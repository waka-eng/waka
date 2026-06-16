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
  failed: number;
  fellBack: number;
  skipped: number;
  failures: AmbitionSynthesisFailure[];
}

export interface AmbitionSynthesisFailure {
  candidateId: string;
  contextNodeId: string;
  idempotencyKey: string;
  reason: "null_output" | "invalid_output" | "exception";
  message?: string;
}

const MAX_SYNTHESIS_CANDIDATES = 5;
const MAX_SIGNALS_PER_SYNTHESIS = 5;
const DEFAULT_TOKEN_BUDGET = 2400;
const MAX_FIELD_CHARS = 420;
const SHALLOW_CATEGORY_PATTERN =
  /\b(startups?|comedy|cities|ai|inspiration|productivity)\b/i;
const PERSONAL_EDGE_PATTERN =
  /\b(because|so I can|rooms?|places?|peers?|people|work|standards?|taste|surroundings?|environment|reject|done with|aliveness|public|braver|build|courage|normalizes?|private planning|visible|self-image|test|consensus)\b/i;
const OUTSIDE_VOICE_PATTERN = /^(you|your|this person|waka)\b/i;
const FORCED_TEMPLATE_PATTERN = /^(i need|i want|i am|i'm|i refuse|i am done with)\b/i;
const WEAK_HEDGE_PATTERN = /\b(i think|maybe|might|probably|seems|kind of)\b/i;
const SLOGAN_LIKE_POST_IT_PATTERN =
  /^(public before perfect|taste as default|test it outside|test it in public|courage normal|places that make courage normal|people who make courage normal|sharper taste as the default)$/i;
const CONCRETE_AMBITION_OBJECT_PATTERN =
  /\b(people|peers|rooms?|places?|city|cities|work|build|building|thing|path|taste|life|self|standards?|experiments?|questions?|environment)\b/i;
const INTERPRETABLE_POST_IT_PATTERN =
  /\b(before|after|without|instead|than|where|who|because|until|against|not|less|more|cost|allowed|dead|normal|braver|lonely|clarity)\b/i;

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
  // explicit_deep_dive and the bulk weekly_refresh both intentionally synthesize
  // thin (single-signal) candidates: the refresh wants real LLM text on every
  // ranked note. Other triggers keep the 2-signal floor. Production refresh
  // surfaces synthesis failure instead of silently converting it into a
  // deterministic note.
  if (
    candidate.evidence.length < 2 &&
    input.trigger !== "explicit_deep_dive" &&
    input.trigger !== "weekly_refresh"
  ) {
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
      // Full-coverage refresh: every ranked candidate that fits the token
      // budget gets real LLM synthesis. Weak output is surfaced as failure
      // instead of being persisted as deterministic output.
      return true;
    case "strong_feedback":
    case "correction":
    case "contradiction":
      return true;
  }
}

export function isSpecificAmbitionSynthesisOutput(
  output: AmbitionSynthesisOutput,
): boolean {
  const candidateText = normalizeWhitespace(output.firstPersonPostItCandidate);
  const text = [
    candidateText,
    output.environmentDirection,
    output.rejectedEnvironment,
    output.evidenceRationale,
  ].join(" ");
  const wordCount = candidateText.split(/\s+/).filter(Boolean).length;
  if (wordCount < 5 || wordCount > 14) return false;
  if (SLOGAN_LIKE_POST_IT_PATTERN.test(candidateText)) return false;
  if (!CONCRETE_AMBITION_OBJECT_PATTERN.test(candidateText)) return false;
  if (!INTERPRETABLE_POST_IT_PATTERN.test(candidateText)) return false;
  if (OUTSIDE_VOICE_PATTERN.test(candidateText)) return false;
  if (FORCED_TEMPLATE_PATTERN.test(candidateText)) return false;
  if (WEAK_HEDGE_PATTERN.test(candidateText)) return false;
  if (
    SHALLOW_CATEGORY_PATTERN.test(candidateText) &&
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
  const postIt = truncateText(output.firstPersonPostItCandidate, 120);
  const matchedEnvironment = truncateText(output.environmentDirection);
  const antiEnvironment = truncateText(output.rejectedEnvironment);
  const evidenceRationale = truncateText(output.evidenceRationale);
  const rejectedAlternativeInterpretation = truncateText(
    output.rejectedAlternativeInterpretation,
  );
  // The persisted `why` string is the only source of truth on read: the API
  // reconstructs ambientSignal/matchedEnvironment/antiEnvironment/evidenceRationale
  // by parsing the labeled sections back out of it. Rebuild those labeled
  // sections from the synthesized output (keeping the deterministic analytical
  // tail — "This may matter ..." with supporting signals and memory movement) so
  // the LLM text actually reaches the user instead of only the title.
  const baseWhy = candidate.why.replace(
    /\s*Rejected alternative interpretation:.+$/i,
    "",
  );
  const analyticalTail = baseWhy.match(/This may matter[\s\S]*$/)?.[0] ?? "";
  const synthesizedHead = [
    `Ambient signal: ${postIt}`,
    `Matched environment: ${matchedEnvironment}`,
    `Anti-environment: ${antiEnvironment}`,
    `Evidence rationale: ${evidenceRationale}`,
  ].join(" ");
  const rebuiltWhy = [synthesizedHead, analyticalTail]
    .filter((part) => part.trim().length > 0)
    .join(" ");
  return {
    ...candidate,
    title: postIt,
    ambientSignal: postIt,
    matchedEnvironment,
    antiEnvironment,
    evidenceRationale,
    rejectedAlternativeInterpretation,
    wowScore: boundedConfidence,
    why: `${rebuiltWhy} Rejected alternative interpretation: ${rejectedAlternativeInterpretation}`,
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
  let failed = 0;
  let skipped = 0;
  const failures: AmbitionSynthesisFailure[] = [];

  function recordFailure(
    candidate: TopOfMindRefreshCandidate,
    reason: AmbitionSynthesisFailure["reason"],
    error?: unknown,
  ): void {
    failed += 1;
    const message =
      error instanceof Error ? error.message.slice(0, 180) : undefined;
    failures.push({
      candidateId: `${candidate.node.id}:${candidate.memoryPattern.state}`,
      contextNodeId: candidate.node.id,
      idempotencyKey: candidate.idempotencyKey,
      reason,
      ...(message ? { message } : {}),
    });
    console.warn("Ambition synthesis failed; candidate will not be persisted", {
      contextNodeId: candidate.node.id,
      idempotencyKey: candidate.idempotencyKey,
      reason,
      ...(message ? { message } : {}),
    });
  }

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
      continue;
    }

    attempted += 1;
    const synthesisInput = createAmbitionSynthesisInput(candidate, {
      userId: input.userId,
      trigger: input.trigger,
      feedback: input.feedback,
      tokenBudget: input.tokenBudget,
    });
    let output: AmbitionSynthesisOutput | null;
    try {
      output = await input.synthesize(synthesisInput);
    } catch (error) {
      recordFailure(candidate, "exception", error);
      continue;
    }

    if (!output) {
      recordFailure(candidate, "null_output");
      continue;
    }

    if (output && isSpecificAmbitionSynthesisOutput(output)) {
      synthesized += 1;
      nextCandidates.push(applyAmbitionSynthesisOutput(candidate, output));
      continue;
    }

    recordFailure(candidate, "invalid_output");
  }

  return {
    candidates: nextCandidates,
    attempted,
    synthesized,
    failed,
    fellBack,
    skipped,
    failures,
  };
}
