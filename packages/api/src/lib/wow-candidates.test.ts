import { describe, expect, it } from "vitest";

import { diversifyWowMomentCandidates, type WowMomentCandidate } from "./wow-candidates.js";

function candidate(id: string, text: string, score: number): WowMomentCandidate {
  return {
    inspiration: {
      id,
      userId: "00000000-0000-4000-8000-000000000001",
      text,
      kind: "note",
      category: 1,
      cluster: "bridge",
      importanceScore: 50,
      wowScore: Math.round(score * 100),
      createdAt: new Date(`2026-06-0${id}T10:00:00.000Z`),
      updatedAt: new Date(`2026-06-0${id}T11:00:00.000Z`),
    },
    embedding: {
      model: "test",
      dimensions: 2,
      inputHash: `hash-${id}`,
      updatedAt: new Date("2026-06-01T12:00:00.000Z"),
    },
    scores: {
      similarityScoreToTrigger: score,
      surpriseSimilarityScoreToTrigger: score,
      timeDistanceScoreToTrigger: score,
      persistedWowScore: score,
      runtimeCandidateScore: score,
    },
  };
}

describe("diversifyWowMomentCandidates", () => {
  it("skips near-identical top candidates when diverse alternatives exist", () => {
    const ranked = [
      candidate("1", "Rooms where unfinished ambition is allowed", 0.99),
      candidate("2", "rooms where unfinished ambition is allowed.", 0.98),
      candidate("3", "Quiet repair belongs near neighbors", 0.7),
    ];

    expect(diversifyWowMomentCandidates(ranked, 2).map((item) => item.inspiration.id)).toEqual([
      "1",
      "3",
    ]);
  });

  it("does not over-filter small archives to zero", () => {
    const ranked = [
      candidate("1", "Rooms where unfinished ambition is allowed", 0.99),
      candidate("2", "rooms where unfinished ambition is allowed.", 0.98),
    ];

    expect(diversifyWowMomentCandidates(ranked, 2).map((item) => item.inspiration.id)).toEqual([
      "1",
      "2",
    ]);
  });
});
