/**
 * Signal activation math — the leaky integrate-and-fire core of the spark
 * engine (docs/brain-inspired-spark-engine.md).
 *
 * Everything here is pure: charges in, decayed potentials out. The design
 * constraint that makes the product promise real — "signals that matter
 * little alone spark together" — is encoded in three places:
 *
 *   1. Every single charge is clamped well below the firing threshold, so
 *      no lone event can fire. Only temporal summation can.
 *   2. Firing requires at least FIRE_MIN_CONTRIBUTORS distinct charged
 *      neighbors. A single strong pair is the existing WOW pipeline's job;
 *      this path exists only for accumulation.
 *   3. The threshold adapts to archive size, so a first-week user with a
 *      dozen signals can experience their first convergence spark, while a
 *      dense archive must earn it (the LLM judge gates quality either way).
 *
 * Decay is lazy — stored rows keep (activation, activatedAt) and the
 * half-life is applied at read time — mirroring how FreshnessDecay avoids
 * DB rewrite churn in the score pipeline.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Activation halves every 7 days without new charge. */
export const ACTIVATION_HALF_LIFE_DAYS = 7;

/** A signal can never hold more than this much charge, however loved. */
export const ACTIVATION_CEILING = 1;

/**
 * Charge injected per event. A new capture charges its semantic *neighbors*
 * (scaled by similarity); the other events charge the signal itself.
 * All values are deliberately sub-threshold (see module header).
 */
export const ACTIVATION_CHARGES = {
  neighbor_capture: 0.3,
  reflection_created: 0.25,
  detail_opened: 0.15,
  detail_returned: 0.15,
  inspiration_updated: 0.1,
  /**
   * A capture charges its *neighbors* (`neighbor_capture`), never itself: a
   * signal is not made important by the act of being written down. The entry
   * exists so the charge map stays total over the revisit event enum — a
   * missing key would make `chargeForEvent` return undefined and poison
   * activation with NaN.
   */
  capture_saved: 0,
} as const;

export type ActivationChargeEvent = keyof typeof ACTIVATION_CHARGES;

/** Firing needs at least this many distinct charged neighbors. */
export const FIRE_MIN_CONTRIBUTORS = 3;

/** A neighbor only counts as a contributor above this decayed activation. */
export const FIRE_CONTRIBUTOR_ACTIVATION_FLOOR = 0.2;

/** …and above this cosine similarity to the trigger. */
export const FIRE_CONTRIBUTOR_SIMILARITY_FLOOR = 0.35;

/** Threshold for a dense archive (peerCount ≥ reference). */
export const FIRE_THRESHOLD_MAX = 1.2;

/** Archive size at which the threshold reaches its maximum. */
export const FIRE_THRESHOLD_REFERENCE_PEERS = 30;

/** Cold-start floor: the threshold never drops below this fraction of max. */
export const FIRE_THRESHOLD_FLOOR_RATIO = 0.4;

/** A signal's own activation must reach this before we bother evaluating. */
export const FIRE_CHECK_SELF_TRIP = 0.35;

/** Minimum time between neighborhood evaluations for one signal. */
export const FIRE_CHECK_COOLDOWN_HOURS = 24;

export interface ActivationState {
  activation: number;
  activatedAt: Date;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** The activation a stored state has *now*, after lazy exponential decay. */
export function decayedActivation(state: ActivationState, now: Date): number {
  const elapsedDays = Math.max(0, now.getTime() - state.activatedAt.getTime()) / DAY_MS;
  return clamp(
    state.activation * Math.pow(0.5, elapsedDays / ACTIVATION_HALF_LIFE_DAYS),
    0,
    ACTIVATION_CEILING,
  );
}

/**
 * Fold a new charge into an existing state: decay what is there, add the
 * charge, clamp to the ceiling. `previous: null` means first-ever charge.
 */
export function foldActivationCharge(
  previous: ActivationState | null,
  charge: number,
  now: Date,
): ActivationState {
  const base = previous ? decayedActivation(previous, now) : 0;
  return {
    activation: clamp(base + charge, 0, ACTIVATION_CEILING),
    activatedAt: now,
  };
}

/** Charge for a self event (revisit, reflection, edit). */
export function chargeForEvent(event: ActivationChargeEvent): number {
  return ACTIVATION_CHARGES[event];
}

/** Charge a neighbor receives when a related signal is captured. */
export function neighborCaptureCharge(similarityToNewSignal: number): number {
  return ACTIVATION_CHARGES.neighbor_capture * clamp(similarityToNewSignal, 0, 1);
}

/**
 * Adaptive firing threshold. Scales linearly with archive size up to the
 * reference count, with a floor so tiny archives are reachable but never
 * free: θ(peers) = θ_max · clamp(peers / reference, floor_ratio, 1).
 */
export function adaptiveFiringThreshold(peerCount: number): number {
  const ratio = clamp(
    peerCount / FIRE_THRESHOLD_REFERENCE_PEERS,
    FIRE_THRESHOLD_FLOOR_RATIO,
    1,
  );
  return FIRE_THRESHOLD_MAX * ratio;
}

export interface NeighborhoodMember extends ActivationState {
  similarityToTrigger: number;
}

export interface FiringEvaluation {
  fired: boolean;
  potential: number;
  threshold: number;
  contributorCount: number;
}

/**
 * Evaluate whether an accumulated neighborhood fires. Contributors are the
 * members that are both semantically close and still warm; the potential is
 * their similarity-weighted decayed activation.
 */
export function evaluateNeighborhoodFiring(input: {
  members: NeighborhoodMember[];
  peerCount: number;
  now: Date;
}): FiringEvaluation {
  const threshold = adaptiveFiringThreshold(input.peerCount);

  let potential = 0;
  let contributorCount = 0;
  for (const member of input.members) {
    if (member.similarityToTrigger < FIRE_CONTRIBUTOR_SIMILARITY_FLOOR) continue;
    const act = decayedActivation(member, input.now);
    if (act < FIRE_CONTRIBUTOR_ACTIVATION_FLOOR) continue;
    contributorCount += 1;
    potential += act * member.similarityToTrigger;
  }

  return {
    fired: contributorCount >= FIRE_MIN_CONTRIBUTORS && potential >= threshold,
    potential,
    threshold,
    contributorCount,
  };
}

/** Refractory guard: has enough time passed since the last evaluation? */
export function shouldRunFireCheck(
  lastFireCheckAt: Date | null,
  now: Date,
): boolean {
  if (!lastFireCheckAt) return true;
  return (
    now.getTime() - lastFireCheckAt.getTime() >=
    FIRE_CHECK_COOLDOWN_HOURS * 60 * 60 * 1000
  );
}
