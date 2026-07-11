import { createHash } from "node:crypto";

export interface CanonicalTopOfMindValueInput {
  evidenceCount: number;
  confidence: number;
  relevance: number;
  novelty: number;
}

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/** The single server-owned value rubric for every top-of-mind generation path. */
export function canonicalTopOfMindValue(
  input: CanonicalTopOfMindValueInput,
): number {
  const evidence = clamp(input.evidenceCount * 20);
  return Math.round(
    evidence * 0.25 +
      clamp(input.confidence) * 0.3 +
      clamp(input.relevance) * 0.3 +
      clamp(input.novelty) * 0.15,
  );
}

function digest(value: string): string {
  return createHash("md5").update(value).digest("hex");
}

/** Stable family identity derived from durable provenance, never generated copy. */
export function semanticFamilyKey(source: string, stableId: string): string {
  return `${source.normalize("NFKC")}:${stableId.normalize("NFKC")}`;
}

export function evidenceFingerprint(signalIds: string[]): string {
  return digest([...new Set(signalIds)].sort().join("\n"));
}

export type TopOfMindPersistenceAction =
  | "create"
  | "replace"
  | "keep_existing"
  | "blocked_by_pin";

export function evaluateTopOfMindCandidate(input: {
  candidateValue: number;
  candidateEvidenceFingerprint: string;
  existing?: { value: number; evidenceFingerprint: string; isPinned: boolean };
}): TopOfMindPersistenceAction {
  const existing = input.existing;
  if (!existing) return "create";
  if (existing.evidenceFingerprint === input.candidateEvidenceFingerprint) {
    return "keep_existing";
  }
  if (existing.isPinned) return "blocked_by_pin";
  return clamp(input.candidateValue) >= clamp(existing.value) + 5
    ? "replace"
    : "keep_existing";
}
