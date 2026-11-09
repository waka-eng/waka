/**
 * ═══ THE WALK, AS BEATS ═══════════════════════════════════════════════════
 *
 * The creature's walk, stated once: a quarter turn to face the way it goes
 * (`turnedPose`'s `yaw`), three steps — a bob per step, the nubs trading
 * heights (`stride`), a small landing squash, a lean into the direction — and
 * a quarter turn back to face you. Two callers draw it:
 *
 *   `CrossingCompanion` walks IN PLACE between Now and Principles while the
 *   sky streams past behind it;
 *   `WalkingCompanion` (onboarding's "find your people") actually travels,
 *   reading `travel` to move across the page while the same feet step.
 *
 * Extracted from `CrossingCompanion` unchanged (2026-11), so the two walks are
 * one walk; a change to a step changes both.
 */
import { clamp01, easeInOut as ease } from "../lib/num";

/** The quarter turn, each way. Quick: the turn IS the acknowledgement. */
export const WALK_TURN_MS = 240;
/** The steps between the turns — long enough for `WALK_STEPS`. */
export const WALK_STEPS_MS = 900;
const WALK_STEPS = 3;
/** Turn, walk, turn back. */
export const WALK_MS = WALK_TURN_MS * 2 + WALK_STEPS_MS;
/** How high a step lifts the body, as a fraction of its size. */
const WALK_BOB = 0.07;
/** How far it leans into the walk, in radians at full stride. */
const WALK_LEAN = 0.07;
/** The squash as a foot lands, at its deepest. */
const WALK_LAND = 0.05;

export interface WalkBeat {
  /** The planet turn: 0 faces you, ±π/2 faces the way it walks. */
  yaw: number;
  /** Lift above the ground, in the caller's px. */
  bob: number;
  /** -1…1, which nub is up. */
  stride: number;
  /** Radians, into the direction of travel. */
  lean: number;
  /** Landing squash, 0…`WALK_LAND`. */
  land: number;
  /** 0 before the first step, 1 after the last: how far along the way it is. */
  travel: number;
}

/** The walk at `w` ms after it began, for a body of `size` px going `dir`. */
export function walkBeat(w: number, dir: 1 | -1, size: number): WalkBeat {
  const turnIn = ease(clamp01(w / WALK_TURN_MS));
  const turnOut = ease(clamp01((w - WALK_TURN_MS - WALK_STEPS_MS) / WALK_TURN_MS));
  const yaw = dir * (Math.PI / 2) * (turnIn - turnOut);
  const walking = clamp01((w - WALK_TURN_MS * 0.5) / (WALK_STEPS_MS + WALK_TURN_MS * 0.5)) * (1 - turnOut);
  const along = clamp01((w - WALK_TURN_MS) / WALK_STEPS_MS);
  const phase = along * WALK_STEPS * Math.PI;
  const inWalk = w > WALK_TURN_MS && w < WALK_TURN_MS + WALK_STEPS_MS;
  return {
    yaw,
    bob: inWalk ? Math.abs(Math.sin(phase)) * size * WALK_BOB : 0,
    stride: inWalk ? Math.sin(phase) : 0,
    lean: dir * WALK_LEAN * walking,
    land: inWalk ? Math.pow(1 - Math.abs(Math.sin(phase)), 6) * WALK_LAND : 0,
    travel: along,
  };
}

/** Room around a walking body for the bob and lean, beyond the rest pose's
    own bleed, as a fraction of its size. */
export const WALK_HEADROOM = 0.12;

/** Where the squash pivots: the body's feet, below its centre by this much. */
const WALK_FEET = 0.45;

/**
 * Put the context where a stepping body of `size` is drawn, centred in a
 * `box`-wide canvas: lifted by the bob, leaned, squashed from its feet. The
 * caller then draws `turnedPose` at the origin. `squash` is the beat's `land`
 * plus anything the caller adds (the crossing's crouch and stretch).
 */
export function placeStep(g: CanvasRenderingContext2D, size: number, box: number, beat: Pick<WalkBeat, "bob" | "lean">, squash: number): void {
  g.translate(box / 2, box / 2 - beat.bob);
  g.rotate(beat.lean);
  g.translate(0, size * WALK_FEET);
  g.scale(1 + squash, 1 - squash);
  g.translate(-size / 2, -size / 2 - size * WALK_FEET);
}
