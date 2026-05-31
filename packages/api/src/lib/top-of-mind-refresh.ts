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
import {
  getDefaultModelProvider,
  type ModelProvider,
} from "./model-provider.js";
import type { AmbitionDimension } from "./top-of-mind-notes.js";

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
  ambientSignal: string;
  matchedEnvironment: string;
  antiEnvironment: string;
  evidenceRationale: string;
  why: string;
  ambitionDimension: AmbitionDimension;
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

function displayLabel(value: string): string {
  const label = normalizeWhitespace(value).replace(/[.。]+$/, "");
  if (!label) return "this";
  return `${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}

function ambitionDimensionForContextType(type: ContextNodeType): AmbitionDimension {
  switch (type) {
    case "environment":
      return "place";
    case "person":
      return "people";
    case "project":
      return "work";
    case "aesthetic":
      return "taste";
    case "tension":
      return "rejection";
    case "open_question":
    case "hypothesis":
      return "next_experiment";
    case "value":
      return "identity";
    case "theme":
    default:
      return "work";
  }
}

function buildInternalFrequency(
  node: TopOfMindRefreshNodeInput,
  type: ContextNodeType,
  evidence: TopOfMindRefreshEvidenceInput[],
): Pick<
  TopOfMindRefreshCandidate,
  "ambientSignal" | "matchedEnvironment" | "antiEnvironment" | "evidenceRationale"
> {
  const label = displayLabel(node.label);
  const dimension = ambitionDimensionForContextType(type);
  const evidenceCount = Math.max(node.evidenceCount, evidence.length);
  const patternScope =
    evidenceCount > 1
      ? `${evidenceCount} saved signals are clustering around this frequency`
      : "one saved signal is starting this frequency";
  const evidencePhrase =
    evidence.length > 1
      ? `${patternScope}, with the strongest ones pointing through "${evidencePreview(evidence[0])}" and "${evidencePreview(evidence[1])}".`
      : `${patternScope}, led by "${evidencePreview(evidence[0]) || label}".`;

  switch (dimension) {
    case "place":
      return {
        ambientSignal: "You may be looking for places that quietly tell you to be braver.",
        matchedEnvironment: `A city, studio, or room where ${label} feels publicly reinforced.`,
        antiEnvironment: "Settings that make ambition feel private, apologetic, or over-explained.",
        evidenceRationale: evidencePhrase,
      };
    case "people":
      return {
        ambientSignal: "You seem to want peers who make fast, public building feel normal.",
        matchedEnvironment: `People who make ${label} feel like a shared operating rhythm.`,
        antiEnvironment: "Circles where permission, polish, or social caution arrives before motion.",
        evidenceRationale: evidencePhrase,
      };
    case "work":
      return {
        ambientSignal: "You may need workrooms where making the thing is the default temperature.",
        matchedEnvironment: `A working culture where ${label} becomes visible through repeated making.`,
        antiEnvironment: "Work contexts that reward commentary while the real object stays abstract.",
        evidenceRationale: evidencePhrase,
      };
    case "taste":
      return {
        ambientSignal: "You seem drawn to standards that make sharper taste feel ordinary.",
        matchedEnvironment: `Surroundings where ${label} is treated as a standard, not decoration.`,
        antiEnvironment: "Rooms that flatten taste into trend, convenience, or generic approval.",
        evidenceRationale: evidencePhrase,
      };
    case "tension":
    case "rejection":
      return {
        ambientSignal: "You may be trying to leave rooms that reward consensus over aliveness.",
        matchedEnvironment: `A surrounding culture that lets the tension around ${label} stay visible long enough to choose from it.`,
        antiEnvironment: "Rooms that smooth over the live part so everyone can keep performing agreement.",
        evidenceRationale: evidencePhrase,
      };
    case "identity":
      return {
        ambientSignal: "You may be practicing a self-image that needs braver surroundings.",
        matchedEnvironment: `An environment where ${label} is mirrored back as normal behavior.`,
        antiEnvironment: "Contexts that make the emerging version of you feel like a private exception.",
        evidenceRationale: evidencePhrase,
      };
    case "next_experiment":
      return {
        ambientSignal: "You may need a small real-world test, not another private theory.",
        matchedEnvironment: `A practical setting where ${label} can be tested in public conditions.`,
        antiEnvironment: "Analysis loops that keep the question safe, abstract, and uncostly.",
        evidenceRationale: evidencePhrase,
      };
  }
}

function buildWhy(
  node: TopOfMindRefreshNodeInput,
  evidence: TopOfMindRefreshEvidenceInput[],
  dimension: AmbitionDimension,
  frequency: Pick<
    TopOfMindRefreshCandidate,
    "ambientSignal" | "matchedEnvironment" | "antiEnvironment" | "evidenceRationale"
  >,
): string {
  const description = normalizeWhitespace(node.description);
  const evidencePreviews = evidence
    .map((row) => evidencePreview(row))
    .filter((preview) => preview.length > 0)
    .slice(0, 5);
  const ambitionReason = `This may matter for ambition because it points at a ${dimension.replace(/_/g, " ")} frequency in the surroundings you seem to need.`;
  const descriptionText = description ? ` ${description}` : "";
  const signalText =
    evidencePreviews.length > 0
      ? ` Supporting signals: ${evidencePreviews.map((preview) => `"${preview}"`).join("; ")}.`
      : ` ${node.evidenceCount} signal${node.evidenceCount === 1 ? "" : "s"} currently support this note.`;
  return [
    `Ambient signal: ${frequency.ambientSignal}`,
    `Matched environment: ${frequency.matchedEnvironment}`,
    `Anti-environment: ${frequency.antiEnvironment}`,
    `Evidence rationale: ${frequency.evidenceRationale}`,
    `${ambitionReason}${descriptionText}${signalText}`,
  ].join(" ");
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
      const ambitionDimension = ambitionDimensionForContextType(contextType);
      const frequency = buildInternalFrequency(node, contextType, evidence);
      return {
        node,
        contextType,
        evidence,
        score: candidateScore(node, contextType, now),
        idempotencyKey,
        title: truncateText(frequency.ambientSignal, MAX_TITLE_CHARS),
        ...frequency,
        why: buildWhy(node, evidence, ambitionDimension, frequency),
        ambitionDimension,
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
  input: { userId: string; limit?: number; now?: Date; modelProvider?: ModelProvider },
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

  const modelProvider = input.modelProvider ?? (await getDefaultModelProvider());
  const candidates = await modelProvider.generateTopOfMindNotes({
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
          beliefStatement: candidate.title,
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
