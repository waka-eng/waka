import { and, eq, inArray, sql } from "drizzle-orm";

import {
  feedback,
  meaningEvidence,
  meaningNodes,
  wowMomentInspirations,
  wowMoments,
  type FeedbackValue,
} from "../db/index.js";
import type { WakaDb } from "./inspiration-embeddings.js";
import {
  topOfMindNoteStatusValues,
  type TopOfMindNoteStatus,
} from "./top-of-mind-notes.js";

export interface FeedbackApplicationTarget {
  userId: string;
  targetType: "signal" | "context_node" | "top_of_mind_note" | "hypothesis";
  targetId: string;
  value: FeedbackValue;
  correctionText?: string | null;
}

export interface FeedbackApplicationPlan {
  topOfMindNoteStatus: TopOfMindNoteStatus;
  nodeStatus: "active" | "stale";
  weightDelta: number;
  confidenceDelta: number;
  correctionRequested: boolean;
}

export interface FeedbackApplicationResult extends FeedbackApplicationPlan {
  source: "user_feedback";
  appliedAt: string;
  targetType: FeedbackApplicationTarget["targetType"];
  targetId: string;
  contextNodeIds: string[];
  noteConfidenceDelta: number;
}

export interface FeedbackApplicationMetadata extends Record<string, unknown> {
  appliedFeedback: FeedbackApplicationResult;
}

const topOfMindStatuses = new Set<string>(topOfMindNoteStatusValues);

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

/**
 * Whether feedback on this target should mutate the underlying context-graph
 * nodes (weight/confidence/status).
 *
 * A top-of-mind note is a *synthesis* over many shared signals, so feedback on
 * it judges the presentation, not the meaning. Cascading that judgment into the
 * graph let a single "not true" on one note flip every context node that shared
 * a signal into permanent `stale` — and because stale nodes are excluded from
 * every read path with no reactivation surface, a couple of dismissals could
 * darken the whole graph and make top-of-mind permanently empty. Note feedback
 * therefore adjusts only the note itself; signal/context_node/hypothesis
 * feedback still updates the graph, because those target the meaning directly.
 */
export function feedbackMutatesContextNodes(
  targetType: FeedbackApplicationTarget["targetType"],
): boolean {
  return targetType !== "top_of_mind_note";
}

export function planFeedbackApplication(input: {
  value: FeedbackValue;
  correctionText?: string | null;
}): FeedbackApplicationPlan {
  switch (input.value) {
    case "true":
      return {
        topOfMindNoteStatus: "active",
        nodeStatus: "active",
        weightDelta: 14,
        confidenceDelta: 6,
        correctionRequested: false,
      };
    case "important":
      return {
        topOfMindNoteStatus: "active",
        nodeStatus: "active",
        weightDelta: 18,
        confidenceDelta: 4,
        correctionRequested: false,
      };
    case "partly":
      return {
        topOfMindNoteStatus: "active",
        nodeStatus: "active",
        weightDelta: 4,
        confidenceDelta: 0,
        correctionRequested: !input.correctionText?.trim(),
      };
    case "not_true":
      return {
        topOfMindNoteStatus: "stale",
        nodeStatus: "stale",
        weightDelta: -26,
        confidenceDelta: -16,
        correctionRequested: false,
      };
    case "not_important":
      return {
        topOfMindNoteStatus: "dismissed",
        nodeStatus: "stale",
        weightDelta: -20,
        confidenceDelta: -8,
        correctionRequested: false,
      };
  }
}

export function readAppliedTopOfMindStatus(
  metadata: Record<string, unknown> | null | undefined,
): TopOfMindNoteStatus | null {
  const applied = metadata?.appliedFeedback;
  if (!applied || typeof applied !== "object") return null;
  const status = (applied as { topOfMindNoteStatus?: unknown })
    .topOfMindNoteStatus;
  if (typeof status !== "string" || !topOfMindStatuses.has(status)) return null;
  return status as TopOfMindNoteStatus;
}

async function findRelatedContextNodeIds(
  db: WakaDb,
  input: FeedbackApplicationTarget,
): Promise<string[]> {
  if (input.targetType === "context_node" || input.targetType === "hypothesis") {
    return [input.targetId];
  }

  const filters = [eq(meaningEvidence.userId, input.userId)];
  if (input.targetType === "signal") {
    filters.push(eq(meaningEvidence.inspirationId, input.targetId));
  }

  if (input.targetType === "top_of_mind_note") {
    const rows = await db
      .select({ meaningNodeId: meaningEvidence.meaningNodeId })
      .from(wowMomentInspirations)
      .innerJoin(
        meaningEvidence,
        and(
          eq(wowMomentInspirations.userId, meaningEvidence.userId),
          eq(wowMomentInspirations.inspirationId, meaningEvidence.inspirationId),
        ),
      )
      .where(
        and(
          eq(wowMomentInspirations.userId, input.userId),
          eq(wowMomentInspirations.wowMomentId, input.targetId),
        ),
      );

    return [...new Set(rows.map((row) => row.meaningNodeId))];
  }

  const rows = await db
    .select({ meaningNodeId: meaningEvidence.meaningNodeId })
    .from(meaningEvidence)
    .where(and(...filters));

  return [...new Set(rows.map((row) => row.meaningNodeId))];
}

async function applyPlanToContextNodes(
  db: WakaDb,
  input: {
    userId: string;
    nodeIds: string[];
    plan: FeedbackApplicationPlan;
  },
): Promise<void> {
  if (input.nodeIds.length === 0) return;

  const now = new Date();
  await db
    .update(meaningNodes)
    .set({
      weight: sql<number>`least(1000, greatest(0, ${meaningNodes.weight} + ${input.plan.weightDelta}))`,
      confidence: sql<number>`least(100, greatest(0, ${meaningNodes.confidence} + ${input.plan.confidenceDelta}))`,
      status: input.plan.nodeStatus,
      ...(input.plan.nodeStatus === "active" ? { lastReinforcedAt: now } : {}),
      updatedAt: now,
    })
    .where(
      and(
        eq(meaningNodes.userId, input.userId),
        inArray(meaningNodes.id, input.nodeIds),
      ),
    );
}

async function applyPlanToTopOfMindNoteConfidence(
  db: WakaDb,
  input: {
    userId: string;
    noteId: string;
    plan: FeedbackApplicationPlan;
  },
): Promise<number> {
  const noteConfidenceDelta =
    input.plan.topOfMindNoteStatus === "dismissed"
      ? -12
      : input.plan.confidenceDelta;
  const [moment] = await db
    .select({ wowScore: wowMoments.wowScore })
    .from(wowMoments)
    .where(
      and(eq(wowMoments.userId, input.userId), eq(wowMoments.id, input.noteId)),
    )
    .for("update")
    .limit(1);

  if (!moment) return 0;

  const nextWowScore = clampInt(moment.wowScore + noteConfidenceDelta, 0, 100);

  await db
    .update(wowMoments)
    .set({ wowScore: nextWowScore, updatedAt: new Date() })
    .where(
      and(eq(wowMoments.userId, input.userId), eq(wowMoments.id, input.noteId)),
    );

  return nextWowScore - moment.wowScore;
}

export async function applyFeedbackToGraph(
  db: WakaDb,
  input: FeedbackApplicationTarget & { feedbackId: string },
): Promise<FeedbackApplicationMetadata> {
  const plan = planFeedbackApplication(input);
  const contextNodeIds = await findRelatedContextNodeIds(db, input);

  // Note feedback records the related nodes for provenance but must not mutate
  // them — see feedbackMutatesContextNodes for why a bad synthesis must not
  // stale the underlying meaning.
  if (feedbackMutatesContextNodes(input.targetType)) {
    await applyPlanToContextNodes(db, {
      userId: input.userId,
      nodeIds: contextNodeIds,
      plan,
    });
  }

  const noteConfidenceDelta =
    input.targetType === "top_of_mind_note"
      ? await applyPlanToTopOfMindNoteConfidence(db, {
          userId: input.userId,
          noteId: input.targetId,
          plan,
        })
      : 0;

  const metadata: FeedbackApplicationMetadata = {
    appliedFeedback: {
      ...plan,
      source: "user_feedback",
      appliedAt: new Date().toISOString(),
      targetType: input.targetType,
      targetId: input.targetId,
      contextNodeIds,
      noteConfidenceDelta,
    },
  };

  await db
    .update(feedback)
    .set({ metadata, updatedAt: new Date() })
    .where(and(eq(feedback.userId, input.userId), eq(feedback.id, input.feedbackId)));

  return metadata;
}
