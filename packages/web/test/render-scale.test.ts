/**
 * THE WORLD IS DRAWN AT THE SCREEN'S OWN RESOLUTION.
 *
 * The defect this holds shut, measured on 2026-09-08: a 393x852 phone at
 * devicePixelRatio 3 was given a 786x1704 backing store, so the compositor
 * upscaled every drawn pixel by half again on the way to the glass. The
 * founder read it off the character — "super broken and blurry" — which is
 * where a 1.5x resample first becomes visible, but it was the whole world.
 *
 * The three cases below are the three that matter: the phone that reported
 * it, the desktop that must not be made softer by the fix, and the ceiling
 * that keeps the fix from being a licence for an unbounded backing store.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). Nothing. `dprOf` takes the ratio as an
 * argument precisely so this arithmetic can be checked without a browser to
 * pretend to be one.
 */

import { describe, expect, it } from "vitest";

import { CEILING, MAX_SCALE, dprOf } from "../src/canvas/scale";

describe("render scale", () => {
  it("gives a phone its own three, which is the bug that was reported", () => {
    expect(dprOf(393, 852, 3)).toBe(3);
    /* and the backing store that follows from it is smaller than what a
       retina laptop has always drawn — the old cap was not protecting
       anything, it was only costing sharpness */
    const phone = 393 * 852 * 3 * 3;
    const laptop = 1440 * 900 * 2 * 2;
    expect(phone).toBeLessThan(laptop);
  });

  it("changes nothing for a screen that was already sharp", () => {
    /* every one of these renders at its own ratio today and must keep it */
    expect(dprOf(1100, 780, 1)).toBe(1);
    expect(dprOf(1100, 780, 2)).toBe(2);
    expect(dprOf(1440, 900, 2)).toBe(2);
    expect(dprOf(2560, 1440, 2)).toBe(2);
  });

  it("stops at three, however much a device claims", () => {
    expect(dprOf(393, 852, 4)).toBe(MAX_SCALE);
    expect(dprOf(393, 852, 8)).toBe(MAX_SCALE);
  });

  it("never trusts a ratio that is not a number", () => {
    expect(dprOf(393, 852, 0)).toBe(1);
    expect(dprOf(393, 852, -2)).toBe(1);
    expect(dprOf(393, 852, Number.NaN)).toBe(1);
    /* Infinity is not a big ratio, it is a broken one — it reads as "no
       answer" and takes the floor, not the ceiling */
    expect(dprOf(393, 852, Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("steps down rather than allocating a surface nothing can hold", () => {
    /* a hypothetical 4000x3000 window at 3 would ask for 108 megapixels */
    const huge = dprOf(4000, 3000, 3);
    expect(huge).toBeLessThan(MAX_SCALE);
    expect(4000 * 3000 * huge * huge).toBeLessThanOrEqual(CEILING * 1_000_000 + 1);
    /* and it never goes below CSS resolution, which would be a bug wearing a
       budget's clothes */
    expect(dprOf(40000, 30000, 3)).toBe(1);
  });
});
