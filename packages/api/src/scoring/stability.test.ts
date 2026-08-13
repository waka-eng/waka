import { describe, expect, it } from "vitest";

import {
  CALENDAR_LOCK_MIN_EVENTS,
  CALENDAR_LOCK_MIN_SPAN_DAYS,
  CALENDAR_LOCK_P_THRESHOLD,
  DORMANCY_BONUS_EXPONENT,
  EVIDENCE_GRADE_DEPTH_WEIGHT,
  EVIDENCE_GRADE_FLOOR,
  IMPORTANCE_DIVERSITY_EXPONENT,
  IMPORTANCE_STABILITY_EXPONENT,
  RETRIEVABILITY_EXPONENT,
  RETRIEVABILITY_SHAPE,
  RITUAL_DECAY_DEPTH_CAP,
  SILENCE_ENVELOPE_MEDIAN_MULTIPLE,
  SILENCE_ENVELOPE_MIN_DAYS,
  SOURCE_DIVERSITY_FLOOR,
  STABILITY_BOOST,
  STABILITY_GRADES,
  STABILITY_INITIAL_DAYS,
  STABILITY_NORM_HORIZON_DAYS,
  STABILITY_SATURATION_EXPONENT,
  STRETCHING_GAP_COUNT,
  STRETCHING_LAST_GAP_MEDIAN_MULTIPLE,
  collapseEventsByDay,
  discoveryScore,
  evidenceGrade,
  foldStabilityEvent,
  importanceScore,
  isCalendarLocked,
  meanRetrievabilityOverWindow,
  rayleighTest,
  replayStability,
  retrievability,
  silenceDiagnostics,
  sourceDiversity,
  stabilityGradeForEvent,
  stabilityNorm,
  type StabilityEvent,
} from "./stability.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE = new Date("2024-01-05T12:00:00.000Z");

function day(offsetDays: number): Date {
  return new Date(BASE.getTime() + offsetDays * DAY_MS);
}

/** Evidence event at mid content depth: q = 0.55 + 0.45·0.5 = 0.775. */
function evidence(offsetDays: number): StabilityEvent {
  return { at: day(offsetDays), grade: evidenceGrade(0.5) };
}

/** 15 events at 35-day spacing — the steady year. */
const SPACED_OFFSETS = Array.from({ length: 15 }, (_, i) => i * 35);

/** The same 15 events crammed into one week — the obsessive burst. */
const MASSED_OFFSETS = [
  0, 0.4, 0.9, 1.3, 1.8, 2.2, 2.7, 3.1, 3.6, 4.0, 4.5, 4.9, 5.4, 5.8, 6.3,
];

/** 4 events, 14 silent months, 3 events — the comeback. */
const COMEBACK_OFFSETS = [0, 35, 70, 105, 530, 565, 600];

describe("retrievability law", () => {
  it("starts at 1 and is exactly 0.9 after one stability-length gap", () => {
    expect(retrievability(0, 7)).toBe(1);
    // (1 + 19/81)^(-1/2) = (81/100)^(1/2) = 0.9 exactly.
    expect(retrievability(7, 7)).toBeCloseTo(0.9, 12);
    expect(retrievability(30, 30)).toBeCloseTo(0.9, 12);
  });

  it("decreases monotonically with the gap", () => {
    expect(retrievability(14, 7)).toBeLessThan(retrievability(7, 7));
    expect(retrievability(70, 7)).toBeLessThan(retrievability(14, 7));
  });

  it("has a power-law tail, not an exponential one", () => {
    // Ten stability-lengths out, a power law keeps R above one half;
    // a 7-day exponential half-life would be at 0.5^10 ≈ 0.001.
    expect(retrievability(70, 7)).toBeGreaterThan(0.5);
  });
});

describe("expected retrievability over a horizon (E[R])", () => {
  it("matches numeric integration of R", () => {
    const s = 30;
    const gap = 10;
    const horizon = 28;
    const dt = 0.001;
    let sum = 0;
    for (let t = gap + dt / 2; t < gap + horizon; t += dt) {
      sum += retrievability(t, s) * dt;
    }
    expect(meanRetrievabilityOverWindow(s, gap, horizon)).toBeCloseTo(
      sum / horizon,
      6,
    );
  });

  it("sits strictly between the window's endpoint retrievabilities", () => {
    const mean = meanRetrievabilityOverWindow(30, 10, 28);
    expect(mean).toBeLessThan(retrievability(10, 30));
    expect(mean).toBeGreaterThan(retrievability(38, 30));
  });

  it("shrinks as the open gap grows", () => {
    expect(meanRetrievabilityOverWindow(30, 120, 28)).toBeLessThan(
      meanRetrievabilityOverWindow(30, 10, 28),
    );
  });
});

describe("gate: the four planted trajectories (durable-interest phase 0)", () => {
  it("steady 35-day spacing plateaus in 80–110 d with shrinking increments", () => {
    const replay = replayStability(SPACED_OFFSETS.map(evidence));
    expect(replay.state).not.toBeNull();
    const finalStability = replay.state!.stability;
    expect(finalStability).toBeGreaterThanOrEqual(80);
    expect(finalStability).toBeLessThanOrEqual(110);

    // Final three increments each under 15%: the plateau is real.
    const lastThree = replay.steps.slice(-3);
    expect(lastThree).toHaveLength(3);
    for (const step of lastThree) {
      expect(step.multiplier - 1).toBeLessThan(0.15);
    }
  });

  it("the same 15 events massed into one week stay within +70% of S_INIT", () => {
    const replay = replayStability(MASSED_OFFSETS.map(evidence));
    // A binge is one event per day: 15 raw events collapse to 7.
    expect(replay.collapsedEventCount).toBe(7);
    const finalStability = replay.state!.stability;
    expect(finalStability).toBeLessThanOrEqual(12);
    expect(finalStability).toBeLessThanOrEqual(1.7 * STABILITY_INITIAL_DAYS);
  });

  it("the 14-month comeback multiplies S by ≥ 2 and beats the massed week ≥ 5×", () => {
    const replay = replayStability(COMEBACK_OFFSETS.map(evidence));
    const comebackStep = replay.steps[4];
    expect(comebackStep.gapDays).toBeCloseTo(425, 6);
    // 600-day span never reaches the 2-year calendar-lock guard, so the
    // deep comeback keeps its full dormancy credit.
    expect(comebackStep.calendarLocked).toBe(false);
    expect(comebackStep.multiplier).toBeGreaterThanOrEqual(2.0);

    const massed = replayStability(MASSED_OFFSETS.map(evidence));
    expect(replay.state!.stability).toBeGreaterThanOrEqual(
      5 * massed.state!.stability,
    );
  });

  it("the same comeback under a calendar lock is capped at ×1.6", () => {
    // Replay the first four events, then fold the comeback with the node
    // flagged calendar-locked: the ritual cap must bind.
    const lead = replayStability(COMEBACK_OFFSETS.slice(0, 4).map(evidence));
    const uncapped = foldStabilityEvent(lead.state, evidence(530));
    const capped = foldStabilityEvent(lead.state, evidence(530), {
      calendarLocked: true,
    });

    expect(uncapped.step.multiplier).toBeGreaterThanOrEqual(2.0);
    expect(capped.step.ritualCapped).toBe(true);
    expect(capped.step.decayDepth).toBe(RITUAL_DECAY_DEPTH_CAP);
    expect(capped.step.multiplier).toBeLessThanOrEqual(1.6);
    expect(capped.step.multiplier).toBeLessThan(uncapped.step.multiplier);
  });
});

describe("stability never decays", () => {
  it("time alone never lowers S; only events move it, and never down", () => {
    const first = foldStabilityEvent(null, evidence(0));
    // Three years of silence, then a worthless (grade 0) event: S holds.
    const after = foldStabilityEvent(first.state, {
      at: day(1095),
      grade: 0,
    });
    expect(after.state.stability).toBe(first.state.stability);
    expect(after.step.multiplier).toBe(1);
  });

  it("a hot-streak event multiplies S by almost nothing", () => {
    const first = foldStabilityEvent(null, evidence(0));
    const nextDay = foldStabilityEvent(first.state, evidence(1));
    expect(nextDay.step.multiplier).toBeGreaterThan(1);
    expect(nextDay.step.multiplier).toBeLessThan(1.06);
  });
});

describe("event grades", () => {
  it("orders by the testing-effect hierarchy", () => {
    expect(stabilityGradeForEvent("reflection_created")).toBe(0.8);
    expect(stabilityGradeForEvent("inspiration_updated")).toBe(0.8);
    expect(stabilityGradeForEvent("detail_returned")).toBe(0.45);
    expect(stabilityGradeForEvent("detail_opened")).toBe(0.45);
  });

  it("capture_saved never charges its own node", () => {
    expect(stabilityGradeForEvent("capture_saved")).toBe(0);
  });

  it("grades evidence by capture effort, clamped to [0.55, 1]", () => {
    expect(evidenceGrade(0)).toBeCloseTo(0.55, 12);
    expect(evidenceGrade(0.5)).toBeCloseTo(0.775, 12);
    expect(evidenceGrade(1)).toBeCloseTo(1, 12);
    expect(evidenceGrade(-3)).toBeCloseTo(0.55, 12);
    expect(evidenceGrade(9)).toBeCloseTo(1, 12);
  });
});

describe("day collapse", () => {
  it("keeps the best grade of a same-day binge", () => {
    const collapsed = collapseEventsByDay([
      { at: new Date("2024-03-01T09:00:00.000Z"), grade: 0.45 },
      { at: new Date("2024-03-01T15:00:00.000Z"), grade: 0.8 },
      { at: new Date("2024-03-02T10:00:00.000Z"), grade: 0.55 },
    ]);
    expect(collapsed).toHaveLength(2);
    expect(collapsed[0].grade).toBe(0.8);
    expect(collapsed[1].grade).toBe(0.55);
  });

  it("keeps the earliest event on a grade tie", () => {
    const collapsed = collapseEventsByDay([
      { at: new Date("2024-03-01T15:00:00.000Z"), grade: 0.8 },
      { at: new Date("2024-03-01T09:00:00.000Z"), grade: 0.8 },
    ]);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].at.toISOString()).toBe("2024-03-01T09:00:00.000Z");
  });
});

describe("calendar lock (Rayleigh phase test)", () => {
  const januaries = [2020, 2021, 2022, 2023, 2024].map(
    (year) => new Date(`${year}-01-15T12:00:00.000Z`),
  );

  it("flags five Januaries across five years", () => {
    const result = rayleighTest(januaries);
    expect(result.meanResultantLength).toBeGreaterThan(0.99);
    expect(result.p).toBeLessThan(CALENDAR_LOCK_P_THRESHOLD);
    expect(isCalendarLocked(januaries)).toBe(true);
  });

  it("never flags fewer than five events, whatever their phases", () => {
    expect(isCalendarLocked(januaries.slice(0, 4))).toBe(false);
  });

  it("never flags a span under two years, however clustered", () => {
    const oneSeason = [0, 10, 20, 30, 40].map((offset) => day(offset));
    expect(isCalendarLocked(oneSeason)).toBe(false);
  });

  it("never flags an even spread around the year", () => {
    const quarterly = Array.from({ length: 9 }, (_, i) => day(i * 91.3125));
    const result = rayleighTest(quarterly);
    expect(result.p).toBeGreaterThan(CALENDAR_LOCK_P_THRESHOLD);
    expect(isCalendarLocked(quarterly)).toBe(false);
  });

  it("caps the every-January return inside a replay", () => {
    // Four annual Januaries, then a 14-month-late March return: the node
    // is provably seasonal by then, so the comeback folds under the lock.
    const events: StabilityEvent[] = [
      ...januaries.slice(0, 4).map((at) => ({ at, grade: evidenceGrade(0.5) })),
      { at: new Date("2024-03-15T12:00:00.000Z"), grade: evidenceGrade(0.5) },
    ];
    const replay = replayStability(events);
    const comeback = replay.steps[4];
    expect(comeback.calendarLocked).toBe(true);
    expect(comeback.multiplier).toBeLessThanOrEqual(1.6);
  });
});

describe("silence diagnostics", () => {
  it("keeps the envelope at the one-month floor for tight cadences", () => {
    const diagnostics = silenceDiagnostics([evidence(0), evidence(10)], day(45));
    expect(diagnostics.envelopeDays).toBe(SILENCE_ENVELOPE_MIN_DAYS);
    expect(diagnostics.openGapDays).toBeCloseTo(35, 6);
    expect(diagnostics.silent).toBe(true);
  });

  it("scales the envelope to the node's own median gap", () => {
    const events = [evidence(0), evidence(40), evidence(80)];
    const patient = silenceDiagnostics(events, day(190));
    expect(patient.envelopeDays).toBe(120);
    expect(patient.silent).toBe(false); // 110-day gap is normal quiet here

    const overdue = silenceDiagnostics(events, day(205));
    expect(overdue.silent).toBe(true); // 125 days has left the envelope
  });

  it("detects the stretching-gaps abandonment signature", () => {
    // Gaps 20, 30, 50: strictly increasing, last ≥ 1.5 × median(30).
    const stretching = silenceDiagnostics(
      [evidence(0), evidence(20), evidence(50), evidence(100)],
      day(110),
    );
    expect(stretching.stretching).toBe(true);
  });

  it("does not call a flat cadence stretching", () => {
    const flat = silenceDiagnostics(
      [evidence(0), evidence(30), evidence(60), evidence(90)],
      day(100),
    );
    expect(flat.stretching).toBe(false);
  });

  it("requires the last gap to clear the median multiple", () => {
    // Gaps 10, 20, 25: increasing, but 25 < 1.5 × median(20).
    const gentle = silenceDiagnostics(
      [evidence(0), evidence(10), evidence(30), evidence(55)],
      day(60),
    );
    expect(gentle.stretching).toBe(false);
  });
});

describe("importance and discovery", () => {
  it("normalizes a year of proven survival to full stability", () => {
    expect(stabilityNorm(STABILITY_NORM_HORIZON_DAYS)).toBe(1);
    expect(stabilityNorm(10 * STABILITY_NORM_HORIZON_DAYS)).toBe(1);
    expect(stabilityNorm(STABILITY_INITIAL_DAYS)).toBeCloseTo(0.1745, 3);
    expect(stabilityNorm(0)).toBe(0);
  });

  it("grows with stability at fixed diversity", () => {
    expect(importanceScore(90, 2)).toBeGreaterThan(importanceScore(30, 2));
  });

  it("floors diversity instead of zeroing single-channel nodes", () => {
    expect(sourceDiversity(1)).toBe(0);
    expect(sourceDiversity(4)).toBe(1);
    expect(sourceDiversity(9)).toBe(1);
    const singleChannel = importanceScore(STABILITY_NORM_HORIZON_DAYS, 1);
    expect(singleChannel).toBeCloseTo(100 * Math.pow(SOURCE_DIVERSITY_FLOOR, 0.15), 1);
    expect(singleChannel).toBeGreaterThan(0);
  });

  it("Discovery is Importance silenced by Awareness", () => {
    expect(discoveryScore(80, 0)).toBe(80);
    expect(discoveryScore(80, 0.25)).toBeCloseTo(60, 12);
    expect(discoveryScore(80, 1)).toBe(0);
    expect(discoveryScore(80, 7)).toBe(0);
  });
});

/**
 * A guard on the goal's tuned numbers, in the same spirit as
 * algorithm-integrity.test.ts: none of these can be re-derived from first
 * principles, and each traces to a law in docs/goals/durable-interest.md.
 * If this failed, that is the point — confirm the new value is intended,
 * then update the expectation in the same commit as the change.
 */
describe("stability constants (durable-interest goal)", () => {
  it("holds the update-law constants", () => {
    expect(STABILITY_INITIAL_DAYS).toBe(7);
    expect(RETRIEVABILITY_SHAPE).toBeCloseTo(19 / 81, 12);
    expect(RETRIEVABILITY_EXPONENT).toBe(-0.5);
    expect(STABILITY_BOOST).toBe(2.0);
    expect(STABILITY_SATURATION_EXPONENT).toBe(-0.25);
    expect(DORMANCY_BONUS_EXPONENT).toBe(2.5);
    expect(RITUAL_DECAY_DEPTH_CAP).toBe(0.25);
  });

  it("holds the grade table", () => {
    expect(STABILITY_GRADES).toEqual({
      reflection_created: 0.8,
      inspiration_updated: 0.8,
      detail_returned: 0.45,
      detail_opened: 0.45,
      capture_saved: 0,
    });
    expect(EVIDENCE_GRADE_FLOOR).toBe(0.55);
    expect(EVIDENCE_GRADE_DEPTH_WEIGHT).toBe(0.45);
  });

  it("holds the diagnostics thresholds", () => {
    expect(CALENDAR_LOCK_MIN_EVENTS).toBe(5);
    expect(CALENDAR_LOCK_MIN_SPAN_DAYS).toBe(730);
    expect(CALENDAR_LOCK_P_THRESHOLD).toBe(0.05);
    expect(SILENCE_ENVELOPE_MIN_DAYS).toBe(30);
    expect(SILENCE_ENVELOPE_MEDIAN_MULTIPLE).toBe(3);
    expect(STRETCHING_GAP_COUNT).toBe(3);
    expect(STRETCHING_LAST_GAP_MEDIAN_MULTIPLE).toBe(1.5);
  });

  it("holds the score shape", () => {
    expect(STABILITY_NORM_HORIZON_DAYS).toBe(365);
    expect(IMPORTANCE_STABILITY_EXPONENT).toBe(0.85);
    expect(IMPORTANCE_DIVERSITY_EXPONENT).toBe(0.15);
    expect(SOURCE_DIVERSITY_FLOOR).toBe(0.05);
  });
});
