import { describe, expect, it } from "vitest";

import { readingMeaningfullyChanged } from "./group-combination-reading.js";
import {
  directionReviewDecision,
  requiredDirectionContributors,
  requiredDirectionResponses,
} from "./group-direction.js";

describe("shared direction review", () => {
  it("lets half the current room shape a draft, rounded up with a two-person floor", () => {
    expect(requiredDirectionContributors(0)).toBe(0);
    expect(requiredDirectionContributors(1)).toBe(1);
    expect(requiredDirectionContributors(2)).toBe(2);
    expect(requiredDirectionContributors(3)).toBe(2);
    expect(requiredDirectionContributors(4)).toBe(2);
    expect(requiredDirectionContributors(5)).toBe(3);
    expect(requiredDirectionContributors(6)).toBe(3);
    expect(requiredDirectionContributors(9)).toBe(5);
  });

  it("requires a majority and never treats one person as a collective act", () => {
    expect(requiredDirectionResponses(2)).toBe(2);
    expect(requiredDirectionResponses(3)).toBe(2);
    expect(requiredDirectionResponses(4)).toBe(3);
    expect(requiredDirectionResponses(9)).toBe(5);
  });

  it("adopts only when the quorum accepts and nobody is holding the current wording", () => {
    expect(
      directionReviewDecision({ memberCount: 4, acceptCount: 3, keepCurrentCount: 0 }),
    ).toBe("adopted");
    expect(
      directionReviewDecision({ memberCount: 4, acceptCount: 3, keepCurrentCount: 1 }),
    ).toBe("pending");
    expect(
      directionReviewDecision({ memberCount: 4, acceptCount: 1, keepCurrentCount: 3 }),
    ).toBe("kept_current");
  });
});

describe("shared direction versioning", () => {
  const current = {
    ambitionText: "Make ambitious work feel sustainable and social.",
    facets: [{ dimension: "the pace", text: "slow enough to notice" }],
    awayFrom: "performing productivity",
    tension: null,
    nextQuestion: "What would we make together?",
  };

  it("reconfirms formatting-only changes instead of creating noisy versions", () => {
    expect(
      readingMeaningfullyChanged(current, {
        ambition: "  Make ambitious work feel sustainable   and social. ",
        facets: [{ dimension: "the pace", text: "slow enough to notice" }],
        awayFrom: "performing productivity",
        tension: null,
        nextQuestion: "What would we make together?",
      }),
    ).toBe(false);
  });

  it("creates a version when the room's actual direction changes", () => {
    expect(
      readingMeaningfullyChanged(current, {
        ambition: "Create ambitious work through shared experimentation.",
        facets: [{ dimension: "the pace", text: "slow enough to notice" }],
        awayFrom: "performing productivity",
        tension: null,
        nextQuestion: "What would we make together?",
      }),
    ).toBe(true);
  });
});
