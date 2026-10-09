/**
 * WHAT MOVED BETWEEN TWO READINGS.
 *
 * The whole input to the redesigned "what changed": one passage with the new
 * words lit, and what the rewrite dropped printed faded beneath it. Four
 * facts it has to get right, and one it has to refuse.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing, and nothing needs replacing.
 * `driftWords` is a pure function over two strings — no clock, no network, no
 * storage, no DOM. The only seam a suite could introduce here would be one it
 * invented first, and a fixture standing in for a string comparison would be
 * testing the fixture.
 */
import { describe, expect, it } from "vitest";

import { driftWords } from "../src/lib/drift";

const lit = (text: string, before: string | null) =>
  driftWords(before, text).words.filter((word) => word.arrived).map((word) => word.text);

describe("what moved between two readings", () => {
  it("lights only the words this reading introduced", () => {
    expect(lit("you keep small decisions", "you keep decisions")).toEqual(["small"]);
  });

  it("carries a repeated word only as many times as it was there before", () => {
    /* Without this, any passage that repeats a common word reads as having
       changed less than it did. */
    const drift = driftWords("a small thing", "a small small thing");
    expect(drift.words.map((word) => word.arrived)).toEqual([false, false, true, false]);
  });

  it("treats a comma and a capital as the same word surviving", () => {
    expect(lit("Small, and quiet", "small and quiet")).toEqual([]);
  });

  it("keeps what the rewrite dropped, spelled as it stood", () => {
    const drift = driftWords("you keep Bigger things", "you keep things");
    expect(drift.left).toEqual(["Bigger"]);
  });

  it("says nothing moved when nothing moved", () => {
    expect(driftWords("one two three", "three two one").same).toBe(true);
  });

  it("refuses to call a first reading all-new", () => {
    /* A first reading has nothing to have drifted from, and lighting every
       word of it would announce a change that never happened. */
    expect(lit("the very first words", null)).toEqual([]);
  });
});
