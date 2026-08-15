/**
 * `/api/feedback` — a reader's verdict on something WAKA generated.
 *
 * Deliberately narrow: does this signal ring true, does this top-of-mind entry
 * land. That is the part that is genuinely a reaction, and it is what the next
 * regeneration reads back.
 *
 * Pin, dismiss and lock are **not** feedback. They are state on the entry, set
 * through the entry's own endpoints, because the generator has to read them on
 * every pass and "is this pinned?" must never require replaying a history of
 * reactions. A request that asks for one of them here is answered with that
 * redirection rather than a bare validation error: the caller is not
 * malformed, it is aimed at the wrong door.
 *
 * A target must belong to the acting profile. A group entry is not a valid
 * target: what a group says about itself changes through proposals, so a
 * private verdict on a shared entry would be a vote nobody else can see.
 */

import { and, desc, eq } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import {
  feedback,
  feedbackTargetTypeValues,
  feedbackValueValues,
  signals,
  topOfMindEntries,
  topOfMinds,
  type Feedback,
  type FeedbackTargetType,
  type FeedbackValue,
} from "../db/index.js";
import { getDb } from "../lib/db.js";
import { requireAuth, type AuthEnv } from "../lib/middleware.js";
import { enqueueTopOfMindRefresh } from "../lib/queue.js";

type WakaDb = ReturnType<typeof getDb>;

const DEFAULT_FEEDBACK_LIMIT = 50;
const MAX_FEEDBACK_LIMIT = 100;
const MAX_CORRECTION_TEXT_LENGTH = 2000;

/** Words that mean entry state. Listed so the refusal can say where they go. */
const ENTRY_STATE_VALUES = [
  "important",
  "not_important",
  "pin",
  "pinned",
  "dismiss",
  "dismissed",
] as const;

const ENTRY_STATE_MESSAGE =
  "Pinning and dismissing are entry state, not feedback. Use the top-of-mind entry's pin/dismiss endpoints; feedback records whether a claim rings true.";

const createFeedbackRequestSchema = z
  .object({
    targetType: z.enum(feedbackTargetTypeValues),
    targetId: z.string().uuid("targetId must be a uuid"),
    value: z.enum(feedbackValueValues),
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
    targetType: z.enum(feedbackTargetTypeValues).optional(),
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

export interface FeedbackRecord {
  id: string;
  profileId: string;
  targetType: FeedbackTargetType;
  targetId: string;
  value: FeedbackValue;
  correctionText: string | null;
  createdAt: string;
}

export interface CreateFeedbackInput {
  profileId: string;
  targetType: FeedbackTargetType;
  targetId: string;
  value: FeedbackValue;
  correctionText?: string;
}

export interface ListFeedbackInput {
  profileId: string;
  targetType?: FeedbackTargetType;
  targetId?: string;
  limit: number;
}

export interface FeedbackRouteDependencies {
  getDatabase?: typeof getDb;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
  createFeedback?: (db: WakaDb, input: CreateFeedbackInput) => Promise<FeedbackRecord | null>;
  listFeedback?: (db: WakaDb, input: ListFeedbackInput) => Promise<FeedbackRecord[]>;
}

function serializeFeedback(row: Feedback): FeedbackRecord {
  return {
    id: row.id,
    profileId: row.profileId,
    targetType: row.targetType,
    targetId: row.targetId,
    value: row.value,
    correctionText: row.correctionText,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Is this target the acting profile's to judge?
 *
 * `feedback.target_id` is not a foreign key — it points at two tables — so
 * this is the check that keeps it honest. Without it, feedback could be filed
 * against any id at all, and regeneration would read a stranger's verdict as
 * the owner's.
 */
async function targetBelongsToProfile(
  db: WakaDb,
  input: { profileId: string; targetType: FeedbackTargetType; targetId: string },
): Promise<boolean> {
  if (input.targetType === "signal") {
    const [row] = await db
      .select({ id: signals.id })
      .from(signals)
      .where(and(eq(signals.id, input.targetId), eq(signals.profileId, input.profileId)))
      .limit(1);
    return Boolean(row);
  }

  const [row] = await db
    .select({ id: topOfMindEntries.id })
    .from(topOfMindEntries)
    .innerJoin(topOfMinds, eq(topOfMinds.id, topOfMindEntries.topOfMindId))
    .where(
      and(
        eq(topOfMindEntries.id, input.targetId),
        eq(topOfMinds.profileId, input.profileId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function createFeedbackForProfile(
  db: WakaDb,
  input: CreateFeedbackInput,
): Promise<FeedbackRecord | null> {
  const owned = await targetBelongsToProfile(db, input);
  if (!owned) return null;

  const [row] = await db
    .insert(feedback)
    .values({
      profileId: input.profileId,
      targetType: input.targetType,
      targetId: input.targetId,
      value: input.value,
      correctionText: input.correctionText ?? null,
    })
    .returning();
  return row ? serializeFeedback(row) : null;
}

export async function listFeedbackForProfile(
  db: WakaDb,
  input: ListFeedbackInput,
): Promise<FeedbackRecord[]> {
  const filters = [eq(feedback.profileId, input.profileId)];
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

/** Is the caller asking for entry state rather than filing a verdict? */
function asksForEntryState(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const value = (body as { value?: unknown }).value;
  return (
    typeof value === "string" && (ENTRY_STATE_VALUES as readonly string[]).includes(value)
  );
}

export function createFeedbackRoutes(
  deps: FeedbackRouteDependencies = {},
): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;
  const createFeedback = deps.createFeedback ?? createFeedbackForProfile;
  const listFeedback = deps.listFeedback ?? listFeedbackForProfile;

  routes.use("*", deps.authMiddleware ?? requireAuth);

  routes.post("/", async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }

    if (asksForEntryState(rawBody)) {
      return c.json({ error: ENTRY_STATE_MESSAGE }, 400);
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

    const session = c.get("session");
    const row = await createFeedback(getDatabase(), {
      profileId: session.profile.id,
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId,
      value: parsed.data.value,
      ...(parsed.data.correctionText
        ? { correctionText: parsed.data.correctionText }
        : {}),
    });

    if (!row) {
      return c.json({ error: "Feedback target not found" }, 404);
    }

    // A verdict changes what the next synthesis should weigh — a signal marked
    // not_true fights uphill, an entry the person rejected should not return in
    // the same form. Re-synthesise so the correction lands without waiting on
    // an unrelated future capture. Best-effort: the verdict has committed.
    void enqueueTopOfMindRefresh(session.profile.id, "signals_changed").catch(
      (err: unknown) => {
        console.warn("[feedback] refresh enqueue failed", {
          profileId: session.profile.id,
          error: err instanceof Error ? err.message : String(err),
        });
      },
    );
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

    const session = c.get("session");
    const rows = await listFeedback(getDatabase(), {
      profileId: session.profile.id,
      ...(parsedQuery.data.targetType ? { targetType: parsedQuery.data.targetType } : {}),
      ...(parsedQuery.data.targetId ? { targetId: parsedQuery.data.targetId } : {}),
      limit: parsedQuery.data.limit ?? DEFAULT_FEEDBACK_LIMIT,
    });

    return c.json({ feedback: rows });
  });

  return routes;
}

export const feedbackRoutes = createFeedbackRoutes();
