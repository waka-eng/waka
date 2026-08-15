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

  const [evidenceCounts, shareRows] = await Promise.all([
    db
      .select({
        signalId: signalEvidence.signalId,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(signalEvidence)
      .where(inArray(signalEvidence.signalId, ids))
      .groupBy(signalEvidence.signalId),
    db
      .select({ signalId: signalShares.signalId, groupId: signalShares.groupId })
      .from(signalShares)
      .where(inArray(signalShares.signalId, ids)),
  ]);

  const countBySignal = new Map(evidenceCounts.map((row) => [row.signalId, Number(row.count)]));
  const groupsBySignal = new Map<string, string[]>();
  for (const row of shareRows) {
    const bucket = groupsBySignal.get(row.signalId);
    if (bucket) bucket.push(row.groupId);
    else groupsBySignal.set(row.signalId, [row.groupId]);
  }

  return rows.map((row) => ({
    id: row.id,
    statement: row.statement,
    status: row.status,
    confidence: row.confidence,
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
  // Same body for "no such profile" and "not yours": whether a profile id
  // exists in someone else's account is not a caller's business.
  if (!target) return { ok: false, status: 404, body: { error: "Profile not found" } };

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
  deleteSignal?: typeof deleteProfileSignal;
  shareSignal?: typeof shareSignalWithGroup;
  unshareSignal?: typeof unshareSignalFromGroup;
  loadProfile?: typeof loadProfileTarget;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
}

export function createSignalRoutes(deps: SignalRouteDependencies = {}): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;
  const listSignals = deps.listSignals ?? listProfileSignals;
  const getSignal = deps.getSignal ?? getProfileSignal;
  const updateStatement = deps.updateStatement ?? updateSignalStatement;
  const deleteSignal = deps.deleteSignal ?? deleteProfileSignal;
  const shareSignal = deps.shareSignal ?? shareSignalWithGroup;
  const unshareSignal = deps.unshareSignal ?? unshareSignalFromGroup;
  const loadProfile = deps.loadProfile ?? loadProfileTarget;

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
