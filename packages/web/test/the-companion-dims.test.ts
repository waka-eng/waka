/**
 * THE COMPANION DIMS WHEN YOU STOP KEEPING THINGS.
 *
 * Founder, 2026-09-22: *"a feature of your character losing light if you
 * don't save inspirations for a while. this motivates user to place
 * themselves in environments to get inspired and stuff and realize they are
 * lacking inspiration in life."*
 *
 * WHY THIS NEEDS A GATE MORE THAN MOST FEATURES. It reverses a ruling, and
 * the ruling it reverses was protecting something real: a body that faded
 * with the archive made the creature look like it was DYING for the crime of
 * the person having had a busy week. `character/tending.ts` quotes that
 * ruling in full. What survives of it is one number — a floor — and a floor
 * is exactly the kind of thing that is correct on the day it is written and
 * quietly wrong two refactors later. Nothing else in the product would
 * notice: a companion sinking to its darkest form still renders, still
 * blinks, and still passes every other suite here.
 *
 * SO THE LOAD-BEARING CASE IS THE ONE ABOUT TIER 0. `BODY_TIERS` is 4 and the
 * frame picks one with `round(bodyLit * 3)`. Tier 0 is the form that reads as
 * gone out, and no silence of any length may reach it. That case walks sixty
 * days rather than checking an endpoint, because a floor can be right at both
 * ends of a range and wrong in the middle of it.
 *
 * AND THE SECOND IS THE ONE ABOUT ARRIVING. A person who has never kept
 * anything has not gone quiet — there is no silence to report. Decaying from
 * zero would hand someone a creature at its dimmest inside their first sixty
 * seconds, which is precisely the shape of bug `tools/e2e/first-sixty.ts`
 * exists to catch, and jsdom can catch it here for free.
 *
 * THE DAY NUMBERS ARE ASSERTED, NOT DESCRIBED. `tending.ts` tells a reader
 * the steps land on day 4.5 and day 12.5. A comment that says that and a
 * function that does something else is worse than no comment, so the two are
 * bound together here, the same way `generation-doc.test.ts` binds the
 * constants to the document that publishes them.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). Nothing, and that is a real answer.
 * `tending.ts` is a pure function that takes its clock as an argument —
 * exactly so this file can ask what a fortnight looks like with no browser,
 * no frame loop and no `Date.now()`. There is no layer beneath it to replace.
 */

import { describe, expect, it } from "vitest";

import { BODY_TIERS } from "../src/character/raster";
import {
  companionLight,
  companionTier,
  tended,
  TENDING_FLOOR,
  TENDING_GRACE_DAYS,
} from "../src/character/tending";
import { DAY_MS } from "../src/lib/num";

/** An arbitrary fixed moment. Nothing here may depend on the real clock. */
const NOW = 1_700_000_000_000;

/** The companion as it stands after `days` of silence. */
const after = (days: number): number => companionTier(NOW - days * DAY_MS, NOW);

describe("the companion dims when you stop keeping things", () => {
  it("greets a person who has never kept anything at full light", () => {
    expect(companionTier(null, NOW)).toBe(BODY_TIERS - 1);
    expect(companionLight(null, NOW)).toBe(1);
    expect(tended(null, NOW)).toBe(1);
  });

  it("never reaches the form that reads as gone out, at any length of silence", () => {
    const reached = new Set<number>();
    for (let days = 0; days <= 60; days += 0.25) reached.add(after(days));
    expect(
      [...reached].sort(),
      "a silence of some length put the creature at its darkest form — " +
        "the floor is what survives of the 2026-08 ruling and it has stopped holding",
    ).not.toContain(0);
    /* and the range is really being walked, so the case above is not vacuous */
    expect(reached.size, "only one tier in sixty days — the light is not moving at all").toBe(3);
    expect([...reached].sort()).toEqual([1, 2, 3]);
  });

  it("costs a busy week nothing", () => {
    expect(after(0)).toBe(BODY_TIERS - 1);
    expect(after(TENDING_GRACE_DAYS)).toBe(BODY_TIERS - 1);
    expect(tended(NOW - TENDING_GRACE_DAYS * DAY_MS, NOW)).toBe(1);
    /* the first step down is later than the grace, not at it */
    expect(after(TENDING_GRACE_DAYS + 0.5)).toBe(BODY_TIERS - 1);
  });

  it("steps down where `tending.ts` tells a reader it does", () => {
    /* The header's own numbers, bound here so the prose cannot drift away
       from the arithmetic. They are edges found by bisection: an earlier
       pass sampled half-days and wrote down 4.5 and 12.5, which were the
       first samples that had ALREADY stepped. This case is what caught it. */
    expect(after(4.0)).toBe(3);
    expect(after(4.2)).toBe(2);
    expect(after(12.1)).toBe(2);
    expect(after(12.4)).toBe(1);
  });

  it("comes back the moment something is kept", () => {
    expect(after(30)).toBe(1);
    expect(companionTier(NOW, NOW)).toBe(BODY_TIERS - 1);
  });

  it("settles on the floor rather than sinking past it", () => {
    const veryLong = companionLight(NOW - 3650 * DAY_MS, NOW);
    expect(veryLong).toBeGreaterThanOrEqual(TENDING_FLOOR);
    expect(veryLong).toBeCloseTo(TENDING_FLOOR, 2);
  });

  it("reads a clock disagreement as tended, not as something stranger", () => {
    /* a memory dated in the future is a clock disagreement, not a fact about a person */
    expect(companionTier(NOW + 5 * DAY_MS, NOW)).toBe(BODY_TIERS - 1);
  });
});
