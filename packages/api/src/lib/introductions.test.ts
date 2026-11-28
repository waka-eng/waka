/** The introduction matcher's comparison: plain word overlap between two
 * principle statements, no model call. Pure, so no database. */
import { describe, expect, it } from "vitest";

import { OVERLAP_FLOOR, introductionsAvailable, negated, principleOverlap, principleWords, stem } from "./introductions.js";

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

describe("negation and word forms", () => {
  it("keeps negations, and never pairs a principle with its negation", () => {
    expect(negated("Don't plan big things.")).toBe(true);
    expect(negated("Don’t plan big things.")).toBe(true);
    expect(negated("Never plan big things.")).toBe(true);
    expect(negated("I won't wait for permission.")).toBe(true);
    expect(negated("큰 계획은 세우지 않는다")).toBe(true);
    expect(negated("Plan big things.")).toBe(false);
    expect(principleOverlap("Plan the big launch carefully before you build.", "Don't plan the big launch carefully before you build.")).toBe(0);
    expect(principleOverlap("Never skip the hard conversation with a friend.", "Don't skip the hard conversation with a friend."))
      .toBeGreaterThanOrEqual(OVERLAP_FLOOR);
  });

  it("reads Korean negation as a word or an ending, never a piece of another word", () => {
    expect(negated("잘못을 인정한다")).toBe(false);
    expect(negated("내 실수를 인정한다")).toBe(false);
    expect(negated("남의 실수를 탓하지 않는다")).toBe(true);
    expect(negated("약속을 못 지킨다")).toBe(true);
    expect(negated("변명 없이 사과한다")).toBe(true);
    expect(negated("끊임없이 배운다")).toBe(false);
    expect(negated("아낌없이 칭찬한다")).toBe(false);
    expect(negated("마음 안의 목소리를 듣는다")).toBe(false);
  });

  it("does not let Korean endings and function words make two principles alike", () => {
    expect(principleOverlap("느리게 사는 것이 중요하다", "정직하게 말하는 것이 중요하다")).toBe(0);
    expect(principleOverlap("큰 계획보다 작은 일을 끝내는 쪽을 고른다", "작은 일을 끝내는 것이 큰 계획보다 낫다")).toBeGreaterThanOrEqual(OVERLAP_FLOOR);
  });

  it("reads an apostrophe as part of the word", () => {
    expect([...principleWords("Don't hide the work.")]).not.toContain("don");
  });

  it("lands plural, -ing, -ed and a silent e on one stem", () => {
    expect(stem("values")).toBe(stem("value"));
    expect(stem("creates")).toBe(stem("create"));
    expect(stem("creating")).toBe(stem("create"));
    expect(stem("planning")).toBe(stem("plan"));
    expect(stem("finished")).toBe(stem("finish"));
    expect(stem("wishes")).toBe(stem("wish"));
    expect(stem("adding")).toBe(stem("add"));
    expect(stem("speeding")).toBe(stem("speed"));
    expect(stem("speed")).toBe("speed");
    expect(stem("running")).toBe(stem("run"));
    expect(stem("planned")).toBe(stem("plan"));
    expect(stem("focusing")).toBe(stem("focus"));
    expect(stem("focused")).toBe(stem("focus"));
    expect(stem("focus")).toBe("focus");
    expect(stem("basis")).toBe("basis");
    expect(stem("status")).toBe("status");
    expect(principleOverlap("Create value for the people you serve.", "Creating values that serve people matters.")).toBeGreaterThanOrEqual(OVERLAP_FLOOR);
  });
});

describe("the flag", () => {
  it("is off unless WAKA_INTRODUCTIONS is exactly 1", () => {
    expect(introductionsAvailable({})).toBe(false);
    expect(introductionsAvailable({ WAKA_INTRODUCTIONS: "true" })).toBe(false);
    expect(introductionsAvailable({ WAKA_INTRODUCTIONS: "1" })).toBe(true);
  });
});
