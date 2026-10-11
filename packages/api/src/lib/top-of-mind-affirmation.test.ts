/** WHAT THIS MOCKS, AND WHY: nothing. `computeSignalConfidence` and
 * `computeSelectionScore` are pure functions of their inputs and a clock, and
 * both are called here exactly as the real pipeline calls them — confidence
 * first, its result fed into selection. No database, no network, no account,
 * no model. That is the point: this is the test a receipt is allowed to cite,
 * so it has to exercise the real arithmetic rather than a description of it. */
import { describe, expect, it } from "vitest";

import { computeSignalConfidence, type ConfidenceEvidence } from "./signal-lifecycle.js";
import { computeSelectionScore } from "./top-of-mind-synthesis.js";

/**
 * ═══ WHAT SAYING "YES" ACTUALLY BUYS ═══
 *
 * `lib/receipts.ts` in the web package carries one law: a receipt may claim
 * ONLY what a named test on the real pipeline enforces. For a long time the
 * receipt for affirming a claim read "On the record" — which claims almost
 * nothing — while the receipt for rejecting one read "Steps far back in the
 * choosing — never erased", which is vivid and mechanical and specific.
 *
 * That asymmetry was honest. Saying yes added `CONFIDENCE_AFFIRMED_BONUS` (8)
 * to confidence, which selection weights at 0.45 — **+3.6 of 100**. Saying
 * not-true multiplied the whole selection score by 0.4, which on a score of
 * 60 is **-36**. Ten times the effect, for the opposite answer, in a product
 * whose central act is confirming. The copy could not be fixed before the
 * mechanism was, because the law would not let it promise more.
 *
 * So the bonus is 30 now — `CONFIDENCE_SPREAD_WEIGHT`, the whole durability
 * term — and this file is what the receipt cites. It holds TWO things,
 * because the second is the reason the obvious fix was not taken.
 */
const DAY = 86_400_000;
const at = (daysAgo: number): Date => new Date(Date.UTC(2026, 9, 10) - daysAgo * DAY);
const NOW = at(0);

/** TWO SAVES, WHICH IS THE CASE THE WHOLE FIX IS ABOUT. A thin claim is
    exactly the one the deadlock trapped: too weak to be selected into a top
    of mind, therefore never shown, therefore never affirmed, therefore never
    given the confidence affirming would have given it. */
const thin = (): ConfidenceEvidence[] =>
  [3, 20].map((daysAgo) => ({ createdAt: at(daysAgo), source: "app" as const }));

/** A pattern that recurred over a month, which is the ordinary healthy case. */
const steady = (): ConfidenceEvidence[] =>
  [2, 9, 17, 24, 31].map((daysAgo) => ({ createdAt: at(daysAgo), source: "app" as const }));

/** The same pattern, gone quiet years ago. */
const stale = (): ConfidenceEvidence[] =>
  [700, 707, 715, 722, 729].map((daysAgo) => ({ createdAt: at(daysAgo), source: "app" as const }));

function selectionFor(evidence: ConfidenceEvidence[], affirmed: boolean): number {
  const confidence = computeSignalConfidence(evidence, NOW, { affirmed });
  return computeSelectionScore({
    confidence,
    evidenceCount: evidence.length,
    lastEvidenceAt: evidence.map((row) => row.createdAt).sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
    comebackBonus: 0,
    now: NOW,
  });
}

describe("what saying yes buys", () => {
  it("lifts a claim above an identical one nobody answered", () => {
    /* THE CLAIM THE RECEIPT MAKES, and the only one it is allowed to make.
       Two signals alike in every respect except that the person said "yes,
       this is me" to one of them. If this ever stops being true, the words on
       screen become a promise the pipeline does not keep. */
    for (const shape of [thin, steady]) {
      expect(selectionFor(shape(), true)).toBeGreaterThan(selectionFor(shape(), false));
    }
  });

  it("does the most for the weakest claim, which is where the deadlock was", () => {
    /**
     * MEASURED 2026-10-10, and this is the shape of the fix rather than a
     * side effect of it.
     *
     *   thin   (2 saves)          confidence 50.0 -> 80.0   selection 47.8 -> 61.3
     *   steady (5 over a month)   confidence 89.0 -> 100.0  selection 75.8 -> 80.8
     *
     * The strong claim gains little because confidence is already near its
     * ceiling and the bonus is bounded — it has nowhere to go. The thin claim
     * gains the full 30, which is +13.5 of selection once the 0.45 weight is
     * applied. That is the right way round: a claim with five pieces of
     * evidence over a month does not need your help to be seen, and a claim
     * with two does. The deadlock was precisely that the claims most in need
     * of a verdict were the ones a verdict could never reach.
     *
     * The assertion is on the WEAK case for the same reason. An earlier
     * version of this test measured the strong one, found +5.0, and would
     * have been satisfied by a bonus a third the size — it was reading the
     * confidence cap, not the mechanism.
     */
    const lift = selectionFor(thin(), true) - selectionFor(thin(), false);
    expect(
      lift,
      "affirming a thin claim barely moves it — the deadlock this was meant " +
        "to break is back, and the receipt is overclaiming again",
    ).toBeGreaterThanOrEqual(10);

    /* And the strong claim still moves, just less. It must not REGRESS to
       zero: a ceiling that swallowed the answer entirely would mean the
       people with the most history get the least say. */
    expect(selectionFor(steady(), true)).toBeGreaterThan(selectionFor(steady(), false));
  });

  it("does not make an affirmed claim immortal, which is why the symmetric fix was refused", () => {
    /**
     * THE OTHER HALF, AND THE REASON FOR THE SHAPE OF THE FIX.
     *
     * The symmetric repair was to mirror `SELECTION_DISPUTED_MULTIPLIER` —
     * if not-true multiplies by 0.4, let yes multiply by 1/0.4 = 2.5. It is
     * the obvious move and it is wrong, because the two answers fail
     * differently. Suppression is safe: a signal you called untrue staying
     * down is the outcome you asked for. Amplification is not. An affirmed
     * signal whose evidence went quiet years ago still scores around 47 on
     * support and confidence alone, and 47 x 2.5 pins to the 100 cap
     * permanently — one true sentence about yourself, and the top of your
     * own reading never changes again.
     *
     * A bounded bonus rides through selection's 0.45 weight and keeps
     * decaying with everything else. This is that difference, measured: a
     * long-quiet claim you AGREED with still loses to a live one you have
     * never answered.
     */
    const affirmedButQuiet = selectionFor(stale(), true);
    const freshAndUnanswered = selectionFor(steady(), false);
    expect(
      affirmedButQuiet,
      "an affirmed claim that went quiet is now outranking a live one — " +
        "affirmation has become a ratchet, and the reading has stopped moving",
    ).toBeLessThan(freshAndUnanswered);
  });

  it("still never subtracts for an unanswered claim", () => {
    /* THE INVARIANT THE BONUS WAS BUILT AROUND, restated because raising it
       raises the cost of breaking it: not answering is not a verdict.
       Silence must never be read as doubt — most signals are unanswered most
       of the time, and a product that quietly punished that would be
       punishing people for not having opinions yet. */
    const quiet = computeSignalConfidence(steady(), NOW, {});
    const explicitlyUnaffirmed = computeSignalConfidence(steady(), NOW, { affirmed: false });
    expect(quiet).toBe(explicitlyUnaffirmed);
    expect(quiet).toBeGreaterThan(0);
  });
});
