import { describe, expect, it } from "vitest";

import { calculateLocalInspirationScoreSnapshot } from "../src/lib/inspiration-scores.js";

const NOW = new Date("2026-05-12T00:00:00.000Z");

function daysAgo(days: number) {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

describe("local inspiration score snapshots", () => {
  it("uses maturity/time-gap direction instead of recency", () => {
    const base = {
      text: "",
      kind: null,
      category: null,
      hasReflection: false,
      now: NOW,
    };

    expect(
      calculateLocalInspirationScoreSnapshot({
        ...base,
        createdAt: daysAgo(0),
      }),
    ).toEqual({ importanceScore: 0, wowScore: 0 });

    expect(
      calculateLocalInspirationScoreSnapshot({
        ...base,
        createdAt: daysAgo(30),
      }),
    ).toEqual({ importanceScore: 6, wowScore: 3 });

    expect(
      calculateLocalInspirationScoreSnapshot({
        ...base,
        createdAt: daysAgo(180),
      }),
    ).toEqual({ importanceScore: 10, wowScore: 5 });
  });

  it("does not use coarse kind/category metadata as context score", () => {
    const sparse = calculateLocalInspirationScoreSnapshot({
      text: "same saved thought",
      kind: null,
      category: null,
      createdAt: daysAgo(30),
      hasReflection: false,
      now: NOW,
    });

    const categorized = calculateLocalInspirationScoreSnapshot({
      text: "same saved thought",
      kind: "quote",
      category: 7,
      createdAt: daysAgo(30),
      hasReflection: false,
      now: NOW,
    });

    expect(categorized).toEqual(sparse);
  });
});
