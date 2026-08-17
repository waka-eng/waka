/**
 * LAYER ONE — THE FIELD: how an inspiration LOOKS, and where it comes to rest.
 *
 * `orb.ts` beside this file says what an inspiration IS. This says what the
 * field does with one: how bright it is for its age (`colorBall`), which size
 * band its sprite comes from (`tierOf`), how tightly a whole field has to pack
 * to fit the band it is given (`fitField`), and where in that band any one orb
 * settles (`scatterX`).
 *
 * One reason to exist: every function here is pure geometry or pure light —
 * given an orb and a number, it returns a number. Nothing schedules a frame,
 * nothing touches a canvas, nothing knows React exists. That is what lets the
 * page call them from inside the loop without the loop owning them.
 */
import {
  FIELD_CITED_LIFT,
  FIELD_DECAY_HALF_LIFE_DAYS,
  FIELD_FLOOR_ANSWERED,
  FIELD_FLOOR_CITED,
  FIELD_FLOOR_IN_GROUP,
  FIELD_FRONTIER_DAYS,
  FIELD_REFLECTION_SATURATION,
  FIELD_REFLECTION_WEIGHT,
} from "../../lib/aliveness";
import { clamp, clamp01, DAY_MS } from "../../lib/num";
import { SIZE_R, TIERS } from "../../canvas/sprites";
import type { Ball } from "./orb";

/** However crowded the field gets, an orb never shrinks past this. */
export const ORB_R_MIN = 6;

/**
 * THE FOCUS LAW, AS RATES — how fast light arrives and how slowly it leaves.
 *
 * Each is the fraction of the distance still remaining one second later, fed
 * to `kd()` with the frame's own dt, so all of these mean the same thing on a
 * 60Hz Android and a 120Hz iPhone. They were per-frame constants (0.14, 0.16,
 * 0.2) and therefore meant two different things on the two devices sitting
 * side by side.
 *
 * They live HERE, with the field, and not with whoever happens to read them.
 * They sat in Home.tsx for as long as the page was the only thing that eased
 * anything, in a block of twelve that also held the camera's rubber band and
 * the companion's turn. Then the sky engine moved out to `space/signal/
 * sky-engine.ts` and took a satellite's glow and dim with it — and a satellite
 * IS a field orb, shown as evidence, so the two must fade on ONE curve or the
 * same memory answers a selection two different ways depending on which
 * section you are looking at it in. Copying five numbers into the new module
 * is exactly how that drifts apart. The other seven eases stayed in the page:
 * they belong to a camera and a character, and nothing outside the loop reads
 * them.
 */
export const EASE_LIGHT = 1.2e-4;
/** Light in fast, out slow: τ ≈ 28ms arriving, ≈ 180ms leaving. */
export const EASE_GLOW_IN = 1e-16;
export const EASE_GLOW_OUT = 3.8e-3;
/** The haze the other way round: it closes in slowly and lifts briskly. */
export const EASE_DIM_IN = 1.1e-2;
export const EASE_DIM_OUT = 4.5e-4;

/**
 * Aliveness mirrors the real activation engine's constants (7-day half-life,
 * reflection charge 0.25 — scoring/activation.ts). With the live archive's
 * June–July gap most balls WILL be dim; that is honest and desired.
 */
export function colorBall(b: Ball, T: number): void {
  const ref = Math.min(Math.max(b.updatedMs, b.capturedMs), T);
  const days = Math.max(0, (T - ref) / DAY_MS);
  const decay = Math.pow(0.5, days / FIELD_DECAY_HALF_LIFE_DAYS);
  /**
   * WHAT YOU BUILT ON DOES NOT ROT.
   *
   * Every memory used to decay on the same curve — including the ones a
   * pattern is standing on and the ones you came back and answered. Animal
   * Crossing has the better rule and has had it for twenty years: weeds grow
   * in the parts of the island you never developed, and never in the parts
   * you did. Come back after two months and what you made is exactly as you
   * left it; only the untended edges show the time.
   *
   * So a memory that is load-bearing — cited by a pattern, or answered in
   * your own words — has a floor under it and cannot sink to dark. The rest
   * of the field still fades exactly as it did, which is where the passage
   * of time is supposed to be visible.
   */
  const tended =
    (b.hasNotes ? FIELD_FLOOR_CITED : 0) +
    (b.reflections > 0 ? FIELD_FLOOR_ANSWERED : 0) +
    (b.hasGroup ? FIELD_FLOOR_IN_GROUP : 0);
  const a = clamp01(
    Math.max(
      decay +
        FIELD_REFLECTION_WEIGHT *
          Math.min(b.reflections, FIELD_REFLECTION_SATURATION) *
          decay,
      tended,
    ) + (b.hasNotes ? FIELD_CITED_LIFT : 0),
  );
  b.alive = a;
  b.alivePow = Math.pow(a, 1.4);
  /**
   * THE FRONTIER. A memory nothing rests on is where this person's
   * self-knowledge stops — and it was the one thing the world could not show,
   * because brightness only ever said "recent". Outer Wilds' log marks the
   * places you have BEEN that still hold something unfound; it never nags
   * about somewhere you have not gone. Same rule here: only a memory old
   * enough to have been read, and still cited by nothing, is a frontier.
   */
  b.frontier = !b.hasNotes && days > FIELD_FRONTIER_DAYS;
}

/**
 * The aliveness continuum, quantised to the baked sprite tiers. Five steps is
 * below what the eye resolves in a gradient this soft, so it still reads as a
 * continuum — and it keeps every appearance pre-rendered.
 */
export function tierOf(b: Ball): number {
  return Math.round(clamp01((b.alive - 0.05) / 0.55) * (TIERS - 1));
}

/**
 * THE FIELD SHOWS EVERYTHING — INVARIANT, not a layout preference.
 *
 * Standing in the field, EVERY inspiration that exists at the dial's time is
 * on screen at once. Not a slice you scroll through, not the newest few with
 * the rest somewhere below the fold: all of them, on every wall, at every
 * viewport height. The founder has asked for this twice, and the honest way
 * to keep the promise as an archive grows is to make the ORBS give way, not
 * the archive: the field fits its inhabitants by shrinking them and their
 * drift, down to a floor, and past that floor the oldest compress into denser
 * sediment at the bottom rather than anything being pushed off the screen.
 *
 * Size still encodes nothing. It is the field making room, which is a fact
 * about the field and not about any memory in it.
 */
export function fitField(arr: Ball[], bandW: number, bandH: number): number {
  const n = Math.max(arr.length, 1);
  /* the radius at which n of them share this band without stacking */
  const fitR = Math.sqrt((bandW * bandH) / n) / 2.6;
  for (const b of arr) {
    const r = clamp(Math.min(b.rBase, fitR), ORB_R_MIN, b.rBase);
    b.r = r;
    /* nearest baked size, so nothing is ever scaled by more than a few
       percent — the sphere's rim and specular only survive at 1:1 */
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < SIZE_R.length; i++) {
      const d = Math.abs(SIZE_R[i] - r);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    if (SIZE_R[bi] > r && bi > 0) bi -= 1;
    b.sizeIdx = bi;
    /* and it is DRAWN at the size it was baked at. The radius jitter was
       always meaningless variation — size encodes nothing here, by law — so
       snapping it to a baked value costs the design nothing and buys a
       pixel-exact edge on every orb in the field.

       DOWN, NEVER UP. The radius arriving here is what the band could FIT;
       rounding it up would hand every orb a few extra pixels at exactly the
       moment the field is crowded enough for that to matter, and the fit
       would quietly stop holding. The smallest baked size is the floor. */
    b.r = SIZE_R[bi];
    /* the drift shrinks with the orb, or a crowded field would stir itself
       into a collision every few seconds */
    const k = r / Math.max(b.rBase, 1);
    b.ampX = b.ampBaseX * k;
    b.ampY = b.ampBaseY * k;
  }
  /* 0 while there is room to spare, 1 once even the floor is crowded: how
     hard the oldest have to be compressed to keep everyone on screen */
  return clamp01((n * Math.pow(2.6 * ORB_R_MIN, 2)) / Math.max(bandW * bandH, 1));
}

/**
 * Blue-noise-ish x for a home assignment: the best of up to 12 candidates by
 * clearance from what is already placed. Shared by the personal field and by
 * every room's field — the same discipline, one column over.
 */
export function scatterX(
  b: Ball,
  y: number,
  px: number[],
  py: number[],
  lo: number,
  hi: number,
): number {
  let best = (lo + hi) / 2;
  let bestGap = -1;
  for (let tries = 0; tries < 12; tries++) {
    /* the twelve draws are the BALL's, not the moment's — see Ball.scat */
    const cand = lo + b.r + b.scat[tries] * Math.max(1, hi - lo - b.r * 2);
    let gap = Infinity;
    for (let i = 0; i < px.length; i++) {
      const dx = cand - px[i];
      const dy = y - py[i];
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < gap) gap = d;
    }
    if (gap > bestGap) {
      bestGap = gap;
      best = cand;
    }
    if (gap > b.r * 2.2) break;
  }
  return clamp(best, lo + b.r, hi - b.r);
}
