import type { FeedbackEmotion, FeedbackValue } from "../db/index.js";
import type {
  TopOfMindRefreshCandidate,
  TopOfMindRefreshEvidenceInput,
} from "./top-of-mind-refresh.js";

export const ambitionSynthesisTriggerValues = [
  "qualified_cluster",
  "memory_movement",
  "explicit_deep_dive",
  "weekly_refresh",
  "strong_feedback",
  "correction",
  "contradiction",
] as const;

export type AmbitionSynthesisTrigger =
  (typeof ambitionSynthesisTriggerValues)[number];

export interface AmbitionSynthesisFeedbackInput {
  targetType: "signal" | "context_node" | "top_of_mind_note" | "hypothesis";
  targetId: string;
  value: FeedbackValue;
  emotionLabel?: FeedbackEmotion | null;
  correctionText?: string | null;
  createdAt: Date;
}

export interface AmbitionSynthesisSavedSignalInput {
  id: string;
  excerpt: string;
  highlight: string | null;
  emotionalPullMetadata: string[];
  microReflection: string | null;
  evidenceReason: string;
  capturedAt: Date;
}

export interface AmbitionSynthesisInput {
  userId: string;
  trigger: AmbitionSynthesisTrigger;
  synthesisKey: string;
  contextNode: {
    id: string;
    type: string;
    label: string;
    description: string;
    confidence: number;
  };
  memoryState: TopOfMindRefreshCandidate["memoryPattern"]["state"];
  memoryMovementScore: number;
  selectedSignals: AmbitionSynthesisSavedSignalInput[];
  priorFeedback: AmbitionSynthesisFeedbackInput[];
  rewrites: string[];
  rejectedOrCompetingInterpretations: string[];
  tokenBudget: number;
  estimatedTokens: number;
  fallback: AmbitionSynthesisOutput;
}

export interface AmbitionSynthesisOutput {
  firstPersonPostItCandidate: string;
  memoryState: TopOfMindRefreshCandidate["memoryPattern"]["state"];
  environmentDirection: string;
  rejectedEnvironment: string;
  evidenceRationale: string;
  confidence: number;
  rejectedAlternativeInterpretation: string;
}

export interface BoundedAmbitionSynthesisLoopResult {
  candidates: TopOfMindRefreshCandidate[];
  attempted: number;
  synthesized: number;
  fellBack: number;
  skipped: number;
}

const MAX_SYNTHESIS_CANDIDATES = 3;
const MAX_SIGNALS_PER_SYNTHESIS = 5;
const DEFAULT_TOKEN_BUDGET = 2400;
const MAX_FIELD_CHARS = 420;
const SHALLOW_CATEGORY_PATTERN =
  /\b(startups?|comedy|cities|ai|inspiration|productivity)\b/i;
const PERSONAL_EDGE_PATTERN =
  /\b(because|so I can|rooms?|peers?|work|standards?|surroundings?|environment|reject|done with|aliveness|public|braver|build|courage|normalizes?|private planning|visible)\b/i;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxChars = MAX_FIELD_CHARS): string {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 3).trimEnd()}...`;
}

function estimateTokens(value: string): number {
  return Math.ceil(normalizeWhitespace(value).length / 4);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(normalizeWhitespace).filter(Boolean))];
}

function parseCaptureMetadata(value: string | null | undefined): {
  emotionalPulls: string[];
  microReflection: string | null;
} {
  const text = value ?? "";
  const marker = "capture_metadata:v1:";
  const index = text.indexOf(marker);
  if (index === -1) return { emotionalPulls: [], microReflection: null };

  try {
    const parsed = JSON.parse(text.slice(index + marker.length)) as {
      resonance?: unknown;
      reflection?: unknown;
    };
    const emotionalPulls = Array.isArray(parsed.resonance)
      ? parsed.resonance.filter((item): item is string => typeof item === "string")
      : [];
    return {
      emotionalPulls: unique(emotionalPulls).slice(0, 8),
      microReflection:
        typeof parsed.reflection === "string"
          ? truncateText(parsed.reflection, 240)
          : null,
    };
  } catch {
    return { emotionalPulls: [], microReflection: null };
  }
}

function selectedSignalsFromEvidence(
  evidence: TopOfMindRefreshEvidenceInput[],
): AmbitionSynthesisSavedSignalInput[] {
  return evidence.slice(0, MAX_SIGNALS_PER_SYNTHESIS).map((row) => {
    const metadata = parseCaptureMetadata(row.sparkNote);
    return {
      id: row.inspirationId,
      excerpt: truncateText(row.inspirationText),
      highlight: row.sparkText ? truncateText(row.sparkText, 240) : null,
      emotionalPullMetadata: metadata.emotionalPulls,
      microReflection: metadata.microReflection,
      evidenceReason: truncateText(row.reason, 240),
      capturedAt: row.createdAt,
    };
  });
}

function fallbackRejectedAlternative(candidate: TopOfMindRefreshCandidate): string {
  return `The shallow read would call this ${candidate.node.label}; the stronger read is about the surrounding conditions that make it feel alive or false.`;
}

export function deterministicAmbitionSynthesisOutput(
  candidate: TopOfMindRefreshCandidate,
): AmbitionSynthesisOutput {
  return {
    firstPersonPostItCandidate: candidate.ambientSignal,
    memoryState: candidate.memoryPattern.state,
    environmentDirection: candidate.matchedEnvironment,
    rejectedEnvironment: candidate.antiEnvironment,
    evidenceRationale: candidate.evidenceRationale,
    confidence: candidate.wowScore,
    rejectedAlternativeInterpretation:
      candidate.rejectedAlternativeInterpretation ??
      fallbackRejectedAlternative(candidate),
  };
}

function priorFeedbackForCandidate(
  candidate: TopOfMindRefreshCandidate,
  feedback: AmbitionSynthesisFeedbackInput[],
): AmbitionSynthesisFeedbackInput[] {
  const signalIds = new Set(candidate.evidence.map((row) => row.inspirationId));
  return feedback
    .filter((row) => {
      if (row.targetType === "context_node" || row.targetType === "hypothesis") {
        return row.targetId === candidate.node.id;
      }
      if (row.targetType === "signal") return signalIds.has(row.targetId);
      return false;
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 8);
}

export function createAmbitionSynthesisInput(
  candidate: TopOfMindRefreshCandidate,
  input: {
    userId: string;
    trigger: AmbitionSynthesisTrigger;
    feedback?: AmbitionSynthesisFeedbackInput[];
    tokenBudget?: number;
  },
): AmbitionSynthesisInput {
  const priorFeedback = priorFeedbackForCandidate(candidate, input.feedback ?? []);
  const rewrites = unique(
    priorFeedback
      .map((row) => row.correctionText ?? "")
      .filter((text) => text.trim().length > 0),
  ).slice(0, 5);
  const selectedSignals = selectedSignalsFromEvidence(candidate.evidence);
  const rejectedOrCompetingInterpretations = unique([
    candidate.rejectedAlternativeInterpretation ?? "",
    ...priorFeedback
      .filter((row) => row.value === "not_true" || row.value === "partly")
      .map((row) => row.correctionText ?? ""),
    fallbackRejectedAlternative(candidate),
  ]).slice(0, 5);
  const tokenBudget = input.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
  const estimatedTokens = estimateTokens(
    JSON.stringify({
      contextNode: candidate.node,
      memoryState: candidate.memoryPattern.state,
      selectedSignals,
      priorFeedback,
      rewrites,
      rejectedOrCompetingInterpretations,
    }),
  );

  return {
    userId: input.userId,
    trigger: input.trigger,
    synthesisKey: `ambition_synthesis:v1:${candidate.idempotencyKey}:${candidate.memoryPattern.state}`,
    contextNode: {
      id: candidate.node.id,
      type: candidate.contextType,
      label: candidate.node.label,
      description: candidate.node.description,
      confidence: candidate.node.confidence,
    },
    memoryState: candidate.memoryPattern.state,
    memoryMovementScore: candidate.memoryPattern.movementScore,
    selectedSignals,
    priorFeedback,
    rewrites,
    rejectedOrCompetingInterpretations,
    tokenBudget,
    estimatedTokens,
    fallback: deterministicAmbitionSynthesisOutput(candidate),
  };
}

export function shouldRunAmbitionSynthesis(input: {
  candidate: TopOfMindRefreshCandidate;
  trigger: AmbitionSynthesisTrigger;
  tokenBudget?: number;
}): boolean {
  const tokenBudget = input.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
  const candidate = input.candidate;
  if (candidate.evidence.length < 2 && input.trigger !== "explicit_deep_dive") {
    return false;
  }
  if (createAmbitionSynthesisInput(candidate, {
    userId: "budget-check",
    trigger: input.trigger,
    tokenBudget,
  }).estimatedTokens > tokenBudget) {
    return false;
  }

  switch (input.trigger) {
    case "qualified_cluster":
      return candidate.node.evidenceCount >= 2 && candidate.node.confidence >= 45;
    case "memory_movement":
      return [
        "reactivated",
        "contradicted",
        "needs_testing",
        "emerging",
      ].includes(candidate.memoryPattern.state);
    case "explicit_deep_dive":
      return true;
    case "weekly_refresh":
      return candidate.score >= 260 || candidate.node.evidenceCount >= 3;
    case "strong_feedback":
    case "correction":
    case "contradiction":
      return true;
  }
}

export function isSpecificAmbitionSynthesisOutput(
  output: AmbitionSynthesisOutput,
): boolean {
  const text = [
    output.firstPersonPostItCandidate,
    output.environmentDirection,
    output.rejectedEnvironment,
    output.evidenceRationale,
  ].join(" ");
  if (!/^(I need|I want|I am|I'm|I refuse|I am done with)\b/i.test(output.firstPersonPostItCandidate)) {
    return false;
  }
  if (
    SHALLOW_CATEGORY_PATTERN.test(output.firstPersonPostItCandidate) &&
    !PERSONAL_EDGE_PATTERN.test(text)
  ) {
    return false;
  }
  if (output.rejectedAlternativeInterpretation.trim().length === 0) return false;
  return PERSONAL_EDGE_PATTERN.test(text);
}

export function applyAmbitionSynthesisOutput(
  candidate: TopOfMindRefreshCandidate,
  output: AmbitionSynthesisOutput,
): TopOfMindRefreshCandidate {
  const boundedConfidence = Math.max(1, Math.min(100, Math.round(output.confidence)));
  const baseWhy = candidate.why.replace(
    /\s*Rejected alternative interpretation:.+$/i,
    "",
  );
  return {
    ...candidate,
    title: truncateText(output.firstPersonPostItCandidate, 120),
    ambientSignal: truncateText(output.firstPersonPostItCandidate, 120),
    matchedEnvironment: truncateText(output.environmentDirection),
    antiEnvironment: truncateText(output.rejectedEnvironment),
    evidenceRationale: truncateText(output.evidenceRationale),
    rejectedAlternativeInterpretation: truncateText(
      output.rejectedAlternativeInterpretation,
    ),
    wowScore: boundedConfidence,
    why: `${baseWhy} Rejected alternative interpretation: ${truncateText(
      output.rejectedAlternativeInterpretation,
    )}`,
  };
}

export async function runBoundedAmbitionSynthesisLoop(input: {
  userId: string;
  trigger: AmbitionSynthesisTrigger;
  candidates: TopOfMindRefreshCandidate[];
  feedback?: AmbitionSynthesisFeedbackInput[];
  tokenBudget?: number;
  maxSyntheses?: number;
  synthesize: (
    input: AmbitionSynthesisInput,
  ) => Promise<AmbitionSynthesisOutput | null>;
}): Promise<BoundedAmbitionSynthesisLoopResult> {
  const maxSyntheses = Math.min(
    Math.max(input.maxSyntheses ?? MAX_SYNTHESIS_CANDIDATES, 0),
    MAX_SYNTHESIS_CANDIDATES,
  );
  const nextCandidates: TopOfMindRefreshCandidate[] = [];
  let attempted = 0;
  let synthesized = 0;
  let fellBack = 0;
  let skipped = 0;

  for (const candidate of input.candidates) {
    if (
      attempted >= maxSyntheses ||
      !shouldRunAmbitionSynthesis({
        candidate,
        trigger: input.trigger,
        tokenBudget: input.tokenBudget,
      })
    ) {
      skipped += 1;
      nextCandidates.push(candidate);
      continue;
    }

    attempted += 1;
    const synthesisInput = createAmbitionSynthesisInput(candidate, {
      userId: input.userId,
      trigger: input.trigger,
      feedback: input.feedback,
      tokenBudget: input.tokenBudget,
    });
    const output = await input.synthesize(synthesisInput);
    if (output && isSpecificAmbitionSynthesisOutput(output)) {
      synthesized += 1;
      nextCandidates.push(applyAmbitionSynthesisOutput(candidate, output));
      continue;
    }

    fellBack += 1;
    nextCandidates.push(
      applyAmbitionSynthesisOutput(candidate, synthesisInput.fallback),
    );
  }

  return {
    candidates: nextCandidates,
    attempted,
    synthesized,
    fellBack,
    skipped,
  };
}
