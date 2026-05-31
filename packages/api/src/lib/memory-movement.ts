import { normalizeContextNodeType, type ContextNodeType } from "./context-node-types.js";

export const memoryStateValues = [
  "emerging",
  "active",
  "fading",
  "dormant",
  "reactivated",
  "contradicted",
  "needs_testing",
] as const;

export type MemoryState = (typeof memoryStateValues)[number];

export const signalMemoryMovementValues = [
  "reinforces_existing",
  "creates_emerging",
  "reactivates_dormant",
  "contradicts_active",
  "decays_by_omission",
] as const;

export type SignalMemoryMovement = (typeof signalMemoryMovementValues)[number];

export interface MemoryPatternNodeInput {
  id: string;
  type: string;
  status?: string;
  weight: number;
  confidence: number;
  evidenceCount: number;
  firstSeenAt: Date;
  lastReinforcedAt: Date;
}

export interface MemoryPatternEvidenceInput {
  meaningNodeId: string;
  inspirationId: string;
  createdAt: Date;
  weight?: number;
}

export interface MemoryPattern {
  contextNodeId: string;
  contextType: ContextNodeType;
  state: MemoryState;
  firstSeenAt: Date;
  lastSeenAt: Date;
  reinforcementCount: number;
  recentReinforcementCount: number;
  currentWeight: number;
  confidence: number;
  decay: number;
  supportingSignalIds: string[];
  movementScore: number;
}

export interface SignalMemoryMovementEvent {
  contextNodeId: string;
  movement: SignalMemoryMovement;
  state: MemoryState;
  supportingSignalIds: string[];
  reason: string;
}

const RECENT_REINFORCEMENT_DAYS = 30;
const FADING_AFTER_DAYS = 45;
const DORMANT_AFTER_DAYS = 120;
const REACTIVATION_GAP_DAYS = 60;

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function daysBetween(later: Date, earlier: Date): number {
  return Math.max(0, later.getTime() - earlier.getTime()) / 86_400_000;
}

function uniqueSignalIds(evidence: MemoryPatternEvidenceInput[]): string[] {
  return [...new Set(evidence.map((row) => row.inspirationId))];
}

function memoryStateScore(state: MemoryState): number {
  switch (state) {
    case "reactivated":
      return 600;
    case "contradicted":
      return 520;
    case "needs_testing":
      return 320;
    case "emerging":
      return 150;
    case "active":
      return 115;
    case "fading":
      return 95;
    case "dormant":
      return 35;
  }
}

function deriveState(input: {
  node: MemoryPatternNodeInput;
  evidence: MemoryPatternEvidenceInput[];
  now: Date;
  contradicted?: boolean;
  needsTesting?: boolean;
}): MemoryState {
  if (input.contradicted || input.node.status === "contradicted") return "contradicted";

  const contextType = normalizeContextNodeType(input.node.type);
  const sortedEvidence = input.evidence
    .slice()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const latest = sortedEvidence[0]?.createdAt ?? input.node.lastReinforcedAt;
  const previous = sortedEvidence[1]?.createdAt;
  const ageDays = daysBetween(input.now, latest);

  if (
    latest &&
    previous &&
    ageDays <= 14 &&
    daysBetween(latest, previous) >= REACTIVATION_GAP_DAYS
  ) {
    return "reactivated";
  }

  if (
    input.needsTesting ||
    ((contextType === "hypothesis" || contextType === "open_question") &&
      input.node.confidence < 70)
  ) {
    return "needs_testing";
  }

  if (ageDays >= DORMANT_AFTER_DAYS) return "dormant";
  if (ageDays >= FADING_AFTER_DAYS) return "fading";

  if (
    input.node.evidenceCount <= 1 &&
    daysBetween(input.now, input.node.firstSeenAt) <= RECENT_REINFORCEMENT_DAYS
  ) {
    return "emerging";
  }

  return "active";
}

export function deriveMemoryPattern(input: {
  node: MemoryPatternNodeInput;
  evidence: MemoryPatternEvidenceInput[];
  now?: Date;
  contradicted?: boolean;
  needsTesting?: boolean;
}): MemoryPattern {
  const now = input.now ?? new Date();
  const sortedEvidence = input.evidence
    .slice()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const latestEvidenceAt = sortedEvidence[0]?.createdAt;
  const lastSeenAt =
    latestEvidenceAt && latestEvidenceAt > input.node.lastReinforcedAt
      ? latestEvidenceAt
      : input.node.lastReinforcedAt;
  const ageDays = daysBetween(now, lastSeenAt);
  const recentReinforcementCount = input.evidence.filter(
    (row) => daysBetween(now, row.createdAt) <= RECENT_REINFORCEMENT_DAYS,
  ).length;
  const decay = clampInt(Math.max(0, ageDays - FADING_AFTER_DAYS) * 1.5, 0, 220);
  const state = deriveState({
    node: input.node,
    evidence: input.evidence,
    now,
    contradicted: input.contradicted,
    needsTesting: input.needsTesting,
  });
  const currentWeight = clampInt(
    input.node.weight + recentReinforcementCount * 12 - decay,
    0,
    1000,
  );

  return {
    contextNodeId: input.node.id,
    contextType: normalizeContextNodeType(input.node.type),
    state,
    firstSeenAt: input.node.firstSeenAt,
    lastSeenAt,
    reinforcementCount: Math.max(input.node.evidenceCount, input.evidence.length),
    recentReinforcementCount,
    currentWeight,
    confidence: input.node.confidence,
    decay,
    supportingSignalIds: uniqueSignalIds(input.evidence),
    movementScore:
      memoryStateScore(state) +
      recentReinforcementCount * 28 +
      Math.min(160, currentWeight * 0.18) +
      input.node.confidence * 0.35 -
      decay * 0.4,
  };
}

export function evaluateSignalMemoryMovement(input: {
  now?: Date;
  patterns: MemoryPattern[];
  signalId: string;
  contextNodeIds: string[];
  contradictedContextNodeIds?: string[];
}): SignalMemoryMovementEvent[] {
  const patternById = new Map(input.patterns.map((pattern) => [pattern.contextNodeId, pattern]));
  const signalNodeIds = new Set(input.contextNodeIds);
  const contradictedNodeIds = new Set(input.contradictedContextNodeIds ?? []);
  const events: SignalMemoryMovementEvent[] = [];

  for (const nodeId of contradictedNodeIds) {
    const pattern = patternById.get(nodeId);
    if (!pattern) continue;
    events.push({
      contextNodeId: nodeId,
      movement: "contradicts_active",
      state: "contradicted",
      supportingSignalIds: [...pattern.supportingSignalIds, input.signalId],
      reason: "A new signal presses against an active context pattern, so the tension stays live instead of being averaged away.",
    });
  }

  for (const nodeId of signalNodeIds) {
    if (contradictedNodeIds.has(nodeId)) continue;
    const pattern = patternById.get(nodeId);
    if (!pattern) {
      events.push({
        contextNodeId: nodeId,
        movement: "creates_emerging",
        state: "emerging",
        supportingSignalIds: [input.signalId],
        reason: "A new signal starts an emerging memory pattern.",
      });
      continue;
    }

    const movement =
      pattern.state === "dormant" || pattern.state === "fading"
        ? "reactivates_dormant"
        : "reinforces_existing";
    events.push({
      contextNodeId: nodeId,
      movement,
      state: movement === "reactivates_dormant" ? "reactivated" : pattern.state,
      supportingSignalIds: [...new Set([...pattern.supportingSignalIds, input.signalId])],
      reason:
        movement === "reactivates_dormant"
          ? "A new signal brings back an older pattern after enough quiet time to make the return meaningful."
          : "A new signal reinforces a pattern that is already part of the user's current context.",
    });
  }

  for (const pattern of input.patterns) {
    if (
      signalNodeIds.has(pattern.contextNodeId) ||
      contradictedNodeIds.has(pattern.contextNodeId) ||
      pattern.state !== "fading"
    ) {
      continue;
    }
    events.push({
      contextNodeId: pattern.contextNodeId,
      movement: "decays_by_omission",
      state: "fading",
      supportingSignalIds: pattern.supportingSignalIds,
      reason: "Recent signals did not return to this older pattern, so its dominance decays without deleting the history.",
    });
  }

  return events;
}
