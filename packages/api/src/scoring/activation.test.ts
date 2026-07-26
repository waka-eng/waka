import { describe, expect, it } from "vitest";

import {
  inspirationRevisitEventTypeValues,
  revisitCountingEventTypes,
} from "../db/schema-revisits.js";

import {
  ACTIVATION_CEILING,
  ACTIVATION_CHARGES,
  FIRE_MIN_CONTRIBUTORS,
  FIRE_THRESHOLD_FLOOR_RATIO,
  FIRE_THRESHOLD_MAX,
  adaptiveFiringThreshold,
  decayedActivation,
  evaluateNeighborhoodFiring,
  foldActivationCharge,
  neighborCaptureCharge,
  shouldRunFireCheck,
  chargeForEvent,
  type ActivationChargeEvent,
} from "./activation.js";

const NOW = new Date("2026-07-06T12:00:00.000Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

describe("decayedActivation", () => {
  it("halves over one half-life and is stable at zero elapsed", () => {
    expect(decayedActivation({ activation: 0.8, activatedAt: NOW }, NOW)).toBeCloseTo(0.8);
    expect(
      decayedActivation({ activation: 0.8, activatedAt: daysAgo(7) }, NOW),
    ).toBeCloseTo(0.4);
    expect(
      decayedActivation({ activation: 0.8, activatedAt: daysAgo(14) }, NOW),
    ).toBeCloseTo(0.2);
  });

  it("never goes negative for clock skew (activatedAt in the future)", () => {
    expect(
      decayedActivation({ activation: 0.5, activatedAt: daysAgo(-3) }, NOW),
    ).toBeCloseTo(0.5);
  });
});

describe("foldActivationCharge", () => {
  it("accumulates onto the decayed base and clamps at the ceiling", () => {
    const first = foldActivationCharge(null, 0.3, daysAgo(7));
    expect(first.activation).toBeCloseTo(0.3);

    const second = foldActivationCharge(first, 0.3, NOW);
    // 0.3 decayed one half-life (0.15) + 0.3
    expect(second.activation).toBeCloseTo(0.45);
    expect(second.activatedAt).toEqual(NOW);

    const saturated = foldActivationCharge(
      { activation: 0.95, activatedAt: NOW },
      0.3,
      NOW,
    );
    expect(saturated.activation).toBe(ACTIVATION_CEILING);
  });

  it("keeps every single charge well below the firing threshold", () => {
    for (const charge of Object.values(ACTIVATION_CHARGES)) {
      expect(charge).toBeLessThan(adaptiveFiringThreshold(0));
    }
  });
});

describe("adaptiveFiringThreshold", () => {
  it("gives cold-start archives the floored threshold", () => {
    expect(adaptiveFiringThreshold(0)).toBeCloseTo(
      FIRE_THRESHOLD_MAX * FIRE_THRESHOLD_FLOOR_RATIO,
    );
    expect(adaptiveFiringThreshold(10)).toBeCloseTo(
      FIRE_THRESHOLD_MAX * FIRE_THRESHOLD_FLOOR_RATIO,
    );
  });

  it("scales to the maximum at the reference archive size and beyond", () => {
    expect(adaptiveFiringThreshold(30)).toBeCloseTo(FIRE_THRESHOLD_MAX);
    expect(adaptiveFiringThreshold(500)).toBeCloseTo(FIRE_THRESHOLD_MAX);
    expect(adaptiveFiringThreshold(15)).toBeCloseTo(FIRE_THRESHOLD_MAX / 2);
  });
});

describe("evaluateNeighborhoodFiring", () => {
  const warm = (activation: number, similarityToTrigger: number) => ({
    activation,
    activatedAt: NOW,
    similarityToTrigger,
  });

  it("fires a first-week archive from a handful of accumulated weak signals", () => {
    // Cold start: 12 embedded peers, three neighbors charged by a few
    // related captures over the week — none individually notable.
    const result = evaluateNeighborhoodFiring({
      members: [warm(0.5, 0.62), warm(0.36, 0.58), warm(0.34, 0.55)],
      peerCount: 12,
      now: NOW,
    });
    expect(result.contributorCount).toBe(3);
    expect(result.potential).toBeGreaterThan(result.threshold);
    expect(result.fired).toBe(true);
  });

  it("holds the same cluster below threshold in a dense archive", () => {
    const result = evaluateNeighborhoodFiring({
      members: [warm(0.5, 0.62), warm(0.36, 0.58), warm(0.34, 0.55)],
      peerCount: 50,
      now: NOW,
    });
    expect(result.fired).toBe(false);
  });

  it("never fires on fewer than the minimum contributors, however strong", () => {
    const result = evaluateNeighborhoodFiring({
      members: [warm(1, 1), warm(1, 1)],
      peerCount: 5,
      now: NOW,
    });
    expect(result.contributorCount).toBe(FIRE_MIN_CONTRIBUTORS - 1);
    expect(result.fired).toBe(false);
  });

  it("ignores cold members and dissimilar members", () => {
    const result = evaluateNeighborhoodFiring({
      members: [
        warm(0.1, 0.9), // too cold
        warm(0.9, 0.2), // too dissimilar
        { activation: 0.9, activatedAt: daysAgo(30), similarityToTrigger: 0.9 }, // decayed cold
      ],
      peerCount: 10,
      now: NOW,
    });
    expect(result.contributorCount).toBe(0);
    expect(result.fired).toBe(false);
  });
});

describe("neighborCaptureCharge", () => {
  it("scales with similarity and clamps out-of-range input", () => {
    expect(neighborCaptureCharge(0.5)).toBeCloseTo(
      ACTIVATION_CHARGES.neighbor_capture * 0.5,
    );
    expect(neighborCaptureCharge(2)).toBeCloseTo(ACTIVATION_CHARGES.neighbor_capture);
    expect(neighborCaptureCharge(-1)).toBe(0);
  });
});

describe("shouldRunFireCheck", () => {
  it("allows the first check and enforces the cooldown after", () => {
    expect(shouldRunFireCheck(null, NOW)).toBe(true);
    expect(shouldRunFireCheck(new Date(NOW.getTime() - 60 * 60 * 1000), NOW)).toBe(false);
    expect(shouldRunFireCheck(daysAgo(2), NOW)).toBe(true);
  });
});

describe("charge map totality over revisit events", () => {
  it("covers every revisit event type, so no event can charge NaN", () => {
    // `pulseSignalActivation` looks charges up by revisit event type. A value
    // added to the enum without a charge here would make `chargeForEvent`
    // return undefined and fold NaN into a signal's activation, which decays
    // to NaN forever. This test fails the moment the two drift apart.
    for (const event of inspirationRevisitEventTypeValues) {
      const charge = chargeForEvent(event as ActivationChargeEvent);
      expect(Number.isFinite(charge), `no charge defined for "${event}"`).toBe(true);
    }
  });

  it("gives a capture no self-charge", () => {
    // A capture charges its neighbours, never itself: writing something down
    // is not what makes it important.
    expect(ACTIVATION_CHARGES.capture_saved).toBe(0);
    const before = { activation: 0.5, activatedAt: NOW };
    const after = foldActivationCharge(before, ACTIVATION_CHARGES.capture_saved, NOW);
    expect(after.activation).toBeCloseTo(0.5);
  });
});

describe("revisit counting membership", () => {
  it("excludes the capture event from revisit scoring", () => {
    // Scoring counts rows in signal_revisit_events to measure how often a
    // signal was returned to. `capture_saved` lives in the same table but is
    // the save itself, so counting it would hand every new signal a revisit
    // it never had and inflate its score at the moment of creation.
    expect(revisitCountingEventTypes).not.toContain("capture_saved");
  });

  it("counts every other event type as a return", () => {
    const expected = inspirationRevisitEventTypeValues.filter(
      (value) => value !== "capture_saved",
    );
    expect([...revisitCountingEventTypes].sort()).toEqual([...expected].sort());
  });
});
