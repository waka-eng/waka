/**
 * The pure halves of match-or-mint: which similarities attach, which ask the
 * judge, which mint — and what evidence makes confidence move. The judge call
 * itself and the DB paths are exercised end to end by tools/e2e/signals.ts;
 * what belongs here is the arithmetic no live run can pin down exactly.
 */

import { describe, expect, it } from "vitest";

import {
  classifyMatch,
  computeSignalConfidence,
  CONFIDENCE_SOURCE_DIVERSITY_BONUS,
  SIGNAL_MATCH_MIN_COSINE,
  SIGNAL_MERGE_JUDGE_MIN_COSINE,
} from "./signal-derivation.js";

const NOW = new Date("2026-08-15T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function evidence(daysAgo: number, source: "app" | "agent" = "app") {
  return { createdAt: new Date(NOW.getTime() - daysAgo * DAY), source };
}

describe("classifyMatch", () => {
  it("attaches at and above the match bar", () => {
    expect(classifyMatch(SIGNAL_MATCH_MIN_COSINE)).toBe("attach");
    expect(classifyMatch(0.99)).toBe("attach");
  });

  it("asks the judge inside the band", () => {
    expect(classifyMatch(SIGNAL_MERGE_JUDGE_MIN_COSINE)).toBe("judge");
    expect(classifyMatch(0.8)).toBe("judge");
    expect(classifyMatch(SIGNAL_MATCH_MIN_COSINE - 0.0001)).toBe("judge");
  });

  it("mints below the band", () => {
    expect(classifyMatch(SIGNAL_MERGE_JUDGE_MIN_COSINE - 0.0001)).toBe("mint");
    expect(classifyMatch(0)).toBe("mint");
  });

  /**
   * Null means the vectors could not be compared — a missing embedding must
   * not look like a confident decision, and the visible mistake is the mint.
   */
  it("mints when similarity is unknowable", () => {
    expect(classifyMatch(null)).toBe("mint");
  });

  it("keeps the band ordered, whatever the tuning", () => {
    expect(SIGNAL_MERGE_JUDGE_MIN_COSINE).toBeLessThan(SIGNAL_MATCH_MIN_COSINE);
  });
});

describe("computeSignalConfidence", () => {
  it("is zero with no evidence", () => {
    expect(computeSignalConfidence([], NOW)).toBe(0);
  });

  it("grows with support and spread", () => {
    const thin = computeSignalConfidence([evidence(0)], NOW);
    const spread = computeSignalConfidence(
      [evidence(30), evidence(20), evidence(10), evidence(0)],
      NOW,
    );
    expect(spread).toBeGreaterThan(thin);
  });

  it("fades as a signal goes quiet", () => {
    const fresh = computeSignalConfidence([evidence(10), evidence(0)], NOW);
    const stale = computeSignalConfidence([evidence(100), evidence(90)], NOW);
    expect(fresh).toBeGreaterThan(stale);
  });

  /**
   * The person's own saves and an agent's observations agreeing is evidence
   * neither could supply alone — corroboration adds.
   */
  it("credits corroboration across capture sources", () => {
    const solo = computeSignalConfidence([evidence(10), evidence(0)], NOW);
    const corroborated = computeSignalConfidence(
      [evidence(10, "app"), evidence(0, "agent")],
      NOW,
    );
    expect(corroborated - solo).toBe(CONFIDENCE_SOURCE_DIVERSITY_BONUS);
  });

  /** A weight would cap every solo human below 100 forever; a bonus must not. */
  it("lets a single-source profile still reach full confidence", () => {
    const saturated = computeSignalConfidence(
      Array.from({ length: 8 }, (_, i) => evidence(i * 5)),
      NOW,
    );
    expect(saturated).toBeGreaterThanOrEqual(97);
  });

  it("never exceeds 100 even with the bonus", () => {
    const maxed = computeSignalConfidence(
      Array.from({ length: 10 }, (_, i) => evidence(i * 4, i % 2 ? "agent" : "app")),
      NOW,
    );
    expect(maxed).toBeLessThanOrEqual(100);
  });
});

describe("decay is real: the same evidence scores lower as it ages", () => {
  /**
   * The bug this pins against: confidence used to be served from a snapshot
   * written the moment evidence landed — recency term at its peak, frozen
   * there forever. Reads now recompute with the current clock, so this
   * property is what a user actually observes.
   */
  it("fades a signal that goes quiet, without any write", () => {
    const evidence = [40, 27, 12, 0].map((daysAgo) => ({
      createdAt: new Date(NOW.getTime() - daysAgo * DAY),
      source: "app" as const,
    }));

    const atWrite = computeSignalConfidence(evidence, NOW);
    const after45quiet = computeSignalConfidence(
      evidence,
      new Date(NOW.getTime() + 45 * DAY),
    );
    const after180quiet = computeSignalConfidence(
      evidence,
      new Date(NOW.getTime() + 180 * DAY),
    );

    expect(after45quiet).toBeLessThan(atWrite);
    expect(after180quiet).toBeLessThan(after45quiet);
    // Support and spread do not decay, so it floors instead of vanishing:
    // dormant patterns stay reachable rather than deleted by arithmetic.
    expect(after180quiet).toBeGreaterThan(0);
  });
});
