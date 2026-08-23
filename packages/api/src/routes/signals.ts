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
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import {
  groupMembers,
  inspirations,
  profiles,
  signalEvidence,
  signalShares,
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
} from "../lib/middleware.js";
import { enqueueSignalReembed, enqueueTopOfMindRefresh } from "../lib/queue.js";
import { reconcilePrinciplesAfterSignalLoss } from "../lib/principle-generation.js";
import {
  computeSignalConfidence,
  dropSignalEmbedding,
} from "../lib/signal-derivation.js";
import type { AuthenticatedSession } from "../lib/session.js";

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

const shareParamsSchema = z.object({
  signalId: z.string().uuid("signalId must be a uuid"),
  groupId: z.string().uuid("groupId must be a uuid"),
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

const createShareBodySchema = z
  .object({ groupId: z.string().uuid("groupId must be a uuid") })
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
  rows: Array<{
    id: string;
    statement: string;
    status: SignalStatus;
    confidence: number;
    lastEvidenceAt: Date | null;
    lockedAt: Date | null;
    unsupportedAt: Date | null;
    createdAt: Date;
  }>,
): Promise<SignalSummary[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);

  const [evidenceRows, shareRows] = await Promise.all([
    db
      .select({
        signalId: signalEvidence.signalId,
        createdAt: signalEvidence.createdAt,
        source: inspirations.source,
      })
      .from(signalEvidence)
      .innerJoin(inspirations, eq(inspirations.id, signalEvidence.inspirationId))
      .where(inArray(signalEvidence.signalId, ids)),
    db
      .select({ signalId: signalShares.signalId, groupId: signalShares.groupId })
      .from(signalShares)
      .where(inArray(signalShares.signalId, ids)),
  ]);

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
      computeSignalConfidence(evidenceBySignal.get(row.id) ?? [], now),
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
      createdAt: signals.createdAt,
    })
    .from(signals)
    .where(
      input.status
        ? and(eq(signals.profileId, input.profileId), eq(signals.status, input.status))
        : eq(signals.profileId, input.profileId),
    )
    .orderBy(desc(signals.confidence), desc(signals.lastEvidenceAt), desc(signals.createdAt))
    .limit(input.limit);

  return decorateSignals(db, rows);
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
      createdAt: signals.createdAt,
    })
    .from(signals)
    .where(and(eq(signals.id, input.signalId), eq(signals.profileId, input.profileId)))
    .limit(1);
  if (!row) return null;

  const [summary] = await decorateSignals(db, [row]);
  if (!summary) return null;

  const evidenceRows = await db
    .select({
      inspirationId: signalEvidence.inspirationId,
      reason: signalEvidence.reason,
      quote: signalEvidence.quote,
      quoteSource: signalEvidence.quoteSource,
      createdAt: signalEvidence.createdAt,
      text: inspirations.text,
    })
    .from(signalEvidence)
    .innerJoin(inspirations, eq(inspirations.id, signalEvidence.inspirationId))
    .where(eq(signalEvidence.signalId, input.signalId))
    .orderBy(desc(signalEvidence.createdAt));

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
 */
export async function updateSignalStatement(
  db: WakaDb,
  input: { profileId: string; signalId: string; statement: string; now?: Date },
): Promise<SignalDetail | null> {
  const updated = await db
    .update(signals)
    .set({
      statement: input.statement,
      lockedAt: input.now ?? new Date(),
      updatedAt: input.now ?? new Date(),
    })
    .where(and(eq(signals.id, input.signalId), eq(signals.profileId, input.profileId)))
    .returning({ id: signals.id });
  if (updated.length === 0) return null;

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

export async function shareSignalWithGroup(
  db: WakaDb,
  input: { profileId: string; signalId: string; groupId: string },
): Promise<"shared" | "not_found" | "not_a_member"> {
  const [signal] = await db
    .select({ id: signals.id })
    .from(signals)
    .where(and(eq(signals.id, input.signalId), eq(signals.profileId, input.profileId)))
    .limit(1);
  if (!signal) return "not_found";

  const [membership] = await db
    .select({ id: groupMembers.id })
    .from(groupMembers)
    .where(
      and(eq(groupMembers.groupId, input.groupId), eq(groupMembers.profileId, input.profileId)),
    )
    .limit(1);
  if (!membership) return "not_a_member";

  // Re-sharing is not an error: the caller wanted this signal on that wall,
  // and after this call it is.
  await db
    .insert(signalShares)
    .values({
      profileId: input.profileId,
      signalId: input.signalId,
      groupId: input.groupId,
    })
    .onConflictDoNothing();

  return "shared";
}

export async function unshareSignalFromGroup(
  db: WakaDb,
  input: { profileId: string; signalId: string; groupId: string },
): Promise<boolean> {
  const removed = await db
    .delete(signalShares)
    .where(
      and(
        eq(signalShares.signalId, input.signalId),
        eq(signalShares.groupId, input.groupId),
        eq(signalShares.profileId, input.profileId),
      ),
    )
    .returning({ id: signalShares.id });
  return removed.length > 0;
}

// ---------------------------------------------------------------------------
// Profile scoping
// ---------------------------------------------------------------------------

export interface ProfileScopeTarget {
  id: string;
  accountId: string;
}

export async function loadProfileTarget(
  db: WakaDb,
  profileId: string,
): Promise<ProfileScopeTarget | null> {
  const [row] = await db
    .select({ id: profiles.id, accountId: profiles.accountId })
    .from(profiles)
    .where(eq(profiles.id, profileId))
    .limit(1);
  return row ?? null;
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

  const denied = profileAccessError(session, target, operation);
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
  deleteSignal?: typeof deleteProfileSignal;
  shareSignal?: typeof shareSignalWithGroup;
  unshareSignal?: typeof unshareSignalFromGroup;
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
  const deleteSignal = deps.deleteSignal ?? deleteProfileSignal;
  const shareSignal = deps.shareSignal ?? shareSignalWithGroup;
  const unshareSignal = deps.unshareSignal ?? unshareSignalFromGroup;
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
          details: parsedQuery.error.flatten().fieldErrors,
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
        { error: "Invalid signal id", details: parsedParams.error.flatten().fieldErrors },
        400,
      );
    }
    const parsedQuery = signalScopeQuerySchema.safeParse(c.req.query());
    if (!parsedQuery.success) {
      return c.json(
        { error: "Invalid signal query", details: parsedQuery.error.flatten().fieldErrors },
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
        { error: "Invalid signal id", details: parsedParams.error.flatten().fieldErrors },
        400,
      );
    }
    const parsedQuery = signalScopeQuerySchema.safeParse(c.req.query());
    if (!parsedQuery.success) {
      return c.json(
        { error: "Invalid signal query", details: parsedQuery.error.flatten().fieldErrors },
        400,
      );
    }

    const rawBody = await c.req.json().catch(() => null);
    const parsedBody = updateSignalBodySchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return c.json(
        { error: "Invalid signal update", details: parsedBody.error.flatten().fieldErrors },
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
        { error: "Invalid signal id", details: parsedParams.error.flatten().fieldErrors },
        400,
      );
    }
    const parsedQuery = signalScopeQuerySchema.safeParse(c.req.query());
    if (!parsedQuery.success) {
      return c.json(
        { error: "Invalid signal query", details: parsedQuery.error.flatten().fieldErrors },
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

  routes.delete("/:signalId", async (c) => {
    const parsedParams = signalParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) {
      return c.json(
        { error: "Invalid signal id", details: parsedParams.error.flatten().fieldErrors },
        400,
      );
    }
    const parsedQuery = signalScopeQuerySchema.safeParse(c.req.query());
    if (!parsedQuery.success) {
      return c.json(
        { error: "Invalid signal query", details: parsedQuery.error.flatten().fieldErrors },
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

  /**
   * Sharing is the owner's act. Group membership is between human profiles,
   * and a share attributes a statement to the member who holds it, so the
   * signal must belong to the session's own profile — an admin curating an
   * agent's memory is not the same thing as publishing on its behalf.
   */
  routes.post("/:signalId/shares", async (c) => {
    const parsedParams = signalParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) {
      return c.json(
        { error: "Invalid signal id", details: parsedParams.error.flatten().fieldErrors },
        400,
      );
    }

    const rawBody = await c.req.json().catch(() => null);
    const parsedBody = createShareBodySchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return c.json(
        { error: "Invalid share request", details: parsedBody.error.flatten().fieldErrors },
        400,
      );
    }

    const outcome = await shareSignal(getDatabase(), {
      profileId: c.get("session").profile.id,
      signalId: parsedParams.data.signalId,
      groupId: parsedBody.data.groupId,
    });
    if (outcome === "not_found") return c.json({ error: "Signal not found" }, 404);
    if (outcome === "not_a_member") {
      return c.json({ error: "Not a member of this group" }, 403);
    }
    return c.json({ shared: true, groupId: parsedBody.data.groupId }, 201);
  });

  routes.delete("/:signalId/shares/:groupId", async (c) => {
    const parsedParams = shareParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) {
      return c.json(
        { error: "Invalid share id", details: parsedParams.error.flatten().fieldErrors },
        400,
      );
    }

    const removed = await unshareSignal(getDatabase(), {
      profileId: c.get("session").profile.id,
      signalId: parsedParams.data.signalId,
      groupId: parsedParams.data.groupId,
    });
    if (!removed) return c.json({ error: "Share not found" }, 404);
    return c.json({ shared: false, groupId: parsedParams.data.groupId }, 200);
  });

  return routes;
}

export const signalsRoutes = createSignalRoutes();
