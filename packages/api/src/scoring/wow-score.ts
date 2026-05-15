/**
 * Pure WOW scoring calculators.
 *
 * All public calculators return normalized scores in the inclusive 0..1 range.
 * Persisted API/database score columns can use `toPersistedScore` to convert the
 * normalized value to a stable 0..100 integer without pulling in DB concerns.
 */

export type NormalizedScore = number;

export type ContentDepthScore = NormalizedScore;
export type ProcessingScore = NormalizedScore;
export type RevisitScore = NormalizedScore;
export type TimeSignalScore = NormalizedScore;
export type ImportanceScore = NormalizedScore;
export type SimilarityScore = NormalizedScore;
export type SurpriseSimilarityScore = NormalizedScore;
export type RelationshipScore = NormalizedScore;
export type CoreWowScore = NormalizedScore;
export type FreshnessDecayScore = NormalizedScore;
export type DisplayedScore = NormalizedScore;
export type WowScore = NormalizedScore;
export type RuntimeCandidateScore = NormalizedScore;

export interface ContentDepthInputs {
  textDepth: NormalizedScore;
  contextScore: NormalizedScore;
}

export interface ProcessingInputs {
  hasReflection: boolean;
}

export interface RevisitInputs {
  uniqueRevisitDays: NormalizedScore;
  totalRevisitCount: NormalizedScore;
  revisitedInLast7Days: boolean | NormalizedScore;
}

export interface ImportanceInputs {
  contentDepth: ContentDepthScore;
  processing: ProcessingScore;
  revisit: RevisitScore;
  timeSignal: TimeSignalScore;
}

export interface WowInputs {
  importance: ImportanceScore;
  topSimilaritySignal: SimilarityScore;
  topSurpriseSimilaritySignal: SurpriseSimilarityScore;
  timeDistanceSignal: TimeSignalScore;
}

export interface RelationshipInputs {
  topSimilaritySignal: SimilarityScore;
  topSurpriseSimilaritySignal: SurpriseSimilarityScore;
  timeDistanceSignal: TimeSignalScore;
}

export interface CoreWowInputs {
  importance: ImportanceScore;
  relationship: RelationshipScore;
}

export interface FreshnessDecayInputs {
  ageDays: number;
}

export interface DisplayedScoreInputs {
  coreWowScore: CoreWowScore;
  freshnessDecay: FreshnessDecayScore;
}

export interface RuntimeCandidateInputs {
  wowScore: WowScore;
  similarityToTrigger: SimilarityScore;
  surpriseSimilarityToTrigger: SurpriseSimilarityScore;
  timeDistanceToTrigger: TimeSignalScore;
}

export interface LogNormalizeOptions {
  /** Value that should map to 1. Values above this are clamped to 1. */
  max: number;
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

export function clamp01(value: number): NormalizedScore {
  return clamp(value, 0, 1);
}

export function log1p(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.log1p(value);
}

export function logNormalize(value: number, options: LogNormalizeOptions): NormalizedScore {
  if (!Number.isFinite(options.max) || options.max <= 0) {
    return 0;
  }

  return clamp01(log1p(value) / Math.log1p(options.max));
}

export function toPersistedScore(score: NormalizedScore): number {
  return Math.round(clamp01(score) * 100);
}

export function fromPersistedScore(score: number): NormalizedScore {
  return clamp01(score / 100);
}

export function calculateProcessingScore(inputs: ProcessingInputs): ProcessingScore {
  return inputs.hasReflection ? 1 : 0;
}

export function calculateContentDepthScore(inputs: ContentDepthInputs): ContentDepthScore {
  return clamp01(0.70 * clamp01(inputs.textDepth) + 0.30 * clamp01(inputs.contextScore));
}

export function calculateRevisitScore(inputs: RevisitInputs): RevisitScore {
  const revisitedInLast7Days =
    typeof inputs.revisitedInLast7Days === "boolean"
      ? inputs.revisitedInLast7Days
        ? 1
        : 0
      : clamp01(inputs.revisitedInLast7Days);

  return clamp01(
    0.65 * clamp01(inputs.uniqueRevisitDays) +
      0.25 * clamp01(inputs.totalRevisitCount) +
      0.10 * revisitedInLast7Days,
  );
}

export function calculateImportanceScore(inputs: ImportanceInputs): ImportanceScore {
  return clamp01(
    0.40 * clamp01(inputs.contentDepth) +
      0.25 * clamp01(inputs.processing) +
      0.25 * clamp01(inputs.revisit) +
      0.10 * clamp01(inputs.timeSignal),
  );
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): NormalizedScore {
  if (a.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let aMagnitudeSquared = 0;
  let bMagnitudeSquared = 0;

  for (let i = 0; i < a.length; i++) {
    const aValue = a[i] ?? 0;
    const bValue = b[i] ?? 0;

    if (!Number.isFinite(aValue) || !Number.isFinite(bValue)) {
      return 0;
    }

    dot += aValue * bValue;
    aMagnitudeSquared += aValue * aValue;
    bMagnitudeSquared += bValue * bValue;
  }

  if (aMagnitudeSquared <= 0 || bMagnitudeSquared <= 0) {
    return 0;
  }

  return clamp01(dot / Math.sqrt(aMagnitudeSquared * bMagnitudeSquared));
}

export function calculateSimilarityScore(value: number): SimilarityScore {
  return clamp01(value);
}

export function calculateSurpriseSimilarityScore(value: number): SurpriseSimilarityScore {
  return clamp01(value);
}

export function calculateWowScore(inputs: WowInputs): WowScore {
  const relationship = calculateRelationshipScore({
    topSimilaritySignal: inputs.topSimilaritySignal,
    topSurpriseSimilaritySignal: inputs.topSurpriseSimilaritySignal,
    timeDistanceSignal: inputs.timeDistanceSignal,
  });

  return calculateCoreWowScore({
    importance: inputs.importance,
    relationship,
  });
}

export function calculateRelationshipScore(
  inputs: RelationshipInputs,
): RelationshipScore {
  return clamp01(
    0.45 * clamp01(inputs.topSimilaritySignal) +
      0.35 * clamp01(inputs.topSurpriseSimilaritySignal) +
      0.20 * clamp01(inputs.timeDistanceSignal),
  );
}

export function calculateCoreWowScore(inputs: CoreWowInputs): CoreWowScore {
  return clamp01(0.55 * clamp01(inputs.importance) + 0.45 * clamp01(inputs.relationship));
}

export function calculateFreshnessDecayScore(
  inputs: FreshnessDecayInputs,
): FreshnessDecayScore {
  const ageDays = Number.isFinite(inputs.ageDays) ? Math.max(0, inputs.ageDays) : 0;
  return clamp01(Math.pow(0.5, ageDays / 30));
}

export function calculateDisplayedScore(inputs: DisplayedScoreInputs): DisplayedScore {
  return clamp01(0.90 * clamp01(inputs.coreWowScore) + 0.10 * clamp01(inputs.freshnessDecay));
}

export function calculateRuntimeCandidateScore(
  inputs: RuntimeCandidateInputs,
): RuntimeCandidateScore {
  return clamp01(
    0.50 * clamp01(inputs.wowScore) +
      0.25 * clamp01(inputs.similarityToTrigger) +
      0.20 * clamp01(inputs.surpriseSimilarityToTrigger) +
      0.05 * clamp01(inputs.timeDistanceToTrigger),
  );
}
