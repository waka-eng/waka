/**
 * The numbers match-or-mint decides by, and the one function that reads them.
 *
 * Every number below is a first, defensible guess made without a corpus.
 * Phase 4 tunes them against real archives; they live here as named exports
 * precisely so that tuning is a one-file diff and a reviewer can see what
 * moved. A magic number buried in a comparison is a number nobody ever tunes.
 *
 * Every constant in this file is LOCKED to docs/generation.md by
 * `packages/api/src/lib/generation-doc.test.ts`: each exported constant here
 * must appear in the doc's tuning tables with exactly this value, and each row
 * of those tables must name a real export here. Both directions, so a new
 * undocumented constant fails CI as loudly as a stale documented one.
 *
 * That promise is worth spelling out, because carving this file out of
 * `signal-derivation.ts` is exactly how it gets broken. The doc test reads
 * whole module namespaces. An earlier attempt at this split had the facade
 * re-export these constants by name, one `export { ... }` list — which quietly
 * narrowed the lock to the names somebody had remembered to type. A constant
 * added here and not added there was invisible to the test, and the suite
 * stayed green while the doc went stale. That was rejected. The lock is now
 * held two ways, both automatic and neither requiring anyone to remember
 * anything: `signal-derivation.ts` re-exports this module with `export *`, and
 * this file is named directly in the doc test's MODULES map. Either alone
 * would carry it; together, neither a facade rewrite nor a MODULES edit can
 * silently unhook it.
 *
 * The clip lengths that bound a candidate's text are deliberately NOT here.
 * They stay unexported beside `clip`, their only caller, because exporting
 * them would enrol them in the lock above — and that is a change of contract,
 * not a move.
 */

/**
 * Above this cosine, a candidate is the pattern an existing signal already
 * names, and the capture becomes evidence for it. Deliberately high: a false
 * match quietly fuses two distinct patterns into one and there is no surface
 * anywhere that would show it happened, while a false mint shows up as a
 * near-duplicate the owner can merge.
 */
export const SIGNAL_MATCH_MIN_COSINE = 0.86;

/**
 * Between this and the match bar, distance alone cannot decide: statements
 * this close are sometimes one pattern reworded and sometimes two patterns
 * sharing a vocabulary. The band gets one judge call for the single nearest
 * candidate. Below it, minting needs no permission — and above the match bar,
 * attaching needs none.
 */
export const SIGNAL_MERGE_JUDGE_MIN_COSINE = 0.7;

/** What match-or-mint does with a similarity, before any model is consulted. */
export function classifyMatch(similarity: number | null): "attach" | "judge" | "mint" {
  if (similarity === null) return "mint";
  if (similarity >= SIGNAL_MATCH_MIN_COSINE) return "attach";
  if (similarity >= SIGNAL_MERGE_JUDGE_MIN_COSINE) return "judge";
  return "mint";
}

/**
 * Two candidates from the *same* capture this close are one pattern said
 * twice. Higher than the match bar because both came from one model call on
 * one input, so genuine distinctness needs more separation to be believable.
 */
export const SIGNAL_BATCH_DEDUPE_MIN_COSINE = 0.94;

/** Evidence count at which an `emerging` signal becomes `active`. */
export const SIGNAL_PROMOTION_MIN_EVIDENCE = 3;

/** Evidence count at which the support term of confidence saturates. */
export const CONFIDENCE_SATURATION_EVIDENCE = 6;

/**
 * Days between first and last evidence at which the durability term
 * saturates. A pattern that recurs across a month is a pattern; five captures
 * in one afternoon are one afternoon.
 */
export const CONFIDENCE_SATURATION_SPREAD_DAYS = 30;

/** Half-life of the recency term: how fast a quiet signal reads as quiet. */
export const CONFIDENCE_RECENCY_HALF_LIFE_DAYS = 45;

/** Weights of the three confidence terms; they sum to 100. */
export const CONFIDENCE_SUPPORT_WEIGHT = 55;
export const CONFIDENCE_SPREAD_WEIGHT = 30;
export const CONFIDENCE_RECENCY_WEIGHT = 15;

/**
 * Bonus when a pattern is corroborated by more than one kind of capturer —
 * the person's own saves and an agent's observations agreeing is evidence
 * neither could supply alone.
 *
 * A bonus rather than a weighted term, deliberately: most profiles are
 * app-only, and a weight would cap every solo human below 100 forever.
 * Corroboration adds; its absence must not subtract.
 */
export const CONFIDENCE_SOURCE_DIVERSITY_BONUS = 8;

/**
 * Ceiling on how many of a profile's signals are scanned for a match. The
 * comparison is in application memory over jsonb vectors, so this bounds the
 * work per capture; ordering by recency of evidence means the signals most
 * likely to match are the ones that survive the cut.
 */
export const MATCH_CANDIDATE_SCAN_LIMIT = 500;
