import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import { feedback, wowMoments } from "../db/index.js";
import { getDb } from "../lib/db.js";
import { requireAuth, type AuthEnv } from "../lib/middleware.js";
import {
  actionRecommendationStatusValues,
  recommendActionsFromTopOfMind,
  type ActionRecommendationState,
  type ActionRecommendationStatus,
  type RecommendedAction,
} from "../lib/action-recommendations.js";
import {
  listTopOfMindNotesForUser,
  type TopOfMindNoteSurface,
} from "./top-of-mind.js";

const DEFAULT_ACTION_RECOMMENDATION_LIMIT = 5;
const MAX_ACTION_RECOMMENDATION_LIMIT = 5;

const ACTION_FEEDBACK_SOURCE = "action_recommendation";

const listActionRecommendationsQuerySchema = z
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
            MAX_ACTION_RECOMMENDATION_LIMIT,
            `limit must be <= ${MAX_ACTION_RECOMMENDATION_LIMIT}`,
          ),
      )
      .optional(),
  })
  .strict();

const updateActionRecommendationSchema = z
  .object({
    actionId: z.string().min(1).max(180),
    sourceTopOfMindId: z.string().uuid("sourceTopOfMindId must be a uuid"),
    status: z.enum(actionRecommendationStatusValues).refine(
      (status) => status !== "active",
      "status must be completed or removed",
    ),
  })
  .strict();

type WakaDb = ReturnType<typeof getDb>;

export interface ListActionRecommendationsInput {
  userId: string;
  limit: number;
}

export interface SaveActionRecommendationStateInput {
  userId: string;
  actionId: string;
  sourceTopOfMindId: string;
  status: Exclude<ActionRecommendationStatus, "active">;
}

export interface ActionRecommendationsRouteDependencies {
  getDatabase?: typeof getDb;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
  listTopOfMindNotes?: (
    db: WakaDb,
    input: { userId: string; limit: number },
  ) => Promise<TopOfMindNoteSurface[]>;
  listStates?: (
    db: WakaDb,
    input: { userId: string; sourceTopOfMindIds: string[] },
  ) => Promise<ActionRecommendationState[]>;
  saveState?: (
    db: WakaDb,
    input: SaveActionRecommendationStateInput,
  ) => Promise<ActionRecommendationState | null>;
}

function parseActionStateMetadata(row: {
  targetId: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}): ActionRecommendationState | null {
  const action = row.metadata.actionRecommendation;
  if (!action || typeof action !== "object") return null;
  const raw = action as Record<string, unknown>;
  if (typeof raw.actionId !== "string") return null;
  if (!actionRecommendationStatusValues.includes(raw.status as ActionRecommendationStatus)) {
    return null;
  }
  return {
    actionId: raw.actionId,
    sourceTopOfMindId: row.targetId,
    status: raw.status as ActionRecommendationStatus,
    updatedAt: row.updatedAt ?? row.createdAt,
  };
}

export async function listActionRecommendationStatesForUser(
  db: WakaDb,
  input: { userId: string; sourceTopOfMindIds: string[] },
): Promise<ActionRecommendationState[]> {
  if (input.sourceTopOfMindIds.length === 0) return [];

  const rows = await db
    .select({
      targetId: feedback.targetId,
      metadata: feedback.metadata,
      createdAt: feedback.createdAt,
      updatedAt: feedback.updatedAt,
    })
    .from(feedback)
    .where(
      and(
        eq(feedback.userId, input.userId),
        eq(feedback.targetType, "top_of_mind_note"),
        eq(feedback.source, ACTION_FEEDBACK_SOURCE),
        inArray(feedback.targetId, input.sourceTopOfMindIds),
      ),
    )
    .orderBy(desc(feedback.createdAt));

  const states = new Map<string, ActionRecommendationState>();
  for (const row of rows) {
    const state = parseActionStateMetadata(row);
    if (!state || states.has(state.actionId)) continue;
    states.set(state.actionId, state);
  }
  return [...states.values()];
}

export async function saveActionRecommendationStateForUser(
  db: WakaDb,
  input: SaveActionRecommendationStateInput,
): Promise<ActionRecommendationState | null> {
  const [sourceNote] = await db
    .select({ id: wowMoments.id })
    .from(wowMoments)
    .where(
      and(
        eq(wowMoments.userId, input.userId),
        eq(wowMoments.id, input.sourceTopOfMindId),
      ),
    )
    .limit(1);
  if (!sourceNote) return null;

  const now = new Date();
  const [row] = await db
    .insert(feedback)
    .values({
      userId: input.userId,
      targetType: "top_of_mind_note",
      targetId: input.sourceTopOfMindId,
      value: input.status === "completed" ? "important" : "not_important",
      source: ACTION_FEEDBACK_SOURCE,
      metadata: {
        actionRecommendation: {
          actionId: input.actionId,
          status: input.status,
        },
      },
      updatedAt: now,
    })
    .returning({
      targetId: feedback.targetId,
      metadata: feedback.metadata,
      createdAt: feedback.createdAt,
      updatedAt: feedback.updatedAt,
    });

  return row ? parseActionStateMetadata(row) : null;
}

export function createActionRecommendationsRoutes(
  deps: ActionRecommendationsRouteDependencies = {},
): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;
  const listTopOfMindNotes =
    deps.listTopOfMindNotes ?? listTopOfMindNotesForUser;
  const listStates = deps.listStates ?? listActionRecommendationStatesForUser;
  const saveState = deps.saveState ?? saveActionRecommendationStateForUser;

  routes.use("*", deps.authMiddleware ?? requireAuth);

  routes.get("/", async (c) => {
    const parsedQuery = listActionRecommendationsQuerySchema.safeParse(
      c.req.query(),
    );
    if (!parsedQuery.success) {
      return c.json(
        {
          error: "Invalid action recommendation query",
          details: parsedQuery.error.flatten().fieldErrors,
        },
        400,
      );
    }

    const userId = c.get("user").id;
    const db = getDatabase();
    const limit = parsedQuery.data.limit ?? DEFAULT_ACTION_RECOMMENDATION_LIMIT;
    const notes = await listTopOfMindNotes(db, { userId, limit: 20 });
    const states = await listStates(db, {
      userId,
      sourceTopOfMindIds: notes.map((note) => note.id),
    });
    const actionRecommendations = recommendActionsFromTopOfMind({
      notes,
      states,
      limit,
    });

    return c.json({ actionRecommendations });
  });

  routes.post("/:actionId/state", async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }

    const parsed = updateActionRecommendationSchema.safeParse({
      actionId: c.req.param("actionId"),
      ...(rawBody && typeof rawBody === "object" ? rawBody : {}),
    });
    if (!parsed.success) {
      return c.json(
        {
          error: "Invalid action recommendation state payload",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }

    const state = await saveState(getDatabase(), {
      userId: c.get("user").id,
      actionId: parsed.data.actionId,
      sourceTopOfMindId: parsed.data.sourceTopOfMindId,
      status: parsed.data.status as Exclude<ActionRecommendationStatus, "active">,
    });

    if (!state) {
      return c.json({ error: "Action recommendation source not found" }, 404);
    }

    return c.json({ actionRecommendationState: state });
  });

  return routes;
}

export const actionRecommendationsRoutes = createActionRecommendationsRoutes();

export type { RecommendedAction };

