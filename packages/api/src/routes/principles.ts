/**
 * `/api/principles` — layer 4: how the profile chooses.
 *
 *   GET    /api/principles           the ranked set (?profile= under the matrix)
 *   GET    /api/principles.md        the canonical machine rendering (same matrix)
 *   POST   /api/principles           declare — routed internally, never refused
 *   PATCH  /api/principles/:id       edit a statement (locks it)
 *   DELETE /api/principles/:id       remove one
 *   POST   /api/principles/reorder   the owner's order — sticky against generation
 *
 * There is deliberately NO refresh endpoint: generation belongs to the
 * nightly cron alone (owner decision; a source-scan test enforces it).
 *
 * Declarations are routed, never refused: validation (context, directive,
 * completion) runs internally, and words that are really a rule or a goal are
 * kept as an inspiration — where they already belong, as evidence. The
 * response states what was created; no test verdict travels with it.
 *
 * When the tests cannot RUN, that is not a routing outcome and is not
 * reported as one: POST answers 503 `retryable` and writes nothing, so an
 * outage can never be mistaken — by a person or by a later screen — for a
 * judgment that their words were not a principle.
 *
 * The matrix: curation is owner-side (the human session, who is admin of
 * every profile in the account; an agent session only on its own profile).
 * An agent session READS its human's principles — the conditioning use case —
 * but never writes them: principles are curation, and capture does not
 * extend to curation.
 */

import { recordConsultation } from "../lib/consultations.js";
import { and, asc, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { personalPrincipleReadable, personalPrincipleSupportCurrent, personalSignalReadable } from '../lib/personal-output.js';
import { citationBodyCurrent, citationStatementCurrent, evidenceSupportCurrent } from '../lib/signal-support-state.js';
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import {
  inspirations,
  feedback,
  profiles,
  type Principle,
  principles,
  principleSignals,
  principleTypeValues,
  signals,
  signalEvidence,
} from "../db/index.js";
import { getDb } from "../lib/db.js";
import { feedbackWordingCurrent } from '../lib/feedback-revisions.js';
import type { DeclarationRoute } from "../lib/model-provider.js";
import { requireAuth, type AuthEnv } from "../lib/middleware.js";
import {
  revertPrincipleStatement,
  writePrincipleStatementChain,
} from "../lib/statement-chains.js";
import {
  getDefaultModelProvider,
  type ModelProvider,
} from "../lib/model-provider.js";
import {
  PRINCIPLE_MAX_STATEMENT_LENGTH,
  PRINCIPLE_MIN_SIGNALS,
  refreshPrinciplesForProfile,
} from "../lib/principle-generation.js";
import { normalizeSupportedLocale } from "../lib/locales.js";
import { validationDetails } from "../lib/validation.js";
import { loadProfileTarget, resolveProfileScope } from "./signals.js";
import { loadPrincipleStatus, requestPrincipleRefresh } from "../lib/principle-status.js";
import { groupPrincipleReadable, groupSignalReadable } from "../lib/group-output.js";

type WakaDb = ReturnType<typeof getDb>;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const scopeQuerySchema = z
  .object({ profile: z.string().uuid("profile must be a uuid").optional() })
  .strict();

const principleParamsSchema = z.object({
  principleId: z.string().uuid("principleId must be a uuid"),
});

const declareSchema = z
  .object({
    statement: z
      .string()
      .trim()
      .min(1, "statement is required")
      .max(PRINCIPLE_MAX_STATEMENT_LENGTH, "statement is too long"),
  })
  .strict();

const editSchema = declareSchema;

const reorderSchema = z
  .object({
    order: z.array(z.string().uuid()).min(1, "order cannot be empty"),
  })
  .strict();

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

export interface PrincipleView {
  id: string;
  statement: string;
  statementRevision?: string;
  type: (typeof principleTypeValues)[number];
  state: "held" | "aspirational" | "contested";
  origin: "minted" | "declared";
  rank: number;
  locked: boolean;
  /** Previously demonstrated support was withdrawn; human wording remains. */
  unsupported?: boolean;
  supportChanged?: boolean;
  heldSince: string | null;
  conflictsWithId: string | null;
  citedSignals: Array<{ id: string; statement: string; examples?: Array<{ text: string; createdAt: string }>; reviewExamples?: Array<{answerId:string;sessionId:string;preview:string;createdAt:string}> }>;
  createdAt: string;
  disputeId?: string | null;
}

export async function loadPrincipleViews(db: WakaDb, profileId: string): Promise<PrincipleView[]> {
  const [profile] = await db.select({ groupId: profiles.groupId }).from(profiles)
    .where(eq(profiles.id, profileId)).limit(1);
  const rows = await db
    .select({ ...getTableColumns(principles), supportCurrent: profile?.groupId
      ? groupPrincipleReadable(profile.groupId, PRINCIPLE_MIN_SIGNALS) : personalPrincipleSupportCurrent(profileId, PRINCIPLE_MIN_SIGNALS) })
    .from(principles)
    .where(and(eq(principles.profileId, profileId),
      ...(profile?.groupId ? [groupPrincipleReadable(profile.groupId, PRINCIPLE_MIN_SIGNALS)]
        : [personalPrincipleReadable(profileId, PRINCIPLE_MIN_SIGNALS)])))
    .orderBy(asc(principles.rank));
  if (rows.length === 0) return [];

  const citationRows = await db
    .select({
      principleId: principleSignals.principleId,
      signalId: principleSignals.signalId,
      statement: signals.statement,
      current: sql<boolean>`${citationStatementCurrent('principle_signals')} AND ${profile?.groupId
        ? groupSignalReadable(profile.groupId) : personalSignalReadable(profileId)}
        AND ${citationBodyCurrent('principle_signals', 'principles', 'principle_statement_revision', 'statement_revision')}`,
    })
    .from(principleSignals)
    .innerJoin(signals, eq(signals.id, principleSignals.signalId))
    .innerJoin(principles, eq(principles.id, principleSignals.principleId))
    .where(
      inArray(
        principleSignals.principleId,
        rows.map((row) => row.id),
      ),
    );
  const citationsByPrinciple = new Map<string, Array<{ id: string; statement: string }>>();
  const changedSupport = new Set<string>();
  for (const row of citationRows) {
    if (!row.current) { changedSupport.add(row.principleId); continue; }
    const cited = { id: row.signalId, statement: row.statement };
    const bucket = citationsByPrinciple.get(row.principleId);
    if (bucket) bucket.push(cited);
    else citationsByPrinciple.set(row.principleId, [cited]);
  }

  const verdicts = await db.select({ id: feedback.id, targetId: feedback.targetId, value: feedback.value })
    .from(feedback).where(and(eq(feedback.profileId, profileId), eq(feedback.targetType, "principle"),
      feedbackWordingCurrent(),
      inArray(feedback.targetId, rows.map((row) => row.id))))
    .orderBy(desc(feedback.createdAt), desc(feedback.id));
  const latest = new Map<string, typeof verdicts[number]>();
  for (const verdict of verdicts) if (!latest.has(verdict.targetId)) latest.set(verdict.targetId, verdict);

  // Personal source excerpts only. Group profiles own no inspirations, and
  // the owner equality below prevents members' captures leaking through here.
  const examples = await db.execute(sql<{ signalId: string; text: string; createdAt: string }>`
    SELECT source.signal_id AS "signalId", source.text, source.created_at AS "createdAt"
    FROM (
      SELECT ${signalEvidence.signalId} AS signal_id, left(${inspirations.text}, 240) AS text,
        ${inspirations.createdAt} AS created_at,
        row_number() OVER (PARTITION BY ${signalEvidence.signalId} ORDER BY ${inspirations.createdAt} DESC, ${inspirations.id}) AS position
      FROM ${signalEvidence}
      JOIN ${signals} ON ${signals.id} = ${signalEvidence.signalId}
      JOIN ${inspirations} ON ${inspirations.id} = ${signalEvidence.inspirationId}
      WHERE ${signalEvidence.profileId} = ${profileId}::uuid
        AND ${inspirations.profileId} = ${profileId}::uuid
        AND ${evidenceSupportCurrent()}
        AND ${signalEvidence.signalId} IN (
          SELECT ${principleSignals.signalId} FROM ${principleSignals}
          WHERE ${principleSignals.profileId} = ${profileId}::uuid
        )
    ) AS source WHERE source.position <= 2
  `);
  const examplesBySignal = new Map<string, Array<{ text: string; createdAt: string }>>();
  for (const example of examples as unknown as Array<{ signalId: string; text: string; createdAt: string }>) {
    const bucket = examplesBySignal.get(example.signalId) ?? [];
    bucket.push({ text: example.text, createdAt: new Date(example.createdAt).toISOString() });
    examplesBySignal.set(example.signalId, bucket);
  }

  const reviewRows=await db.execute<{signalId:string;answerId:string;sessionId:string;preview:string;createdAt:string}>(sql`
    SELECT source.signal_id AS "signalId",source.answer_id AS "answerId",source.session_id AS "sessionId",source.preview,source.created_at AS "createdAt"
    FROM (
      SELECT e.signal_id,a.id AS answer_id,a.session_id,
        CASE WHEN length(a.answer)>240 THEN left(a.answer,237)||'…' ELSE a.answer END AS preview,a.created_at,
        row_number() OVER(PARTITION BY e.signal_id ORDER BY a.created_at DESC,a.id) AS position
      FROM signal_review_evidence e JOIN review_answers a ON a.profile_id=e.profile_id AND a.id=e.answer_id
      WHERE e.profile_id=${profileId}::uuid AND review_evidence_current(e.profile_id,e.signal_id,e.answer_id)
        AND EXISTS(SELECT 1 FROM principle_signals p WHERE p.profile_id=e.profile_id AND p.signal_id=e.signal_id)
    ) source WHERE source.position<=2 ORDER BY source.signal_id,source.position`);
  const reviewsBySignal=new Map<string,NonNullable<PrincipleView['citedSignals'][number]['reviewExamples']>>();
  for(const row of reviewRows){
    const bucket=reviewsBySignal.get(row.signalId)??[];
    bucket.push({answerId:row.answerId,sessionId:row.sessionId,preview:row.preview,createdAt:new Date(row.createdAt).toISOString()});
    reviewsBySignal.set(row.signalId,bucket);
  }

  return rows.map((row) => ({
    id: row.id,
    statement: row.statement,
    statementRevision: row.statementRevision.toString(),
    type: row.type,
    state: row.state,
    origin: row.origin,
    rank: row.rank,
    locked: row.lockedAt !== null,
    unsupported: row.unsupportedAt != null,
    supportChanged: changedSupport.has(row.id) || (!row.supportCurrent && row.heldSince !== null),
    heldSince: row.heldSince?.toISOString() ?? null,
    conflictsWithId: row.conflictsWithId,
    citedSignals: (changedSupport.has(row.id) ? [] : citationsByPrinciple.get(row.id) ?? []).map((signal) => ({
      ...signal, examples: examplesBySignal.get(signal.id) ?? [],reviewExamples:reviewsBySignal.get(signal.id)??[],
    })),
    createdAt: row.createdAt.toISOString(),
    disputeId: latest.get(row.id)?.value === "not_true" ? latest.get(row.id)!.id : null,
  }));
}

/** Undo exactly the selected user verdict, preserving model-detected conflicts. */
export async function undoPrincipleDispute(db: WakaDb, profileId: string, principleId: string, disputeId: string) {
  return db.transaction(async (tx) => {
    const [principle] = await tx.select().from(principles)
      .where(and(eq(principles.id, principleId), eq(principles.profileId, profileId))).for("update").limit(1);
    if (!principle) return false;
    const predicate = and(eq(feedback.profileId, profileId), eq(feedback.targetType, "principle"), eq(feedback.targetId, principleId));
    const [latest] = await tx.select().from(feedback).where(predicate)
      .orderBy(desc(feedback.createdAt), desc(feedback.id)).limit(1);
    if (latest?.id !== disputeId || latest.value !== "not_true") return true;
    await tx.delete(feedback).where(and(predicate, eq(feedback.id, disputeId)));
    const [previous] = await tx.select().from(feedback).where(and(predicate, feedbackWordingCurrent()))
      .orderBy(desc(feedback.createdAt), desc(feedback.id)).limit(1);
    const state = principle.conflictsWithId || previous?.value === "not_true" ? "contested"
      : principle.unsupportedAt !== null || (principle.origin === "declared" && !principle.heldSince) ? "aspirational" : "held";
    await tx.update(principles).set({ state, updatedAt: new Date() })
      .where(and(eq(principles.id, principleId), eq(principles.profileId, profileId)));
    return true;
  });
}

/**
 * The canonical machine rendering — ONE deterministic markdown document,
 * byte-identical for every consumer. The preamble IS the consumption
 * contract; ids are stable short handles for citing; contested pairs name
 * each other; the trailing line pins the generation stamp to day precision
 * so two same-day renders of the same set are the same bytes.
 */
export function renderPrinciplesMarkdown(
  profile: { name: string; type: "human" | "agent" },
  views: PrincipleView[],
  renderedAt: Date,
): string {
  const shortId = (id: string) => `p-${id.slice(0, 8)}`;
  const lines: string[] = [];
  lines.push(`# Principles — ${profile.name} (${profile.type} profile)`);
  lines.push("");
  lines.push("> This document bounds decisions made on this person's behalf.");
  lines.push("> Principles constrain and veto; they do not pick answers — reason");
  lines.push("> freely inside them. When two conflict, the higher-ranked wins.");
  lines.push("> Cite principle ids in any decision that leaned on them.");
  lines.push("> States: held = demonstrated by this person's history.");
  lines.push("> aspirational = declared in their own words, not yet demonstrated —");
  lines.push("> still binding as their word. contested = under review; rank decides");
  lines.push("> meanwhile.");
  lines.push("");
  if (views.length === 0) {
    lines.push("No principles yet. They are earned from history, or declared.");
  }
  for (const view of views) {
    const marker =
      view.state === "contested" && view.conflictsWithId
        ? `contested, in tension with ${shortId(view.conflictsWithId)}`
        : view.supportChanged && !view.unsupported ? `${view.state}; current support unconfirmed` : view.state;
    lines.push(`${view.rank}. \`${shortId(view.id)}\` (${marker}) — ${view.statement}`);
    if (view.unsupported) {
      lines.push("   Supporting evidence has been withdrawn. Preserve the owner's wording; do not describe it as demonstrated by their history or as rejected by them.");
    } else if (view.supportChanged) {
      lines.push("   Current support is not confirmed. Preserve the owner's wording; do not treat the earlier citations as current proof.");
    }
  }
  lines.push("");
  lines.push(
    `— ${views.length} principle${views.length === 1 ? "" : "s"} · generated from patterns · this rendering ${renderedAt.toISOString().slice(0, 10)}`,
  );
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export interface PrincipleRouteDependencies {
  getDatabase?: typeof getDb;
  getModelProvider?: () => Promise<ModelProvider>;
  loadProfile?: typeof loadProfileTarget;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
}

export function createPrincipleRoutes(deps: PrincipleRouteDependencies = {}): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;
  const getProvider = deps.getModelProvider ?? getDefaultModelProvider;
  const loadProfile = deps.loadProfile ?? loadProfileTarget;

  routes.use("*", deps.authMiddleware ?? requireAuth);

  const resolveRead = async (c: Parameters<MiddlewareHandler<AuthEnv>>[0]) => {
    const parsed = scopeQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return { error: c.json({ error: "Invalid query" }, 400 as const) };
    const scope = await resolveProfileScope(
      getDatabase(),
      c.get("session"),
      parsed.data.profile,
      "read",
      loadProfile,
    );
    if (!scope.ok) return { error: c.json(scope.body, scope.status) };
    return { profileId: scope.profileId };
  };

  routes.get("/", async (c) => {
    const resolved = await resolveRead(c);
    if ("error" in resolved) return resolved.error;
    const db = getDatabase();
    const views = await loadPrincipleViews(db, resolved.profileId);
    /* the read side answers for itself: the JSON list is the serve the MCP
       client actually reads, so it is on the record like the rendering */
    await recordConsultation(db, {
      profileId: resolved.profileId,
      session: c.get("session"),
      surface: "principles",
    });
    return c.json({ principles: views });
  });

  routes.get("/status", async (c) => {
    const resolved = await resolveRead(c);
    if ("error" in resolved) return resolved.error;
    return c.json({ status: await loadPrincipleStatus(getDatabase(), resolved.profileId) });
  });

  routes.post("/refresh", async (c) => {
    // Generation may only be requested for the session's own profile.
    const profileId = c.get("session").profile.id;
    const status = await requestPrincipleRefresh(getDatabase(), profileId, c.req.query("retry") === "1");
    return c.json({ status }, 202);
  });

  routes.delete("/:principleId/disputes/:disputeId", async (c) => {
    const params = z.object({ principleId: z.string().uuid(), disputeId: z.string().uuid() }).safeParse(c.req.param());
    if (!params.success) return c.json({ error: "Invalid dispute" }, 400);
    const query = scopeQuerySchema.safeParse(c.req.query());
    if (!query.success) return c.json({ error: "Invalid query" }, 400);
    const scope = await resolveProfileScope(getDatabase(), c.get("session"), query.data.profile, "write", loadProfile);
    if (!scope.ok) return c.json(scope.body, scope.status);
    const undone = await undoPrincipleDispute(getDatabase(), scope.profileId, params.data.principleId, params.data.disputeId);
    return undone ? c.json({ ok: true }) : c.json({ error: "Principle not found" }, 404);
  });

  /**
   * Declare. Curation is owner-side: the session writes only into its own
   * profile (the human session may also curate its agents' profiles — the
   * admin half of the matrix — via ?profile=).
   */
  routes.post("/", async (c) => {
    const parsedQuery = scopeQuerySchema.safeParse(c.req.query());
    if (!parsedQuery.success) return c.json({ error: "Invalid query" }, 400);
    const db = getDatabase();
    const scope = await resolveProfileScope(
      db,
      c.get("session"),
      parsedQuery.data.profile,
      "write",
      loadProfile,
    );
    if (!scope.ok) return c.json(scope.body, scope.status);

    const rawBody = await c.req.json().catch(() => null);
    const parsed = declareSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid declaration", details: validationDetails(parsed.error) },
        400,
      );
    }

    const session = c.get("session");
    const provider = await getProvider();
    /* Internal routing — the tests run, the outcome is a destination, and no
       verdict travels back with the response.

       WHAT THIS USED TO DO, AND WHY IT WAS WRONG. It ended
       `.catch(() => ({ route: "inspiration" }))`. Every failure of the
       provider — a missing key, a rate limit, a timeout, a malformed
       response — became the same row and the same 201 as a considered
       rejection. A person told WAKA how they choose, WAKA said nothing, and
       their words were filed as a note. Nothing distinguished that from a
       judgment, so no screen built later could distinguish it either.

       The product rule is that no REFUSAL is ever shown. It is not that
       nothing is ever said. "We could not consider this yet" is the other
       sentence, and it is the honest one when the judge never sat. The
       statement is not written anywhere on this path: a declaration the
       person can send again is better than a note they did not ask for. */
    let route: DeclarationRoute;
    try {
      route = await provider.routeDeclaration({
        preferredLocale: normalizeSupportedLocale(session.profile.preferredLocale),
        statement: parsed.data.statement,
      });
    } catch (err) {
      console.warn("[principles] declaration could not be routed", err);
      return c.json(
        {
          error: "Not considered yet",
          /* The client's cue to offer the words back rather than report a
             verdict. Named as a state, not as a reason — the reason is an
             infrastructure detail and is nobody's business on this side. */
          retryable: true,
        },
        503,
      );
    }

    if (route.route === "inspiration") {
      const [row] = await db
        .insert(inspirations)
        .values({
          profileId: scope.profileId,
          text: parsed.data.statement,
          kind: "note",
          source: "app",
        })
        .returning({ id: inspirations.id });
      return c.json({ created: "inspiration", inspirationId: row!.id }, 201);
    }

    const created = await db.transaction(async (tx) => {
      const ranks = await tx
        .select({ rank: principles.rank })
        .from(principles)
        .where(eq(principles.profileId, scope.profileId));
      const nextRank = ranks.length === 0 ? 1 : Math.max(...ranks.map((r) => r.rank)) + 1;
      const [row] = await tx
        .insert(principles)
        .values({
          profileId: scope.profileId,
          statement: parsed.data.statement,
          type: route.type,
          state: "aspirational",
          origin: "declared",
          rank: nextRank,
          // The owner's words, locked from birth.
          lockedAt: new Date(),
        })
        .returning();
      // Chained from birth too — as the owner's words, so revert has
      // nothing machine-side to reach for on a declaration, by design.
      await writePrincipleStatementChain(tx, {
        profileId: scope.profileId,
        principleId: row!.id,
        statement: parsed.data.statement,
        reason: "declared",
      });
      return row!;
    });
    const [view] = await loadPrincipleViews(db, scope.profileId).then((views) =>
      views.filter((v) => v.id === created.id),
    );
    return c.json({ created: "principle", principle: view }, 201);
  });

  routes.patch("/:principleId", async (c) => {
    const params = principleParamsSchema.safeParse(c.req.param());
    if (!params.success) return c.json({ error: "Principle not found" }, 404);
    const parsedQuery = scopeQuerySchema.safeParse(c.req.query());
    if (!parsedQuery.success) return c.json({ error: "Invalid query" }, 400);
    const rawBody = await c.req.json().catch(() => null);
    const parsed = editSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json({ error: "Invalid edit", details: validationDetails(parsed.error) }, 400);
    }

    const db = getDatabase();
    const scope = await resolveProfileScope(
      db,
      c.get("session"),
      parsedQuery.data.profile,
      "write",
      loadProfile,
    );
    if (!scope.ok) return c.json(scope.body, scope.status);

    /* The edit joins the statement chain, and the sentence it replaces is
       seeded first when the machine was still its author (unlocked) and
       nothing recorded it yet — the machine's original survives the very
       edit that would have destroyed it (no-quiet-corners Phase 2). */
    const now = new Date();
    const updated = await db.transaction(async (tx) => {
      const [before] = await tx
        .select({ statement: principles.statement, lockedAt: principles.lockedAt })
        .from(principles)
        .where(
          and(
            eq(principles.id, params.data.principleId),
            eq(principles.profileId, scope.profileId),
          ),
        )
        .limit(1);
      if (!before) return false;

      await writePrincipleStatementChain(tx, {
        profileId: scope.profileId,
        principleId: params.data.principleId,
        statement: parsed.data.statement,
        reason: "edited",
        seedStatement: before.lockedAt === null ? before.statement : null,
        now,
      });
      await tx
        .update(principles)
        .set({ statement: parsed.data.statement, lockedAt: now, updatedAt: now })
        .where(
          and(
            eq(principles.id, params.data.principleId),
            eq(principles.profileId, scope.profileId),
          ),
        );
      return true;
    });
    if (!updated) return c.json({ error: "Principle not found" }, 404);

    const [view] = await loadPrincipleViews(db, scope.profileId).then((views) =>
      views.filter((v) => v.id === params.data.principleId),
    );
    return c.json({ principle: view });
  });

  /**
   * The lock's third verb, at layer 4. Restores the machine's minted
   * sentence byte-for-byte from the chain and clears the lock. A declared
   * principle has no machine original — the chain holds only the owner's
   * words — and the verb says so rather than inventing one.
   */
  routes.post("/:principleId/revert", async (c) => {
    const params = principleParamsSchema.safeParse(c.req.param());
    if (!params.success) return c.json({ error: "Principle not found" }, 404);
    const parsedQuery = scopeQuerySchema.safeParse(c.req.query());
    if (!parsedQuery.success) return c.json({ error: "Invalid query" }, 400);

    const db = getDatabase();
    const scope = await resolveProfileScope(
      db,
      c.get("session"),
      parsedQuery.data.profile,
      "write",
      loadProfile,
    );
    if (!scope.ok) return c.json(scope.body, scope.status);

    const result = await revertPrincipleStatement(db, {
      profileId: scope.profileId,
      principleId: params.data.principleId,
    });
    if (result.outcome === "not_found") return c.json({ error: "Principle not found" }, 404);
    if (result.outcome === "nothing_to_revert") {
      return c.json(
        { error: "No machine statement to return to — the chain holds only your own words" },
        409,
      );
    }

    const [view] = await loadPrincipleViews(db, scope.profileId).then((views) =>
      views.filter((v) => v.id === params.data.principleId),
    );
    return c.json({ principle: view });
  });

  routes.delete("/:principleId", async (c) => {
    const params = principleParamsSchema.safeParse(c.req.param());
    if (!params.success) return c.json({ error: "Principle not found" }, 404);
    const parsedQuery = scopeQuerySchema.safeParse(c.req.query());
    if (!parsedQuery.success) return c.json({ error: "Invalid query" }, 400);

    const db = getDatabase();
    const scope = await resolveProfileScope(
      db,
      c.get("session"),
      parsedQuery.data.profile,
      "write",
      loadProfile,
    );
    if (!scope.ok) return c.json(scope.body, scope.status);

    const deleted = await db.transaction(async (tx) => {
      // A conflict partner keeps its contested state (the dispute was real)
      // but must not point at a row that no longer exists.
      await tx
        .update(principles)
        .set({ conflictsWithId: null })
        .where(
          and(
            eq(principles.profileId, scope.profileId),
            eq(principles.conflictsWithId, params.data.principleId),
          ),
        );
      return tx
        .delete(principles)
        .where(
          and(
            eq(principles.id, params.data.principleId),
            eq(principles.profileId, scope.profileId),
          ),
        )
        .returning({ id: principles.id });
    });
    if (deleted.length === 0) return c.json({ error: "Principle not found" }, 404);
    return c.json({ deleted: true });
  });

  /**
   * The owner's order. Sticky: every listed row gets owner_ranked_at, and
   * generation thereafter only appends. Two-pass rank write because the
   * per-profile unique index would reject a permutation applied in place.
   */
  routes.post("/reorder", async (c) => {
    const parsedQuery = scopeQuerySchema.safeParse(c.req.query());
    if (!parsedQuery.success) return c.json({ error: "Invalid query" }, 400);
    const rawBody = await c.req.json().catch(() => null);
    const parsed = reorderSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json({ error: "Invalid order", details: validationDetails(parsed.error) }, 400);
    }

    const db = getDatabase();
    const scope = await resolveProfileScope(
      db,
      c.get("session"),
      parsedQuery.data.profile,
      "write",
      loadProfile,
    );
    if (!scope.ok) return c.json(scope.body, scope.status);

    const rows = await db
      .select({ id: principles.id })
      .from(principles)
      .where(eq(principles.profileId, scope.profileId));
    const known = new Set(rows.map((row) => row.id));
    const order = parsed.data.order;
    if (order.length !== known.size || !order.every((id) => known.has(id))) {
      return c.json({ error: "Order must list every principle exactly once" }, 400);
    }

    const now = new Date();
    await db.transaction(async (tx) => {
      for (let i = 0; i < order.length; i += 1) {
        await tx
          .update(principles)
          .set({ rank: -(i + 1) })
          .where(and(eq(principles.id, order[i]!), eq(principles.profileId, scope.profileId)));
      }
      for (let i = 0; i < order.length; i += 1) {
        await tx
          .update(principles)
          .set({ rank: i + 1, ownerRankedAt: now, updatedAt: now })
          .where(and(eq(principles.id, order[i]!), eq(principles.profileId, scope.profileId)));
      }
    });

    return c.json({ principles: await loadPrincipleViews(db, scope.profileId) });
  });

  /**
   * E2e-only: run generation for the acting profile, now. Registered ONLY
   * when WAKA_ENABLE_PRINCIPLES_TEST_TRIGGER=1 — absent in deployed stages,
   * where the nightly cron is the sole path into generation. Calls
   * refreshPrinciplesForProfile directly rather than enqueueing, so the
   * source-scan pin ("the cron is the sole enqueuer") holds even here.
   */
  if (process.env.WAKA_ENABLE_PRINCIPLES_TEST_TRIGGER === "1") {
    routes.post("/refresh-test-trigger", async (c) => {
      const session = c.get("session");
      void refreshPrinciplesForProfile({ profileId: session.profile.id })
        .then((result) => console.log("[principles] test trigger ran", result))
        .catch((err) => {
          console.warn("[principles] test trigger failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      return c.json({ status: "running" }, 202);
    });
  }

  return routes;
}

/**
 * `GET /api/principles.md` — mounted as a sibling of the JSON routes because
 * the canonical URL is a document, not a collection member. Same matrix as
 * the list; one renderer, no second shape.
 */
export function createPrincipleMarkdownRoute(
  deps: PrincipleRouteDependencies = {},
): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;
  const loadProfile = deps.loadProfile ?? loadProfileTarget;

  routes.use("*", deps.authMiddleware ?? requireAuth);

  routes.get("/", async (c) => {
    const parsed = scopeQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: "Invalid query" }, 400);
    const db = getDatabase();
    const scope = await resolveProfileScope(
      db,
      c.get("session"),
      parsed.data.profile,
      "read",
      loadProfile,
    );
    if (!scope.ok) return c.json(scope.body, scope.status);

    const [profileRaw] = await db
      .select({ name: profiles.name, type: profiles.type })
      .from(profiles)
      .where(eq(profiles.id, scope.profileId))
      .limit(1);
    // Room principles are served through group membership, never personal scope.
    if (!profileRaw || profileRaw.type === "group") {
      return c.json({ error: "Profile not found" }, 404);
    }
    const profileRow = { name: profileRaw.name, type: profileRaw.type };

    const views = await loadPrincipleViews(db, scope.profileId);
    const renderedAt = new Date();
    const markdown = renderPrinciplesMarkdown(profileRow, views, renderedAt);
    /* the read side answers for itself: the canonical document is a daily
       rendering, so the day-stamp is its version receipt */
    await recordConsultation(db, {
      profileId: scope.profileId,
      session: c.get("session"),
      surface: "principles",
      renderedOn: renderedAt,
    });
    return c.text(markdown, 200, { "Content-Type": "text/markdown; charset=utf-8" });
  });

  return routes;
}

export const principlesRoutes = createPrincipleRoutes();
export const principlesMarkdownRoutes = createPrincipleMarkdownRoute();
export type { Principle };
