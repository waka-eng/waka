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
 * At or above this cosine to a DISMISSED signal's vector, a candidate is the
 * pattern its owner already threw out, and the ground refuses it: no mint, no
 * evidence, no judge call — one `suppressions` row naming the anchor instead.
 * The refusal is checked BEFORE the match, so a refused pattern cannot
 * re-enter as evidence for something else, and a refused candidate never
 * spends a model call.
 *
 * Deliberately the same number as the match bar today: "close enough to be
 * the same pattern" must mean one thing whether the pattern is wanted or
 * refused. A separate export all the same, because the two may need to tune
 * apart — a false refusal is visible in the antechamber and reversible by
 * restore, while a false match is the invisible fusion the match bar is set
 * high against.
 */
export const SIGNAL_SUPPRESSION_MIN_COSINE = 0.86;

/**
 * Two candidates from the *same* capture this close are one pattern said
 * twice. Higher than the match bar because both came from one model call on
 * one input, so genuine distinctness needs more separation to be believable.
 */
export const SIGNAL_BATCH_DEDUPE_MIN_COSINE = 0.94;

/** The gardener's suspect bar: at or above the attach threshold, two
    STANDING signals are close enough that derivation would have attached
    one to the other — exactly the pairs worth a judge's minute. */
export const GARDENER_SUSPECT_MIN_COSINE = 0.86;
/** Most-recently-evidenced signals one garden pass reads. */
export const GARDENER_SCAN_LIMIT = 300;
/** Judge calls one pass may spend — the rest of the suspects wait a week. */
export const GARDENER_MAX_JUDGED_PAIRS = 8;

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

/**
 * Added when the owner's LATEST standing verdict on the signal is "true" —
 * a person saying "yes, this is me" is corroboration of the strongest kind,
 * and until 2026-08-31 it changed selection context only, never the number
 * the world lights by. A bonus like the diversity bonus, not a weight:
 * unanswered must not subtract, and disputed is deliberately NOT mirrored
 * here — "not_true" already moves selection through its own multiplier, and
 * cutting confidence too would count one answer twice.
 *
 * ── 8 -> 30 ON 2026-10-10, AND THE ARITHMETIC IS THE ARGUMENT ─────────────
 *
 * At 8 this was worth EXACTLY what `CONFIDENCE_SOURCE_DIVERSITY_BONUS` is
 * worth. A person reading a sentence about themselves and saying "yes, that
 * is me" counted for the same as that sentence happening to have been
 * captured from two different apps.
 *
 * Downstream it was smaller still. Selection weights confidence at 0.45, so
 * affirming moved the selection score by +3.6 of 100 — while "not true"
 * multiplies the whole score by `SELECTION_DISPUTED_MULTIPLIER` (0.4), which
 * on a score of 60 is -36. Ten times the effect for the opposite answer, on
 * a loop whose entire thesis is that confirming is the central act.
 *
 * THE NUMBER IS NOT PICKED, IT IS BORROWED. 30 is `CONFIDENCE_SPREAD_WEIGHT`
 * — the whole durability term, the one that asks whether a pattern recurred
 * across a month rather than across an afternoon. So the principle is
 * statable in one sentence, which is the test of whether a constant is
 * reasoned: YOUR SAYING "THIS IS ME" IS WORTH WHAT A MONTH OF RECURRENCE IS
 * WORTH. It is not worth more than the support term (55), because a single
 * answer should not outrank everything a person actually did.
 *
 * ── WHY NOT A SELECTION MULTIPLIER, WHICH WOULD BE THE SYMMETRIC FIX ──────
 *
 * Mirroring `SELECTION_DISPUTED_MULTIPLIER` at 1/0.4 = 2.5 is the obvious
 * move and it is wrong, because the two answers are not symmetric in their
 * failure. Suppression is safe: a signal you called untrue staying down is
 * the outcome you asked for. Amplification is not. An affirmed signal whose
 * evidence went quiet years ago scores 0.45*confidence + 0.2*support*100
 * with recency at 0 — about 47 — and 47 x 2.5 pins to the 100 cap forever.
 * The person would have made one true statement about themselves and been
 * unable to ever see anything else at the top of their own reading.
 *
 * A bounded bonus cannot do that: it rides through the 0.45 weight and still
 * decays with everything else. `top-of-mind-affirmation.test.ts` holds both
 * halves — that affirming lifts a claim, and that it does not make it
 * immortal.
 */
export const CONFIDENCE_AFFIRMED_BONUS = 30;

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

/**
 * HOW MANY SHELVES THE READING IS SHOWN WHEN IT NAMES A CAPTURE'S CATEGORY.
 *
 * Enough that a capture nearly always finds a home among them, few enough
 * that the list stays a list rather than becoming the prompt. They are shown
 * busiest-first, so this cap drops the long tail of one-offs rather than the
 * handful of shelves that actually organise the archive.
 */
export const MAX_EXISTING_CATEGORIES = 24;

/*
 * -----------------------------------------------------------------------
 * Related captures — recurrence the extractor is allowed to SEE.
 *
 * Per-capture extraction can only name a pattern one capture witnesses on
 * its own. The pattern a person actually produces returns months later,
 * dressed in different words, across saves that individually look like
 * nothing — so at derivation the current capture's nearest earlier
 * captures (by inspiration-embedding cosine) are shown to the extractor
 * as context, and it may cite the ones that independently witness a
 * statement it is already grounding in the current capture. A citation
 * becomes a real evidence row for the same signal — dated by ITS OWN
 * capture date (see signal-lifecycle.ts) and kept only with a verbatim
 * quote from its own text, verified in code.
 * -----------------------------------------------------------------------
 */

/**
 * Ceiling on how many of the profile's most recent capture vectors are
 * scanned for relatedness. Same in-memory-cosine cost story as
 * MATCH_CANDIDATE_SCAN_LIMIT, and deliberately the same value: the two
 * scans run in the same pass over the same archive.
 */
export const RELATED_INSPIRATION_SCAN_LIMIT = 500;

/**
 * Floor below which an earlier capture is not offered as context at all.
 * Well under the signal-matching bars on purpose — statements are distilled
 * and compact while captures are raw and noisy, so thematic kinship between
 * captures lives lower on the cosine scale than sameness between statements.
 * A first, defensible guess like every number in this file; the failure
 * modes are bounded on both sides (too high → the feature sees nothing and
 * derivation behaves exactly as before; too low → the model is shown noise
 * it is instructed to ignore and must out-quote to cite).
 */
export const RELATED_INSPIRATION_MIN_COSINE = 0.6;

/**
 * How many related captures the extractor is shown. Context, not corpus:
 * enough to notice a theme returning, few enough that the current capture
 * stays the loudest thing in the prompt.
 */
export const RELATED_INSPIRATION_CONTEXT_LIMIT = 5;

/** Recall's floor — the same relatedness floor derivation trusts (0.6 in
    the pinned embedding space): below it, a match is a coincidence of
    vocabulary, not a thought the person holds. */
export const RECALL_MIN_COSINE = 0.6;
/** Most matches one recall serves — an answer, not a dump. */
export const RECALL_LIMIT = 8;
