/**
 * HOW LONG THE CARD'S SAVE MAY HOLD THE BAR (review, 2026-10-21).
 *
 * While the memory card's save is out, a press away from the card is refused
 * and the card says "Save or cancel this edit first."
 * (`docs/plans/card-and-archive.md`). A save that never answers must not
 * leave the bar dead, so past this deadline the card's line also offers
 * Cancel edit.
 */
export const LEAVE_DEADLINE_MS = 20_000;
