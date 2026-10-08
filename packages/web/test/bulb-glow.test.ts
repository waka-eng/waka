/**
 * THE BULB DIMS, AND NEVER GOES OUT.
 *
 * The character is a lightbulb and the less a person is keeping, the dimmer it
 * burns. Four facts, each of which a careless edit would break:
 *
 *   1. Kept just now = full brightness. If the top of the range is not 1 the
 *      bulb can never look "on", and the whole channel loses its ceiling.
 *   2. One half-life of silence spends half the range ABOVE the floor — not
 *      half of 1. The floor is not part of what decays; it is what is left
 *      when everything decayable is gone.
 *   3. It never reaches dark. "Fading never deletes" is a founder law, and a
 *      bulb at zero says "broken" or "off", which is a claim about a person
 *      rather than about their week.
 *   4. It is monotonic. More silence is never more light — the one property
 *      that makes brightness readable as the passage of time.
 *
 * And a clock that runs backwards brightens rather than blanks: a second of
 * skew between a phone and the server must not put out the light.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing, and nothing needs replacing.
 * `bulbGlow` is a pure function of one number — no clock, no fetch, no DOM, no
 * store. The real implementation IS what runs here, so there is no layer a
 * fixture could stand in for and no way for this suite to go green against a
 * substitute. Where the day count comes from is a different question, and it
 * is answered where that fetch lives rather than here.
 */
import { describe, expect, it } from "vitest";

import { BULB_FLOOR, FIELD_DECAY_HALF_LIFE_DAYS, bulbGlow } from "../src/lib/aliveness";

describe("the bulb's glow", () => {
  it("burns full when something was kept just now", () => {
    expect(bulbGlow(0)).toBeCloseTo(1, 10);
  });

  it("spends half the range above the floor in one half-life", () => {
    /* Deliberately not 0.5: the floor is what remains, so the decay runs
       between BULB_FLOOR and 1 rather than between 0 and 1. */
    const expected = BULB_FLOOR + (1 - BULB_FLOOR) * 0.5;
    expect(bulbGlow(FIELD_DECAY_HALF_LIFE_DAYS)).toBeCloseTo(expected, 10);
  });

  it("never goes dark, however long the silence", () => {
    expect(bulbGlow(365)).toBeGreaterThan(0);
    expect(bulbGlow(365)).toBeCloseTo(BULB_FLOOR, 4);
    expect(bulbGlow(100_000)).toBeGreaterThanOrEqual(BULB_FLOOR);
  });

  it("only ever dims as the silence grows", () => {
    let previous = bulbGlow(0);
    for (let day = 1; day <= 60; day += 1) {
      const now = bulbGlow(day);
      expect(now).toBeLessThan(previous);
      previous = now;
    }
  });

  it("treats a backwards clock as just now", () => {
    /* Phone and server disagreeing by a moment must brighten, never blank. */
    expect(bulbGlow(-3)).toBeCloseTo(1, 10);
    expect(bulbGlow(Number.NaN)).toBeCloseTo(1, 10);
  });

  it("stays inside the channel at every input", () => {
    for (const days of [0, 0.5, 1, 7, 30, 90, 1000]) {
      const glow = bulbGlow(days);
      expect(glow).toBeGreaterThanOrEqual(BULB_FLOOR);
      expect(glow).toBeLessThanOrEqual(1);
    }
  });
});
