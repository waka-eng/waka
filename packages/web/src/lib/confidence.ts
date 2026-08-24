/**
 * CONFIDENCE, AS A STATE — because the law says numerals never render.
 *
 * `docs/data-model.md` puts it plainly: **confidence is the light.** In the
 * world that is literal — a signal's brightness IS its confidence, and no
 * number is drawn anywhere. The flat surfaces have no light channel, so they
 * printed the number instead: `3 behind it · 42% · still forming`.
 *
 * WHAT WAS ACTUALLY WRONG WITH THAT. Not that it was ugly. `42%` is a
 * quantity with no unit and no scale in sight — 42% of what, out of what,
 * good or bad? A person cannot read it without a legend, and there was none.
 * Meanwhile the two things beside it on the same line were already states in
 * words, so the line mixed registers mid-sentence.
 *
 * WHY THREE BANDS AND WHERE THEY ARE CUT. Not thirds. `docs/generation.md`
 * gives the formula:
 *
 *     confidence = SUPPORT(55) x evidence, saturating at 6
 *                + SPREAD(30)  x time span, saturating at 30 days
 *                + RECENCY(15) x decay, half-life 45 days
 *                + 8 when evidence spans both app and agent
 *
 * so the number has structure, and the cuts follow it rather than arithmetic:
 *
 *   - **40** is just above where a pattern lands the day it is born. Three
 *     captures today, no span yet, is `55 x (3/6) + ~0 + 15` = about 42 —
 *     which is exactly the 42% that was on screen when this was written.
 *     Below that line a signal is one or two mentions and a fresh clock.
 *   - **70** is past what support alone can buy. Saturated evidence with no
 *     span at all tops out near 70, so nothing reaches this band without
 *     having recurred ACROSS TIME, which is the thing the product is looking
 *     for. One mention is a thought; three are a pattern; three across a
 *     season is a shape.
 *
 * WHY THESE WORDS. They order themselves in plain English — nobody needs a
 * key to know `strong` is more than `faint`, and that is the whole of what
 * `42%` failed to do. They also describe the pattern's GRIP rather than the
 * machine's certainty: this number is a fact about how much evidence a person
 * has produced and how it is spread, not about how sure a model is, and
 * "confidence" as a word invites exactly the wrong reading.
 *
 * DELIBERATELY NOT MERGED WITH `status`. A signal is `emerging` until it has
 * three pieces of evidence and `active` after — a threshold on a COUNT. This
 * is how hard it holds right now. A signal can be `steady · still forming`
 * (well-supported by two rich captures, short of the count bar) and that is
 * not a contradiction, it is two different facts. Collapsing them into one
 * word would lose the one the person can act on.
 */

/** The bands, in the order a person reads them. Canon name, world words. */
export type ConfidenceBand = "faint" | "steady" | "strong";

/**
 * Where support alone runs out. Saturated evidence (6) with no time span and
 * a fresh clock lands near 70, so nothing above this recurred in one sitting.
 */
export const CONFIDENCE_BAND_STRONG = 70;

/**
 * Just above where a pattern lands on the day it is born: three captures, no
 * spread, full recency, is about 42.
 */
export const CONFIDENCE_BAND_STEADY = 40;

/**
 * Read a confidence score as the state it stands for.
 *
 * Total order, no gaps: anything below `CONFIDENCE_BAND_STEADY` is faint,
 * including the zero a signal carries before its first read.
 */
export function confidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= CONFIDENCE_BAND_STRONG) return "strong";
  if (confidence >= CONFIDENCE_BAND_STEADY) return "steady";
  return "faint";
}

/**
 * The message key for a band, so the surface never spells one out.
 *
 * The three keys are written as literals rather than built from the band name
 * because `t()` takes a key union off the message file: a `string` here
 * compiles to an error at every call site, which is the type system doing its
 * job, and a template that happened to produce a valid key would compile
 * while silently accepting a typo the day a band is renamed.
 */
export function confidenceBandKey(
  confidence: number,
): "signalHoldFaint" | "signalHoldSteady" | "signalHoldStrong" {
  const band = confidenceBand(confidence);
  if (band === "strong") return "signalHoldStrong";
  if (band === "steady") return "signalHoldSteady";
  return "signalHoldFaint";
}
