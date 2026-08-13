import { describe, expect, it } from "vitest";

import {
  computeNodeDynamics,
  orderByTomRank,
  TOM_STATE_WEIGHTS,
  type NodeDynamicsEventInput,
} from "./node-dynamics.js";

const DAY_MS = 86_400_000;
const NOW = new Date("2026-08-09T12:00:00.000Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

function evidence(nodeId: string, agoDays: number, text = ""): NodeDynamicsEventInput {
  return { nodeId, at: daysAgo(agoDays), textSample: text, channel: "note" };
}

describe("computeNodeDynamics", () => {
  it("labels a fresh steady node emerging and keeps it high in the pool", () => {
    const dynamics = computeNodeDynamics(
      new Map([["n1", [evidence("n1", 60), evidence("n1", 30), evidence("n1", 2)]]]),
      NOW,
    );
    const n1 = dynamics.get("n1")!;
    expect(n1.state).toBe("emerging");
    expect(n1.expectedRetrievability28).toBeGreaterThan(0.5);
    expect(n1.tomRank).toBeCloseTo(
      n1.expectedRetrievability28 * TOM_STATE_WEIGHTS.emerging,
      10,
    );
  });

  it("calls a consummated node resolved, not fading", () => {
    const dynamics = computeNodeDynamics(
      new Map([
        ["n1", [
          evidence("n1", 200),
          evidence("n1", 170),
          evidence("n1", 140, "negotiated the move-in date"),
          evidence("n1", 120, "signed the lease. done with apartment hunting"),
        ]],
      ]),
      NOW,
    );
    expect(dynamics.get("n1")!.state).toBe("resolved");
  });

  it("reads stretching gaps as fading", () => {
    // Gaps 20 → 32 → 55: strictly increasing, last ≥ 1.5 × median; then silence.
    const dynamics = computeNodeDynamics(
      new Map([
        ["n1", [evidence("n1", 300), evidence("n1", 280), evidence("n1", 248), evidence("n1", 193)]],
      ]),
      NOW,
    );
    expect(dynamics.get("n1")!.state).toBe("fading");
  });

  it("discounts silent nodes in the pool without erasing their standing", () => {
    const dynamics = computeNodeDynamics(
      new Map([
        ["hot", [evidence("hot", 20), evidence("hot", 10), evidence("hot", 1)]],
        ["quiet", [evidence("quiet", 300), evidence("quiet", 270), evidence("quiet", 240), evidence("quiet", 210)]],
      ]),
      NOW,
    );
    const hot = dynamics.get("hot")!;
    const quiet = dynamics.get("quiet")!;
    expect(hot.tomRank).toBeGreaterThan(quiet.tomRank);
    // Standing is preserved: the quiet node's stability is untouched by silence.
    expect(quiet.stability).toBeGreaterThan(7);
  });

  it("grades revisit events by type", () => {
    const withReflection = computeNodeDynamics(
      new Map([
        ["n1", [
          evidence("n1", 40),
          { nodeId: "n1", at: daysAgo(10), revisitType: "reflection_created" },
        ]],
      ]),
      NOW,
    );
    const withGlance = computeNodeDynamics(
      new Map([
        ["n1", [
          evidence("n1", 40),
          { nodeId: "n1", at: daysAgo(10), revisitType: "detail_opened" },
        ]],
      ]),
      NOW,
    );
    expect(withReflection.get("n1")!.stability).toBeGreaterThan(
      withGlance.get("n1")!.stability,
    );
  });
});

describe("orderByTomRank", () => {
  it("sorts by rank and leaves unknown nodes last", () => {
    const dynamics = computeNodeDynamics(
      new Map([
        ["a", [evidence("a", 40), evidence("a", 3)]],
        ["b", [evidence("b", 200), evidence("b", 170), evidence("b", 140)]],
      ]),
      NOW,
    );
    const ordered = orderByTomRank(
      [{ id: "unknown" }, { id: "b" }, { id: "a" }],
      dynamics,
    );
    expect(ordered.map((n) => n.id)).toEqual(["a", "b", "unknown"]);
  });
});
