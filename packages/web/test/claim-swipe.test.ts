/**
 * THE SWIPE DECIDES THE SAME WAY FOR A THUMB AND A MOUSE.
 *
 * Founder, 2026-10-15: "swipe the card towards the character up to say yes
 * and swipe it down to say no ... drag on laptop, swipe on mobile."
 *
 * `lib/claim-swipe.ts` takes its measurements as arguments so the rule can
 * be checked here without mounting a card — the same reason `canvas/scale.ts`
 * takes a device ratio. Every case is a release the component could hand it.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. The decision is pure.
 */
import { describe, expect, it } from "vitest";

import { COMMIT_FRACTION, FLICK_MIN_PX, FLICK_VELOCITY, decideSwipe, swipeProgress } from "../src/lib/claim-swipe";

const HEIGHT = 120;

describe("decideSwipe", () => {
  it("commits up past the fraction of the card's own height, slowly", () => {
    expect(decideSwipe({ dy: -(HEIGHT * COMMIT_FRACTION), height: HEIGHT, velocity: 0 })).toBe("up");
  });

  it("commits down past the same distance", () => {
    expect(decideSwipe({ dy: HEIGHT * COMMIT_FRACTION + 1, height: HEIGHT, velocity: 0 })).toBe("down");
  });

  it("settles back short of the distance when the move was slow", () => {
    expect(decideSwipe({ dy: -(HEIGHT * COMMIT_FRACTION) + 1, height: HEIGHT, velocity: -0.1 })).toBeNull();
  });

  it("commits a short, fast flick in the direction of travel", () => {
    expect(decideSwipe({ dy: -FLICK_MIN_PX, height: HEIGHT, velocity: -FLICK_VELOCITY })).toBe("up");
    expect(decideSwipe({ dy: FLICK_MIN_PX, height: HEIGHT, velocity: FLICK_VELOCITY })).toBe("down");
  });

  it("does not let a fast twitch of a few pixels count as an answer", () => {
    expect(decideSwipe({ dy: -(FLICK_MIN_PX - 1), height: HEIGHT, velocity: -2 })).toBeNull();
  });

  it("past the distance, reads the direction from where the card is", () => {
    /* Dragged well down, then thrown back up a little: it is still far down,
       and that is the answer. */
    expect(decideSwipe({ dy: HEIGHT, height: HEIGHT, velocity: -1 })).toBe("down");
  });

  it("short of the distance, treats a flick back toward the middle as a change of mind", () => {
    expect(decideSwipe({ dy: FLICK_MIN_PX + 1, height: HEIGHT, velocity: -1 })).toBeNull();
    expect(decideSwipe({ dy: FLICK_MIN_PX + 1, height: HEIGHT, velocity: 1 })).toBe("down");
  });

  it("decides nothing when the card has no height to measure against", () => {
    expect(decideSwipe({ dy: -40, height: 0, velocity: -0.2 })).toBeNull();
  });
});

describe("swipeProgress", () => {
  it("rises from 0 to 1 over the commit distance and never past it", () => {
    expect(swipeProgress(0, HEIGHT)).toBe(0);
    expect(swipeProgress(-(HEIGHT * COMMIT_FRACTION) / 2, HEIGHT)).toBeCloseTo(0.5);
    expect(swipeProgress(HEIGHT * 2, HEIGHT)).toBe(1);
    expect(swipeProgress(30, 0)).toBe(0);
  });
});
