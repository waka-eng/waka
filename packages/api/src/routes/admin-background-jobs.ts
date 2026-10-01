/**
 * Internal background-job observability.
 *
 * Three gates, in order: the namespace only exists when a deployment opts in
 * by environment, the caller must hold a session, and their account email must
 * be on the admin allowlist. Any one of them alone is a single mistake away
 * from exposing a queue.
 *
 * What it shows is deliberately thin. A job row carries operational facts —
 * type, status, attempts, timing, the sanitized last error — plus the ids its
 * payload names. It does not resolve those ids into the rows behind them: an
 * operator debugging a stuck queue needs to know *which* work is stuck, not to
 * read the person's captures through a debugging surface.
 *
 * Every query is scoped to the profiles of the acting account, so an admin sees
 * their own account's queue and nothing else. Being an admin is permission to
 * inspect the machinery, not permission to read other people's memory.
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";

import {
  backgroundJobs,
  backgroundJobStatusValues,
  backgroundJobTypeValues,
  profiles,
  type BackgroundJob,
  type BackgroundJobStatus,
  type BackgroundJobType,
} from "../db/index.js";
import { requireAdminUser } from "../lib/admin-auth.js";
import { getDb } from "../lib/db.js";
import { type AuthEnv, requireAuth } from "../lib/middleware.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_LAST_ERROR_LENGTH = 1_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET_ASSIGNMENT_RE =
  /\b(api[_-]?key|x-api-key|secret|password|token|access[_-]?token|refresh[_-]?token)\b\s*[:=]\s*("[^"]+"|'[^']+'|[^\s,;&]+)/gi;
const AUTHORIZATION_HEADER_RE = /\bAuthorization\s*:\s*[^\r\n,;]+/gi;
const BEARER_TOKEN_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const LONG_TOKEN_LIKE_RE = /\b[A-Za-z0-9._~+/=-]{32,}\b/g;

/** Payload keys safe to echo: an enum-valued reason, and identifiers. */
const SAFE_PAYLOAD_KEY_RE = /(^reason$|Id$)/;

export interface AdminBackgroundJobsRouteDependencies {
  getDatabase?: typeof getDb;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
  adminGate?: MiddlewareHandler<AuthEnv>;
  adminAuthorization?: MiddlewareHandler<AuthEnv>;
}

export interface AdminBackgroundJobSummary {
  id: string;
  profileId: string;
  type: BackgroundJobType;
  status: BackgroundJobStatus;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  lockedAt: string | null;
  /**
   * When this job last began running. Read alongside `runAfter` it is what
   * explains a job sitting an hour out with no error against it: the account
   * spent its model budget, and the queue moved the work rather than dropping
   * it. Without it, a deferral is indistinguishable from a stuck queue.
   */
  startedAt: string | null;
  lastError: string | null;
  idempotencyKey: string | null;
  createdAt: string;
  updatedAt: string;
  payloadSummary: Record<string, string>;
}

export function isAdminBackgroundJobsEnabled(): boolean {
  return (
    process.env.WAKA_ENABLE_ADMIN_ROUTES === "true" ||
    process.env.WAKA_ENABLE_BACKGROUND_JOBS_ADMIN === "true"
  );
}

export const requireAdminBackgroundJobsEnabled: MiddlewareHandler<AuthEnv> = async (
  c,
  next,
) => {
  if (!isAdminBackgroundJobsEnabled()) {
    return c.notFound();
  }
  await next();
};

function parseLimit(raw: string | undefined): number {
  if (!raw) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function parseStatus(raw: string | undefined): BackgroundJobStatus | null | undefined {
  if (!raw) return undefined;
  return (backgroundJobStatusValues as readonly string[]).includes(raw)
    ? (raw as BackgroundJobStatus)
    : null;
}

function parseType(raw: string | undefined): BackgroundJobType | null | undefined {
  if (!raw) return undefined;
  return (backgroundJobTypeValues as readonly string[]).includes(raw)
    ? (raw as BackgroundJobType)
    : null;
}

/**
 * The payload, reduced to what is safe by construction.
 *
 * Keyed on the shape of the key rather than on the job type: payload shapes
 * change as the pipeline does, and a per-type switch fails open — a field
 * added tomorrow would be echoed by whichever branch forgot to exclude it.
 * An identifier and a reason cannot carry a person's words; everything else is
 * dropped, including anything that grows into free text later.
 */
export function summarizePayload(payload: unknown): Record<string, string> {
  if (!payload || typeof payload !== "object") return {};
  const summary: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    if (!SAFE_PAYLOAD_KEY_RE.test(key)) continue;
    summary[key] = value;
  }
  return summary;
}

function sanitizeLastError(lastError: string | null): string | null {
  if (lastError === null) return null;
  return lastError
    .replace(AUTHORIZATION_HEADER_RE, "Authorization: [redacted]")
    .replace(BEARER_TOKEN_RE, "Bearer [redacted]")
    .replace(SECRET_ASSIGNMENT_RE, "$1=[redacted]")
    .replace(LONG_TOKEN_LIKE_RE, "[redacted]")
    .slice(0, MAX_LAST_ERROR_LENGTH);
}

export function serializeJob(job: BackgroundJob): AdminBackgroundJobSummary {
  return {
    id: job.id,
    profileId: job.profileId,
    type: job.type,
    status: job.status,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    runAfter: job.runAfter.toISOString(),
    lockedAt: job.lockedAt?.toISOString() ?? null,
    startedAt: job.startedAt?.toISOString() ?? null,
    lastError: sanitizeLastError(job.lastError),
    idempotencyKey: job.idempotencyKey,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    payloadSummary: summarizePayload(job.payload),
  };
}

/**
 * The profiles this account owns — the tenant boundary for every query below.
 *
 * Jobs are keyed by profile, and an account has several (its human profile and
 * its agents), so "my queue" is a set rather than a single id.
 */
async function loadAccountProfileIds(
  db: ReturnType<typeof getDb>,
  accountId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.accountId, accountId));
  return rows.map((row) => row.id);
}

export function createAdminBackgroundJobsRoutes(
  deps: AdminBackgroundJobsRouteDependencies = {},
): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;

  routes.use("*", deps.adminGate ?? requireAdminBackgroundJobsEnabled);
  routes.use("*", deps.authMiddleware ?? requireAuth);
  routes.use("*", deps.adminAuthorization ?? requireAdminUser);

  routes.get("/", async (c) => {
    const status = parseStatus(c.req.query("status"));
    if (status === null) return c.json({ error: "Invalid status filter" }, 400);

    const type = parseType(c.req.query("type"));
    if (type === null) return c.json({ error: "Invalid type filter" }, 400);

    const requestedProfileId = c.req.query("profileId");
    if (requestedProfileId && !UUID_RE.test(requestedProfileId)) {
      return c.json({ error: "Invalid profileId filter" }, 400);
    }

    const db = getDatabase();
    const accountProfileIds = await loadAccountProfileIds(db, c.get("session").account.id);
    if (accountProfileIds.length === 0) return c.json({ jobs: [] });

    // A filter for someone else's profile returns an empty list rather than a
    // refusal: whether that id exists is not answered here either way.
    if (requestedProfileId && !accountProfileIds.includes(requestedProfileId)) {
      return c.json({ jobs: [] });
    }

    const conditions = [
      inArray(
        backgroundJobs.profileId,
        requestedProfileId ? [requestedProfileId] : accountProfileIds,
      ),
    ];
    if (status) conditions.push(eq(backgroundJobs.status, status));
    if (type) conditions.push(eq(backgroundJobs.type, type));

    const rows = await db
      .select()
      .from(backgroundJobs)
      .where(and(...conditions))
      .orderBy(desc(backgroundJobs.createdAt))
      .limit(parseLimit(c.req.query("limit")));

    return c.json({ jobs: rows.map(serializeJob) });
  });

  routes.get("/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) return c.notFound();

    const db = getDatabase();
    const accountProfileIds = await loadAccountProfileIds(db, c.get("session").account.id);
    if (accountProfileIds.length === 0) return c.notFound();

    const rows = await db
      .select()
      .from(backgroundJobs)
      .where(
        and(
          eq(backgroundJobs.id, id),
          inArray(backgroundJobs.profileId, accountProfileIds),
        ),
      )
      .limit(1);
    const job = rows[0];
    if (!job) return c.notFound();

    return c.json({ job: serializeJob(job) });
  });

  routes.post("/:id/retry", async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) return c.notFound();

    const db = getDatabase();
    const accountProfileIds = await loadAccountProfileIds(db, c.get("session").account.id);
    if (accountProfileIds.length === 0) return c.notFound();

    const now = new Date();
    const updatedRows = await db
      .update(backgroundJobs)
      .set({
        status: "pending",
        requestVersion: sql`${backgroundJobs.requestVersion} + 1`,
        result: null,
        attempts: 0,
        lockedAt: null,
        lastError: null,
        runAfter: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(backgroundJobs.id, id),
          inArray(backgroundJobs.profileId, accountProfileIds),
          eq(backgroundJobs.status, "failed"),
        ),
      )
      .returning();

    const updated = updatedRows[0];
    if (!updated) {
      // Distinguish "not yours / no such job" from "yours, but not failed":
      // the second is a real answer an operator needs, the first must stay
      // indistinguishable from a job that never existed.
      const existingRows = await db
        .select({ id: backgroundJobs.id })
        .from(backgroundJobs)
        .where(
          and(
            eq(backgroundJobs.id, id),
            inArray(backgroundJobs.profileId, accountProfileIds),
          ),
        )
        .limit(1);
      if (!existingRows[0]) return c.notFound();
      return c.json({ error: "Only failed background jobs can be retried" }, 409);
    }

    return c.json({ job: serializeJob(updated) });
  });

  return routes;
}

export const adminBackgroundJobsRoutes = createAdminBackgroundJobsRoutes();
