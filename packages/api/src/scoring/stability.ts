/**
 * Context-node stability math — storage strength for the durable-interest
 * goal (docs/goals/durable-interest.md).
 *
 * Two-component memory, Bjork's distinction made executable:
 *
 *   - *Retrieval strength* — "alive right now" — is signal `activation`
 *     (7-day half-life, spark engine S1). It ships and is untouched here.
 *   - *Storage strength* — "survives the novelty" — is `S`, measured in
 *     days: how long a gap this node has proven it survives. S NEVER
 *     decays. It grows only when evidence arrives, and how much it grows
 *     depends on how decayed the node was when the evidence landed.
 *
 * Everything here is pure: events in, stability out. The founder's
 * sentence this module is judged against — "where my pulse still races
 * after the novelty wears off" — is encoded in three laws:
 *
 *   1. The dormancy bonus `e^(DORM·d) − 1`: evidence landing while the
 *      node is hot multiplies S by ≈1 (a hot streak buys nothing durable);
 *      evidence returning from deep decay multiplies it by 2–3×. The
 *      comeback IS the signal.
 *   2. Saturation `S^SAT`: already-stable nodes are hard to grow. S
 *      calibrates to the demonstrated survival horizon — a node fed
 *      monthly plateaus near S ≈ 90 and only longer survived gaps push it
 *      higher. Frequency alone can never buy what spacing proves.
 *   3. The ritual cap: an every-January return is calendar, not pull. A
 *      node whose events cluster on the annual circle (Rayleigh test) has
 *      its decay-depth credit capped, so seasonal ritual cannot
 *      impersonate a comeback.
 *
 * Forgetting is power-law, not exponential (the freshness decays elsewhere
 * in the codebase are exponential on purpose — they measure recency, not
 * interest). Under a power law an eighteen-month theme does not bleed
 * standing at the speed of last week's flash — which is exactly the
 * discrimination "after the novelty wears off" asks for.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * First evidence proves nothing about spacing yet: seed S at one week, the
 * same horizon as the activation half-life, so R(t) starts believable.
 */
export const STABILITY_INITIAL_DAYS = 7;

/**
 * Forgetting-curve shape (FSRS form): R(t,S) = (1 + SHAPE·t/S)^EXPONENT,
 * with SHAPE = 19/81 chosen so that R(S, S) = 0.9 exactly — "stability" is
 * the gap this node survives with 90% retrievability.
 */
export const RETRIEVABILITY_SHAPE = 19 / 81;

/** Power-law tail, not exponential — see module header. */
export const RETRIEVABILITY_EXPONENT = -0.5;

/** Scale of the maximum single-event stability gain. */
export const STABILITY_BOOST = 2.0;

/**
 * Saturation exponent: growth is damped by S^(−0.25), so stability
 * plateaus at the demonstrated survival horizon instead of compounding
 * without bound under a steady cadence.
 */
export const STABILITY_SATURATION_EXPONENT = -0.25;

/**
 * Dormancy-bonus exponent: growth scales with e^(2.5·d) − 1 where
 * d = 1 − R(gap). At d ≈ 0 the factor vanishes (hot streaks buy nothing);
 * at d ≈ 0.5 it is ≈ 2.5 (the deep comeback is worth a multiple).
 */
export const DORMANCY_BONUS_EXPONENT = 2.5;

/**
 * Calendar-locked nodes have decay depth capped here: the every-January
 * return may keep at most this much dormancy credit. Ritual is not pull.
 */
export const RITUAL_DECAY_DEPTH_CAP = 0.25;

/**
 * Event grades q, ordered by the testing-effect hierarchy: re-generation
 * (writing a reflection, editing the inspiration) beats re-exposure
 * (opening a detail view). `capture_saved` never charges its own node —
 * the evidence row created at capture is that moment's charge, graded by
 * content depth — and the entry exists only so the map stays total over
 * the revisit-event enum, the same discipline as ACTIVATION_CHARGES.
 */
export const STABILITY_GRADES = {
  reflection_created: 0.8,
  inspiration_updated: 0.8,
  detail_returned: 0.45,
  detail_opened: 0.45,
  capture_saved: 0,
} as const;

export type StabilityGradeEvent = keyof typeof STABILITY_GRADES;

/**
 * Evidence from a new signal grades by capture effort:
 * q = FLOOR + WEIGHT · contentDepth. A drive-by link is 0.55; a deep
 * composed capture reaches 1.0.
 */
export const EVIDENCE_GRADE_FLOOR = 0.55;
export const EVIDENCE_GRADE_DEPTH_WEIGHT = 0.45;

/** Calendar lock needs enough events to mean anything… */
export const CALENDAR_LOCK_MIN_EVENTS = 5;
/** …spanning at least two annual cycles… */
export const CALENDAR_LOCK_MIN_SPAN_DAYS = 730;
/** …with Rayleigh p below this to call the phase clustering real. */
export const CALENDAR_LOCK_P_THRESHOLD = 0.05;

/** "Normal quiet" is never shorter than a month… */
export const SILENCE_ENVELOPE_MIN_DAYS = 30;
/** …and otherwise three times the node's own median gap. */
export const SILENCE_ENVELOPE_MEDIAN_MULTIPLE = 3;

/** Stretching-gaps abandonment signature: this many gaps, each longer… */
export const STRETCHING_GAP_COUNT = 3;
/** …with the last at least this multiple of the node's median gap. */
export const STRETCHING_LAST_GAP_MEDIAN_MULTIPLE = 1.5;

/** S_norm treats one year of proven survival as full stability. */
export const STABILITY_NORM_HORIZON_DAYS = 365;

/** Importance leans on proven stability… */
export const IMPORTANCE_STABILITY_EXPONENT = 0.85;
/** …with a small diversity term: one newsletter echoing is one exposure. */
export const IMPORTANCE_DIVERSITY_EXPONENT = 0.15;
/** Diversity never zeroes Importance outright — floor, not gate. */
export const SOURCE_DIVERSITY_FLOOR = 0.05;
/** Four distinct capture channels count as fully diverse. */
export const SOURCE_DIVERSITY_REFERENCE_CHANNELS = 4;

export interface StabilityEvent {
  at: Date;
  /** q ∈ [0,1], from STABILITY_GRADES or evidenceGrade(). */
  grade: number;
}

export interface StabilityState {
  /** S — the gap, in days, this node has proven it survives. Never decays. */
  stability: number;
  lastEventAt: Date;
}

/** Per-event trace, kept so backfills can be hand-checked (phase 3 gate). */
export interface StabilityStep {
  at: Date;
  gapDays: number;
  stabilityBefore: number;
  retrievabilityBefore: number;
  decayDepth: number;
  /** The node counted as calendar-locked when this event folded. */
  calendarLocked: boolean;
  /** The lock actually bit: raw decay depth exceeded the ritual cap. */
  ritualCapped: boolean;
  grade: number;
  multiplier: number;
  stabilityAfter: number;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Grade for a graded revisit event. */
export function stabilityGradeForEvent(event: StabilityGradeEvent): number {
  return STABILITY_GRADES[event];
}

/** Grade for evidence from a new signal, by capture effort. */
export function evidenceGrade(contentDepth: number): number {
  return (
    EVIDENCE_GRADE_FLOOR + EVIDENCE_GRADE_DEPTH_WEIGHT * clamp(contentDepth, 0, 1)
  );
}

/**
 * R(t, S): the probability this node still surfaces unprompted after a
 * t-day gap, given proven stability S. Power law; R(S, S) = 0.9.
 */
export function retrievability(elapsedDays: number, stabilityDays: number): number {
  const t = Math.max(0, Number.isFinite(elapsedDays) ? elapsedDays : 0);
  const s = Math.max(1e-6, Number.isFinite(stabilityDays) ? stabilityDays : 0);
  return clamp(
    Math.pow(1 + RETRIEVABILITY_SHAPE * (t / s), RETRIEVABILITY_EXPONENT),
    0,
    1,
  );
}

/**
 * E[R] — the mean of R(t, S) across a horizon window starting `gap` days
 * after the last event: the probability, averaged over the window, that
 * this node still surfaces unprompted. The Phase-1 prediction lens.
 *
 * Closed form of (1/h)·∫ R dt over [g, g+h] with k = SHAPE/S:
 * (2 / (k·h)) · (√(1 + k(g+h)) − √(1 + k·g)).
 */
export function meanRetrievabilityOverWindow(
  stabilityDays: number,
  gapAtWindowStartDays: number,
  windowDays: number,
): number {
  const s = Math.max(1e-6, Number.isFinite(stabilityDays) ? stabilityDays : 0);
  const g = Math.max(0, Number.isFinite(gapAtWindowStartDays) ? gapAtWindowStartDays : 0);
  const h = Math.max(1e-6, Number.isFinite(windowDays) ? windowDays : 0);
  const k = RETRIEVABILITY_SHAPE / s;
  return clamp(
    (2 / (k * h)) * (Math.sqrt(1 + k * (g + h)) - Math.sqrt(1 + k * g)),
    0,
    1,
  );
}

/**
 * Same-day events collapse to the single best-graded one (ties keep the
 * earliest): a binge is one event — the session-cap discipline activation
 * charges already follow. Days are UTC.
 */
export function collapseEventsByDay(events: StabilityEvent[]): StabilityEvent[] {
  const byDay = new Map<string, StabilityEvent>();
  for (const event of [...events].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    const key = event.at.toISOString().slice(0, 10);
    const kept = byDay.get(key);
    if (!kept || event.grade > kept.grade) byDay.set(key, event);
  }
  return [...byDay.values()].sort((a, b) => a.at.getTime() - b.at.getTime());
}

/**
 * Fold one (day-collapsed) event into the stability state.
 *
 * first event:   S = STABILITY_INITIAL_DAYS
 * later events:  R_pre = R(gap, S);  d = 1 − R_pre
 *                if calendar-locked: d = min(d, RITUAL_DECAY_DEPTH_CAP)
 *                S ×= 1 + BOOST · q · S^SAT · (e^(DORM·d) − 1)
 */
export function foldStabilityEvent(
  previous: StabilityState | null,
  event: StabilityEvent,
  options?: { calendarLocked?: boolean },
): { state: StabilityState; step: StabilityStep } {
  const grade = clamp(event.grade, 0, 1);

  if (!previous) {
    const state = { stability: STABILITY_INITIAL_DAYS, lastEventAt: event.at };
    return {
      state,
      step: {
        at: event.at,
        gapDays: 0,
        stabilityBefore: 0,
        retrievabilityBefore: 1,
        decayDepth: 0,
        calendarLocked: options?.calendarLocked === true,
        ritualCapped: false,
        grade,
        multiplier: 1,
        stabilityAfter: state.stability,
      },
    };
  }

  const gapDays = Math.max(
    0,
    (event.at.getTime() - previous.lastEventAt.getTime()) / DAY_MS,
  );
  const retrievabilityBefore = retrievability(gapDays, previous.stability);
  const rawDepth = 1 - retrievabilityBefore;
  const ritualCapped =
    options?.calendarLocked === true && rawDepth > RITUAL_DECAY_DEPTH_CAP;
  const decayDepth = ritualCapped ? RITUAL_DECAY_DEPTH_CAP : rawDepth;

  const multiplier =
    1 +
    STABILITY_BOOST *
      grade *
      Math.pow(previous.stability, STABILITY_SATURATION_EXPONENT) *
      Math.expm1(DORMANCY_BONUS_EXPONENT * decayDepth);

  const state = {
    stability: previous.stability * multiplier,
    lastEventAt: event.at,
  };
  return {
    state,
    step: {
      at: event.at,
      gapDays,
      stabilityBefore: previous.stability,
      retrievabilityBefore,
      decayDepth,
      calendarLocked: options?.calendarLocked === true,
      ritualCapped,
      grade,
      multiplier,
      stabilityAfter: state.stability,
    },
  };
}

/** Position of a date on the annual circle, in radians. */
export function annualPhaseRadians(date: Date): number {
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
  const yearMs = 365.2425 * DAY_MS;
  return (2 * Math.PI * (date.getTime() - startOfYear)) / yearMs;
}

export interface RayleighResult {
  sampleCount: number;
  meanResultantLength: number;
  p: number;
}

/**
 * Rayleigh test for phase concentration on the annual circle:
 * R̄ = |Σ e^(iφ)| / n, p ≈ e^(−n·R̄²). Small p ⇒ the events cluster at
 * one time of year.
 */
export function rayleighTest(dates: Date[]): RayleighResult {
  const n = dates.length;
  if (n === 0) return { sampleCount: 0, meanResultantLength: 0, p: 1 };
  let sumCos = 0;
  let sumSin = 0;
  for (const date of dates) {
    const phase = annualPhaseRadians(date);
    sumCos += Math.cos(phase);
    sumSin += Math.sin(phase);
  }
  const meanResultantLength = Math.hypot(sumCos, sumSin) / n;
  const p = clamp(Math.exp(-n * meanResultantLength * meanResultantLength), 0, 1);
  return { sampleCount: n, meanResultantLength, p };
}

/**
 * A node is calendar-locked when enough events, across enough years,
 * cluster tightly on the annual circle. All three guards are required:
 * fewer than five events or under two years of span can look seasonal by
 * accident.
 */
export function isCalendarLocked(dates: Date[]): boolean {
  if (dates.length < CALENDAR_LOCK_MIN_EVENTS) return false;
  const times = dates.map((d) => d.getTime());
  const spanDays = (Math.max(...times) - Math.min(...times)) / DAY_MS;
  if (spanDays < CALENDAR_LOCK_MIN_SPAN_DAYS) return false;
  return rayleighTest(dates).p < CALENDAR_LOCK_P_THRESHOLD;
}

export interface StabilityReplay {
  state: StabilityState | null;
  steps: StabilityStep[];
  /** Events after day-collapse — what the folds actually consumed. */
  collapsedEventCount: number;
}

/**
 * Replay a node's full (uncollapsed) event history into a stability state.
 * Calendar lock is evaluated per step over the events seen so far,
 * including the current one — the phase of the return is itself evidence
 * of ritual.
 */
export function replayStability(events: StabilityEvent[]): StabilityReplay {
  const collapsed = collapseEventsByDay(events);
  let state: StabilityState | null = null;
  const steps: StabilityStep[] = [];
  const seenDates: Date[] = [];
  for (const event of collapsed) {
    seenDates.push(event.at);
    const calendarLocked = isCalendarLocked(seenDates);
    const folded = foldStabilityEvent(state, event, { calendarLocked });
    state = folded.state;
    steps.push(folded.step);
  }
  return { state, steps, collapsedEventCount: collapsed.length };
}

export interface SilenceDiagnostics {
  eventCount: number;
  medianGapDays: number | null;
  envelopeDays: number;
  openGapDays: number;
  /** Open gap has left the node's own normal quiet. */
  silent: boolean;
  /** Gaps stretching before quit — the published abandonment signature. */
  stretching: boolean;
  calendarLocked: boolean;
  rayleighP: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Per-node silence diagnostics. Every threshold is the node's own cadence
 * — median gap, not a global constant — so a weekly theme and a
 * quarterly theme each get their own definition of "quiet".
 */
export function silenceDiagnostics(
  events: StabilityEvent[],
  now: Date,
): SilenceDiagnostics {
  const collapsed = collapseEventsByDay(events);
  const gaps: number[] = [];
  for (let i = 1; i < collapsed.length; i += 1) {
    gaps.push(
      (collapsed[i].at.getTime() - collapsed[i - 1].at.getTime()) / DAY_MS,
    );
  }
  const medianGapDays = median(gaps);
  const envelopeDays = Math.max(
    SILENCE_ENVELOPE_MIN_DAYS,
    medianGapDays === null ? 0 : SILENCE_ENVELOPE_MEDIAN_MULTIPLE * medianGapDays,
  );
  const last = collapsed[collapsed.length - 1];
  const openGapDays = last
    ? Math.max(0, (now.getTime() - last.at.getTime()) / DAY_MS)
    : 0;

  const recent = gaps.slice(-STRETCHING_GAP_COUNT);
  const strictlyIncreasing =
    recent.length === STRETCHING_GAP_COUNT &&
    recent.every((gap, i) => i === 0 || gap > recent[i - 1]);
  const stretching =
    strictlyIncreasing &&
    medianGapDays !== null &&
    recent[recent.length - 1] >=
      STRETCHING_LAST_GAP_MEDIAN_MULTIPLE * medianGapDays;

  const dates = collapsed.map((event) => event.at);
  const rayleigh = rayleighTest(dates);

  return {
    eventCount: collapsed.length,
    medianGapDays,
    envelopeDays,
    openGapDays,
    silent: collapsed.length > 0 && openGapDays > envelopeDays,
    stretching,
    calendarLocked: isCalendarLocked(dates),
    rayleighP: rayleigh.p,
  };
}

/** S mapped to [0,1]: log-scaled, one year of proven survival = 1. */
export function stabilityNorm(stabilityDays: number): number {
  const s = Math.max(0, Number.isFinite(stabilityDays) ? stabilityDays : 0);
  return Math.min(
    1,
    Math.log(1 + s / STABILITY_INITIAL_DAYS) /
      Math.log(1 + STABILITY_NORM_HORIZON_DAYS / STABILITY_INITIAL_DAYS),
  );
}

/**
 * Distinct capture channels → [0,1]. One channel is zero diversity (one
 * newsletter echoing is one exposure); four or more is full.
 */
export function sourceDiversity(distinctChannelCount: number): number {
  const n = clamp(distinctChannelCount, 0, SOURCE_DIVERSITY_REFERENCE_CHANNELS);
  return Math.max(0, (n - 1) / (SOURCE_DIVERSITY_REFERENCE_CHANNELS - 1));
}

/** Importance ∈ [0,100]: proven stability, tempered by source diversity. */
export function importanceScore(
  stabilityDays: number,
  distinctChannelCount: number,
): number {
  return (
    100 *
    Math.pow(stabilityNorm(stabilityDays), IMPORTANCE_STABILITY_EXPONENT) *
    Math.pow(
      Math.max(sourceDiversity(distinctChannelCount), SOURCE_DIVERSITY_FLOOR),
      IMPORTANCE_DIVERSITY_EXPONENT,
    )
  );
}

/**
 * Discovery = Importance × (1 − Awareness): durably important AND absent
 * from everything the person has said out loud. The founding promise as a
 * ranking — "ambitions reveal themselves, including ones I never knew I
 * had."
 */
export function discoveryScore(importance: number, awareness: number): number {
  return Math.max(0, importance) * (1 - clamp(awareness, 0, 1));
}
