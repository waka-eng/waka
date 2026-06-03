import { and, desc, eq } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import {
  feedback,
  feedbackEmotionEnumValues,
  feedbackTargetEnumValues,
  feedbackValueEnumValues,
  inspirations,
  meaningNodes,
  wowMoments,
  type Feedback,
  type FeedbackEmotion,
  type FeedbackTarget,
  type FeedbackValue,
} from "../db/index.js";
import { getDb } from "../lib/db.js";
import { applyFeedbackToGraph } from "../lib/feedback-application.js";
import { requireAuth, type AuthEnv } from "../lib/middleware.js";

const DEFAULT_FEEDBACK_LIMIT = 50;
const MAX_FEEDBACK_LIMIT = 100;
const MAX_CORRECTION_TEXT_LENGTH = 2000;

const feedbackTargetSchema = z.enum(feedbackTargetEnumValues);
const feedbackValueSchema = z.enum(feedbackValueEnumValues);
const feedbackEmotionSchema = z.enum(feedbackEmotionEnumValues);

const createFeedbackRequestSchema = z
  .object({
    targetType: feedbackTargetSchema,
    targetId: z.string().uuid("targetId must be a uuid"),
    value: feedbackValueSchema,
    emotionLabel: feedbackEmotionSchema.optional(),
    correctionText: z
      .string()
      .trim()
      .min(1, "correctionText cannot be empty")
      .max(
        MAX_CORRECTION_TEXT_LENGTH,
        `correctionText must be <= ${MAX_CORRECTION_TEXT_LENGTH} characters`,
      )
      .optional(),
  })
  .strict();

const listFeedbackQuerySchema = z
  .object({
    targetType: feedbackTargetSchema.optional(),
    targetId: z.string().uuid("targetId must be a uuid").optional(),
    limit: z
      .string()
      .regex(/^\d+$/, "limit must be an integer")
      .transform((value) => Number.parseInt(value, 10))
      .pipe(
        z
          .number()
          .int("limit must be an integer")
          .min(1, "limit must be at least 1")
          .max(MAX_FEEDBACK_LIMIT, `limit must be <= ${MAX_FEEDBACK_LIMIT}`),
      )
      .optional(),
  })
  .strict();

type WakaDb = ReturnType<typeof getDb>;

export interface FeedbackRecord {
  id: string;
  userId: string;
  targetType: FeedbackTarget;
  targetId: string;
  value: FeedbackValue;
  emotionLabel: FeedbackEmotion | null;
  correctionText: string | null;
  source: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFeedbackInput {
  userId: string;
  targetType: FeedbackTarget;
  targetId: string;
  value: FeedbackValue;
  emotionLabel?: FeedbackEmotion;
  correctionText?: string;
}

export interface ListFeedbackInput {
  userId: string;
  targetType?: FeedbackTarget;
  targetId?: string;
  limit: number;
}

export interface FeedbackRouteDependencies {
  getDatabase?: typeof getDb;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
  createFeedback?: (
    db: WakaDb,
    input: CreateFeedbackInput,
  ) => Promise<FeedbackRecord | null>;
  listFeedback?: (
    db: WakaDb,
    input: ListFeedbackInput,
  ) => Promise<FeedbackRecord[]>;
}

function serializeFeedback(row: Feedback): FeedbackRecord {
  return {
    id: row.id,
    userId: row.userId,
    targetType: row.targetType,
    targetId: row.targetId,
    value: row.value,
    emotionLabel: row.emotionLabel,
    correctionText: row.correctionText,
    source: row.source,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function targetBelongsToUser(
  db: WakaDb,
  input: { userId: string; targetType: FeedbackTarget; targetId: string },
): Promise<boolean> {
  if (input.targetType === "signal") {
    const [row] = await db
      .select({ id: inspirations.id })
      .from(inspirations)
      .where(
        and(
          eq(inspirations.userId, input.userId),
          eq(inspirations.id, input.targetId),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  if (input.targetType === "top_of_mind_note") {
    const [row] = await db
      .select({ id: wowMoments.id })
      .from(wowMoments)
      .where(
        and(
          eq(wowMoments.userId, input.userId),
          eq(wowMoments.id, input.targetId),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  const filters = [
    eq(meaningNodes.userId, input.userId),
    eq(meaningNodes.id, input.targetId),
  ];
  if (input.targetType === "hypothesis") {
    filters.push(eq(meaningNodes.type, "hypothesis"));
  }

  const [row] = await db
    .select({ id: meaningNodes.id })
    .from(meaningNodes)
    .where(and(...filters))
    .limit(1);
  return Boolean(row);
}

export async function createFeedbackForUser(
  db: WakaDb,
  input: CreateFeedbackInput,
): Promise<FeedbackRecord | null> {
  return db.transaction(async (tx) => {
    const txDb = tx as unknown as WakaDb;
    const targetExists = await targetBelongsToUser(txDb, input);
    if (!targetExists) return null;

    const now = new Date();
    const [row] = await tx
      .insert(feedback)
      .values({
        userId: input.userId,
        targetType: input.targetType,
        targetId: input.targetId,
        value: input.value,
        emotionLabel: input.emotionLabel ?? null,
        correctionText: input.correctionText ?? null,
        source: "user",
        updatedAt: now,
      })
      .returning();

    if (!row) return null;

    const metadata = await applyFeedbackToGraph(txDb, {
      feedbackId: row.id,
      userId: input.userId,
      targetType: input.targetType,
      targetId: input.targetId,
      value: input.value,
      correctionText: input.correctionText ?? null,
    });

    return serializeFeedback({ ...row, metadata, updatedAt: new Date() });
  });
}

export async function listFeedbackForUser(
  db: WakaDb,
  input: ListFeedbackInput,
): Promise<FeedbackRecord[]> {
  const filters = [eq(feedback.userId, input.userId)];
  if (input.targetType) filters.push(eq(feedback.targetType, input.targetType));
  if (input.targetId) filters.push(eq(feedback.targetId, input.targetId));

  const rows = await db
    .select()
    .from(feedback)
    .where(and(...filters))
    .orderBy(desc(feedback.createdAt))
    .limit(input.limit);

  return rows.map(serializeFeedback);
}

export function createFeedbackRoutes(
  deps: FeedbackRouteDependencies = {},
): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;
  const createFeedback = deps.createFeedback ?? createFeedbackForUser;
  const listFeedback = deps.listFeedback ?? listFeedbackForUser;

  routes.use("*", deps.authMiddleware ?? requireAuth);

  routes.post("/", async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }

    const parsed = createFeedbackRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        {
          error: "Invalid feedback payload",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }

    const row = await createFeedback(getDatabase(), {
      userId: c.get("user").id,
      ...parsed.data,
    });

    if (!row) {
      return c.json({ error: "Feedback target not found" }, 404);
    }

    return c.json({ feedback: row }, 201);
  });

  routes.get("/", async (c) => {
    const parsedQuery = listFeedbackQuerySchema.safeParse(c.req.query());
    if (!parsedQuery.success) {
      return c.json(
        {
          error: "Invalid feedback query",
          details: parsedQuery.error.flatten().fieldErrors,
        },
        400,
      );
    }

    const rows = await listFeedback(getDatabase(), {
      userId: c.get("user").id,
      targetType: parsedQuery.data.targetType,
      targetId: parsedQuery.data.targetId,
      limit: parsedQuery.data.limit ?? DEFAULT_FEEDBACK_LIMIT,
    });

    return c.json({ feedback: rows });
  });

  return routes;
}

export const feedbackRoutes = createFeedbackRoutes();
