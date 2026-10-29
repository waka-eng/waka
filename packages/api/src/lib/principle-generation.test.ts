/**
 * The pure halves of layer-4 generation: the longevity bar, rank stickiness,
 * redemption, and reconciliation. The database paths are exercised end to end
 * by tools/e2e/principles.ts; what belongs here is the arithmetic no live run
 * can pin exactly — the same division of labor as signal-derivation.test.ts.
 */

import { describe, expect, it } from "vitest";

import {
  computeCitationEligibility,
  nextRank,
  PRINCIPLE_MIN_SIGNALS,
  PRINCIPLE_MIN_SPAN_DAYS,
  PRINCIPLE_MIN_TOM_APPEARANCES,
  promoteDecision,
  reconcileAction,
  type CitationEvidence,
} from "./principle-generation.js";

const NOW = new Date("2026-08-18T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function citation(
  signalId: string,
  daysAgo: number[],
  tomVersionIds: string[],
): CitationEvidence {
  return {
    signalId,
    statement:signalId,
    evidenceAt: daysAgo.map((d) => new Date(NOW.getTime() - d * DAY)),
    tomVersionIds,
  };
}

/** A set that clears every bar exactly: 3 signals, 60-day span, 5 versions. */
function clearingSet(): CitationEvidence[] {
  return [
    citation("s1", [60, 40], ["v1", "v2"]),
    citation("s2", [30, 20], ["v3", "v4"]),
    citation("s3", [10, 0], ["v5"]),
  ];
}

describe("the longevity bar", () => {
  it("passes a set that clears every test", () => {
    const verdict = computeCitationEligibility(clearingSet(), NOW);
    expect(verdict).toMatchObject({
      eligible: true,
      distinctSignals: 3,
      tomAppearances: 5,
    });
    expect(verdict.spanDays).toBeCloseTo(60, 5);
  });

  it("fails on too few distinct signals, whatever their depth", () => {
    // Two signals with abundant evidence and versions — depth is not breadth.
    const set = [
      citation("s1", [90, 60, 30, 0], ["v1", "v2", "v3"]),
      citation("s2", [80, 45, 10], ["v4", "v5", "v6"]),
    ];
    const verdict = computeCitationEligibility(set, NOW);
    expect(verdict.distinctSignals).toBe(2);
    expect(verdict.eligible).toBe(false);
  });

  it("allows supported initial principles without waiting 45 days", () => {
    const set = [
      citation("s1", [5, 4], ["v1", "v2"]),
      citation("s2", [3, 2], ["v3", "v4"]),
      citation("s3", [1, 0], ["v5"]),
    ];
    const verdict = computeCitationEligibility(set, NOW);
    expect(verdict.spanDays).toBe(5);
    expect(verdict.eligible).toBe(true);
  });

  it('counts normalized duplicate statements once even when their IDs differ',()=>{
    const set=clearingSet().map((row,index)=>({...row,statement:['Same choice','  same   choice  ','ＳＡＭＥ choice'][index]!}));
    expect(computeCitationEligibility(set,NOW)).toMatchObject({distinctSignals:1,eligible:false});
  });

  it("fails without enough top-of-mind survivals", () => {
    const set = [
      citation("s1", [60, 40], []),
      citation("s2", [30, 20], []),
      citation("s3", [10, 0], []),
    ];
    const verdict = computeCitationEligibility(set, NOW);
    expect(verdict.tomAppearances).toBe(0);
    expect(verdict.eligible).toBe(false);
  });

  /** Span is the UNION's lifetime; appearances are the UNION's versions. */
  it("measures the theme, not any one signal", () => {
    // No single signal spans 45 days or hits 5 versions; together they do.
    const set = [
      citation("s1", [60, 55], ["v1", "v2"]),
      citation("s2", [35, 30], ["v2", "v3", "v4"]),
      citation("s3", [5, 0], ["v5"]),
    ];
    const verdict = computeCitationEligibility(set, NOW);
    expect(verdict.spanDays).toBeCloseTo(60, 5);
    expect(verdict.tomAppearances).toBe(5);
    expect(verdict.eligible).toBe(true);
  });

  it("is empty-safe", () => {
    expect(computeCitationEligibility([], NOW)).toMatchObject({
      eligible: false,
      distinctSignals: 0,
      spanDays: 0,
      tomAppearances: 0,
    });
  });

  it("keeps the bars ordered sanely, whatever the tuning", () => {
    expect(PRINCIPLE_MIN_SIGNALS).toBeGreaterThan(0);
    expect(PRINCIPLE_MIN_SPAN_DAYS).toBe(0);
    expect(PRINCIPLE_MIN_TOM_APPEARANCES).toBeGreaterThan(0);
  });
});

describe("rank stickiness", () => {
  /**
   * Generation's entire vocabulary for rank is "append": this function is
   * the only rank arithmetic it owns, so proving it appends proves the
   * owner's arrangement can never be re-sorted by a nightly run.
   */
  it("appends at the bottom, always", () => {
    expect(nextRank([])).toBe(1);
    expect(nextRank([{ rank: 1 }, { rank: 2 }, { rank: 3 }])).toBe(4);
  });

  it("appends below owner-made gaps rather than filling them", () => {
    // The owner deleted rank 2; a new principle must not take the dead slot
    // and thereby jump the queue.
    expect(nextRank([{ rank: 1 }, { rank: 3 }, { rank: 7 }])).toBe(8);
  });
});

describe("redemption", () => {
  it("promotes only an aspirational principle, and only on the bar", () => {
    expect(promoteDecision("aspirational", true)).toBe(true);
    expect(promoteDecision("aspirational", false)).toBe(false);
    expect(promoteDecision("held", true)).toBe(false);
    expect(promoteDecision("contested", true)).toBe(false);
  });
});

describe("reconciliation after evidence loss", () => {
  it("preserves a generated principle once its owner has edited the wording", () => {
    const edited = { origin: "minted" as const, state: "held" as const, lockedAt: NOW };
    expect(reconcileAction(edited, false)).toBe("demote");
  });
  it("keeps anything still clearing the bar", () => {
    expect(reconcileAction({ origin: "minted", state: "held" }, true)).toBe("keep");
    expect(reconcileAction({ origin: "declared", state: "contested" }, true)).toBe("keep");
  });

  /** The owner's words stand, undemonstrated again — never deleted. */
  it("demotes a declared principle below the bar", () => {
    expect(reconcileAction({ origin: "declared", state: "held" }, false)).toBe("demote");
    expect(reconcileAction({ origin: "declared", state: "contested" }, false)).toBe("demote");
  });

  /** A machine claim without support has no words worth keeping. */
  it("removes a minted principle below the bar", () => {
    expect(reconcileAction({ origin: "minted", state: "held" }, false)).toBe("remove");
    expect(reconcileAction({ origin: "minted", state: "contested" }, false)).toBe("remove");
  });

  it("never touches an aspirational row — it claims no demonstration", () => {
    expect(reconcileAction({ origin: "declared", state: "aspirational" }, false)).toBe("keep");
  });
});
