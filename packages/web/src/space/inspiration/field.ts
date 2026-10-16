/**
 * LAYER ONE — THE FIELD: how an inspiration LOOKS, and where it comes to rest.
 *
 * `orb.ts` beside this file says what an inspiration IS. This says what the
 * field does with one: how bright it is for its age (`colorBall`), how
 * tightly a whole field has to pack to fit the band it is given
 * (`fitField`), and where in that band any one orb settles (`scatterX`).
 *
 * One reason to exist: every function here is pure geometry or pure light —
 * given an orb and a number, it returns a number. Nothing schedules a frame,
 * nothing touches a canvas, nothing knows React exists. That is what lets the
 * page call them from inside the loop without the loop owning them.
 */
import {
  carryOf,
  FIELD_ATTENTION_SPAN,
  FIELD_CARRY_SPAN,
  FIELD_RECENCY_WEIGHT,
  FIELD_DECAY_HALF_LIFE_DAYS,
  FIELD_FLOOR_ANSWERED,
  FIELD_FLOOR_CITED,
  FIELD_FRONTIER_DAYS,
  FIELD_REFLECTION_SATURATION,
  FIELD_REFLECTION_WEIGHT,
} from "../../lib/aliveness";
import { clamp, clamp01, DAY_MS } from "../../lib/num";
import { SIZE_R, sizeIdxFor } from "../../canvas/sprites";
import type { Ball } from "./orb";

/** However crowded the field gets, an orb never shrinks past this. */
export const ORB_R_MIN = 6;

/* THE FOCUS LAW'S RATES WENT WITH THE ORBS. `EASE_GLOW_*` and `EASE_DIM_*`
   were how fast an orb's light arrived and how slowly it left, kept here so
   a field orb and a sky satellite faded on one curve. Nothing draws an orb
   now, and the loop stopped easing light nobody sees. */

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
  /**
   * AND HOW MUCH IT HOLDS UP DECIDES HOW FAR ABOVE THE FLOOR IT STANDS.
   *
   * Being cited was a boolean, so every load-bearing memory was lit exactly
   * alike: the save a principle, the poster and three patterns all rest on
   * looked the same as the one a single emerging pattern mentions once. The
   * carry grades that (`carryOf`, lib/aliveness.ts) — roots, then the poster,
   * then a principle — and the span it buys sits ON TOP of the cited floor,
   * so being cited at all still means "cannot rot" and the rest of the range
   * says how much of this person is standing here. Founder, 2026-08-24.
   */
  const carry = b.hasNotes
    ? carryOf({
        roots: b.roots,
        promotion: b.promotion,
        onPoster: b.onPoster,
        underPrinciple: b.underPrinciple,
      })
    : 0;
  const tended =
    (b.hasNotes ? FIELD_FLOOR_CITED : 0) +
    (b.reflections > 0
      ? FIELD_FLOOR_ANSWERED +
        FIELD_ATTENTION_SPAN *
          (Math.min(b.reflections, FIELD_REFLECTION_SATURATION) /
            FIELD_REFLECTION_SATURATION)
      : 0);
  /* A THIRD FLOOR STOOD HERE: `b.hasGroup ? FIELD_FLOOR_IN_GROUP : 0`, a
     tenth of the range for a memory with a shared pattern resting on it.
     Rooms went on 2026-10-12 (founder: "방 없애"), `Signal.sharedGroupIds`
     with them, and the flag could no longer be true. Cited and answered are
     the two floors there are. */
  /* RECENCY IS CAPPED; THE CARRY RIDES ABOVE EVERYTHING. A memory kept this
     morning used to hit the max and clamp the whole young field to one flat
     top band (see FIELD_RECENCY_MAX). Now freshness can only carry a memory
     so far, and the room above belongs to use: the carry is ADDED on top of
     whichever of recency and the floors is winning, so a cited memory
     outshines an uncited twin whatever their shared age is — which is the
     founder's ruling, at both ends of an archive's life. */
  /* Freshness SCALES across its own share of the range rather than being
     capped into it — a cap returned the same value for everything kept in
     the last week and erased the gradient at the end of the archive a person
     reads most (see FIELD_RECENCY_WEIGHT, and the measurement in its note). */
  const recency =
    FIELD_RECENCY_WEIGHT *
    Math.min(
      decay +
        FIELD_REFLECTION_WEIGHT *
          Math.min(b.reflections, FIELD_REFLECTION_SATURATION) *
          decay,
      1,
    );
  /* AGE SITS ON TOP OF THE FLOORS RATHER THAN COMPETING WITH THEM, and the
     `Math.max` this replaces was a dead channel with a date on it: freshness
     can only ever reach `FIELD_RECENCY_WEIGHT`, the cited floor is already
     most of the way there, so past about five days the max returned the floor
     and AGE CONTRIBUTED EXACTLY ZERO — forever, for every cited memory in the
     archive — against this module's own header, which calls showing the
     passage of time the one job it has. Now freshness spends its share of
     whatever room is left above the floor: a memory that is cited, answered
     and in a room has less of that room to spend, which is right, because by
     then what it is holding up matters more than when it arrived. */
  const a = clamp01(tended + (1 - tended) * recency + FIELD_CARRY_SPAN * carry);
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

/* `tierOf` WENT WITH THE SPRITES IT INDEXED: it quantised `alive` into the
   baked bands an orb was drawn from. `alive` itself is still the light. */


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
       percent — the sphere's rim and specular only survive at 1:1. The rule
       lives in `sizeIdxFor` because it was written here and NOT written in the
       two places that build a ball, and that divergence is what made every
       orb outside a fit a blurry one. */
    const bi = sizeIdxFor(r);
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
