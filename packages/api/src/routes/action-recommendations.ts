import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import { feedback, wowMoments } from "../db/index.js";
import { getDb } from "../lib/db.js";
import { requireAuth, type AuthEnv } from "../lib/middleware.js";
import {
  actionRecommendationStatusValues,
  selectActionRecommendationCandidates,
  type ActionRecommendationGenerator,
  type ActionRecommendationState,
  type ActionRecommendationStatus,
  type RecommendedAction,
} from "../lib/action-recommendations.js";
import {
  listTopOfMindNotesForUser,
  type TopOfMindNoteSurface,
} from "./top-of-mind.js";

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

const actionRecommendationParamsSchema = z
  .object({
    actionId: z.string().min(1).max(180),
  })
  .strict();

const updateActionRecommendationBodySchema = z
  .object({
    sourceTopOfMindId: z.string().uuid("sourceTopOfMindId must be a uuid"),
    status: z.enum(actionRecommendationStatusValues).refine(
      (status) => status !== "active",
      "status must be completed or removed",
    ),
    outcomeText: z.string().trim().max(1000).optional(),
    relatedSignalIds: z
      .array(z.string().uuid("relatedSignalIds must contain uuids"))
      .max(10)
      .optional(),
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
  outcomeText?: string;
  relatedSignalIds?: string[];
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
  getModelProvider?: () => Promise<ActionRecommendationGenerator>;
}

function hasMatchingActionRecommendationCandidate(
  notes: TopOfMindNoteSurface[],
  input: { actionId: string; sourceTopOfMindId: string },
): boolean {
  return selectActionRecommendationCandidates({
    notes,
    states: [],
    limit: MAX_ACTION_RECOMMENDATION_LIMIT,
  }).some(
    (candidate) =>
      candidate.id === input.actionId &&
      candidate.sourceTopOfMindId === input.sourceTopOfMindId,
  );
}

function findMatchingTerminalState(
  states: ActionRecommendationState[],
  input: {
    actionId: string;
    sourceTopOfMindId: string;
    status: Exclude<ActionRecommendationStatus, "active">;
  },
): ActionRecommendationState | null {
  return (
    states.find(
      (state) =>
        state.actionId === input.actionId &&
        state.sourceTopOfMindId === input.sourceTopOfMindId &&
        state.status === input.status,
    ) ?? null
  );
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
    outcomeText:
      typeof raw.outcomeText === "string" && raw.outcomeText.trim()
        ? raw.outcomeText.trim()
        : null,
    relatedSignalIds: Array.isArray(raw.relatedSignalIds)
      ? raw.relatedSignalIds.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
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
  const outcomeText = input.outcomeText?.trim();
  const relatedSignalIds = input.relatedSignalIds ?? [];
  const [row] = await db
    .insert(feedback)
    .values({
      userId: input.userId,
      targetType: "top_of_mind_note",
      targetId: input.sourceTopOfMindId,
      value: input.status === "completed" ? "important" : "not_important",
      correctionText: outcomeText || null,
      source: ACTION_FEEDBACK_SOURCE,
      metadata: {
        actionRecommendation: {
          actionId: input.actionId,
          status: input.status,
          ...(outcomeText ? { outcomeText } : {}),
          ...(relatedSignalIds.length > 0 ? { relatedSignalIds } : {}),
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

    // Action recommendations are temporarily disabled. Keep the authenticated
    // endpoint and query validation contract intact, but do not read notes or
    // invoke the model provider/Gemini while the UI surface is hidden.
    return c.json({ actionRecommendations: [] });
  });

  routes.post("/:actionId/state", async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }

    const parsedParams = actionRecommendationParamsSchema.safeParse(c.req.param());
    const parsedBody = updateActionRecommendationBodySchema.safeParse(rawBody);
    if (!parsedParams.success || !parsedBody.success) {
      return c.json(
        {
          error: "Invalid action recommendation state payload",
          details: {
            ...(!parsedParams.success
              ? parsedParams.error.flatten().fieldErrors
              : {}),
            ...(!parsedBody.success ? parsedBody.error.flatten().fieldErrors : {}),
          },
        },
        400,
      );
    }

    const userId = c.get("user").id;
    const db = getDatabase();
    const notes = await listTopOfMindNotes(db, { userId, limit: 20 });
    const states = await listStates(db, {
      userId,
      sourceTopOfMindIds: notes.map((note) => note.id),
    });
    const matchingState = findMatchingTerminalState(states, {
      actionId: parsedParams.data.actionId,
      sourceTopOfMindId: parsedBody.data.sourceTopOfMindId,
      status: parsedBody.data.status as Exclude<ActionRecommendationStatus, "active">,
    });
    if (matchingState) {
      return c.json({ actionRecommendationState: matchingState });
    }

    const hasMatchingCandidate = hasMatchingActionRecommendationCandidate(notes, {
      actionId: parsedParams.data.actionId,
      sourceTopOfMindId: parsedBody.data.sourceTopOfMindId,
    });

    if (!hasMatchingCandidate) {
      return c.json({ error: "Action recommendation not found" }, 404);
    }

    const saveInput: SaveActionRecommendationStateInput = {
      userId,
      actionId: parsedParams.data.actionId,
      sourceTopOfMindId: parsedBody.data.sourceTopOfMindId,
      status: parsedBody.data.status as Exclude<ActionRecommendationStatus, "active">,
    };
    if (parsedBody.data.outcomeText?.trim()) {
      saveInput.outcomeText = parsedBody.data.outcomeText.trim();
    }
    if (parsedBody.data.relatedSignalIds?.length) {
      saveInput.relatedSignalIds = parsedBody.data.relatedSignalIds;
    }

    const state = await saveState(db, saveInput);

    if (!state) {
      return c.json({ error: "Action recommendation not found" }, 404);
    }

    return c.json({ actionRecommendationState: state });
  });

  return routes;
}

export const actionRecommendationsRoutes = createActionRecommendationsRoutes();

export type { RecommendedAction };
