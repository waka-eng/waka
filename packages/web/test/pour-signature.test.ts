/**
 * THE SIGNATURE THAT DECIDES WHETHER THE WORLD IS BUILT AT ALL.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `nothing`. `pourSignature` is a pure
 * function of an array and a set — no clock, no network, no DOM. There is
 * nothing to stand in for, so nothing is.
 *
 * WHAT IT IS FOR. The frame loop's setup effect is what starts the rAF and
 * attaches every listener the world answers to. It re-runs when this
 * signature changes. The old signature spelled `(inspirations ?? [])`, so an
 * archive that had not answered and an archive that answered EMPTY both
 * signed as `""` — and a brand-new account passes through exactly those two
 * states in that order. If the profiles call happened to land first, the
 * effect ran early against a null archive, bailed, and never saw a reason to
 * run again: the world was drawn, the loading ground was gone, and not one
 * key or press was answered. It flaked a journey one run in four before
 * anyone could name it.
 *
 * So the first case here is the whole gate: swap `NOT_POURED` back for `""`
 * and it fails.
 */
import { describe, expect, it } from "vitest";
import { NOT_POURED, pourSignature } from "../src/space/pour-signature";

const orb = (id: string) => ({ id });
const NONE: ReadonlySet<string> = new Set();

describe("pourSignature", () => {
  it("says something different about an unanswered archive than an empty one", () => {
    const unanswered = pourSignature(null, NONE);
    const empty = pourSignature([], NONE);
    expect(unanswered).not.toBe(empty);
    expect(empty).toBe("");
  });

  it("treats undefined the same as null — neither is an answer", () => {
    expect(pourSignature(undefined, NONE)).toBe(NOT_POURED);
    expect(pourSignature(null, NONE)).toBe(NOT_POURED);
  });

  it("can never be produced by a real archive: no id carries a space", () => {
    /* the sentinel's only job is to be unreachable from the data */
    expect(NOT_POURED).toMatch(/\s/);
    const real = pourSignature([orb("a"), orb("b b")], NONE);
    expect(real).not.toBe(NOT_POURED);
  });

  it("ignores what this session already put in the world", () => {
    /* a keep must not rebuild the world: `born()` already placed that orb */
    const born = new Set(["fresh"]);
    expect(pourSignature([orb("old"), orb("fresh")], born)).toBe("old");
  });

  it("does not change when only a born memory arrives from the server", () => {
    const born = new Set(["fresh"]);
    const before = pourSignature([orb("old")], born);
    const after = pourSignature([orb("old"), orb("fresh")], born);
    expect(after).toBe(before);
  });

  it("does change when the archive really gains something", () => {
    const before = pourSignature([orb("old")], NONE);
    const after = pourSignature([orb("old"), orb("other")], NONE);
    expect(after).not.toBe(before);
  });

  it("does change when the archive loses something — a deletion is a rebuild", () => {
    const before = pourSignature([orb("a"), orb("b")], NONE);
    const after = pourSignature([orb("a")], NONE);
    expect(after).not.toBe(before);
  });

  it("does not depend on the order the archive arrives in", () => {
    expect(pourSignature([orb("b"), orb("a")], NONE)).toBe(
      pourSignature([orb("a"), orb("b")], NONE),
    );
  });
});
