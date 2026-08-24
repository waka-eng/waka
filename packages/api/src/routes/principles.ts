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
 * The matrix: curation is owner-side (the human session, who is admin of
 * every profile in the account; an agent session only on its own profile).
 * An agent session READS its human's principles — the conditioning use case —
 * but never writes them: principles are curation, and capture does not
 * extend to curation.
 */

import { recordConsultation } from "../lib/consultations.js";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import {
  inspirations,
  profiles,
  type Principle,
  principles,
  principleSignals,
  principleTypeValues,
  signals,
} from "../db/index.js";
import { getDb } from "../lib/db.js";
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
  refreshPrinciplesForProfile,
} from "../lib/principle-generation.js";
import { normalizeSupportedLocale } from "../lib/locales.js";
import { loadProfileTarget, resolveProfileScope } from "./signals.js";

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
  type: (typeof principleTypeValues)[number];
  state: "held" | "aspirational" | "contested";
  origin: "minted" | "declared";
  rank: number;
  locked: boolean;
  heldSince: string | null;
  conflictsWithId: string | null;
  citedSignals: Array<{ id: string; statement: string }>;
  createdAt: string;
}

async function loadPrincipleViews(db: WakaDb, profileId: string): Promise<PrincipleView[]> {
  const rows = await db
    .select()
    .from(principles)
    .where(eq(principles.profileId, profileId))
    .orderBy(asc(principles.rank));
  if (rows.length === 0) return [];

  const citationRows = await db
    .select({
      principleId: principleSignals.principleId,
      signalId: principleSignals.signalId,
      statement: signals.statement,
    })
    .from(principleSignals)
    .innerJoin(signals, eq(signals.id, principleSignals.signalId))
    .where(
      inArray(
        principleSignals.principleId,
        rows.map((row) => row.id),
      ),
    );
  const citationsByPrinciple = new Map<string, Array<{ id: string; statement: string }>>();
  for (const row of citationRows) {
    const cited = { id: row.signalId, statement: row.statement };
    const bucket = citationsByPrinciple.get(row.principleId);
    if (bucket) bucket.push(cited);
    else citationsByPrinciple.set(row.principleId, [cited]);
  }

  return rows.map((row) => ({
    id: row.id,
    statement: row.statement,
    type: row.type,
    state: row.state,
    origin: row.origin,
    rank: row.rank,
    locked: row.lockedAt !== null,
    heldSince: row.heldSince?.toISOString() ?? null,
    conflictsWithId: row.conflictsWithId,
    citedSignals: citationsByPrinciple.get(row.id) ?? [],
    createdAt: row.createdAt.toISOString(),
  }));
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
        : view.state;
    lines.push(`${view.rank}. \`${shortId(view.id)}\` (${marker}) — ${view.statement}`);
  }
  lines.push("");
  lines.push(
    `— ${views.length} principle${views.length === 1 ? "" : "s"} · generated nightly · this rendering ${renderedAt.toISOString().slice(0, 10)}`,
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
        { error: "Invalid declaration", details: parsed.error.flatten().fieldErrors },
        400,
      );
    }

    const session = c.get("session");
    const provider = await getProvider();
    // Internal routing — the tests run, the outcome is a destination, and no
    // verdict travels back with the response.
    const route = await provider
      .routeDeclaration({
        preferredLocale: normalizeSupportedLocale(session.profile.preferredLocale),
        statement: parsed.data.statement,
      })
      .catch(() => ({ route: "inspiration" as const, type: "maxim" as const }));

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
      return c.json({ error: "Invalid edit", details: parsed.error.flatten().fieldErrors }, 400);
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
      return c.json({ error: "Invalid order", details: parsed.error.flatten().fieldErrors }, 400);
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

    const [profileRow] = await db
      .select({ name: profiles.name, type: profiles.type })
      .from(profiles)
      .where(eq(profiles.id, scope.profileId))
      .limit(1);
    if (!profileRow) return c.json({ error: "Profile not found" }, 404);

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
