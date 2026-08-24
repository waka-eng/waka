/**
 * ALIVENESS — how bright a memory is, and the constants that decide it.
 *
 * These were eight literals inside the render loop: 7, 0.34, 0.18, 0.1, 0.25,
 * 2, 0.12, 3. Brightness is the only meaning channel this product has, so
 * those eight numbers were a scoring model — an unnamed one, sitting beside a
 * documented one it disagreed with.
 *
 * `docs/generation.md` names every constant the backend scores with, and
 * `generation-doc.test.ts` fails CI when one drifts from the code. These are
 * now in that document for the same reason: a number that decides what a
 * person sees should be as reviewable as a number that decides what the
 * machine concludes.
 *
 * WHERE THEY DELIBERATELY DIFFER FROM THE BACKEND, AND WHY.
 *
 * The backend decays confidence with a 45-day half-life and selects for the
 * top of mind with a 30-day one. The field is faster on purpose: those two
 * govern what the machine CONCLUDES over months, and this governs what a
 * person SEES on a surface they may open daily. A field that took a month to
 * visibly change would not show the passage of time at all — which is the one
 * job it has.
 *
 * That is an argument, not a fact, and it is written here so it can be argued
 * with. What is not acceptable is the previous state: the same idea carrying
 * two different numbers, in two places, with nothing connecting them.
 */

/** Half-life of an untended memory's light, in days. Backend analogues: 45
    (confidence) and 30 (selection) — see the note above for why this is faster. */
export const FIELD_DECAY_HALF_LIFE_DAYS = 7;

/** Attention stops adding light past this many reflections. The backend
    saturates evidence at 6; this is lower because it counts a person's
    returns to ONE memory, not a pattern's accumulation across many. */
export const FIELD_REFLECTION_SATURATION = 2;

/** How much each returned reflection adds, as a fraction of current decay. */
export const FIELD_REFLECTION_WEIGHT = 0.25;

/**
 * FLOORS — what cannot sink to dark, and by how much.
 *
 * A memory that is load-bearing does not rot: cited by a pattern, answered in
 * your own words, or out loud in a group. Animal Crossing's rule — weeds grow
 * where you never built, never where you did.
 */
export const FIELD_FLOOR_CITED = 0.34;
export const FIELD_FLOOR_ANSWERED = 0.18;
export const FIELD_FLOOR_IN_GROUP = 0.1;

/**
 * A citation lifts a memory ABOVE its floor as well as setting one.
 *
 * This was a second `+0.12` for `hasNotes` in the same expression that already
 * counted it at 0.34 — the same fact twice, and no way to tell whether that
 * was deliberate. It is deliberate: being cited both stops a memory sinking
 * AND makes it brighter than an equally old one that is not. Named so the
 * double counting is a decision rather than a suspicion.
 */
export const FIELD_CITED_LIFT = 0.12;

/** Untouched for longer than this, and cited by nothing, is a frontier. */
export const FIELD_FRONTIER_DAYS = 3;

/**
 * THE CARRY — how much of this person's self-knowledge a memory is holding up.
 *
 * Being cited used to be a BOOLEAN, and so every memory a pattern rested on
 * was lit exactly alike: the one save that a principle, the poster and three
 * patterns all stand on looked the same as the one a single emerging pattern
 * mentions once. The field's only channel was answering "is anything above
 * this?" when the question a person actually has is "how much of me is
 * standing on this?" (founder, 2026-08-24).
 *
 * Three facts, one per layer above the ground, all of them already known to
 * the client:
 *
 *   ROOTS      — how many patterns cite this memory (layer 2). Saturating at
 *                the same count that promotes a signal, so a memory holding
 *                up a full pattern's worth of evidence is at the top of this
 *                term rather than at some number chosen for the light.
 *   THE POSTER — a pattern citing it is cited by the live top of mind (layer
 *                3): this memory is under what currently matters.
 *   A PRINCIPLE— a pattern citing it is cited by a principle (layer 4): it is
 *                under something the person has settled.
 *
 * The three shares sum to one, so `carryOf` returns a clean 0..1 and the
 * spread it buys is one named constant rather than an emergent maximum.
 *
 * WHAT THIS DELIBERATELY IS NOT. It is not a score of the memory's worth, and
 * it never renders as one — there is no badge, no count, no bar anywhere. It
 * moves light, which is the world's only meaning channel, and light is a
 * state: bright means load-bearing, dim means nothing rests here yet. A
 * person reads the difference without being told a number, which is the whole
 * argument for having a single channel.
 */
export const FIELD_CARRY_ROOT_SATURATION = 3;
export const FIELD_CARRY_ROOTS_SHARE = 0.4;
export const FIELD_CARRY_POSTER_SHARE = 0.3;
export const FIELD_CARRY_PRINCIPLE_SHARE = 0.3;

/**
 * The extra light a fully-carrying memory holds over a barely-cited one.
 *
 * `FIELD_FLOOR_CITED` is still what being cited AT ALL is worth — one root
 * and nothing above it, and the memory already cannot rot. This is the span
 * above that floor, so the field reads as a gradient of load rather than as
 * two brightnesses.
 */
export const FIELD_CARRY_SPAN = 0.5;

/** What a memory is holding up, in 0..1. Pure; the field's only reader. */
export function carryOf(input: {
  roots: number;
  onPoster: boolean;
  underPrinciple: boolean;
}): number {
  const roots =
    Math.min(Math.max(input.roots, 0), FIELD_CARRY_ROOT_SATURATION) /
    FIELD_CARRY_ROOT_SATURATION;
  const carry =
    FIELD_CARRY_ROOTS_SHARE * roots +
    (input.onPoster ? FIELD_CARRY_POSTER_SHARE : 0) +
    (input.underPrinciple ? FIELD_CARRY_PRINCIPLE_SHARE : 0);
  return Math.min(Math.max(carry, 0), 1);
}
