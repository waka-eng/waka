import { describe, expect, it } from "vitest";

import {
  deriveMemoryPattern,
  evaluateSignalMemoryMovement,
  type MemoryPatternEvidenceInput,
  type MemoryPatternNodeInput,
} from "./memory-movement.js";

const now = new Date("2026-05-30T12:00:00.000Z");

function node(input: Partial<MemoryPatternNodeInput> & Pick<MemoryPatternNodeInput, "id">): MemoryPatternNodeInput {
  const { id, ...rest } = input;
  return {
    id,
    type: "theme",
    weight: 120,
    confidence: 76,
    evidenceCount: 2,
    firstSeenAt: new Date("2026-04-01T10:00:00.000Z"),
    lastReinforcedAt: new Date("2026-05-25T10:00:00.000Z"),
    ...rest,
  };
}

function evidence(
  input: Partial<MemoryPatternEvidenceInput> &
    Pick<MemoryPatternEvidenceInput, "meaningNodeId" | "inspirationId" | "createdAt">,
): MemoryPatternEvidenceInput {
  return {
    weight: 70,
    ...input,
  };
}

describe("memory movement model", () => {
  it("derives reinforcement counts, recent support, confidence, decay, and signal provenance", () => {
    const pattern = deriveMemoryPattern({
      now,
      node: node({ id: "active-pattern", evidenceCount: 3 }),
      evidence: [
        evidence({
          meaningNodeId: "active-pattern",
          inspirationId: "signal-now",
          createdAt: new Date("2026-05-29T10:00:00.000Z"),
        }),
        evidence({
          meaningNodeId: "active-pattern",
          inspirationId: "signal-old",
          createdAt: new Date("2026-04-01T10:00:00.000Z"),
        }),
      ],
    });

    expect(pattern).toMatchObject({
      contextNodeId: "active-pattern",
      state: "active",
      reinforcementCount: 3,
      recentReinforcementCount: 1,
      confidence: 76,
      supportingSignalIds: ["signal-now", "signal-old"],
    });
    expect(pattern.currentWeight).toBeGreaterThan(120);
    expect(pattern.decay).toBe(0);
  });

  it("lets old unrepeated patterns fade without deleting historical support", () => {
    const pattern = deriveMemoryPattern({
      now,
      node: node({
        id: "fading-pattern",
        evidenceCount: 4,
        lastReinforcedAt: new Date("2026-03-01T10:00:00.000Z"),
      }),
      evidence: [
        evidence({
          meaningNodeId: "fading-pattern",
          inspirationId: "signal-old",
          createdAt: new Date("2026-03-01T10:00:00.000Z"),
        }),
      ],
    });

    expect(pattern.state).toBe("fading");
    expect(pattern.decay).toBeGreaterThan(0);
    expect(pattern.currentWeight).toBeLessThan(120);
    expect(pattern.supportingSignalIds).toEqual(["signal-old"]);
  });

  it("marks a dormant pattern as reactivated when new evidence returns after a long gap", () => {
    const pattern = deriveMemoryPattern({
      now,
      node: node({
        id: "returned-pattern",
        type: "environment",
        evidenceCount: 3,
        firstSeenAt: new Date("2025-09-01T10:00:00.000Z"),
        lastReinforcedAt: new Date("2026-05-30T10:00:00.000Z"),
      }),
      evidence: [
        evidence({
          meaningNodeId: "returned-pattern",
          inspirationId: "signal-returned",
          createdAt: new Date("2026-05-30T10:00:00.000Z"),
        }),
        evidence({
          meaningNodeId: "returned-pattern",
          inspirationId: "signal-before",
          createdAt: new Date("2026-01-15T10:00:00.000Z"),
        }),
      ],
    });

    expect(pattern.state).toBe("reactivated");
    expect(pattern.recentReinforcementCount).toBe(1);
    expect(pattern.movementScore).toBeGreaterThan(300);
  });

  it("preserves contradictions as live tensions instead of averaging them away", () => {
    const pattern = deriveMemoryPattern({
      now,
      node: node({ id: "live-tension", type: "tension", status: "contradicted" }),
      evidence: [
        evidence({
          meaningNodeId: "live-tension",
          inspirationId: "signal-a",
          createdAt: new Date("2026-05-20T10:00:00.000Z"),
        }),
      ],
    });

    expect(pattern.state).toBe("contradicted");

    const events = evaluateSignalMemoryMovement({
      patterns: [pattern],
      signalId: "signal-b",
      contextNodeIds: [],
      contradictedContextNodeIds: ["live-tension"],
    });

    expect(events).toEqual([
      expect.objectContaining({
        contextNodeId: "live-tension",
        movement: "contradicts_active",
        state: "contradicted",
        supportingSignalIds: ["signal-a", "signal-b"],
      }),
    ]);
  });

  it("evaluates new signals as reinforcement, emerging creation, reactivation, or decay by omission", () => {
    const active = deriveMemoryPattern({
      now,
      node: node({ id: "active-pattern" }),
      evidence: [
        evidence({
          meaningNodeId: "active-pattern",
          inspirationId: "signal-active",
          createdAt: new Date("2026-05-25T10:00:00.000Z"),
        }),
      ],
    });
    const fading = deriveMemoryPattern({
      now,
      node: node({
        id: "fading-pattern",
        lastReinforcedAt: new Date("2026-03-01T10:00:00.000Z"),
      }),
      evidence: [
        evidence({
          meaningNodeId: "fading-pattern",
          inspirationId: "signal-old",
          createdAt: new Date("2026-03-01T10:00:00.000Z"),
        }),
      ],
    });

    const events = evaluateSignalMemoryMovement({
      patterns: [active, fading],
      signalId: "signal-new",
      contextNodeIds: ["active-pattern", "fading-pattern", "brand-new-pattern"],
    });

    expect(events.map((event) => [event.contextNodeId, event.movement, event.state])).toEqual([
      ["active-pattern", "reinforces_existing", "active"],
      ["fading-pattern", "reactivates_dormant", "reactivated"],
      ["brand-new-pattern", "creates_emerging", "emerging"],
    ]);

    const omissionEvents = evaluateSignalMemoryMovement({
      patterns: [active, fading],
      signalId: "signal-new",
      contextNodeIds: ["active-pattern"],
    });

    expect(omissionEvents).toContainEqual(
      expect.objectContaining({
        contextNodeId: "fading-pattern",
        movement: "decays_by_omission",
      }),
    );
  });
});
