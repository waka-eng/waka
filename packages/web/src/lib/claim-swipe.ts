/**
 * THE SWIPE, DECIDED WITHOUT A BROWSER.
 *
 * Founder, 2026-10-15: "drag on laptop, swipe on mobile, to give this sense
 * of a very easy yes or no." The first card was swiped up and down; the slip
 * that replaced it (`ClaimSlip`) is thrown sideways to answer and pulled down
 * to talk, and asks this module both questions.
 *
 * ONE AXIS AT A TIME. The caller hands in travel along whichever axis the
 * gesture locked to, and gets back which way it went — "up" for negative
 * travel (up, or left), "down" for positive (down, or right). What a
 * direction MEANS is the caller's to say.
 *
 * The slip follows the pointer; what this module decides is whether a
 * release COMMITS. It takes its measurements as arguments rather than
 * reading the DOM, for the same reason `canvas/scale.ts` takes a device
 * ratio: the rule can be checked by a test that never mounts anything, and
 * the component that uses it stays a thin pair of hands.
 *
 * TWO WAYS TO COMMIT, because a thumb and a mouse move differently.
 *
 *   DISTANCE. Past `COMMIT_FRACTION` of the card's own height, whichever
 *   way it is moving. The card
 *   is the unit, not the screen: a tall phone and a short laptop window
 *   should ask for the same gesture relative to the thing being moved.
 *   A third, not the 40% first tried: measured in a browser, a deliberate
 *   half-inch drag on a phone settled back, and "very easy" was the brief.
 *
 *   FLICK. A short, fast move commits too. Tinder's rule, and Apple's
 *   sheets: a gesture that is clearly going somewhere does not have to
 *   arrive. `FLICK_MIN_PX` keeps a twitch from counting — a fast move of
 *   a few pixels is a tap that wobbled, not a decision.
 */

/** Fraction of the card's height the pointer must travel to commit. */
export const COMMIT_FRACTION = 0.33;
/** Pixels per millisecond above which a shorter move still commits. */
export const FLICK_VELOCITY = 0.45;
/** The least a flick may travel and still be read as one. */
export const FLICK_MIN_PX = 24;
/** Below this the card does not move at all, so a tap on the statement or
    on the "from" line stays a tap. */
export const DRAG_SLOP_PX = 6;

export type SwipeDirection = "up" | "down";

export interface SwipeRelease {
  /** Travel along the locked axis since the pointer went down; negative is up or left. */
  dy: number;
  /** The card's rendered height, the unit the distance rule is measured in. */
  height: number;
  /** Pixels per millisecond along the same axis over the last stretch of the move. */
  velocity: number;
}

/** What a release means: an answer, or nothing (the card settles back). */
export function decideSwipe({ dy, height, velocity }: SwipeRelease): SwipeDirection | null {
  const far = height > 0 && Math.abs(dy) >= height * COMMIT_FRACTION;
  const flick = Math.abs(velocity) >= FLICK_VELOCITY && Math.abs(dy) >= FLICK_MIN_PX;
  if (!far && !flick) return null;
  /* A FLICK BACK IS A CHANGE OF MIND. Short of the distance, a flick only
     answers in the direction it is thrown: a card dragged one way and then
     thrown back toward the middle is being taken back, not sent (review,
     2026-10-15 — it used to file the answer the card had been dragged
     toward). Past the distance, where the card sits is the answer. */
  if (!far && Math.sign(velocity) !== Math.sign(dy)) return null;
  return dy < 0 ? "up" : "down";
}

/** How far the card is from committing, 0 to 1, for the light that rises
    as the answer forms. Shown, never decided on. */
export function swipeProgress(dy: number, height: number): number {
  if (height <= 0) return 0;
  return Math.min(1, Math.abs(dy) / (height * COMMIT_FRACTION));
}
