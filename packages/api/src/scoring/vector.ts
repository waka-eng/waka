/**
 * Vector similarity.
 *
 * Embeddings are compared in application code rather than in Postgres: the
 * archives are small enough that a linear scan over one profile's vectors is
 * fast, and it keeps the schema portable across hosts without a pgvector
 * extension.
 *
 * Every function here is total — a malformed, mismatched, or non-finite
 * vector returns 0 rather than throwing or producing NaN. Similarity feeds
 * ranking and match-or-mint decisions, and a NaN silently poisons a sort in
 * a way that is very hard to see afterwards; zero is wrong in an obvious,
 * self-correcting direction.
 */

/** A score clamped to [0, 1]. */
export type NormalizedScore = number;

function clamp01(value: number): NormalizedScore {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Cosine similarity of two equal-length vectors, clamped to [0, 1].
 *
 * Embedding models return unit-ish vectors whose pairwise cosine lands in
 * [0, 1] in practice; clamping guards the edges rather than reshaping the
 * measure.
 */
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
