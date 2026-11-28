/** The introduction matcher's comparison: plain word overlap between two
 * principle statements, no model call. Pure, so no database. */
import { describe, expect, it } from "vitest";

import { OVERLAP_FLOOR, firstName, introductionsAvailable, principleOverlap, principleWords } from "./introductions.js";

describe("principle overlap", () => {
  it("finds one principle said two ways", () => {
    expect(principleOverlap("I would rather finish something small than plan something big.",
      "Finish the small thing instead of planning the big one.")).toBeGreaterThanOrEqual(OVERLAP_FLOOR);
  });

  it("does not pair principles that share only function words or one word", () => {
    expect(principleOverlap("Tell people the truth early, even when it costs you.",
      "I would rather finish something small than plan something big.")).toBe(0);
    expect(principleOverlap("Protect quiet mornings.", "Protect your team from meetings.")).toBe(0);
  });

  it("reads Korean in two-letter pieces, so particles do not hide a shared word", () => {
    expect([...principleWords("작은 일을 끝내는 편")]).toContain("작은");
    expect(principleOverlap("큰 계획보다 작은 일을 끝내는 쪽을 고른다", "작은 일을 끝내는 것이 큰 계획보다 낫다")).toBeGreaterThanOrEqual(OVERLAP_FLOOR);
  });
});

describe("what is said about the other person", () => {
  it("is a first name only", () => {
    expect(firstName("  Jun  Park ")).toBe("Jun");
    expect(firstName("")).toBe("");
  });
});

describe("the flag", () => {
  it("is off unless WAKA_INTRODUCTIONS is exactly 1", () => {
    expect(introductionsAvailable({})).toBe(false);
    expect(introductionsAvailable({ WAKA_INTRODUCTIONS: "true" })).toBe(false);
    expect(introductionsAvailable({ WAKA_INTRODUCTIONS: "1" })).toBe(true);
  });
});
