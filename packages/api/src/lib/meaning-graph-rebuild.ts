import { asc, eq } from "drizzle-orm";

import {
  inspirations,
  meaningEdges,
  meaningEvidence,
  meaningNodes,
} from "../db/index.js";
import { getDb } from "./db.js";
import { persistMeaningGraphForInspiration } from "./meaning-graph-writer.js";
import { persistMeaningPacketForInspiration } from "./meaning-packets.js";

export type MeaningGraphRebuildPhase =
  | "queued"
  | "counting"
  | "clearing"
  | "processing"
  | "completed";

export interface MeaningGraphRebuildProgress {
  phase: MeaningGraphRebuildPhase;
  totalInspirations: number;
  processedInspirations: number;
  nodesTouched: number;
  evidenceTouched: number;
  edgesTouched: number;
  startedAt?: string;
  completedAt?: string;
}

export interface MeaningGraphRebuildPayload extends MeaningGraphRebuildProgress {
  requestedByUserId: string;
}

export interface MeaningGraphRebuildResult {
  inspirations: number;
  nodesTouched: number;
  evidenceTouched: number;
  edgesTouched: number;
}

export type MeaningGraphRebuildProgressReporter = (
  progress: MeaningGraphRebuildPayload,
) => Promise<void> | void;

export function createInitialMeaningGraphRebuildPayload(userId: string): MeaningGraphRebuildPayload {
  return {
    requestedByUserId: userId,
    phase: "queued",
    totalInspirations: 0,
    processedInspirations: 0,
    nodesTouched: 0,
    evidenceTouched: 0,
    edgesTouched: 0,
  };
}

export function parseMeaningGraphRebuildPayload(
  payload: unknown,
  userId: string,
): MeaningGraphRebuildPayload {
  if (!payload || typeof payload !== "object") {
    return createInitialMeaningGraphRebuildPayload(userId);
  }

  const value = payload as Partial<MeaningGraphRebuildPayload>;
  const phase =
    value.phase === "queued" ||
    value.phase === "counting" ||
    value.phase === "clearing" ||
    value.phase === "processing" ||
    value.phase === "completed"
      ? value.phase
      : "queued";

  return {
    requestedByUserId:
      typeof value.requestedByUserId === "string" && value.requestedByUserId.trim()
        ? value.requestedByUserId
        : userId,
    phase,
    totalInspirations: coerceNonNegativeInteger(value.totalInspirations),
    processedInspirations: coerceNonNegativeInteger(value.processedInspirations),
    nodesTouched: coerceNonNegativeInteger(value.nodesTouched),
    evidenceTouched: coerceNonNegativeInteger(value.evidenceTouched),
    edgesTouched: coerceNonNegativeInteger(value.edgesTouched),
    startedAt: typeof value.startedAt === "string" ? value.startedAt : undefined,
    completedAt: typeof value.completedAt === "string" ? value.completedAt : undefined,
  };
}

export async function rebuildMeaningGraphForUser(input: {
  db?: ReturnType<typeof getDb>;
  userId: string;
  initialPayload?: unknown;
  onProgress?: MeaningGraphRebuildProgressReporter;
}): Promise<MeaningGraphRebuildResult> {
  const db = input.db ?? getDb();
  const startedAt = new Date().toISOString();
  let progress: MeaningGraphRebuildPayload = {
    ...parseMeaningGraphRebuildPayload(input.initialPayload, input.userId),
    requestedByUserId: input.userId,
    phase: "counting",
    startedAt,
    completedAt: undefined,
  };

  const report = async (next: Partial<MeaningGraphRebuildPayload>) => {
    progress = { ...progress, ...next };
    await input.onProgress?.(progress);
  };

  await report(progress);

  const inspirationRows = await db
    .select({ id: inspirations.id })
    .from(inspirations)
    .where(eq(inspirations.userId, input.userId))
    .orderBy(asc(inspirations.createdAt));

  await report({
    phase: "clearing",
    totalInspirations: inspirationRows.length,
    processedInspirations: 0,
    nodesTouched: 0,
    evidenceTouched: 0,
    edgesTouched: 0,
  });

  await db.delete(meaningEvidence).where(eq(meaningEvidence.userId, input.userId));
  await db.delete(meaningEdges).where(eq(meaningEdges.userId, input.userId));
  await db.delete(meaningNodes).where(eq(meaningNodes.userId, input.userId));

  await report({ phase: "processing" });

  for (const inspiration of inspirationRows) {
    await persistMeaningPacketForInspiration({
      db,
      userId: input.userId,
      inspirationId: inspiration.id,
    });
    const result = await persistMeaningGraphForInspiration({
      db,
      userId: input.userId,
      triggerInspirationId: inspiration.id,
    });
    await report({
      phase: "processing",
      processedInspirations: progress.processedInspirations + 1,
      nodesTouched: progress.nodesTouched + result.nodes.length,
      evidenceTouched: progress.evidenceTouched + result.evidence.length,
      edgesTouched: progress.edgesTouched + result.edges.length,
    });
  }

  await report({ phase: "completed", completedAt: new Date().toISOString() });

  return {
    inspirations: inspirationRows.length,
    nodesTouched: progress.nodesTouched,
    evidenceTouched: progress.evidenceTouched,
    edgesTouched: progress.edgesTouched,
  };
}

function coerceNonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}
