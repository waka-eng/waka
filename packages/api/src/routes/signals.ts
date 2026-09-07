/**
 * `/api/signals` — layer 2: the profile's distilled, evidence-backed patterns.
 *
 * This is the curated surface, not the archive. Raw captures live behind
 * `/api/inspirations`; what a reader gets here is the statement WAKA distilled
 * from them, what supports it, and how sure it is.
 *
 * Three rules shape every handler below:
 *
 *   - **A read may cross profiles; a write mostly may not.** An agent-bound
 *     session reading the human profile's signals is the conditioning case
 *     the permission matrix exists for. `resolveProfileAccess` decides, from
 *     facts the server controls, and nothing here is inferred from a header.
 *   - **An edit locks.** PATCH sets `lockedAt`, and from that moment
 *     regeneration may keep attaching evidence but never rewrites the text.
 *     That is the whole of the edit rule, and it is enforced by writing the
 *     timestamp here rather than by asking the generator to be careful.
 *   - **Sharing exposes the statement, never the evidence.** A share is a
 *     per-signal, per-group act by the signal's owner. The inspirations
 *     behind it never cross an account boundary.
 */

import { recordConsultation } from "../lib/consultations.js";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";

import { buildLikePattern } from "./inspirations-recall.js";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import {
  experiences,
  feedback,
  inspirations,
  profiles,
  signalEvidence,
  signalShares,
  signalContradictions,
  signalStatusValues,
  signals,
  type SignalStatus,
} from "../db/index.js";
import { getDb } from "../lib/db.js";
import {
  profileAccessError,
  requireAuth,
  type AuthEnv,
  type ProfileOperation,
  asAccountProfile,
} from "../lib/middleware.js";
import { enqueueSignalReembed, enqueueTopOfMindRefresh } from "../lib/queue.js";
import { reconcilePrinciplesAfterSignalLoss } from "../lib/principle-generation.js";
import {
  computeSignalConfidence,
  dropSignalEmbedding,
  refreshSignalLifecycle,
} from "../lib/signal-derivation.js";
import { resolveContestedPairs } from "../lib/contested-pairs.js";
import {
  revertSignalStatement,
  writeSignalStatementChain,
} from "../lib/statement-chains.js";
import type { AuthenticatedSession } from "../lib/session.js";
import { validationDetails } from "../lib/validation.js";

type WakaDb = ReturnType<typeof getDb>;

const DEFAULT_SIGNAL_LIMIT = 80;
const MAX_SIGNAL_LIMIT = 200;
const MAX_EVIDENCE_PREVIEW_LENGTH = 220;
const MAX_STATEMENT_LENGTH = 500;

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

const limitSchema = z
  .string()
  .regex(/^\d+$/, "limit must be an integer")
  .transform((value) => Number.parseInt(value, 10))
  .pipe(
    z
      .number()
      .int("limit must be an integer")
      .min(1, "limit must be at least 1")
      .max(MAX_SIGNAL_LIMIT, `limit must be <= ${MAX_SIGNAL_LIMIT}`),
  );

const listSignalsQuerySchema = z
  .object({
    status: z.enum(signalStatusValues).optional(),
    /**
     * SCOPED RECALL (meeting, 2026-08-17). An agent working one concern must
     * be able to ask for the signals ABOUT that concern instead of paging the
     * whole wall through its context window — "이런 프로젝트 관련한 시그널만
     * 보고 싶어", asked for as a query parameter on exactly this route. Same
     * two-pronged match the layer-1 recall uses: tsquery for words, ilike for
     * fragments, because a statement is one sentence and either alone misses.
     */
    q: z.string().trim().min(1).max(200).optional(),
    /** Only the signals evidenced by memories kept during this experience. */
    experience: z.string().trim().min(1).max(80).optional(),
    limit: limitSchema.optional(),
    /** Read another profile in the same account, per the permission matrix. */
    profile: z.string().uuid("profile must be a uuid").optional(),
  })
  .strict();

const signalScopeQuerySchema = z
  .object({ profile: z.string().uuid("profile must be a uuid").optional() })
  .strict();

const signalParamsSchema = z.object({
  signalId: z.string().uuid("signalId must be a uuid"),
});

const updateSignalBodySchema = z
  .object({
    statement: z
      .string()
      .trim()
      .min(1, "statement cannot be empty")
      .max(MAX_STATEMENT_LENGTH, `statement must be <= ${MAX_STATEMENT_LENGTH} characters`),
  })
  .strict();

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export interface SignalSummary {
  id: string;
  statement: string;
  status: SignalStatus;
  confidence: number;
  evidenceCount: number;
  lastEvidenceAt: string | null;
  /** A human edited the statement; regeneration will not rewrite it. */
  locked: boolean;
  /** Locked, but every capture behind it is gone. */
  unsupported: boolean;
  /** Thrown out by the owner. The row and evidence stay; its vector is now a
      suppression anchor — derivation refuses candidates near it, on the
      record. Dismissed rows also read `status: "retired"`. */
  dismissed: boolean;
  /** Standing in an unresolved contradicts pair — awaiting the owner's
      arbitration, which is the only kind there is. Computed from the pair
      rows at serve time, never stored on the signal. */
  contested: boolean;
  /** The side that gave way when its owner settled a pair — a state read
      off the resolution, never a deletion. */
  yielded: boolean;
  sharedGroupIds: string[];
  createdAt: string;
}

export interface SignalEvidenceItem {
  inspirationId: string;
  /** A bounded excerpt of the capture — enough to recognize, not the whole. */
  preview: string;
  reason: string | null;
  quote: string | null;
  /** Whose words the quote is ("own" | "enrichment"). Null when there is no
      quote, or when the quote predates span verification — a consumer must
      treat a null-source quote as unverified. */
  quoteSource: "own" | "enrichment" | null;
  createdAt: string;
}

export interface SignalDetail extends SignalSummary {
  evidence: SignalEvidenceItem[];
}

export interface ListSignalsInput {
  profileId: string;
  status?: SignalStatus;
  /** Full-text over the statements; see `listSignalsQuerySchema.q`. */
  query?: string;
  /** Only signals evidenced from this named experience's memories. */
  experience?: string;
  limit: number;
}

export interface GetSignalInput {
  profileId: string;
  signalId: string;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function truncatePreview(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_EVIDENCE_PREVIEW_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_EVIDENCE_PREVIEW_LENGTH - 3).trimEnd()}...`;
}

/**
 * Evidence counts and share memberships are fetched per page rather than as
 * correlated subqueries on the signal row: two bounded lookups keyed by the
 * ids already in hand, instead of a count that re-runs for every row.
 */
async function decorateSignals(
  db: WakaDb,
  ownerProfileId: string,
  rows: Array<{
    id: string;
    statement: string;
    status: SignalStatus;
    confidence: number;
    lastEvidenceAt: Date | null;
    lockedAt: Date | null;
    unsupportedAt: Date | null;
    dismissedAt: Date | null;
    createdAt: Date;
  }>,
): Promise<SignalSummary[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);

  const [evidenceRows, shareRows, pairRows, verdictRows] = await Promise.all([
    db
      .select({
        signalId: signalEvidence.signalId,
        createdAt: inspirations.createdAt,
        source: inspirations.source,
      })
      .from(signalEvidence)
      .innerJoin(inspirations, eq(inspirations.id, signalEvidence.inspirationId))
      .where(inArray(signalEvidence.signalId, ids)),
    db
      .select({ signalId: signalShares.signalId, groupId: signalShares.groupId })
      .from(signalShares)
      .where(inArray(signalShares.signalId, ids)),
    db
      .select({
        aSignalId: signalContradictions.aSignalId,
        bSignalId: signalContradictions.bSignalId,
        resolvedAt: signalContradictions.resolvedAt,
        yieldedSignalId: signalContradictions.yieldedSignalId,
      })
      .from(signalContradictions)
      .where(
        or(
          inArray(signalContradictions.aSignalId, ids),
          inArray(signalContradictions.bSignalId, ids),
        ),
      ),
    db
      .select({ targetId: feedback.targetId, value: feedback.value })
      .from(feedback)
      .where(
        and(
          /* the OWNER's verdicts only — room members also file feedback on
             shared signals, and their stances are the room's business, not
             this number's */
          eq(feedback.profileId, ownerProfileId),
          eq(feedback.targetType, "signal"),
          inArray(feedback.targetId, ids),
        ),
      )
      .orderBy(desc(feedback.createdAt)),
  ]);

  /* latest-wins, the standing verdict — the same read selection makes */
  const latestVerdict = new Map<string, string>();
  for (const row of verdictRows) {
    if (!latestVerdict.has(row.targetId)) latestVerdict.set(row.targetId, row.value);
  }

  // Contested and yielded are read off the pair rows at serve time — the
  // relation is the record, and the signal row is never mutated to mirror
  // it (the same rule ratified standing follows on the poster).
  const contestedIds = new Set<string>();
  const yieldedIds = new Set<string>();
  for (const pair of pairRows) {
    if (pair.resolvedAt === null) {
      contestedIds.add(pair.aSignalId);
      contestedIds.add(pair.bSignalId);
    } else if (pair.yieldedSignalId) {
      yieldedIds.add(pair.yieldedSignalId);
    }
  }

  // Confidence is computed from the evidence at read time, not served from
  // the stored snapshot. The snapshot is written when evidence changes, which
  // is precisely the moment its recency term is at its maximum — so a stored
  // value can only overstate a signal that has since gone quiet. Reads tell
  // the truth about now; the snapshot remains for the group wall, whose query
  // must not reach these private tables.
  const evidenceBySignal = new Map<string, Array<{ createdAt: Date; source: "app" | "agent" }>>();
  for (const row of evidenceRows) {
    const bucket = evidenceBySignal.get(row.signalId);
    if (bucket) bucket.push(row);
    else evidenceBySignal.set(row.signalId, [row]);
  }
  const now = new Date();
  const liveConfidence = new Map(
    rows.map((row) => [
      row.id,
      computeSignalConfidence(evidenceBySignal.get(row.id) ?? [], now, {
        affirmed: latestVerdict.get(row.id) === "true",
      }),
    ]),
  );

  const countBySignal = new Map(
    [...evidenceBySignal.entries()].map(([id, list]) => [id, list.length]),
  );
  const groupsBySignal = new Map<string, string[]>();
  for (const row of shareRows) {
    const bucket = groupsBySignal.get(row.signalId);
    if (bucket) bucket.push(row.groupId);
    else groupsBySignal.set(row.signalId, [row.groupId]);
  }

  // The SQL pre-sort used the stored snapshots; live values decay
  // independently, so restore the promised order before serializing.
  const ordered = [...rows].sort((a, b) => {
    const ca = liveConfidence.get(a.id) ?? 0;
    const cb = liveConfidence.get(b.id) ?? 0;
    if (cb !== ca) return cb - ca;
    const ra = a.lastEvidenceAt?.getTime() ?? 0;
    const rb = b.lastEvidenceAt?.getTime() ?? 0;
    if (rb !== ra) return rb - ra;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  return ordered.map((row) => ({
    id: row.id,
    statement: row.statement,
    status: row.status,
    confidence: liveConfidence.get(row.id) ?? 0,
    evidenceCount: countBySignal.get(row.id) ?? 0,
    lastEvidenceAt: toIso(row.lastEvidenceAt),
    locked: row.lockedAt !== null,
    unsupported: row.unsupportedAt !== null,
    dismissed: row.dismissedAt !== null,
    contested: contestedIds.has(row.id),
    yielded: yieldedIds.has(row.id),
    sharedGroupIds: groupsBySignal.get(row.id) ?? [],
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function listProfileSignals(
  db: WakaDb,
  input: ListSignalsInput,
): Promise<SignalSummary[]> {
  const rows = await db
    .select({
      id: signals.id,
      statement: signals.statement,
      status: signals.status,
      confidence: signals.confidence,
      lastEvidenceAt: signals.lastEvidenceAt,
      lockedAt: signals.lockedAt,
      unsupportedAt: signals.unsupportedAt,
      dismissedAt: signals.dismissedAt,
      createdAt: signals.createdAt,
    })
    .from(signals)
    .where(
      and(
        eq(signals.profileId, input.profileId),
        ...(input.status ? [eq(signals.status, input.status)] : []),
        ...(input.query
          ? [
              or(
                sql`to_tsvector('simple', ${signals.statement}) @@ plainto_tsquery('simple', ${input.query})`,
                sql`${signals.statement} ilike ${buildLikePattern(input.query)} escape '!'`,
              )!,
            ]
          : []),
        /* A signal's relation to an experience is a fact of its EVIDENCE —
           which memories stand under it and where they were kept — so the
           filter walks evidence → inspiration → experience rather than
           reading a stored link that could drift (meeting, 2026-08-17). */
        ...(input.experience
          ? [
              inArray(
                signals.id,
                db
                  .select({ id: signalEvidence.signalId })
                  .from(signalEvidence)
                  .innerJoin(
                    inspirations,
                    eq(inspirations.id, signalEvidence.inspirationId),
                  )
                  .innerJoin(
                    experiences,
                    and(
                      eq(experiences.id, inspirations.experienceId),
                      eq(experiences.profileId, input.profileId),
                      eq(experiences.name, input.experience),
                    ),
                  ),
              ),
            ]
          : []),
      ),
    )
    .orderBy(desc(signals.confidence), desc(signals.lastEvidenceAt), desc(signals.createdAt))
    .limit(input.limit);

  return decorateSignals(db, input.profileId, rows);
}

export async function getProfileSignal(
  db: WakaDb,
  input: GetSignalInput,
): Promise<SignalDetail | null> {
  const [row] = await db
    .select({
      id: signals.id,
      statement: signals.statement,
      status: signals.status,
      confidence: signals.confidence,
      lastEvidenceAt: signals.lastEvidenceAt,
      lockedAt: signals.lockedAt,
      unsupportedAt: signals.unsupportedAt,
      dismissedAt: signals.dismissedAt,
      createdAt: signals.createdAt,
    })
    .from(signals)
    .where(and(eq(signals.id, input.signalId), eq(signals.profileId, input.profileId)))
    .limit(1);
  if (!row) return null;

  const [summary] = await decorateSignals(db, input.profileId, [row]);
  if (!summary) return null;

  const evidenceRows = await db
    .select({
      inspirationId: signalEvidence.inspirationId,
      reason: signalEvidence.reason,
      quote: signalEvidence.quote,
      quoteSource: signalEvidence.quoteSource,
      /* dated by the CAPTURE that witnesses it (dev, PR #266): evidence is
         as old as the memory, not as the pass that noticed it */
      createdAt: inspirations.createdAt,
      text: inspirations.text,
    })
    .from(signalEvidence)
    .innerJoin(inspirations, eq(inspirations.id, signalEvidence.inspirationId))
    .where(eq(signalEvidence.signalId, input.signalId))
    .orderBy(desc(inspirations.createdAt));

  return {
    ...summary,
    evidence: evidenceRows.map((evidence) => ({
      inspirationId: evidence.inspirationId,
      preview: truncatePreview(evidence.text),
      reason: evidence.reason,
      quote: evidence.quote,
      quoteSource: evidence.quoteSource,
      createdAt: evidence.createdAt.toISOString(),
    })),
  };
}

/**
 * A human edit freezes the statement. `lockedAt` is set in the same statement
 * that writes the text so there is no window in which an edited signal is
 * unlocked and a concurrent regeneration could overwrite it.
 *
 * The edit also joins the statement chain — and the sentence it replaces is
 * seeded into the chain first when nothing recorded it yet and the machine
 * was still its author (unlocked), so the machine's original survives the
 * very edit that would have destroyed it (no-quiet-corners Phase 2).
 */
export async function updateSignalStatement(
  db: WakaDb,
  input: { profileId: string; signalId: string; statement: string; now?: Date },
): Promise<SignalDetail | null> {
  const now = input.now ?? new Date();
  const changed = await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ statement: signals.statement, lockedAt: signals.lockedAt })
      .from(signals)
      .where(and(eq(signals.id, input.signalId), eq(signals.profileId, input.profileId)))
      .limit(1);
    if (!before) return false;

    await writeSignalStatementChain(tx, {
      profileId: input.profileId,
      signalId: input.signalId,
      statement: input.statement,
      reason: "edited",
      /* only an unlocked pre-edit sentence is the machine's to seed */
      seedStatement: before.lockedAt === null ? before.statement : null,
      now,
    });
    await tx
      .update(signals)
      .set({ statement: input.statement, lockedAt: now, updatedAt: now })
      .where(and(eq(signals.id, input.signalId), eq(signals.profileId, input.profileId)));
    /* holding these words is an arbitration: any pair this signal stands in
       resolves in its favor — the owner's act, never evidence weight */
    await resolveContestedPairs(tx, {
      profileId: input.profileId,
      signalId: input.signalId,
      act: "lock",
      now,
    });
    return true;
  });
  if (!changed) return null;

  return getProfileSignal(db, { profileId: input.profileId, signalId: input.signalId });
}

/**
 * Release a locked signal — the unlock the canon promised ("unlocking is an
 * explicit human act"). The words stay exactly as the person left them;
 * derivation may simply restate them again from the next pass on.
 *
 * One consequence is applied at the same moment rather than left for a later
 * pass to trip over: a locked signal that lost all its evidence was kept as
 * `unsupported` only because the words were the person's. Releasing those
 * words is accepting the standing rule for generated signals — no evidence,
 * no signal — so the release retires it in the same UPDATE. Idempotent: an
 * unlocked signal releases to itself.
 */
export async function releaseSignalStatement(
  db: WakaDb,
  input: { profileId: string; signalId: string },
): Promise<SignalDetail | null> {
  const updated = await db
    .update(signals)
    .set({
      lockedAt: null,
      status: sql`case when ${signals.unsupportedAt} is not null then 'retired'::signal_status else ${signals.status} end`,
      unsupportedAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(signals.id, input.signalId), eq(signals.profileId, input.profileId)))
    .returning({ id: signals.id });
  if (updated.length === 0) return null;

  return getProfileSignal(db, { profileId: input.profileId, signalId: input.signalId });
}

/**
 * Throw a pattern out without deleting anything. The row, its evidence, its
 * shares and its embedding all stay; what changes is standing: `retired`
 * takes it out of the match scan and the top of mind (the exclusions retired
 * rows already have), and `dismissedAt` makes its vector a SUPPRESSION
 * ANCHOR — from this moment derivation refuses any candidate near it and
 * writes the refusal down (goals/the-legible-loop.md Phase 3).
 *
 * `coalesce` keeps the FIRST dismissal time on a repeat: "since when has the
 * ground refused this" is a fact about the owner's act, not about the last
 * time a client retried the request.
 */
export async function dismissProfileSignal(
  db: WakaDb,
  input: { profileId: string; signalId: string },
): Promise<SignalDetail | null> {
  const updated = await db
    .update(signals)
    .set({
      status: "retired",
      dismissedAt: sql`coalesce(${signals.dismissedAt}, now())`,
      updatedAt: new Date(),
    })
    .where(and(eq(signals.id, input.signalId), eq(signals.profileId, input.profileId)))
    .returning({ id: signals.id });
  if (updated.length === 0) return null;

  /* throwing a side out settles its disputes — that side yields. Leaving a
     one-sided "contested" standing forever would be a quiet corner. */
  await resolveContestedPairs(db, {
    profileId: input.profileId,
    signalId: input.signalId,
    act: "dismiss",
  });

  return getProfileSignal(db, { profileId: input.profileId, signalId: input.signalId });
}

/**
 * The dismissal's other half — every silence this system creates must be
 * reversible. Clearing `dismissedAt` stops the refusals; standing is then
 * recomputed from the evidence that never went anywhere: back to `emerging`,
 * and the lifecycle pass re-promotes on the spot when the evidence already
 * clears the bar. A signal that was not dismissed keeps its status — restore
 * undoes dismissal, not ordinary retirement.
 */
export async function restoreProfileSignal(
  db: WakaDb,
  input: { profileId: string; signalId: string },
): Promise<SignalDetail | null> {
  const restored = await db.transaction(async (tx) => {
    const updated = await tx
      .update(signals)
      .set({
        status: sql`case when ${signals.dismissedAt} is null then ${signals.status} else 'emerging'::signal_status end`,
        dismissedAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(signals.id, input.signalId), eq(signals.profileId, input.profileId)))
      .returning({ id: signals.id });
    if (updated.length === 0) return false;

    await refreshSignalLifecycle(tx as never, input.signalId, new Date());
    return true;
  });
  if (!restored) return null;

  return getProfileSignal(db, { profileId: input.profileId, signalId: input.signalId });
}

export async function deleteProfileSignal(
  db: WakaDb,
  input: { profileId: string; signalId: string },
): Promise<boolean> {
  const deleted = await db
    .delete(signals)
    .where(and(eq(signals.id, input.signalId), eq(signals.profileId, input.profileId)))
    .returning({ id: signals.id });
  return deleted.length > 0;
}

// ---------------------------------------------------------------------------
// Profile scoping
// ---------------------------------------------------------------------------

export interface ProfileScopeTarget {
  id: string;
  accountId: string;
  /** who the target is — the sibling-grant rule reads it */
  type: "human" | "agent";
}

export async function loadProfileTarget(
  db: WakaDb,
  profileId: string,
): Promise<ProfileScopeTarget | null> {
  const [row] = await db
    .select({ id: profiles.id, accountId: profiles.accountId, type: profiles.type })
    .from(profiles)
    .where(eq(profiles.id, profileId))
    .limit(1);
  /* a room's mind narrows to nothing here: its signals are the room's, read
     through the group routes and their membership gate, never through the
     personal scope machinery */
  return row ? asAccountProfile(row) : null;
}

export type ProfileScopeResolution =
  | { ok: true; profileId: string }
  | { ok: false; status: 403 | 404; body: { error: string } };

/**
 * Resolve which profile a request acts on. Absent an explicit target the
 * answer is the session's own profile, which needs no check — a session may
 * always act on the profile it is bound to.
 *
 * Shared with the layer-3 surface: both `/api/signals` and `/api/top-of-mind`
 * take the same `?profile=` parameter and answer to the same access matrix,
 * and a second copy of a security check is a second copy that can drift.
 */
export async function resolveProfileScope(
  db: WakaDb,
  session: AuthenticatedSession,
  requestedProfileId: string | undefined,
  operation: ProfileOperation,
  loadProfile: typeof loadProfileTarget,
): Promise<ProfileScopeResolution> {
  if (!requestedProfileId || requestedProfileId === session.profile.id) {
    return { ok: true, profileId: session.profile.id };
  }

  const target = await loadProfile(db, requestedProfileId);

  // A profile in another account answers exactly like one that does not
  // exist. Otherwise the pair of status codes is an oracle: 403 means "real
  // id, someone else's" and 404 means "no such id", which lets any caller
  // enumerate real profile ids across the whole install. The 403 below is
  // therefore reserved for a same-account profile the operation forbids —
  // an agent session reaching for write on its human, say — where the caller
  // already knows the profile exists because it is its own account's.
  if (!target || target.accountId !== session.profile.accountId) {
    return { ok: false, status: 404, body: { error: "Profile not found" } };
  }

  const denied = await profileAccessError(db, session, target, operation);
  if (denied) return { ok: false, status: 403, body: denied };

  return { ok: true, profileId: target.id };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export interface SignalRouteDependencies {
  getDatabase?: typeof getDb;
  listSignals?: typeof listProfileSignals;
  getSignal?: typeof getProfileSignal;
  updateStatement?: typeof updateSignalStatement;
  releaseStatement?: typeof releaseSignalStatement;
  dismissSignal?: typeof dismissProfileSignal;
  restoreSignal?: typeof restoreProfileSignal;
  deleteSignal?: typeof deleteProfileSignal;
  loadProfile?: typeof loadProfileTarget;
  dropEmbedding?: typeof dropSignalEmbedding;
  requestReembed?: typeof enqueueSignalReembed;
  requestRefresh?: typeof enqueueTopOfMindRefresh;
  reconcilePrinciples?: typeof reconcilePrinciplesAfterSignalLoss;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
}

export function createSignalRoutes(deps: SignalRouteDependencies = {}): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;
  const listSignals = deps.listSignals ?? listProfileSignals;
  const getSignal = deps.getSignal ?? getProfileSignal;
  const updateStatement = deps.updateStatement ?? updateSignalStatement;
  const releaseStatement = deps.releaseStatement ?? releaseSignalStatement;
  const dismissSignal = deps.dismissSignal ?? dismissProfileSignal;
  const restoreSignal = deps.restoreSignal ?? restoreProfileSignal;
  const deleteSignal = deps.deleteSignal ?? deleteProfileSignal;
  const loadProfile = deps.loadProfile ?? loadProfileTarget;
  const dropEmbedding = deps.dropEmbedding ?? dropSignalEmbedding;
  const requestReembed = deps.requestReembed ?? enqueueSignalReembed;
  const requestRefresh = deps.requestRefresh ?? enqueueTopOfMindRefresh;
  const reconcilePrinciples = deps.reconcilePrinciples ?? reconcilePrinciplesAfterSignalLoss;

  /**
   * Curating a signal changes what the artifact should be built from, so the
   * top of mind is re-synthesised in the background. Best-effort on purpose:
   * the edit itself has already committed, and a failed enqueue is a stale
   * board on the next refresh, not a lost edit. The debounce absorbs a burst.
   */
  const scheduleRefresh = (profileId: string): void => {
    void requestRefresh(profileId, "signals_changed").catch((err: unknown) => {
      console.warn("[signals] top-of-mind refresh enqueue failed", {
        profileId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  };

  /**
   * Ask the queue to re-vector an edited statement.
   *
   * Awaited, unlike the refresh above, because the stale vector has already
   * been dropped by the time this runs: if the row never lands, the signal
   * stops being a match target until something edits it again. One INSERT is
   * a fraction of the model call it replaces in this handler, so the edit is
   * still faster than it was.
   *
   * Caught, because the edit itself has committed. A queue that is briefly
   * unreachable must not turn a successful edit into a 500 the caller will
   * retry — the retry would rewrite the same statement and ask again.
   */
  const scheduleReembed = async (profileId: string, signalId: string): Promise<void> => {
    try {
      await requestReembed(profileId, signalId);
    } catch (err: unknown) {
      console.warn("[signals] re-embed enqueue failed; this signal has no vector", {
        profileId,
        signalId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  routes.use("*", deps.authMiddleware ?? requireAuth);

  routes.get("/", async (c) => {
    const parsedQuery = listSignalsQuerySchema.safeParse(c.req.query());
    if (!parsedQuery.success) {
      return c.json(
        {
          error: "Invalid signal query",
          details: validationDetails(parsedQuery.error),
        },
        400,
      );
    }

    const db = getDatabase();
    const scope = await resolveProfileScope(
      db,
      c.get("session"),
      parsedQuery.data.profile,
      "read",
      loadProfile,
    );
    if (!scope.ok) return c.json(scope.body, scope.status);

    const signalRows = await listSignals(db, {
      query: parsedQuery.data.q,
      experience: parsedQuery.data.experience,
      profileId: scope.profileId,
      status: parsedQuery.data.status,
      limit: parsedQuery.data.limit ?? DEFAULT_SIGNAL_LIMIT,
    });
    /* the read side answers for itself: this serve is on the record before
       the response leaves — goals/no-quiet-corners.md Phase 1 */
    await recordConsultation(db, {
      profileId: scope.profileId,
      session: c.get("session"),
      surface: "signals",
    });
    return c.json({ signals: signalRows }, 200);
  });

  routes.get("/:signalId", async (c) => {
    const parsedParams = signalParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) {
      return c.json(
        { error: "Invalid signal id", details: validationDetails(parsedParams.error) },
        400,
      );
    }
    const parsedQuery = signalScopeQuerySchema.safeParse(c.req.query());
    if (!parsedQuery.success) {
      return c.json(
        { error: "Invalid signal query", details: validationDetails(parsedQuery.error) },
        400,
      );
    }

    const db = getDatabase();
    const scope = await resolveProfileScope(
      db,
      c.get("session"),
      parsedQuery.data.profile,
      "read",
      loadProfile,
    );
    if (!scope.ok) return c.json(scope.body, scope.status);

    const signal = await getSignal(db, {
      profileId: scope.profileId,
      signalId: parsedParams.data.signalId,
    });
    if (!signal) return c.json({ error: "Signal not found" }, 404);
    return c.json({ signal }, 200);
  });

  routes.patch("/:signalId", async (c) => {
    const parsedParams = signalParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) {
      return c.json(
        { error: "Invalid signal id", details: validationDetails(parsedParams.error) },
        400,
      );
    }
    const parsedQuery = signalScopeQuerySchema.safeParse(c.req.query());
    if (!parsedQuery.success) {
      return c.json(
        { error: "Invalid signal query", details: validationDetails(parsedQuery.error) },
        400,
      );
    }

    const rawBody = await c.req.json().catch(() => null);
    const parsedBody = updateSignalBodySchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return c.json(
        { error: "Invalid signal update", details: validationDetails(parsedBody.error) },
        400,
      );
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

    const signal = await updateStatement(db, {
      profileId: scope.profileId,
      signalId: parsedParams.data.signalId,
      statement: parsedBody.data.statement,
    });
    if (!signal) return c.json({ error: "Signal not found" }, 404);

    // The stored vector now describes wording its owner has replaced, and
    // replacing it means embedding — a call on the one Gemini key every
    // account shares. This handler used to make that call itself, which meant
    // one account could spend the key at HTTP speed while the queue's
    // per-account budget watched the wrong door. So the work is split by what
    // it costs: forgetting the old vector is a delete and happens now;
    // computing the new one is model work and goes where model work is
    // metered.
    //
    // The gap between the two leaves the signal without a vector for as long
    // as the queue takes, so a similar capture mints a visible near-duplicate
    // its owner can merge — the recoverable mistake this pipeline always
    // chooses. Keeping the old vector until the job ran would be the other
    // kind: the signal would go on quietly collecting evidence for the meaning
    // its owner just rejected.
    //
    // Dropped first and enqueued second, never the reverse. In a single
    // process the enqueue arms an immediate drain, so enqueuing first races
    // the job — it could write the fresh vector and have this delete remove
    // it, leaving no vector and no job coming to replace it.
    await dropEmbedding(db, {
      profileId: scope.profileId,
      signalId: parsedParams.data.signalId,
    });
    await scheduleReembed(scope.profileId, parsedParams.data.signalId);
    scheduleRefresh(scope.profileId);
    return c.json({ signal }, 200);
  });

  /**
   * The lock's other half. Editing locks; this releases — same write scope as
   * the edit, because whoever may lock a statement may hand it back. The text
   * is not touched here: release only returns the sentence to the generator's
   * jurisdiction, and the next derivation or synthesis decides what happens
   * to it. The refresh is scheduled because a release can retire an
   * unsupported signal the artifact still cites.
   */
  routes.post("/:signalId/release", async (c) => {
    const parsedParams = signalParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) {
      return c.json(
        { error: "Invalid signal id", details: validationDetails(parsedParams.error) },
        400,
      );
    }
    const parsedQuery = signalScopeQuerySchema.safeParse(c.req.query());
    if (!parsedQuery.success) {
      return c.json(
        { error: "Invalid signal query", details: validationDetails(parsedQuery.error) },
        400,
      );
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

    const signal = await releaseStatement(db, {
      profileId: scope.profileId,
      signalId: parsedParams.data.signalId,
    });
    if (!signal) return c.json({ error: "Signal not found" }, 404);

    scheduleRefresh(scope.profileId);
    return c.json({ signal }, 200);
  });

  /**
   * The lock's third verb. Release keeps the person's words and returns
   * jurisdiction; revert restores the machine's sentence byte-for-byte from
   * the statement chain and clears the lock. Same embedding maintenance as
   * the edit, and for the same reason: the stored vector now describes
   * wording the row no longer carries.
   */
  routes.post("/:signalId/revert", async (c) => {
    const parsedParams = signalParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) {
      return c.json(
        { error: "Invalid signal id", details: validationDetails(parsedParams.error) },
        400,
      );
    }
    const parsedQuery = signalScopeQuerySchema.safeParse(c.req.query());
    if (!parsedQuery.success) {
      return c.json(
        { error: "Invalid signal query", details: validationDetails(parsedQuery.error) },
        400,
      );
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

    const result = await revertSignalStatement(db, {
      profileId: scope.profileId,
      signalId: parsedParams.data.signalId,
    });
    if (result.outcome === "not_found") return c.json({ error: "Signal not found" }, 404);
    if (result.outcome === "nothing_to_revert") {
      return c.json(
        { error: "No machine statement to return to — the chain holds only your own words" },
        409,
      );
    }

    await dropEmbedding(db, {
      profileId: scope.profileId,
      signalId: parsedParams.data.signalId,
    });
    await scheduleReembed(scope.profileId, parsedParams.data.signalId);
    scheduleRefresh(scope.profileId);

    const signal = await getSignal(db, {
      profileId: scope.profileId,
      signalId: parsedParams.data.signalId,
    });
    return c.json({ signal }, 200);
  });

  /**
   * The dismiss verb — "then let it go", without deletion. Same write scope
   * as the edit. The refresh is scheduled because the artifact may cite the
   * signal that was just thrown out; the embedding is deliberately NOT
   * dropped — it is the anchor the refusals stand on from here.
   */
  routes.post("/:signalId/dismiss", async (c) => {
    const parsedParams = signalParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) {
      return c.json(
        { error: "Invalid signal id", details: validationDetails(parsedParams.error) },
        400,
      );
    }
    const parsedQuery = signalScopeQuerySchema.safeParse(c.req.query());
    if (!parsedQuery.success) {
      return c.json(
        { error: "Invalid signal query", details: validationDetails(parsedQuery.error) },
        400,
      );
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

    const signal = await dismissSignal(db, {
      profileId: scope.profileId,
      signalId: parsedParams.data.signalId,
    });
    if (!signal) return c.json({ error: "Signal not found" }, 404);

    scheduleRefresh(scope.profileId);
    return c.json({ signal }, 200);
  });

  /** The dismissal's undo: the refusals stop, the pattern returns to sight. */
  routes.post("/:signalId/restore", async (c) => {
    const parsedParams = signalParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) {
      return c.json(
        { error: "Invalid signal id", details: validationDetails(parsedParams.error) },
        400,
      );
    }
    const parsedQuery = signalScopeQuerySchema.safeParse(c.req.query());
    if (!parsedQuery.success) {
      return c.json(
        { error: "Invalid signal query", details: validationDetails(parsedQuery.error) },
        400,
      );
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

    const signal = await restoreSignal(db, {
      profileId: scope.profileId,
      signalId: parsedParams.data.signalId,
    });
    if (!signal) return c.json({ error: "Signal not found" }, 404);

    scheduleRefresh(scope.profileId);
    return c.json({ signal }, 200);
  });

  routes.delete("/:signalId", async (c) => {
    const parsedParams = signalParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) {
      return c.json(
        { error: "Invalid signal id", details: validationDetails(parsedParams.error) },
        400,
      );
    }
    const parsedQuery = signalScopeQuerySchema.safeParse(c.req.query());
    if (!parsedQuery.success) {
      return c.json(
        { error: "Invalid signal query", details: validationDetails(parsedQuery.error) },
        400,
      );
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

    const deleted = await deleteSignal(db, {
      profileId: scope.profileId,
      signalId: parsedParams.data.signalId,
    });
    if (!deleted) return c.json({ error: "Signal not found" }, 404);

    // The artifact may cite the signal just removed; re-synthesise so an entry
    // is not left resting on a citation that no longer resolves. Principles
    // reconcile immediately (state maintenance, no model, no midnight wait).
    await reconcilePrinciples(db, {
      profileId: scope.profileId,
      signalIds: [parsedParams.data.signalId],
    });
    scheduleRefresh(scope.profileId);
    return c.json({ deleted: true }, 200);
  });

  /*
   * THERE IS NO VERB HERE ANY MORE.
   *
   * `POST /:signalId/shares` and its delete used to be how a statement
   * reached a room. The founder retired that on 2026-08-24: a room grows its
   * own statements from its members' pooled public memories, and the wall
   * stopped reading `signal_shares` the same day. The endpoints outlived the
   * wall by a few hours and were doing real damage in that state — a caller
   * got 201, the row landed, and nothing anywhere ever showed it, which is
   * the worst answer an API can give.
   *
   * The TABLE stays, and so does everything that reads it: the export carries
   * a person's shares as their own history, and `routes/feedback.ts` still
   * honours an old share as standing to answer the statement it put up. What
   * is gone is the ability to make a NEW one. Sharing is a memory being
   * public now, and that switch lives on the memory.
   */

  return routes;
}

export const signalsRoutes = createSignalRoutes();
