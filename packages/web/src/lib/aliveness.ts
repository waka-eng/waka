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
 * your own words. (It read "or out loud in a group" until rooms went.)
 * Animal Crossing's rule — weeds grow
 * where you never built, never where you did.
 */
export const FIELD_FLOOR_CITED = 0.15;
export const FIELD_FLOOR_ANSWERED = 0.18;
/* `FIELD_FLOOR_IN_GROUP = 0.1` IS GONE. A memory sat a tenth of the way up
   the field's range when a pattern resting on it had been shared into a
   room — the "out loud in a group" half of the sentence above, and the only
   floor in this file that depended on anything outside the account. Rooms
   were removed on 2026-10-12 (founder: "방 없애"), `Signal.sharedGroupIds`
   went with them, and nothing could set the flag true any more. The cited
   and answered floors are untouched. */

/**
 * ATTENTION PAID SURVIVES THE WEATHER (founder, 2026-08-24: brightness must
 * say how active a memory is, and a field where nothing has been derived yet
 * was uniformly dim).
 *
 * Returning to a memory used to be worth `FIELD_REFLECTION_WEIGHT × decay` —
 * MULTIPLIED by the decay it was supposed to resist, so a memory you came
 * back to three times a month ago is lit exactly like one you never opened.
 * Attention is a thing you did; it does not un-happen because time passed.
 * So the answered floor is graded by how often you came back, on the same
 * saturation the additive term uses, and that grade does not decay.
 */
export const FIELD_ATTENTION_SPAN = 0.16;

/**
 * HOW MUCH OF THE RANGE FRESHNESS MAY SPEND — measured, not guessed.
 *
 * This was a CAP at 0.55, and a cap was the wrong instrument twice over.
 * Driving a real derived archive through `colorBall` and the sprite banding
 * the orbs were then drawn in, and printing the histogram (five memories, four of them on the poster) gave
 * tier 6 and tier 7 — ONE band apart out of nine, both crowded at the top,
 * which is exactly the "all same brightness" the founder kept reporting. Two
 * causes, both visible in that measurement:
 *
 *   A CAP FLATTENS THE THING IT LIMITS. `min(decay, 0.55)` returns 0.55 for
 *   anything kept in the last week — decay is 1.0 today and 0.5 at seven
 *   days — so every recent memory came out at the identical value and the
 *   passage of time stopped being visible at the exact end of the archive a
 *   person looks at most.
 *
 *   AND IT LEFT NO ROOM. With the cited floor and the old cited lift, an
 *   ordinary memory already sat at 0.72 before the carry contributed
 *   anything, so the whole carry range was squeezed into the top eighth.
 *
 * A WEIGHT instead: freshness scales across its own share of the range and
 * keeps its gradient, and the rest of the range belongs to use. Brightness
 * says how much of you stands on a memory; "I kept it this morning" is not
 * standing on it, but it is not nothing either.
 */
export const FIELD_RECENCY_WEIGHT = 0.25;

/* `FIELD_CITED_LIFT` was here: a second, flat +0.12 for being cited at all,
   on top of the cited floor. It was deliberate when the floor was the only
   other thing citation bought — but `carryOf` now grades exactly that, from
   the first root upward, and the flat term was pure baseline inflation: it
   pushed every cited memory into the top bands before the grading had said
   anything. Removed with its doc row rather than zeroed, so nothing carries
   a constant that means nothing. */

/** Untouched for longer than this, and cited by nothing, is a frontier. */
export const FIELD_FRONTIER_DAYS = 3;

/* `FIELD_TIER_CEILING` AND `FIELD_TIER_GAMMA` WENT WITH THE ORBS. They bent
   the aliveness continuum into the baked sprite bands an orb was drawn from
   — a gamma, because the continuum is exponential in age and a linear
   banding spent nearly every band on the first week (founder, 2026-08-24:
   two months of memories "one flat grey"). Perception, never scoring; with
   nothing drawn there is nothing to perceive, and `alive` is unchanged. */

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
/**
 * THE FOUR SHARES ARE WEIGHTED BY WHAT THEY MEAN, and the weighting was
 * settled by measurement rather than taste. An even-ish split gave a real
 * archive a one-band spread — every memory cited once, four of the five on
 * the poster, so the ONLY distinction available was poster membership and
 * one share bought one step out of nine, which reads as no difference at
 * all. Reaching what currently matters is the strongest thing a memory can
 * be doing, so it carries the largest share; a settled principle is next;
 * promotion and sheer count of roots are the quieter two.
 */
export const FIELD_CARRY_ROOTS_SHARE = 0.1;
/**
 * HOW FAR THE PATTERN ABOVE THIS MEMORY HAS GOT — and this is the term that
 * makes the light move at all in a young archive, which is the one the
 * founder has been looking at.
 *
 * It used to be a BOOLEAN: true once a citing signal reached `active`. That
 * is a cliff at three pieces of evidence with nothing on either side of it,
 * and a young archive lives entirely on the near side — every capture derives
 * its own lone candidate, so no signal is active, so the term is false for
 * every memory and contributes exactly zero variance. Re-running the real
 * modules over the repo's own fixture: thirteen of fourteen cited memories,
 * spanning nine to ninety-one days, landed on the IDENTICAL aliveness. The
 * math was right and had nothing to say, which is what "why all same
 * brightness" means, said four times.
 *
 * So it grades. A candidate with one memory behind it is a guess; with two,
 * something the loop is starting to believe; at three it promotes and the
 * term is full. That is a distinction that exists from the first week,
 * moves on every keep, and is exactly what "how active this one is being
 * used to form signals" asks for — so it holds the largest share.
 */
export const FIELD_CARRY_PROMOTED_SHARE = 0.45;
export const FIELD_CARRY_POSTER_SHARE = 0.25;
export const FIELD_CARRY_PRINCIPLE_SHARE = 0.2;
/**
 * THE EVIDENCE THAT FILLS THE PROMOTION TERM, and it is not a free number:
 * it is the loop's own promotion threshold — a signal turns `active` when
 * three memories say the same thing (`docs/generation.md`). Grading toward
 * it rather than past it means the light and the lifecycle agree about what
 * "confirmed" is, and a signal that HAS promoted lands at a full term
 * without the field having to special-case it.
 */
export const FIELD_CARRY_PROMOTION_EVIDENCE = 3;

/**
 * The extra light a fully-carrying memory holds over a barely-cited one.
 *
 * `FIELD_FLOOR_CITED` is still what being cited AT ALL is worth — one root
 * and nothing above it, and the memory already cannot rot. This is the span
 * above that floor, so the field reads as a gradient of load rather than as
 * two brightnesses.
 */
export const FIELD_CARRY_SPAN = 0.85;

/** What a memory is holding up, in 0..1. Pure; the field's only reader.
 *
 * EVERY TERM THAT CAN BE GRADED IS GRADED, and the shares are sized so that
 * one step of any of them clears one band of the drawn tier. A share that
 * buys less than a band is arithmetic nobody can see — which is how four
 * correct terms produced one flat field. */
export function carryOf(input: {
  roots: number;
  /** How far the furthest-along pattern above this memory has got, 0..1. */
  promotion: number;
  onPoster: boolean;
  underPrinciple: boolean;
}): number {
  /* THE FIRST ROOT IS THE ONE THAT MEANS MOST. Counting roots linearly made
     a single citation worth a third of its share — measured, less than one
     band, so "the loop read this and made something of it" looked exactly
     like "nothing came of this". The step from none to one is the largest
     step there is; the second and third refine it. */
  const roots = Math.sqrt(
    Math.min(Math.max(input.roots, 0), FIELD_CARRY_ROOT_SATURATION) /
      FIELD_CARRY_ROOT_SATURATION,
  );
  const carry =
    FIELD_CARRY_ROOTS_SHARE * roots +
    FIELD_CARRY_PROMOTED_SHARE * Math.min(Math.max(input.promotion, 0), 1) +
    (input.onPoster ? FIELD_CARRY_POSTER_SHARE : 0) +
    (input.underPrinciple ? FIELD_CARRY_PRINCIPLE_SHARE : 0);
  return Math.min(Math.max(carry, 0), 1);
}

/**
 * THE BULB — one brightness for the whole character, not for one memory.
 *
 * Everything above grades a single memory's light. This grades the person's,
 * and it lives in the same file for the reason the file exists: there is one
 * place where numbers that decide what a person SEES are written down, and
 * `generation-doc.test.ts` reads this path by name, so a constant here cannot
 * drift from `docs/generation.md` without failing CI.
 *
 * The character is a lightbulb, and the less you are keeping, the dimmer it
 * burns. One input: how long since you last kept anything. Not how many
 * claims wait, not how much the loop concluded — those are other facts with
 * other surfaces, and a bulb that meant four things at once would mean none
 * of them. It reuses `FIELD_DECAY_HALF_LIFE_DAYS` rather than choosing a
 * second curve, because "the field dims in a week" and "you dim in a week"
 * are the same statement about the same person and should not be tunable
 * apart.
 *
 * FADING NEVER DELETES, so the bulb has a floor. A bulb at zero does not read
 * as "you have been away"; it reads as broken, or as switched off, which is a
 * thing the product would be saying about a person rather than about their
 * week. `BULB_FLOOR` is the lowest it burns — visibly dim, unmistakably lit,
 * and in the same range as the floors that keep a load-bearing memory from
 * rotting.
 */
export const BULB_FLOOR = 0.12;

/* `bulbGlow` IS GONE — the character's light from days-since-last-kept,
   called by nothing. What replaced it first was the FIELD (the mean
   aliveness of the eight most alive notes), and that was faint for almost
   every account: aliveness spends only `FIELD_RECENCY_WEIGHT` of its range
   on freshness, so a busy week barely moved it. `savingLight` below replaced
   that in turn. */

/**
 * THE CHARACTER'S REACH IS HOW MUCH YOU HAVE BEEN SAVING (founder,
 * 2026-10-21: "the brightness should reflect how much inspirations the person
 * has been saving").
 *
 * Every save adds light that halves every `FIELD_DECAY_HALF_LIFE_DAYS` — the
 * same week the field dims in, for the reason the bulb note above gives: "the
 * field dims in a week" and "you dim in a week" are one statement and should
 * not be tunable apart. The sum is then saturated, `1 − e^(−activity / K)`,
 * because past a busy week the difference between busy and very busy is not
 * something light should try to say.
 *
 * `SAVING_LIGHT_SCALE` is K. Five saves spread over the past seven days sum to
 * about 3.5–3.8 and read at roughly two thirds; five today read at about three
 * quarters; one today at about a quarter; nothing for a month sits near dark.
 * It drives only the aura's reach — each note's own light is still its
 * aliveness — and it is never shown as a number.
 */
export const SAVING_LIGHT_SCALE = 3.5;

/** Saves' timestamps (ms) and "now" (the dial's time) → reach in [0, 1).
    A save stamped after `nowMs` has not happened yet at that time. */
export function savingLight(savedMs: Iterable<number>, nowMs: number): number {
  let activity = 0;
  for (const at of savedMs) {
    const ageDays = (nowMs - at) / 86_400_000;
    if (!(ageDays >= 0)) continue;
    activity += Math.pow(0.5, ageDays / FIELD_DECAY_HALF_LIFE_DAYS);
  }
  return 1 - Math.exp(-activity / SAVING_LIGHT_SCALE);
}
