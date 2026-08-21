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
