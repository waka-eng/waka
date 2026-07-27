import { describe, expect, it } from "vitest";

import { inspirationRevisitEventTypeValues, revisitCountingEventTypes } from "../db/schema-revisits.js";
import {
  ACTIVATION_CEILING,
  ACTIVATION_CHARGES,
  ACTIVATION_HALF_LIFE_DAYS,
  FIRE_CONTRIBUTOR_ACTIVATION_FLOOR,
  FIRE_CONTRIBUTOR_SIMILARITY_FLOOR,
  FIRE_MIN_CONTRIBUTORS,
  FIRE_THRESHOLD_FLOOR_RATIO,
  FIRE_THRESHOLD_MAX,
  FIRE_THRESHOLD_REFERENCE_PEERS,
  adaptiveFiringThreshold,
  chargeForEvent,
  decayedActivation,
  type ActivationChargeEvent,
} from "./activation.js";
import { calculateRuntimeCandidateScore } from "./wow-score.js";
import { scoreCandidateSurprise } from "../lib/wow-candidates.js";

/**
 * A guard on other people's tuned numbers.
 *
 * The wall's design is being reworked, and design work reaches into the same
 * files as the retrieval and activation maths. These constants were chosen by
 * agikee and Q00 against real archives; none of them can be derived from first
 * principles, so a change that "looked equivalent" is exactly how they get
 * lost. Pinning them means a future edit has to be deliberate — the test fails
 * and someone decides — rather than silent.
 *
 * If you are here because this test failed: that is the point. Confirm the new
 * value is intended, get it from whoever tuned it, then update the expectation
 * in the same commit as the change.
 */

describe("activation constants (Q00)", () => {
  it("holds the charge, decay and ceiling values", () => {
    expect(ACTIVATION_HALF_LIFE_DAYS).toBe(7);
    expect(ACTIVATION_CEILING).toBe(1);
    expect(ACTIVATION_CHARGES).toEqual({
      neighbor_capture: 0.3,
      reflection_created: 0.25,
      detail_opened: 0.15,
      detail_returned: 0.15,
      inspiration_updated: 0.1,
      capture_saved: 0,
    });
  });

  it("holds the firing thresholds", () => {
    expect(FIRE_MIN_CONTRIBUTORS).toBe(3);
    expect(FIRE_CONTRIBUTOR_ACTIVATION_FLOOR).toBe(0.2);
    expect(FIRE_CONTRIBUTOR_SIMILARITY_FLOOR).toBe(0.35);
    expect(FIRE_THRESHOLD_MAX).toBe(1.2);
    expect(FIRE_THRESHOLD_REFERENCE_PEERS).toBe(30);
    expect(FIRE_THRESHOLD_FLOOR_RATIO).toBe(0.4);
  });

  it("keeps every single charge below the coldest firing threshold", () => {
    // The design intent: no one event can fire a neighbourhood on its own.
    for (const charge of Object.values(ACTIVATION_CHARGES)) {
      expect(charge).toBeLessThan(adaptiveFiringThreshold(0));
    }
  });

  it("still halves activation over one half-life", () => {
    const now = new Date("2026-07-01T00:00:00.000Z");
    const aWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    expect(decayedActivation({ activation: 0.8, activatedAt: aWeekAgo }, now)).toBeCloseTo(0.4);
  });

  it("has a charge for every revisit event, so none can fold NaN into activation", () => {
    for (const event of inspirationRevisitEventTypeValues) {
      expect(Number.isFinite(chargeForEvent(event as ActivationChargeEvent))).toBe(true);
    }
  });

  it("counts every revisit event except the capture itself", () => {
    // A capture is not a return. Counting it credits every new signal with a
    // revisit it never had.
    expect(revisitCountingEventTypes).not.toContain("capture_saved");
    expect([...revisitCountingEventTypes].sort()).toEqual(
      inspirationRevisitEventTypeValues.filter((v) => v !== "capture_saved").sort(),
    );
  });
});

describe("candidate ranking weights (agikee)", () => {
  it("holds the runtime candidate score mix", () => {
    // 0.50 wow + 0.25 similarity + 0.20 surprise + 0.05 time.
    const only = (key: "wowScore" | "similarityToTrigger" | "surpriseSimilarityToTrigger" | "timeDistanceToTrigger") =>
      calculateRuntimeCandidateScore({
        wowScore: 0,
        similarityToTrigger: 0,
        surpriseSimilarityToTrigger: 0,
        timeDistanceToTrigger: 0,
        [key]: 1,
      } as never);

    expect(only("wowScore")).toBeCloseTo(0.5);
    expect(only("similarityToTrigger")).toBeCloseTo(0.25);
    expect(only("surpriseSimilarityToTrigger")).toBeCloseTo(0.2);
    expect(only("timeDistanceToTrigger")).toBeCloseTo(0.05);
  });

  it("keeps the surprise curve peaking at medium similarity, not high", () => {
    // The bridge signal: an obvious neighbour is not a surprising one. Scored
    // through the real retrieval path, since the same-named helper in the
    // score module is only a clamp.
    const at = (cosine: number) => scoreCandidateSurprise(cosine);
    expect(at(0.55)).toBeGreaterThan(at(0.95));
    expect(at(0.55)).toBeGreaterThan(at(0.05));
    expect(at(0.55)).toBeCloseTo(1, 1);
  });
});
