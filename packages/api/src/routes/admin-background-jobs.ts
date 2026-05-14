/**
 * Internal/dev-only background job observability API.
 *
 * The whole namespace is hidden behind an explicit environment opt-in plus the
 * normal session auth middleware. It is for local/internal debugging only and
 * deliberately returns a safe summary of queue payloads instead of raw JSONB.
 */

import { and, asc, desc, eq } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";

import {
  backgroundJobs,
  backgroundJobStatusValues,
  backgroundJobTypeValues,
  type BackgroundJob,
  type BackgroundJobStatus,
  type BackgroundJobType,
  inspirations,
  type ProcessInspirationPayload,
  wowMomentInspirations,
  wowMoments,
} from "../db/index.js";
import { getDb } from "../lib/db.js";
import { type AuthEnv, requireAuth } from "../lib/middleware.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_LAST_ERROR_LENGTH = 1_000;
const MAX_INSPIRATION_PREVIEW_LENGTH = 240;
const MAX_WOW_TITLE_PREVIEW_LENGTH = 120;
const MAX_WOW_EXPLANATION_PREVIEW_LENGTH = 240;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET_ASSIGNMENT_RE =
  /\b(api[_-]?key|x-api-key|secret|password|token|access[_-]?token|refresh[_-]?token)\b\s*[:=]\s*("[^"]+"|'[^']+'|[^\s,;&]+)/gi;
const AUTHORIZATION_HEADER_RE = /\bAuthorization\s*:\s*[^\r\n,;]+/gi;
const BEARER_TOKEN_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const LONG_TOKEN_LIKE_RE = /\b[A-Za-z0-9._~+/=-]{32,}\b/g;

export interface AdminBackgroundJobsRouteDependencies {
  getDatabase?: typeof getDb;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
  adminGate?: MiddlewareHandler<AuthEnv>;
}

export interface AdminBackgroundJobSummary {
  id: string;
  userId: string;
  type: BackgroundJobType;
  status: BackgroundJobStatus;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  lockedAt: string | null;
  lastError: string | null;
  idempotencyKey: string | null;
  createdAt: string;
  updatedAt: string;
  payloadSummary: Record<string, unknown>;
}

export interface AdminBackgroundJobPipelineDetail {
  type: "process_inspiration";
  inspiration: {
    id: string;
    textPreview: string;
    kind: string | null;
    category: number | null;
    cluster: string | null;
    classifiedAt: string | null;
    importanceScore: number;
    wowScore: number;
    createdAt: string;
    updatedAt: string;
  } | null;
  inspirationMissingReason: "payload_missing" | "not_found_or_not_visible" | null;
  wowMoments: Array<{
    id: string;
    kind: string;
    titlePreview: string;
    explanationPreview: string;
    wowScore: number;
    createdAt: string;
  }>;
}

export interface AdminBackgroundJobDetail extends AdminBackgroundJobSummary {
  pipeline?: AdminBackgroundJobPipelineDetail;
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

function summarizePayload(job: BackgroundJob): Record<string, unknown> {
  if (job.type === "process_inspiration") {
    const payload = job.payload as ProcessInspirationPayload;
    return { inspirationId: payload.inspirationId };
  }
  return {};
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

function truncatePreview(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function serializeJob(job: BackgroundJob): AdminBackgroundJobSummary {
  return {
    id: job.id,
    userId: job.userId,
    type: job.type,
    status: job.status,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    runAfter: job.runAfter.toISOString(),
    lockedAt: job.lockedAt?.toISOString() ?? null,
    lastError: sanitizeLastError(job.lastError),
    idempotencyKey: job.idempotencyKey,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    payloadSummary: summarizePayload(job),
  };
}

async function loadProcessInspirationPipeline(input: {
  db: ReturnType<typeof getDb>;
  job: BackgroundJob;
  currentUserId: string;
}): Promise<AdminBackgroundJobPipelineDetail> {
  const payloadSummary = summarizePayload(input.job);
  const inspirationId = payloadSummary.inspirationId;
  if (typeof inspirationId !== "string" || !UUID_RE.test(inspirationId)) {
    return {
      type: "process_inspiration",
      inspiration: null,
      inspirationMissingReason: "payload_missing",
      wowMoments: [],
    };
  }

  const inspirationRows = await input.db
    .select({
      id: inspirations.id,
      text: inspirations.text,
      kind: inspirations.kind,
      category: inspirations.category,
      cluster: inspirations.cluster,
      classifiedAt: inspirations.classifiedAt,
      importanceScore: inspirations.importanceScore,
      wowScore: inspirations.wowScore,
      createdAt: inspirations.createdAt,
      updatedAt: inspirations.updatedAt,
    })
    .from(inspirations)
    .where(and(eq(inspirations.id, inspirationId), eq(inspirations.userId, input.currentUserId)))
    .limit(1);

  const inspiration = inspirationRows[0];
  if (!inspiration) {
    return {
      type: "process_inspiration",
      inspiration: null,
      inspirationMissingReason: "not_found_or_not_visible",
      wowMoments: [],
    };
  }

  const linkedWowMoments = await input.db
    .select({
      id: wowMoments.id,
      kind: wowMoments.kind,
      title: wowMoments.title,
      why: wowMoments.why,
      wowScore: wowMoments.wowScore,
      createdAt: wowMoments.createdAt,
    })
    .from(wowMomentInspirations)
    .innerJoin(wowMoments, eq(wowMomentInspirations.wowMomentId, wowMoments.id))
    .where(
      and(
        eq(wowMomentInspirations.userId, input.currentUserId),
        eq(wowMomentInspirations.inspirationId, inspiration.id),
        eq(wowMoments.userId, input.currentUserId),
      ),
    )
    .orderBy(asc(wowMomentInspirations.sortOrder), asc(wowMomentInspirations.createdAt));

  return {
    type: "process_inspiration",
    inspiration: {
      id: inspiration.id,
      textPreview: truncatePreview(inspiration.text, MAX_INSPIRATION_PREVIEW_LENGTH),
      kind: inspiration.kind,
      category: inspiration.category,
      cluster: inspiration.cluster,
      classifiedAt: inspiration.classifiedAt?.toISOString() ?? null,
      importanceScore: inspiration.importanceScore,
      wowScore: inspiration.wowScore,
      createdAt: inspiration.createdAt.toISOString(),
      updatedAt: inspiration.updatedAt.toISOString(),
    },
    inspirationMissingReason: null,
    wowMoments: linkedWowMoments.map((moment) => ({
      id: moment.id,
      kind: moment.kind,
      titlePreview: truncatePreview(moment.title, MAX_WOW_TITLE_PREVIEW_LENGTH),
      explanationPreview: truncatePreview(moment.why, MAX_WOW_EXPLANATION_PREVIEW_LENGTH),
      wowScore: moment.wowScore,
      createdAt: moment.createdAt.toISOString(),
    })),
  };
}

async function serializeJobDetail(input: {
  db: ReturnType<typeof getDb>;
  job: BackgroundJob;
  currentUserId: string;
}): Promise<AdminBackgroundJobDetail> {
  const detail: AdminBackgroundJobDetail = serializeJob(input.job);
  if (input.job.type === "process_inspiration") {
    detail.pipeline = await loadProcessInspirationPipeline(input);
  }
  return detail;
}

export function createAdminBackgroundJobsRoutes(
  deps: AdminBackgroundJobsRouteDependencies = {},
): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;

  routes.use("*", deps.adminGate ?? requireAdminBackgroundJobsEnabled);
  routes.use("*", deps.authMiddleware ?? requireAuth);

  routes.get("/", async (c) => {
    const status = parseStatus(c.req.query("status"));
    if (status === null) return c.json({ error: "Invalid status filter" }, 400);

    const type = parseType(c.req.query("type"));
    if (type === null) return c.json({ error: "Invalid type filter" }, 400);

    const currentUserId = c.get("user").id;
    const requestedUserId = c.req.query("userId");
    if (requestedUserId && !UUID_RE.test(requestedUserId)) {
      return c.json({ error: "Invalid userId filter" }, 400);
    }

    if (requestedUserId && requestedUserId !== currentUserId) {
      return c.json({ jobs: [] });
    }

    const conditions = [];
    if (status) conditions.push(eq(backgroundJobs.status, status));
    if (type) conditions.push(eq(backgroundJobs.type, type));
    conditions.push(eq(backgroundJobs.userId, currentUserId));

    const query = getDatabase()
      .select()
      .from(backgroundJobs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(backgroundJobs.createdAt))
      .limit(parseLimit(c.req.query("limit")));

    const rows = await query;
    return c.json({ jobs: rows.map(serializeJob) });
  });

  routes.get("/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) return c.notFound();
    const currentUserId = c.get("user").id;

    const rows = await getDatabase()
      .select()
      .from(backgroundJobs)
      .where(and(eq(backgroundJobs.id, id), eq(backgroundJobs.userId, currentUserId)))
      .limit(1);
    const job = rows[0];
    if (!job) return c.notFound();

    return c.json({ job: await serializeJobDetail({ db: getDatabase(), job, currentUserId }) });
  });

  routes.post("/:id/retry", async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) return c.notFound();
    const currentUserId = c.get("user").id;

    const db = getDatabase();
    const now = new Date();
    const updatedRows = await db
      .update(backgroundJobs)
      .set({
        status: "pending",
        attempts: 0,
        lockedAt: null,
        lastError: null,
        runAfter: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(backgroundJobs.id, id),
          eq(backgroundJobs.userId, currentUserId),
          eq(backgroundJobs.status, "failed"),
        ),
      )
      .returning();

    const updated = updatedRows[0];
    if (!updated) {
      const existingRows = await db
        .select({ id: backgroundJobs.id })
        .from(backgroundJobs)
        .where(and(eq(backgroundJobs.id, id), eq(backgroundJobs.userId, currentUserId)))
        .limit(1);
      if (!existingRows[0]) return c.notFound();
      return c.json({ error: "Only failed background jobs can be retried" }, 409);
    }

    return c.json({ job: serializeJob(updated) });
  });

  return routes;
}

export const adminBackgroundJobsRoutes = createAdminBackgroundJobsRoutes();
