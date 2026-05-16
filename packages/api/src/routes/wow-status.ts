import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";

import {
  backgroundJobs,
  inspirationEmbeddings,
  inspirations,
  wowMomentInspirations,
  wowMoments,
  type BackgroundJob,
  type ProcessInspirationPayload,
} from "../db/index.js";
import { getDb } from "../lib/db.js";
import { type AuthEnv, requireAuth } from "../lib/middleware.js";

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;
const JOB_SCAN_LIMIT = 200;
const MAX_TEXT_PREVIEW_LENGTH = 180;
const MAX_WOW_TITLES = 5;

export interface WowStatusRouteDependencies {
  getDatabase?: typeof getDb;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
}

function parseLimit(raw: string | undefined): number {
  if (!raw) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function truncatePreview(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_TEXT_PREVIEW_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_TEXT_PREVIEW_LENGTH - 1).trimEnd()}…`;
}

function jobInspirationId(job: BackgroundJob): string | null {
  if (job.type !== "process_inspiration") return null;
  const payload = job.payload as ProcessInspirationPayload;
  return typeof payload.inspirationId === "string" ? payload.inspirationId : null;
}

type WowStatusDebugCode =
  | "linked_wow_ready"
  | "waiting_for_job"
  | "missing_embedding"
  | "job_failed"
  | "no_generated_wow";

function buildDebugReason(input: {
  job: BackgroundJob | null;
  embedded: boolean;
  linkedWowMomentCount: number;
}): { code: WowStatusDebugCode; label: string; detail: string } {
  if (input.linkedWowMomentCount > 0) {
    return {
      code: "linked_wow_ready",
      label: `generated ${input.linkedWowMomentCount}`,
      detail: `${input.linkedWowMomentCount} linked WOW moment${input.linkedWowMomentCount === 1 ? "" : "s"} found for this inspiration.`,
    };
  }

  if (!input.job || input.job.status === "pending" || input.job.status === "running") {
    return {
      code: "waiting_for_job",
      label: "waiting for job",
      detail: input.job
        ? `Processing job is ${input.job.status}; WOW links may appear after it finishes.`
        : "No process_inspiration job was found in the recent job scan yet.",
    };
  }

  if (input.job.status === "failed") {
    return {
      code: "job_failed",
      label: "job failed",
      detail: "The processing job failed; retry or inspect the redacted admin job error.",
    };
  }

  if (!input.embedded) {
    return {
      code: "missing_embedding",
      label: "missing embedding",
      detail: "No retrieval embedding exists for this inspiration, so relationship matching cannot link WOW moments yet.",
    };
  }

  return {
    code: "no_generated_wow",
    label: "generated 0",
    detail: "Processing finished with an embedding, but no WOW moment link was generated for this inspiration.",
  };
}

export function createWowStatusRoutes(deps: WowStatusRouteDependencies = {}): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;
  routes.use("*", deps.authMiddleware ?? requireAuth);

  routes.get("/", async (c) => {
    const userId = c.get("user").id;
    const limit = parseLimit(c.req.query("limit"));
    const db = getDatabase();

    const recentInspirations = await db
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
      .where(eq(inspirations.userId, userId))
      .orderBy(desc(inspirations.createdAt))
      .limit(limit);

    const inspirationIds = recentInspirations.map((row) => row.id);
    if (inspirationIds.length === 0) {
      return c.json({ rows: [] });
    }

    const [jobs, embeddedRows, linkedRows] = await Promise.all([
      db
        .select()
        .from(backgroundJobs)
        .where(and(eq(backgroundJobs.userId, userId), eq(backgroundJobs.type, "process_inspiration")))
        .orderBy(desc(backgroundJobs.createdAt))
        .limit(JOB_SCAN_LIMIT),
      db
        .select({ inspirationId: inspirationEmbeddings.inspirationId })
        .from(inspirationEmbeddings)
        .where(
          and(
            eq(inspirationEmbeddings.userId, userId),
            inArray(inspirationEmbeddings.inspirationId, inspirationIds),
          ),
        ),
      db
        .select({
          inspirationId: wowMomentInspirations.inspirationId,
          wowMomentId: wowMoments.id,
          title: wowMoments.title,
        })
        .from(wowMomentInspirations)
        .innerJoin(wowMoments, eq(wowMomentInspirations.wowMomentId, wowMoments.id))
        .where(
          and(
            eq(wowMomentInspirations.userId, userId),
            eq(wowMoments.userId, userId),
            inArray(wowMomentInspirations.inspirationId, inspirationIds),
          ),
        )
        .orderBy(desc(wowMoments.createdAt)),
    ]);

    const jobByInspirationId = new Map<string, BackgroundJob>();
    for (const job of jobs) {
      const inspirationId = jobInspirationId(job);
      if (inspirationId && inspirationIds.includes(inspirationId) && !jobByInspirationId.has(inspirationId)) {
        jobByInspirationId.set(inspirationId, job);
      }
    }

    const embedded = new Set(embeddedRows.map((row) => row.inspirationId));
    const wowByInspirationId = new Map<string, { count: number; titles: string[] }>();
    for (const row of linkedRows) {
      const current = wowByInspirationId.get(row.inspirationId) ?? { count: 0, titles: [] };
      current.count += 1;
      if (current.titles.length < MAX_WOW_TITLES && !current.titles.includes(row.title)) {
        current.titles.push(row.title);
      }
      wowByInspirationId.set(row.inspirationId, current);
    }

    return c.json({
      rows: recentInspirations.map((inspiration) => {
        const job = jobByInspirationId.get(inspiration.id) ?? null;
        const wow = wowByInspirationId.get(inspiration.id) ?? { count: 0, titles: [] };
        const isEmbedded = embedded.has(inspiration.id);
        const debugReason = buildDebugReason({
          job,
          embedded: isEmbedded,
          linkedWowMomentCount: wow.count,
        });
        return {
          inspiration: {
            id: inspiration.id,
            textPreview: truncatePreview(inspiration.text),
            kind: inspiration.kind,
            category: inspiration.category,
            cluster: inspiration.cluster,
            classifiedAt: inspiration.classifiedAt?.toISOString() ?? null,
            importanceScore: inspiration.importanceScore,
            wowScore: inspiration.wowScore,
            createdAt: inspiration.createdAt.toISOString(),
            updatedAt: inspiration.updatedAt.toISOString(),
          },
          job: job
            ? {
                id: job.id,
                status: job.status,
                attempts: job.attempts,
                maxAttempts: job.maxAttempts,
                updatedAt: job.updatedAt.toISOString(),
                lastError: job.lastError ? "redacted" : null,
              }
            : null,
          embedded: isEmbedded,
          linkedWowMomentCount: wow.count,
          linkedWowMomentTitles: wow.titles,
          generatedWowMomentCount: wow.count,
          debugReason,
        };
      }),
    });
  });

  return routes;
}

export const wowStatusRoutes = createWowStatusRoutes();
