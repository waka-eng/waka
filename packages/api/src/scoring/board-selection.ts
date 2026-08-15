/**
 * Choosing a wall, rather than accumulating one.
 *
 * Synthesis judges one trigger at a time and used to put each surviving
 * reading straight on the board, stopping at six. So the wall was "the first
 * six that worked" — arrival order decided it, and nothing was ever in a
 * position to look at six readings together and ask whether they were the best
 * six. Measured on a real board: ten triggers produced three readings that were
 * three phrasings of one idea, and no stage could notice.
 *
 * This is that stage. It runs strictly AFTER the judge and after the two-owner
 * and restatement gates, so it only ever chooses among readings those already
 * accepted. The judge decides what is true; this decides what makes a board.
 *
 * **Why it is arithmetic and not a prompt.** The obvious version — show each
 * judgment the readings already on the board and ask it not to repeat them —
 * was built and measured on 2026-08-02. It made collapse worse: three readings
 * became nine, three of them character-for-character identical, and refusals
 * fell from seven to one. A model shown five notes writes a sixth that looks
 * like them. Awareness of the set cannot live inside generation; it belongs
 * here, where it is a calculation rather than a request.
 *
 * **Why it ranks and never thresholds.** Both distinctness measures available
 * have failed on real boards: lexical overlap called a collapsed board distinct
 * at 0.08 because five phrasings of one idea share no words, and embedding
 * cosine normalized against a fixed corpus ranked a collapsed board and a
 * plural one the wrong way round. Neither can answer "is this board collapsed?"
 * Both answer "is A further from B than from C?" reliably, and that is all a
 * greedy selection needs. Any absolute threshold added here is a bug.
 */

import { cosineSimilarity } from "./vector.js";

/**
 * How much a reading's own strength counts, against what it adds to the board.
 *
 * Low on purpose. Every candidate reaching this stage has already been judged
 * true, spanned two members, and survived the restatement filter — they are
 * not of wildly different quality, and the question here is what the board
 * still lacks. Scoring quality highly would rebuild arrival order under a new
 * name, since arrival was already ordered by roughly the same strength.
 */
export const BOARD_QUALITY_WEIGHT = 0.2;

/**
 * How much reaching a member nobody on the board rests on counts.
 *
 * The highest weight, because a member absent from a board is not a metric
 * gap: it is a person whose signals were never read alongside the others,
 * which is the one thing a room exists to do. Deliberately above distinctness
 * — a fresh voice is worth more than a marginally different idea from voices
 * already present.
 */
export const BOARD_COVERAGE_WEIGHT = 0.5;

/**
 * How much saying something the board does not yet say counts.
 *
 * Applied to a WITHIN-PASS RANK, never to a raw cosine. A tight room sits near
 * 0.9 mean similarity and a loose one near 0.5; the same absolute cut would
 * flatten the first and shred the second. Ranking makes both behave the same:
 * "furthest from what is already up" means the same thing in either room.
 */
export const BOARD_DISTINCTNESS_WEIGHT = 0.3;

export interface SelectableCandidate {
  /** Stable identity for the candidate, used only for deterministic ties. */
  id: string;
  /** Embedding of the reading itself — its title and belief statement. */
  embedding: number[];
  /** Distinct members whose signals this reading rests on. */
  ownerIds: string[];
  /** The reading's own strength, 0..1. */
  quality: number;
  /**
   * A reading this pass re-derived rather than invented.
   *
   * These are not chosen; they are already on the board and seed it. A reading
   * reached again has been confirmed, not superseded, and dropping one because
   * selection preferred a fresher-looking alternative would reintroduce a bug
   * that already cost a real board two of its six notes — and would make the
   * wall churn between refreshes for reasons nobody could see.
   */
  reconfirmed?: boolean;
}

/**
 * Rank positions of each value, lowest value first, normalized to 0..1.
 *
 * The relative-measure primitive this module rests on: it discards the scale
 * of the numbers and keeps only their order, so a board of near-identical
 * readings still produces a usable spread of scores.
 */
function normalizedRanks(values: number[]): number[] {
  const order = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => (a.value === b.value ? a.index - b.index : a.value - b.value));
  const ranks = new Array<number>(values.length).fill(0);
  const denominator = Math.max(1, values.length - 1);
  order.forEach((entry, position) => {
    ranks[entry.index] = position / denominator;
  });
  return ranks;
}

/** Similarity of a candidate to the nearest reading already on the board. */
function nearestSelectedSimilarity(
  candidate: SelectableCandidate,
  selected: SelectableCandidate[],
): number {
  let nearest = -1;
  for (const chosen of selected) {
    if (chosen.embedding.length !== candidate.embedding.length) continue;
    const similarity = cosineSimilarity(candidate.embedding, chosen.embedding);
    // An incomparable pair tells us nothing about distance; skip it rather
    // than letting it read as "maximally far".
    if (similarity !== null && similarity > nearest) nearest = similarity;
  }
  // Nothing to be near yet: maximally distinct by definition.
  return nearest < 0 ? 0 : nearest;
}

/**
 * Choose the readings that make the best board.
 *
 * Re-confirmed readings seed it, then the remaining places go to whichever
 * candidate most improves what the board still lacks — a member nobody speaks
 * for, or something nobody has said.
 *
 * Deterministic and order-independent: the same candidate set in any order
 * yields the same board, so a wall never changes because Postgres returned
 * rows differently.
 */
export function selectBoard(
  candidates: SelectableCandidate[],
  k: number,
): SelectableCandidate[] {
  if (k <= 0 || candidates.length === 0) return [];

  // Sorting up front is what makes the result independent of input order; ties
  // fall to id so two runs on the same data agree.
  const pool = [...candidates].sort((a, b) =>
    a.quality === b.quality ? a.id.localeCompare(b.id) : b.quality - a.quality,
  );

  const selected: SelectableCandidate[] = [];
  const remaining: SelectableCandidate[] = [];
  for (const candidate of pool) {
    if (candidate.reconfirmed && selected.length < k) selected.push(candidate);
    else remaining.push(candidate);
  }

  const covered = new Set<string>();
  for (const chosen of selected) for (const owner of chosen.ownerIds) covered.add(owner);

  /**
   * Seed with the strongest reading when nothing is on the board yet.
   *
   * Not an optimisation — a correctness fix the tests caught. With an empty
   * board every candidate is equally distant from it, so ranking those tied
   * distances still spread them across 0..1 and handed the place to whichever
   * candidate happened to sort last. "Furthest from nothing" is not a
   * question; quality is the only thing that can answer the first place.
   */
  if (selected.length === 0 && remaining.length > 0) {
    const seed = remaining.shift()!;
    selected.push(seed);
    for (const owner of seed.ownerIds) covered.add(owner);
  }

  while (selected.length < k && remaining.length > 0) {
    /**
     * Distance is scored by rank WITHIN this round, recomputed each time.
     *
     * Recomputed rather than cached because "how different is this from the
     * board" changes every time something joins the board — a candidate that
     * was the freshest voice can become a near-duplicate of what was just
     * chosen.
     */
    const similarities = remaining.map((candidate) =>
      nearestSelectedSimilarity(candidate, selected),
    );
    // Negated so the LEAST similar candidate ranks highest: distinctness is
    // the inverse of nearness, and ranking ascending on raw similarity scored
    // the closest candidate best — the opposite of the point.
    const distinctness = normalizedRanks(similarities.map((value) => -value));

    let bestIndex = 0;
    let bestGain = -Infinity;
    remaining.forEach((candidate, index) => {
      const newMembers = candidate.ownerIds.filter((owner) => !covered.has(owner)).length;
      // Normalized by the candidate's own reach so a reading resting on five
      // members is not automatically better than one resting on two — what
      // counts is whether the people it reaches are missing from the board.
      const coverage = candidate.ownerIds.length === 0
        ? 0
        : newMembers / candidate.ownerIds.length;

      const gain =
        BOARD_QUALITY_WEIGHT * candidate.quality +
        BOARD_COVERAGE_WEIGHT * coverage +
        BOARD_DISTINCTNESS_WEIGHT * (distinctness[index] ?? 0);

      if (gain > bestGain) {
        bestGain = gain;
        bestIndex = index;
      }
    });

    const [chosen] = remaining.splice(bestIndex, 1);
    if (!chosen) break;
    selected.push(chosen);
    for (const owner of chosen.ownerIds) covered.add(owner);
  }

  return selected;
}
