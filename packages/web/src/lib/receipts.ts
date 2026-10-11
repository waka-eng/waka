/**
 * GESTURE RECEIPTS — what each act teaches the loop, said at the moment of
 * the act. goal: the-legible-loop, Phase 2.
 *
 * The law of this file: a receipt may claim ONLY what a named test on the
 * real pipeline enforces. `enforcedBy` is that test's repo path, and
 * `receipts.test.ts` fails the suite when a path stops existing — a receipt
 * for a law that is not enforced is the advisory-button lie the research
 * (docs/craft/the-legible-loop.md, finding 4) shows destroys trust.
 *
 * Two entries (`starHeld`, `releaseOffer`) document lines that were already
 * on screen before this file existed; the suite pins Home's literals to
 * these copies so the wording cannot fork.
 */

import type { MessageKey } from "./i18n";

export interface Receipt {
  text: string;
  /** repo-relative path of the test that enforces this receipt's claim */
  enforcedBy: string;
  /** the catalog key the world renders this receipt through — Home says
      `say(RECEIPTS.x.messageKey)`, `text` is the canonical English, and
      receipts.test.ts pins the en-US catalog to it so the wording cannot
      fork between registry and screen */
  messageKey: MessageKey;
}

export const RECEIPTS = {
  /**
   * YES ON YOUR OWN PATTERN — and it may finally say what it does.
   *
   * This read "On the record", which claims almost nothing, and sat beside a
   * rejection receipt reading "Steps far back in the choosing — never
   * erased": vivid, mechanical, specific. The asymmetry was not a writing
   * failure. It was this file's law working correctly — a receipt may claim
   * only what a named test enforces, and what the pipeline enforced was
   * barely worth saying. Affirming added `CONFIDENCE_AFFIRMED_BONUS` (8),
   * which selection weights at 0.45: +3.6 of 100, against the -36 that
   * rejecting the same claim produced. The copy could not be fixed before
   * the mechanism was, and the law is what stopped anyone trying.
   *
   * The bonus is 30 now — the whole durability term, so your saying "this is
   * me" is worth what a month of recurrence is worth — and it moves a thin
   * claim's selection by +13.5 of 100, measured. So the sentence can name
   * the effect, and `enforcedBy` points at the test that would go red if it
   * stopped being true.
   */
  verdictKept: {
    messageKey: "worldReceiptVerdictKept",
    text: "This now carries weight in what reaches your top of mind",
    enforcedBy: "packages/api/src/lib/top-of-mind-affirmation.test.ts",
  },
  /** not true: dampened in the choosing, never removed */
  verdictNo: {
    messageKey: "worldReceiptVerdictNo",
    text: "Steps far back in the choosing — never erased",
    enforcedBy: "packages/api/src/lib/top-of-mind-synthesis.test.ts",
  },
  /** an answer on a room's shared statement */
  verdictGroup: {
    messageKey: "worldReceiptVerdictGroup",
    text: "Answered — the room reads who stands where",
    enforcedBy: "packages/api/src/routes/room-reactions.db.test.ts",
  },
  /** Keep this one up */
  pinned: {
    messageKey: "worldReceiptPinned",
    text: "Held at the front — rewrites keep it there",
    enforcedBy: "packages/api/src/lib/top-of-mind-synthesis.test.ts",
  },
  /** Not this — rides beside the undo, because reversible is part of the law */
  dismissed: {
    messageKey: "worldReceiptDismissed",
    text: "Set aside — it will not return to your top of mind",
    enforcedBy: "packages/api/src/lib/top-of-mind-synthesis.test.ts",
  },
  /** "then let it go" on a pattern of your own — the ground-level law:
      dismissal anchors a refusal, deletes nothing, and is reversible.
      Switched on by the-legible-loop Phase 3; until that phase shipped, the
      claim would have been the advisory-button lie. */
  groundRefuses: {
    messageKey: "worldReceiptGroundRefuses",
    text: "The ground will refuse anything this close from now on",
    enforcedBy: "packages/api/src/lib/signal-suppression.db.test.ts",
  },
  /** the star's standing line, already on screen — documented here */
  starHeld: {
    messageKey: "worldReceiptStarHeld",
    text: "Your own words — WAKA will not rewrite them",
    enforcedBy: "packages/api/src/lib/signal-lock-contract.db.test.ts",
  },
  /** the release confirm, already on screen — documented here */
  releaseOffer: {
    messageKey: "worldReceiptReleaseOffer",
    text: "WAKA will be allowed to rewrite this sentence",
    enforcedBy: "packages/api/src/lib/signal-lock-contract.db.test.ts",
  },
} satisfies Record<string, Receipt>;
