/**
 * Vector similarity.
 *
 * Embeddings are compared in application code rather than in Postgres: one
 * profile's archive is small enough that a linear scan is fast, and it keeps
 * the schema portable across hosts without a pgvector extension.
 */

/**
 * Cosine similarity of two vectors, or `null` when they cannot be compared —
 * different lengths, empty, or a zero vector.
 *
 * Null rather than zero, because the two mean different things to a caller.
 * Match-or-mint reads a low score as "this is a different pattern" and acts on
 * it; if an unusable vector also scored zero, a missing embedding would look
 * exactly like a confident decision that nothing matched, and the capture
 * would quietly mint a duplicate signal. A caller that genuinely wants a
 * number can coalesce; a caller that must not confuse the two cannot recover
 * the distinction once it is gone.
 */
export function cosineSimilarity(
  a: readonly number[],
  b: readonly number[],
): number | null {
  if (a.length === 0 || a.length !== b.length) return null;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const left = a[i]!;
    const right = b[i]!;
    if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
    dot += left * right;
    normA += left * left;
    normB += right * right;
  }
  if (normA === 0 || normB === 0) return null;

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
