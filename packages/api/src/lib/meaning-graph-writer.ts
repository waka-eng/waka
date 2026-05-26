/**
 * Persisted meaning graph writer.
 *
 * This is the convergence layer for the meaning system. It does not create a
 * second product algorithm; it promotes compact packets, WAKA scores,
 * retrieval candidates, and safe relationship judgments into one durable graph:
 *
 *   inspiration/spark/packet -> evidence
 *   meaning node             -> promoted interpretation
 *   meaning edge             -> relationship between interpretations
 */

import { and, eq, sql } from "drizzle-orm";

import {
  meaningEdges,
  meaningEvidence,
  meaningNodes,
  meaningPackets,
  type MeaningEdge,
  type MeaningEvidence,
  type MeaningNode,
} from "../db/index.js";
import { getDb } from "./db.js";
import type { WakaDb } from "./inspiration-embeddings.js";
import {
  judgeMeaningRelationshipsForInspiration,
  type JudgeMeaningRelationshipsForInspirationParams,
  type JudgeMeaningRelationshipsForInspirationResult,
  type MeaningRelationshipKind,
  type MeaningRelationshipProposal,
} from "./meaning-relationship-judge.js";

export const meaningNodeTypeValues = [
  "claim",
  "value",
  "question",
  "desire",
  "tension",
  "life_direction",
  "person_archetype",
  "environment",
] as const;

export type MeaningNodeType = (typeof meaningNodeTypeValues)[number];

export const meaningEdgeKindValues = [
  "supports",
  "challenges",
  "points_to",
  "asks_for",
  "reactivates",
] as const;

export type MeaningEdgeKind = (typeof meaningEdgeKindValues)[number];

export interface PersistMeaningGraphForInspirationParams
  extends JudgeMeaningRelationshipsForInspirationParams {}

export interface PersistMeaningGraphForInspirationResult {
  judgmentResult: JudgeMeaningRelationshipsForInspirationResult;
  nodes: MeaningNode[];
  evidence: MeaningEvidence[];
  edges: MeaningEdge[];
}

type PacketRow = NonNullable<JudgeMeaningRelationshipsForInspirationResult["candidateSet"]["trigger"]>;

interface MeaningSignal {
  inspirationId: string;
  packetId: string;
  type: MeaningNodeType;
  label: string;
  description: string;
  reason: string;
  weight: number;
  confidence: number;
}

interface PendingMeaningEdge {
  source: MeaningSignal;
  target: MeaningSignal;
  kind: MeaningEdgeKind;
  weight: number;
  confidence: number;
  evidenceInspirationId: string;
}

type CandidateRow = JudgeMeaningRelationshipsForInspirationResult["candidateSet"]["candidates"][number];

const MAX_DETERMINISTIC_EDGES = 4;
const MIN_DETERMINISTIC_EDGE_SCORE = 0.2;

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeLabel(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/[.!?。！？]+$/u, "")
    .trim()
    .toLowerCase();
}

function shortText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  const clipped = normalized.slice(0, maxLength + 1);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${(lastSpace > 40 ? clipped.slice(0, lastSpace) : normalized.slice(0, maxLength)).trim()}...`;
}

function includesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function packetText(row: PacketRow): string {
  return [
    row.packet.sparkText,
    row.packet.packetText,
    row.inspiration.cluster ?? "",
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

function addSignal(signals: MeaningSignal[], signal: MeaningSignal): void {
  const label = normalizeLabel(signal.label);
  if (!label) return;
  if (signals.some((item) => item.type === signal.type && item.label === label)) return;
  signals.push({ ...signal, label });
}

function baseWeight(row: PacketRow, relationshipBoost = 0): number {
  const sparkBoost = row.packet.sparkText.trim() ? 18 : 0;
  const scoreBoost = Math.max(row.inspiration.importanceScore, row.inspiration.wowScore) * 0.35;
  return clampInt(34 + sparkBoost + scoreBoost + relationshipBoost, 20, 100);
}

function baseConfidence(row: PacketRow, relationshipConfidence = 0): number {
  const sparkBoost = row.packet.sparkText.trim() ? 10 : 0;
  return clampInt(Math.max(58 + sparkBoost, relationshipConfidence), 45, 95);
}

function buildMeaningSignals(
  row: PacketRow,
  options: { relationshipKind?: MeaningRelationshipKind; relationshipConfidence?: number } = {},
): MeaningSignal[] {
  const text = packetText(row);
  const weight = baseWeight(row, options.relationshipKind ? 14 : 0);
  const confidence = baseConfidence(row, options.relationshipConfidence ?? 0);
  const signals: MeaningSignal[] = [];
  const common = {
    inspirationId: row.inspiration.id,
    packetId: row.packet.id,
    weight,
    confidence,
  };
  const sparkSource = row.packet.sparkText.trim();
  const shouldKeepSpecificClaim =
    sparkSource.length > 0 ||
    row.inspiration.wowScore >= 82 ||
    row.inspiration.importanceScore >= 82;

  if (shouldKeepSpecificClaim) {
    const source = sparkSource || row.packet.artifactExcerpt || row.packet.packetText;
    addSignal(signals, {
      ...common,
      type: "claim",
      label: shortText(source, 92),
      description:
        "A specific saved claim or spark preserved so the graph keeps texture instead of only broad themes.",
      reason: sparkSource
        ? "The user-designated spark is preserved as first-class meaning evidence."
        : "Strong WAKA score promoted this compact claim alongside broader meaning nodes.",
      weight: clampInt(weight + (sparkSource ? 6 : -8), 20, 100),
      confidence: clampInt(confidence + (sparkSource ? 4 : -8), 45, 95),
    });
  }

  if (includesAny(text, ["ai", "agent", "prototype", "build", "builder", "building", "tools", "만들"])) {
    addSignal(signals, {
      ...common,
      type: "question",
      label: "what is worth building when building itself gets cheap?",
      description: "The save points past raw speed toward judgment and direction.",
      reason: "WAKA building/AI signals plus packet evidence promoted this as a live question.",
    });
    addSignal(signals, {
      ...common,
      type: "value",
      label: "human judgment over pure speed",
      description: "Execution speed matters less than choosing well.",
      reason: "Existing WOW/importance signals frame speed as insufficient without human judgment.",
      weight: clampInt(weight - 6, 20, 100),
      confidence: clampInt(confidence - 4, 45, 95),
    });
  }

  if (includesAny(text, ["who", "people", "community", "builder", "founder", "lonely", "alone", "together", "hacker house", "누구", "사람", "외로"])) {
    addSignal(signals, {
      ...common,
      type: "desire",
      label: "to build around people who make ambition feel less lonely",
      description: "The save treats people as part of the work, not background context.",
      reason: "People/community signals were retrieved as meaning evidence, not just topic overlap.",
    });
    addSignal(signals, {
      ...common,
      type: "person_archetype",
      label: "builders who are intense but still human",
      description: "The desired people hold ambition without flattening the human reason for it.",
      reason: "Builder/founder language appears with emotional cost and belonging signals.",
      weight: clampInt(weight - 10, 20, 100),
      confidence: clampInt(confidence - 8, 45, 95),
    });
  }

  if (includesAny(text, ["room", "space", "place", "city", "cities", "environment", "community", "hacker house", "where", "어디", "공간", "환경"])) {
    addSignal(signals, {
      ...common,
      type: "environment",
      label: "rooms where people can be honest before they are impressive",
      description: "The save treats environment as something that shapes ambition and self-understanding.",
      reason: "Place/community signals connect the save to environment design.",
    });
  }

  if (includesAny(text, ["why", "meaning", "matter", "death", "life", "last day", "가치", "왜", "삶", "죽"])) {
    addSignal(signals, {
      ...common,
      type: "question",
      label: "what kind of life would make this work worth it?",
      description: "The save asks whether work is connected to a life that feels worth living.",
      reason: "Life/why signals were strong enough to promote an existential question.",
    });
  }

  if (includesAny(text, ["what to build", "who to build", "무엇을 만들어야", "누구와", "왜 만들어야"])) {
    addSignal(signals, {
      ...common,
      type: "life_direction",
      label: "choose work, people, and environments that keep the why alive",
      description: "The save links work, people, place, and meaning into a direction of life.",
      reason: "The packet directly connects what to build, who to build with, and why it matters.",
      weight: clampInt(weight + 10, 20, 100),
      confidence: clampInt(confidence + 6, 45, 95),
    });
  }

  if (includesAny(text, ["faster", "fast", "accelerat", "lonely", "security", "blocking ai", "productivity", "빨라", "외로"])) {
    addSignal(signals, {
      ...common,
      type: "tension",
      label: "building gets faster while people feel less grounded",
      description: "The save holds acceleration and disorientation in the same frame.",
      reason: "WAKA tension/surprise signals are represented as a durable tension node.",
    });
  }

  if (signals.length === 0 && (row.packet.sparkText.trim() || row.inspiration.wowScore >= 40 || row.inspiration.importanceScore >= 40)) {
    const source = row.packet.sparkText.trim() || row.packet.artifactExcerpt || row.packet.packetText;
    addSignal(signals, {
      ...common,
      type: "question",
      label: `why this keeps moving me: ${shortText(source, 72)}`,
      description: "The save has enough signal to preserve as an under-specified meaning question.",
      reason: "Fallback promotion from spark or strong WAKA scores without a clearer ontology match.",
      weight: clampInt(weight - 8, 20, 100),
      confidence: clampInt(confidence - 14, 45, 95),
    });
  }

  return signals.slice(0, 7);
}

function proposalToEdgeKind(kind: MeaningRelationshipKind): MeaningEdgeKind {
  switch (kind) {
    case "presses_against":
      return "challenges";
    case "returns_to":
      return "reactivates";
    case "clarifies":
    case "extends":
    case "reframes":
      return "points_to";
    case "resonates_with":
    default:
      return "supports";
  }
}

function chooseEdgeSource(signals: MeaningSignal[]): MeaningSignal | null {
  return (
    signals.find((signal) => signal.type === "life_direction") ??
    signals.find((signal) => signal.type === "desire") ??
    signals.find((signal) => signal.type === "question") ??
    signals.find((signal) => signal.type === "claim") ??
    signals[0] ??
    null
  );
}

function durableSignalKey(signal: MeaningSignal): string {
  return `${signal.type}:${signal.label}`;
}

function chooseDistinctEdgePair(
  sourceSignals: MeaningSignal[],
  targetSignals: MeaningSignal[],
): { source: MeaningSignal; target: MeaningSignal } | null {
  const sourcePreference = [
    "life_direction",
    "desire",
    "question",
    "claim",
    "value",
    "tension",
    "environment",
    "person_archetype",
  ];
  const targetPreference = [
    "life_direction",
    "environment",
    "desire",
    "question",
    "claim",
    "value",
    "tension",
    "person_archetype",
  ];
  const orderedSources = [
    ...sourcePreference.flatMap((type) =>
      sourceSignals.filter((signal) => signal.type === type),
    ),
    ...sourceSignals,
  ];
  const orderedTargets = [
    ...targetPreference.flatMap((type) =>
      targetSignals.filter((signal) => signal.type === type),
    ),
    ...targetSignals,
  ];

  for (const source of orderedSources) {
    for (const target of orderedTargets) {
      if (durableSignalKey(source) !== durableSignalKey(target)) {
        return { source, target };
      }
    }
  }
  return null;
}

function deterministicEdgeKind(triggerRow: PacketRow, candidate: CandidateRow): MeaningEdgeKind {
  if (
    triggerRow.inspiration.cluster &&
    candidate.inspiration.cluster &&
    triggerRow.inspiration.cluster === candidate.inspiration.cluster
  ) {
    return "points_to";
  }
  return "supports";
}

function deterministicConfidence(score: number): number {
  return clampInt(42 + score * 36, 42, 78);
}

function deterministicEdgesFromCandidates(
  judgmentResult: JudgeMeaningRelationshipsForInspirationResult,
  excludedCandidateIds: Set<string> = new Set(),
): { signals: MeaningSignal[]; edges: PendingMeaningEdge[] } {
  const triggerRow = judgmentResult.candidateSet.trigger;
  if (!triggerRow) return { signals: [], edges: [] };

  const triggerSignals = buildMeaningSignals(triggerRow);
  if (!chooseEdgeSource(triggerSignals)) return { signals: triggerSignals, edges: [] };

  const signals: MeaningSignal[] = [...triggerSignals];
  const edges: PendingMeaningEdge[] = [];
  const sortedCandidates = [...judgmentResult.candidateSet.candidates]
    .filter(
      (candidate) =>
        !excludedCandidateIds.has(candidate.inspiration.id) &&
        candidate.scores.runtimeMeaningCandidateScore >= MIN_DETERMINISTIC_EDGE_SCORE,
    )
    .sort(
      (a, b) =>
        b.scores.runtimeMeaningCandidateScore -
        a.scores.runtimeMeaningCandidateScore,
    )
    .slice(0, MAX_DETERMINISTIC_EDGES);

  for (const candidate of sortedCandidates) {
    const confidence = deterministicConfidence(
      candidate.scores.runtimeMeaningCandidateScore,
    );
    const candidateRow = {
      inspiration: candidate.inspiration,
      packet: candidate.packet,
    };
    const targetSignals = buildMeaningSignals(candidateRow, {
      relationshipKind: "resonates_with",
      relationshipConfidence: confidence,
    });
    const pair = chooseDistinctEdgePair(triggerSignals, targetSignals);
    if (!pair) continue;
    signals.push(...targetSignals);
    edges.push({
      source: pair.source,
      target: pair.target,
      kind: deterministicEdgeKind(triggerRow, candidate),
      weight: confidence,
      confidence,
      evidenceInspirationId: triggerRow.inspiration.id,
    });
  }

  return { signals, edges };
}

function appendUnique(values: string[], value: string): string[] {
  return values.includes(value) ? values : [...values, value];
}

async function upsertMeaningNode(input: {
  db: WakaDb;
  userId: string;
  signal: MeaningSignal;
}): Promise<MeaningNode> {
  const now = new Date();
  const [node] = await input.db
    .insert(meaningNodes)
    .values({
      userId: input.userId,
      type: input.signal.type,
      label: input.signal.label,
      description: input.signal.description,
      status: "active",
      source: "meaning_graph_writer",
      weight: input.signal.weight,
      confidence: input.signal.confidence,
      evidenceCount: 0,
      firstSeenAt: now,
      lastReinforcedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [meaningNodes.userId, meaningNodes.type, meaningNodes.label],
      set: {
        description: input.signal.description,
        status: "active",
        lastReinforcedAt: now,
        updatedAt: now,
      },
    })
    .returning();

  return node!;
}

async function upsertMeaningEvidence(input: {
  db: WakaDb;
  userId: string;
  node: MeaningNode;
  signal: MeaningSignal;
}): Promise<MeaningEvidence | null> {
  const [evidence] = await input.db
    .insert(meaningEvidence)
    .values({
      userId: input.userId,
      meaningNodeId: input.node.id,
      inspirationId: input.signal.inspirationId,
      packetId: input.signal.packetId,
      reason: input.signal.reason,
      weight: input.signal.weight,
      confidence: input.signal.confidence,
      source: "meaning_graph_writer",
    })
    .onConflictDoNothing({
      target: [meaningEvidence.meaningNodeId, meaningEvidence.inspirationId],
    })
    .returning();

  const [stats] = await input.db
    .select({
      evidenceCount: sql<number>`count(*)::int`,
      weight: sql<number>`coalesce(sum(${meaningEvidence.weight}), 0)::int`,
      confidence: sql<number>`coalesce(max(${meaningEvidence.confidence}), 0)::int`,
    })
    .from(meaningEvidence)
    .where(eq(meaningEvidence.meaningNodeId, input.node.id));

  await input.db
    .update(meaningNodes)
    .set({
      weight: Math.min(1000, stats?.weight ?? input.signal.weight),
      confidence: stats?.confidence ?? input.signal.confidence,
      evidenceCount: stats?.evidenceCount ?? 1,
      lastReinforcedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(meaningNodes.id, input.node.id));

  return evidence ?? null;
}

async function upsertMeaningEdge(input: {
  db: WakaDb;
  userId: string;
  edge: PendingMeaningEdge;
  sourceNode: MeaningNode;
  targetNode: MeaningNode;
}): Promise<MeaningEdge> {
  const now = new Date();
  const [existing] = await input.db
    .select()
    .from(meaningEdges)
    .where(
      and(
        eq(meaningEdges.userId, input.userId),
        eq(meaningEdges.sourceNodeId, input.sourceNode.id),
        eq(meaningEdges.targetNodeId, input.targetNode.id),
      ),
    )
    .limit(1);

  if (existing) {
    const evidenceInspirationIds = appendUnique(
      existing.evidenceInspirationIds,
      input.edge.evidenceInspirationId,
    );
    const [edge] = await input.db
      .update(meaningEdges)
      .set({
        status: "active",
        kind:
          edgeKindPriority(input.edge.kind) > edgeKindPriority(existing.kind as MeaningEdgeKind)
            ? input.edge.kind
            : existing.kind,
        weight: Math.min(1000, existing.weight + input.edge.weight),
        confidence: Math.max(existing.confidence, input.edge.confidence),
        evidenceCount: evidenceInspirationIds.length,
        evidenceInspirationIds,
        lastReinforcedAt: now,
        updatedAt: now,
      })
      .where(eq(meaningEdges.id, existing.id))
      .returning();
    return edge!;
  }

  const [edge] = await input.db
    .insert(meaningEdges)
    .values({
      userId: input.userId,
      sourceNodeId: input.sourceNode.id,
      targetNodeId: input.targetNode.id,
      kind: input.edge.kind,
      weight: input.edge.weight,
      confidence: input.edge.confidence,
      evidenceCount: 1,
      evidenceInspirationIds: [input.edge.evidenceInspirationId],
      status: "active",
      source: "meaning_graph_writer",
      lastReinforcedAt: now,
      updatedAt: now,
    })
    .returning();

  return edge!;
}

function packetRowsByInspirationId(
  judgmentResult: JudgeMeaningRelationshipsForInspirationResult,
): Map<string, PacketRow> {
  const rows = new Map<string, PacketRow>();
  if (judgmentResult.candidateSet.trigger) {
    rows.set(
      judgmentResult.candidateSet.trigger.inspiration.id,
      judgmentResult.candidateSet.trigger,
    );
  }
  for (const candidate of judgmentResult.candidateSet.candidates) {
    rows.set(candidate.inspiration.id, {
      inspiration: candidate.inspiration,
      packet: candidate.packet,
    });
  }
  return rows;
}

function signalsForProposal(
  proposal: MeaningRelationshipProposal,
  rowsByInspirationId: Map<string, PacketRow>,
): { signals: MeaningSignal[]; edge: PendingMeaningEdge | null } {
  const fromRow = rowsByInspirationId.get(proposal.fromInspirationId);
  const toRow = rowsByInspirationId.get(proposal.toInspirationId);
  if (!fromRow || !toRow) return { signals: [], edge: null };

  const fromSignals = buildMeaningSignals(fromRow, {
    relationshipKind: proposal.kind,
    relationshipConfidence: proposal.confidence,
  });
  const toSignals = buildMeaningSignals(toRow, {
    relationshipKind: proposal.kind,
    relationshipConfidence: proposal.confidence,
  });
  const pair = chooseDistinctEdgePair(fromSignals, toSignals);

  return {
    signals: [...fromSignals, ...toSignals],
    edge:
      pair
        ? {
            source: pair.source,
            target: pair.target,
            kind: proposalToEdgeKind(proposal.kind),
            weight: proposal.confidence,
            confidence: proposal.confidence,
            evidenceInspirationId: proposal.fromInspirationId,
          }
      : null,
  };
}

function signalKey(signal: MeaningSignal): string {
  return `${signal.type}:${signal.label}:${signal.inspirationId}`;
}

function pendingEdgeKey(edge: PendingMeaningEdge): string {
  return `${durableSignalKey(edge.source)}:${durableSignalKey(edge.target)}`;
}

function edgeKindPriority(kind: MeaningEdgeKind): number {
  switch (kind) {
    case "challenges":
    case "points_to":
    case "asks_for":
    case "reactivates":
      return 2;
    case "supports":
    default:
      return 1;
  }
}

function addPendingEdge(edgesByKey: Map<string, PendingMeaningEdge>, edge: PendingMeaningEdge): void {
  const key = pendingEdgeKey(edge);
  const existing = edgesByKey.get(key);
  if (
    !existing ||
    edgeKindPriority(edge.kind) > edgeKindPriority(existing.kind) ||
    edge.confidence > existing.confidence ||
    edge.weight > existing.weight
  ) {
    edgesByKey.set(key, edge);
  }
}

export async function persistMeaningGraphForInspiration(
  params: PersistMeaningGraphForInspirationParams,
): Promise<PersistMeaningGraphForInspirationResult> {
  const db = params.db ?? getDb();
  const judgmentResult = await judgeMeaningRelationshipsForInspiration({
    ...params,
    db,
  });

  if (!judgmentResult.candidateSet.trigger) {
    return { judgmentResult, nodes: [], evidence: [], edges: [] };
  }

  const rowsByInspirationId = packetRowsByInspirationId(judgmentResult);
  const signalsByKey = new Map<string, MeaningSignal>();
  const pendingEdgesByKey = new Map<string, PendingMeaningEdge>();
  const proposalTargetIds = new Set(
    judgmentResult.proposals.map((proposal) => proposal.toInspirationId),
  );

  const deterministic = deterministicEdgesFromCandidates(judgmentResult, proposalTargetIds);
  for (const signal of deterministic.signals) {
    signalsByKey.set(signalKey(signal), signal);
  }
  for (const edge of deterministic.edges) {
    addPendingEdge(pendingEdgesByKey, edge);
  }

  for (const proposal of judgmentResult.proposals) {
    const result = signalsForProposal(proposal, rowsByInspirationId);
    for (const signal of result.signals) {
      signalsByKey.set(signalKey(signal), signal);
    }
    if (result.edge) addPendingEdge(pendingEdgesByKey, result.edge);
  }

  const nodesBySignalKey = new Map<string, MeaningNode>();
  const evidence: MeaningEvidence[] = [];
  for (const [key, signal] of signalsByKey) {
    const node = await upsertMeaningNode({ db, userId: params.userId, signal });
    nodesBySignalKey.set(key, node);
    const evidenceRow = await upsertMeaningEvidence({
      db,
      userId: params.userId,
      node,
      signal,
    });
    if (evidenceRow) evidence.push(evidenceRow);
  }

  const nodes = [...new Map([...nodesBySignalKey.values()].map((node) => [node.id, node])).values()];
  const edges: MeaningEdge[] = [];
  for (const pendingEdge of pendingEdgesByKey.values()) {
    const sourceNode = nodesBySignalKey.get(signalKey(pendingEdge.source));
    const targetNode = nodesBySignalKey.get(signalKey(pendingEdge.target));
    if (!sourceNode || !targetNode || sourceNode.id === targetNode.id) continue;
    edges.push(
      await upsertMeaningEdge({
        db,
        userId: params.userId,
        edge: pendingEdge,
        sourceNode,
        targetNode,
      }),
    );
  }

  return { judgmentResult, nodes, evidence, edges };
}
