import { describe, expect, it } from "vitest";

import { FLOURISHES, FLOURISH_MS, flourishPose, nextFlourish } from "../src/character/flourish";

/* Founder, 2026-11-20: a new line on the creature plays a move, "different
   every time". */
describe("the creature's move for a new line", () => {
  it("never plays the same move twice in a row", () => {
    let last = null as ReturnType<typeof nextFlourish> | null;
    for (let i = 0; i < 200; i += 1) {
      const next = nextFlourish(last);
      expect(next).not.toBe(last);
      last = next;
    }
  });

  it("reaches every move", () => {
    const seen = new Set(FLOURISHES.map((_, i) => nextFlourish(null, () => i / FLOURISHES.length)));
    expect([...seen].sort()).toEqual([...FLOURISHES].sort());
  });

  it.each(FLOURISHES)("%s moves the body midway and rests at both ends", (kind) => {
    const still = { lift: 0, dx: 0, rot: 0, sq: 0, sx: 1, sy: 1 };
    expect(flourishPose(kind, 0, 120)).toEqual(still);
    expect(flourishPose(kind, 1, 120)).toEqual(still);
    const mid = [0.2, 0.3, 0.5].map(t => flourishPose(kind, t, 120));
    expect(mid.some(p => Math.abs(p.lift) + Math.abs(p.dx) + Math.abs(p.rot) + Math.abs(p.sq) + Math.abs(p.sx - 1) + Math.abs(p.sy - 1) > 0.01)).toBe(true);
    expect(FLOURISH_MS[kind]).toBeGreaterThan(300);
  });
});
