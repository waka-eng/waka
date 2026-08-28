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

export interface Receipt {
  text: string;
  /** repo-relative path of the test that enforces this receipt's claim */
  enforcedBy: string;
}

export const RECEIPTS = {
  /** yes / partly on your own pattern: the record is the effect */
  verdictKept: {
    text: "on the record",
    enforcedBy: "packages/api/src/routes/feedback.test.ts",
  },
  /** not true: dampened in the choosing, never removed */
  verdictNo: {
    text: "steps far back in the choosing — never erased",
    enforcedBy: "packages/api/src/lib/top-of-mind-synthesis.test.ts",
  },
  /** an answer on a room's shared statement */
  verdictGroup: {
    text: "answered — the room reads who stands where",
    enforcedBy: "packages/api/src/routes/room-reactions.db.test.ts",
  },
  /** Keep this one up */
  pinned: {
    text: "held at the front — rewrites keep it there",
    enforcedBy: "packages/api/src/lib/top-of-mind-synthesis.test.ts",
  },
  /** Not this — rides beside the undo, because reversible is part of the law */
  dismissed: {
    text: "set aside — it will not return to your top of mind",
    enforcedBy: "packages/api/src/lib/top-of-mind-synthesis.test.ts",
  },
  /** "then let it go" on a pattern of your own — the ground-level law:
      dismissal anchors a refusal, deletes nothing, and is reversible.
      Switched on by the-legible-loop Phase 3; until that phase shipped, the
      claim would have been the advisory-button lie. */
  groundRefuses: {
    text: "the ground will refuse anything this close from now on",
    enforcedBy: "packages/api/src/lib/signal-suppression.db.test.ts",
  },
  /** the star's standing line, already on screen — documented here */
  starHeld: {
    text: "your own words — WAKA will not rewrite them",
    enforcedBy: "packages/api/src/lib/signal-lock-contract.db.test.ts",
  },
  /** the release confirm, already on screen — documented here */
  releaseOffer: {
    text: "WAKA will be allowed to rewrite this sentence",
    enforcedBy: "packages/api/src/lib/signal-lock-contract.db.test.ts",
  },
} satisfies Record<string, Receipt>;
