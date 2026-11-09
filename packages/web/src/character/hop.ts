/**
 * ═══ THE KEEP'S HOP ═══════════════════════════════════════════════════════
 *
 * When something is kept, the world's creature gathers itself (a small
 * squash, `ANTICIPATE_*`) and releases into two bounces, the second lower —
 * a creature that is delighted, not one bouncing on a spring. The world's loop
 * reads these; so does onboarding's creature, when an answer lands in it and
 * when it hops from one place on the page to the next.
 */
import { clamp01 } from "../lib/num";

/** The gather before the hop. */
export const ANTICIPATE_MS = 130;
/** The keep's hop: two bounces over this long, the second lower. */
export const HOP_MS = 720;
/** How far it compresses at the bottom of the gather. Squash, so positive. */
export const ANTICIPATE_SQ = 0.03;
/** How high a bounce goes, as a fraction of the body's size. */
const HOP_HEIGHT = 0.14;
/** How much lower the second bounce is than the first. */
const HOP_DECAY = 0.45;

/** Lift at `t` (0…1 through `HOP_MS`), negative is up, for a body of `size`. */
export function hopLift(t: number, size: number): number {
  const u = clamp01(t);
  return u > 0 && u < 1 ? -Math.abs(Math.sin(Math.PI * 2 * u)) * size * HOP_HEIGHT * (1 - u * HOP_DECAY) : 0;
}

/** One arc of the same hop, for a creature that travels while it hops:
    the first bounce alone, stretched over the trip. */
export function hopArc(t: number, size: number): number {
  const u = clamp01(t);
  return -Math.sin(Math.PI * u) * size * HOP_HEIGHT;
}
