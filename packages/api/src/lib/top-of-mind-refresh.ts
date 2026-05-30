import { and, desc, eq, inArray } from "drizzle-orm";

import {
  inspirations,
  meaningEvidence,
  meaningNodes,
  meaningPackets,
  wowMomentInspirations,
  wowMoments,
  type WowKind,
} from "../db/index.js";
import { normalizeContextNodeType, type ContextNodeType } from "./context-node-types.js";
import type { WakaDb } from "./inspiration-embeddings.js";

const DEFAULT_REFRESH_LIMIT = 5;
const MAX_REFRESH_LIMIT = 20;
const MAX_EVIDENCE_PER_NOTE = 3;
const MAX_TITLE_CHARS = 120;
const MAX_REASON_CHARS = 180;

export interface TopOfMindRefreshNodeInput {
  id: string;
  type: string;
  label: string;
  description: string;
  weight: number;
  confidence: number;
  evidenceCount: number;
  lastReinforcedAt: Date;
}

export interface TopOfMindRefreshEvidenceInput {
  meaningNodeId: string;
  inspirationId: string;
  reason: string;
  weight: number;
  createdAt: Date;
  inspirationText: string;
  sparkText: string | null;
}

export interface TopOfMindRefreshCandidate {
  node: TopOfMindRefreshNodeInput;
  contextType: ContextNodeType;
  evidence: TopOfMindRefreshEvidenceInput[];
  score: number;
  idempotencyKey: string;
  title: string;
  why: string;
  kind: WowKind;
  reflectionQuestion: string | null;
  reflectionGuide: string | null;
  wowScore: number;
}

export interface RefreshTopOfMindNotesResult {
  generated: number;
  existing: number;
  skipped: number;
  candidates: TopOfMindRefreshCandidate[];
  notes: Array<{
    id: string;
    contextNodeId: string;
    status: "created" | "existing";
  }>;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxChars: number): string {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 3).trimEnd()}...`;
}

function contextPriority(type: ContextNodeType): number {
  switch (type) {
    case "project":
      return 90;
    case "open_question":
      return 86;
    case "tension":
      return 82;
    case "hypothesis":
      return 74;
    case "value":
      return 68;
    case "theme":
      return 54;
    case "environment":
      return 44;
    case "person":
      return 40;
    case "aesthetic":
      return 36;
  }
}

function recencyScore(date: Date, now: Date): number {
  const ageDays = Math.max(0, now.getTime() - date.getTime()) / 86_400_000;
  if (ageDays <= 3) return 48;
  if (ageDays <= 14) return 32;
  if (ageDays <= 45) return 18;
  return 0;
}

function candidateScore(node: TopOfMindRefreshNodeInput, type: ContextNodeType, now: Date): number {
  return (
    node.evidenceCount * 130 +
    node.weight +
    node.confidence * 0.6 +
    contextPriority(type) +
    recencyScore(node.lastReinforcedAt, now)
  );
}

function noteKindForContextType(type: ContextNodeType): WowKind {
  switch (type) {
    case "tension":
      return "tension";
    case "open_question":
    case "hypothesis":
      return "outlier";
    case "project":
    case "value":
      return "bridge";
    default:
      return "recurrence";
  }
}

function reflectionQuestionForContextType(
  node: TopOfMindRefreshNodeInput,
  type: ContextNodeType,
): string | null {
  if (type === "open_question") {
    const label = normalizeWhitespace(node.label);
    return label.endsWith("?") ? label : `${label}?`;
  }
  if (type === "tension") {
    return "What correction would make this feel truer right now?";
  }
  if (type === "hypothesis") {
    return "What would you look for next to test this?";
  }
  return null;
}

function reflectionGuideForContextType(type: ContextNodeType): string | null {
  if (type !== "project") return null;
  return [
    "Start here",
    "Name the smallest next signal that would make this direction more concrete.",
  ].join("\n");
}

function evidencePreview(evidence: TopOfMindRefreshEvidenceInput | undefined): string {
  if (!evidence) return "";
  return truncateText(evidence.sparkText || evidence.inspirationText, 96);
}

function buildWhy(
  node: TopOfMindRefreshNodeInput,
  evidence: TopOfMindRefreshEvidenceInput[],
): string {
  const description = normalizeWhitespace(node.description);
  const sourcePreview = evidencePreview(evidence[0]);
  if (description && sourcePreview) {
    return `${description} Recent evidence: "${sourcePreview}"`;
  }
  if (description) return description;
  if (sourcePreview) {
    return `This keeps showing up in your signals. Recent evidence: "${sourcePreview}"`;
  }
  return `${node.evidenceCount} signal${node.evidenceCount === 1 ? "" : "s"} currently point at this context.`;
}

function buildIdempotencyKey(userId: string, nodeId: string): string {
  return `top_of_mind_context_node:v1:${userId}:${nodeId}`;
}

function groupEvidenceByNodeId(
  evidence: TopOfMindRefreshEvidenceInput[],
): Map<string, TopOfMindRefreshEvidenceInput[]> {
  const byNodeId = new Map<string, TopOfMindRefreshEvidenceInput[]>();
  for (const row of evidence) {
    const bucket = byNodeId.get(row.meaningNodeId) ?? [];
    bucket.push(row);
    byNodeId.set(row.meaningNodeId, bucket);
  }
  return byNodeId;
}

export function rankTopOfMindRefreshCandidates(input: {
  userId: string;
  nodes: TopOfMindRefreshNodeInput[];
  evidence: TopOfMindRefreshEvidenceInput[];
  existingIdempotencyKeys?: Set<string>;
  limit?: number;
  now?: Date;
}): TopOfMindRefreshCandidate[] {
  const now = input.now ?? new Date();
  const limit = Math.min(
    Math.max(input.limit ?? DEFAULT_REFRESH_LIMIT, 1),
    MAX_REFRESH_LIMIT,
  );
  const existing = input.existingIdempotencyKeys ?? new Set<string>();
  const evidenceByNodeId = groupEvidenceByNodeId(input.evidence);

  return input.nodes
    .map((node) => {
      const contextType = normalizeContextNodeType(node.type);
      const idempotencyKey = buildIdempotencyKey(input.userId, node.id);
      const evidence = (evidenceByNodeId.get(node.id) ?? [])
        .slice()
        .sort(
          (a, b) =>
            b.weight - a.weight ||
            b.createdAt.getTime() - a.createdAt.getTime(),
        )
        .slice(0, MAX_EVIDENCE_PER_NOTE);
      return {
        node,
        contextType,
        evidence,
        score: candidateScore(node, contextType, now),
        idempotencyKey,
        title: truncateText(node.label, MAX_TITLE_CHARS),
        why: buildWhy(node, evidence),
        kind: noteKindForContextType(contextType),
        reflectionQuestion: reflectionQuestionForContextType(node, contextType),
        reflectionGuide: reflectionGuideForContextType(contextType),
        wowScore: clampInt(
          35 + node.evidenceCount * 8 + node.weight * 0.08 + node.confidence * 0.25,
          1,
          100,
        ),
      };
    })
    .filter(
      (candidate) =>
        candidate.evidence.length > 0 &&
        candidate.node.evidenceCount > 0 &&
        !existing.has(candidate.idempotencyKey),
    )
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.node.evidenceCount - a.node.evidenceCount ||
        b.node.weight - a.node.weight,
    )
    .slice(0, limit);
}

async function loadExistingContextNoteKeys(
  db: WakaDb,
  input: { userId: string; nodeIds: string[] },
): Promise<Set<string>> {
  if (input.nodeIds.length === 0) return new Set();
  const candidateKeys = input.nodeIds.map((nodeId) =>
    buildIdempotencyKey(input.userId, nodeId),
  );
  const rows = await db
    .select({ idempotencyKey: wowMoments.idempotencyKey })
    .from(wowMoments)
    .where(
      and(
        eq(wowMoments.userId, input.userId),
        inArray(wowMoments.idempotencyKey, candidateKeys),
      ),
    );
  return new Set(rows.map((row) => row.idempotencyKey));
}

export async function refreshTopOfMindNotesFromContextGraph(
  db: WakaDb,
  input: { userId: string; limit?: number; now?: Date },
): Promise<RefreshTopOfMindNotesResult> {
  const nodes = await db
    .select({
      id: meaningNodes.id,
      type: meaningNodes.type,
      label: meaningNodes.label,
      description: meaningNodes.description,
      weight: meaningNodes.weight,
      confidence: meaningNodes.confidence,
      evidenceCount: meaningNodes.evidenceCount,
      lastReinforcedAt: meaningNodes.lastReinforcedAt,
    })
    .from(meaningNodes)
    .where(and(eq(meaningNodes.userId, input.userId), eq(meaningNodes.status, "active")))
    .orderBy(desc(meaningNodes.evidenceCount), desc(meaningNodes.weight))
    .limit(80);

  const nodeIds = nodes.map((node) => node.id);
  const [evidence, existingIdempotencyKeys] = await Promise.all([
    nodeIds.length === 0
      ? []
      : db
          .select({
            meaningNodeId: meaningEvidence.meaningNodeId,
            inspirationId: meaningEvidence.inspirationId,
            reason: meaningEvidence.reason,
            weight: meaningEvidence.weight,
            createdAt: meaningEvidence.createdAt,
            inspirationText: inspirations.text,
            sparkText: meaningPackets.sparkText,
          })
          .from(meaningEvidence)
          .innerJoin(
            inspirations,
            and(
              eq(inspirations.id, meaningEvidence.inspirationId),
              eq(inspirations.userId, meaningEvidence.userId),
            ),
          )
          .innerJoin(
            meaningPackets,
            and(
              eq(meaningPackets.id, meaningEvidence.packetId),
              eq(meaningPackets.userId, meaningEvidence.userId),
            ),
          )
          .where(
            and(
              eq(meaningEvidence.userId, input.userId),
              inArray(meaningEvidence.meaningNodeId, nodeIds),
            ),
          )
          .orderBy(desc(meaningEvidence.weight), desc(meaningEvidence.createdAt))
          .limit(240),
    loadExistingContextNoteKeys(db, { userId: input.userId, nodeIds }),
  ]);

  const candidates = rankTopOfMindRefreshCandidates({
    userId: input.userId,
    nodes,
    evidence,
    existingIdempotencyKeys,
    limit: input.limit,
    now: input.now,
  });

  const notes: RefreshTopOfMindNotesResult["notes"] = [];
  for (const candidate of candidates) {
    const result = await db.transaction(async (tx) => {
      const [createdMoment] = await tx
        .insert(wowMoments)
        .values({
          userId: input.userId,
          title: candidate.title,
          kind: candidate.kind,
          idempotencyKey: candidate.idempotencyKey,
          why: candidate.why,
          beliefStatement: `This may point to ${candidate.node.label}.`,
          reflectionQuestion: candidate.reflectionQuestion,
          reflectionGuide: candidate.reflectionGuide,
          wowScore: candidate.wowScore,
        } as typeof wowMoments.$inferInsert)
        .onConflictDoNothing({ target: wowMoments.idempotencyKey })
        .returning({ id: wowMoments.id });

      const moment =
        createdMoment ??
        (
          await tx
            .select({ id: wowMoments.id })
            .from(wowMoments)
            .where(eq(wowMoments.idempotencyKey, candidate.idempotencyKey))
            .limit(1)
        )[0];
      if (!moment) return null;

      if (createdMoment) {
        await tx
          .insert(wowMomentInspirations)
          .values(
            candidate.evidence.map((row, index) => ({
              userId: input.userId,
              wowMomentId: moment.id,
              inspirationId: row.inspirationId,
              role: "Evidence signal",
              reason: truncateText(row.reason || "This signal supports the note.", MAX_REASON_CHARS),
              sortOrder: index,
            })),
          )
          .onConflictDoNothing({
            target: [
              wowMomentInspirations.wowMomentId,
              wowMomentInspirations.inspirationId,
            ],
          });
      }

      return {
        id: moment.id,
        contextNodeId: candidate.node.id,
        status: createdMoment ? ("created" as const) : ("existing" as const),
      };
    });

    if (result) notes.push(result);
  }

  return {
    generated: notes.filter((note) => note.status === "created").length,
    existing: notes.filter((note) => note.status === "existing").length,
    skipped: Math.max(0, nodes.length - candidates.length),
    candidates,
    notes,
  };
}
