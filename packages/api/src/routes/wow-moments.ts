/**
 * WOW moments routes.
 *
 * Authenticated users can list persisted WOW moments and explicitly request a
 * bounded manual generation attempt for one existing inspiration. The create
 * async classifier worker reuses the same bounded pipeline for best-effort
 * automatic generation after a capture has been processed; this manual route
 * keeps its existing response semantics.
 */

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import {
  inspirations,
  wowMomentInspirations,
  wowMoments,
} from "../db/index.js";
import { getDb } from "../lib/db.js";
import {
  ensureInspirationEmbedding,
  type WakaDb,
} from "../lib/inspiration-embeddings.js";
import { persistLocalInspirationScoresById } from "../lib/inspiration-scores.js";
import { type AuthEnv, requireAuth } from "../lib/middleware.js";
import {
  DEFAULT_WOW_GENERATION_LIMIT,
  MAX_WOW_GENERATION_LIMIT,
} from "../lib/wow-generation-config.js";
import {
  MAX_WOW_MOMENT_SOURCE_LINKS,
  judgeWowMomentForInspiration,
  persistWowMomentForInspirationJudgment,
} from "../lib/wow-judge.js";

const DEFAULT_WOW_MOMENTS_LIMIT = 20;
const MAX_WOW_MOMENTS_LIMIT = 100;

const listWowMomentsQuerySchema = z
  .object({
    limit: z
      .string()
      .regex(/^\d+$/, "limit must be an integer")
      .transform((value) => Number.parseInt(value, 10))
      .pipe(
        z
          .number()
          .int("limit must be an integer")
          .min(1, "limit must be at least 1")
          .max(
            MAX_WOW_MOMENTS_LIMIT,
            `limit must be <= ${MAX_WOW_MOMENTS_LIMIT}`,
          ),
      )
      .optional(),
  })
  .strict();

const generateWowMomentRequestSchema = z
  .object({
    inspirationId: z.string().uuid("inspirationId must be a uuid"),
    limit: z
      .number()
      .int("limit must be an integer")
      .min(1, "limit must be at least 1")
      .max(MAX_WOW_GENERATION_LIMIT, `limit must be <= ${MAX_WOW_GENERATION_LIMIT}`)
      .optional(),
  })
  .strict();

export type GenerateWowMomentRequest = z.infer<typeof generateWowMomentRequestSchema>;

export interface WowMomentsRouteDependencies {
  getDatabase?: () => WakaDb;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
  ensureEmbedding?: typeof ensureInspirationEmbedding;
  judgeWowMoment?: typeof judgeWowMomentForInspiration;
  persistJudgment?: typeof persistWowMomentForInspirationJudgment;
}

function logSafeGenerationError(error: unknown): void {
  console.warn("[wow-moments] manual generation failed", {
    error: error instanceof Error ? error.message : String(error),
  });
}

export function createWowMomentsRoutes(
  deps: WowMomentsRouteDependencies = {},
): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;
  const ensureEmbedding = deps.ensureEmbedding ?? ensureInspirationEmbedding;
  const judgeWowMoment = deps.judgeWowMoment ?? judgeWowMomentForInspiration;
  const persistJudgment = deps.persistJudgment ?? persistWowMomentForInspirationJudgment;

  routes.use("*", deps.authMiddleware ?? requireAuth);

  routes.get("/", async (c) => {
    const parsedQuery = listWowMomentsQuerySchema.safeParse(c.req.query());
    if (!parsedQuery.success) {
      return c.json(
        {
          error: "Invalid WOW moments query",
          details: parsedQuery.error.flatten().fieldErrors,
        },
        400,
      );
    }

    const user = c.get("user");
    const db = getDatabase();
    const limit = parsedQuery.data.limit ?? DEFAULT_WOW_MOMENTS_LIMIT;

    const moments = await db
      .select({
        id: wowMoments.id,
        userId: wowMoments.userId,
        title: wowMoments.title,
        kind: wowMoments.kind,
        why: wowMoments.why,
        reflectionQuestion: wowMoments.reflectionQuestion,
        wowScore: wowMoments.wowScore,
        createdAt: wowMoments.createdAt,
        updatedAt: wowMoments.updatedAt,
      })
      .from(wowMoments)
      .where(eq(wowMoments.userId, user.id))
      // Score first, then recency as a deterministic tie-breaker. Main feed
      // consumers still render only their own smaller best-recent surface.
      .orderBy(desc(wowMoments.wowScore), desc(wowMoments.createdAt))
      .limit(limit);

    if (moments.length === 0) {
      return c.json({ wowMoments: [] });
    }

    const momentIds = moments.map((moment) => moment.id);
    const relatedRows = await db
      .select({
        wowMomentId: wowMomentInspirations.wowMomentId,
        inspirationId: wowMomentInspirations.inspirationId,
        role: wowMomentInspirations.role,
        reason: wowMomentInspirations.reason,
        sortOrder: wowMomentInspirations.sortOrder,
        inspirationText: inspirations.text,
        inspirationKind: inspirations.kind,
        inspirationCreatedAt: inspirations.createdAt,
        inspirationWowScore: inspirations.wowScore,
      })
      .from(wowMomentInspirations)
      .innerJoin(
        inspirations,
        eq(wowMomentInspirations.inspirationId, inspirations.id),
      )
      .where(
        and(
          inArray(wowMomentInspirations.wowMomentId, momentIds),
          eq(wowMomentInspirations.userId, user.id),
          eq(inspirations.userId, user.id),
        ),
      )
      .orderBy(asc(wowMomentInspirations.sortOrder), asc(wowMomentInspirations.createdAt));

    const relatedByMomentId = new Map<string, typeof relatedRows>();
    for (const row of relatedRows) {
      const bucket = relatedByMomentId.get(row.wowMomentId) ?? [];
      bucket.push(row);
      relatedByMomentId.set(row.wowMomentId, bucket);
    }

    return c.json({
      wowMoments: moments.map((moment) => ({
        ...moment,
        relatedInspirations: (relatedByMomentId.get(moment.id) ?? [])
          .slice(0, MAX_WOW_MOMENT_SOURCE_LINKS)
          .map((row) => ({
            inspirationId: row.inspirationId,
            role: row.role,
            reason: row.reason,
            text: row.inspirationText,
            kind: row.inspirationKind,
            createdAt: row.inspirationCreatedAt,
            wowScore: row.inspirationWowScore,
          })),
      })),
    });
  });

  routes.post("/generate", async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }

    const parsed = generateWowMomentRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        {
          error: "Invalid WOW generation payload",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }

    const user = c.get("user");
    const db = getDatabase();
    const limit = parsed.data.limit ?? DEFAULT_WOW_GENERATION_LIMIT;

    try {
      const embeddingResult = await ensureEmbedding({
        db,
        userId: user.id,
        inspirationId: parsed.data.inspirationId,
      });

      if (embeddingResult.status === "missing_inspiration") {
        return c.json({ error: "Inspiration not found" }, 404);
      }

      if (embeddingResult.status === "stale_source") {
        return c.json(
          {
            error: "Inspiration changed while generating embedding",
            code: "stale_source",
            retryable: true,
          },
          409,
        );
      }

      try {
        await persistLocalInspirationScoresById(db, {
          userId: user.id,
          inspirationId: parsed.data.inspirationId,
        });
      } catch (error) {
        logSafeGenerationError(error);
      }

      const judgment = await judgeWowMoment({
        db,
        userId: user.id,
        triggerInspirationId: parsed.data.inspirationId,
        limit,
      });

      if (!judgment.isWowMoment) {
        return c.json({
          generated: false,
          reason: "not_wow_moment",
          judgment,
          embeddingStatus: embeddingResult.status,
        });
      }

      const persisted = await persistJudgment({
        db,
        userId: user.id,
        triggerInspirationId: parsed.data.inspirationId,
        judgment,
        limit,
      });

      if (persisted.persisted === false) {
        if (persisted.reason === "trigger_not_found") {
          return c.json({ error: "Inspiration not found" }, 404);
        }
        return c.json({
          generated: false,
          reason: persisted.reason,
          judgment: persisted.judgment,
          embeddingStatus: embeddingResult.status,
        });
      }

      return c.json({
        generated: true,
        status: persisted.status,
        embeddingStatus: embeddingResult.status,
        judgment: persisted.judgment,
        wowMoment: persisted.wowMoment,
        inspirationLinks: persisted.inspirationLinks,
      });
    } catch (error) {
      logSafeGenerationError(error);
      return c.json(
        {
          error: "WOW generation unavailable",
          code: "wow_generation_unavailable",
        },
        503,
      );
    }
  });

  return routes;
}

export const wowMomentsRoutes = createWowMomentsRoutes();
