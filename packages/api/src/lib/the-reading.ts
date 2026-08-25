/**
 * The reading — "How WAKA reads you."
 *
 * goal: the-legible-loop, Phase 1. One rendering of the loop's rules, in
 * second person and present tense, that is STRUCTURALLY incapable of lying:
 * every sentence here is registered with its backing — either a tuning
 * constant imported from the module that enforces it (so the sentence's
 * words are pinned to the live value by `the-reading.test.ts`), or the path
 * of the contract test that enforces the claim (so a sentence about a law
 * cannot outlive the law's test). A sentence with neither backing cannot be
 * added without failing the suite — that is the point.
 *
 * The vague-explanation research (docs/craft/the-legible-loop.md, finding 8)
 * is why this exists in this shape: an explanation disconnected from
 * mechanism reduces trust below saying nothing. This one is the mechanism,
 * worded.
 *
 * No digits anywhere in the rendering — constants arrive as words, pinned.
 * The same rendering serves the world's panel and the wire format: the
 * reading contract is one contract for every kind of mind.
 */

import {
  SIGNAL_MATCH_MIN_COSINE,
  SIGNAL_PROMOTION_MIN_EVIDENCE,
} from "./signal-derivation-thresholds.js";
import { CONFIDENCE_RECENCY_HALF_LIFE_DAYS } from "./signal-derivation-thresholds.js";
import {
  COMEBACK_MIN_DORMANT_DAYS,
  GROUP_DRAFT_MIN_AFFIRMED,
  SELECTION_DISPUTED_MULTIPLIER,
  TOP_OF_MIND_MIN_SIGNALS,
  TOP_OF_MIND_SIGNAL_LIMIT,
} from "./top-of-mind-synthesis.js";

export type ReadingBacking =
  | {
      kind: "constant";
      /** the export's name, for the drift test's error messages */
      constant: string;
      /** the LIVE value, imported — identity with the pipeline by construction */
      value: number;
      /** the words the sentence must carry for this value; the drift test
          holds its own value→words expectation, so changing the constant
          fails until both the words here and the sentence change with it */
      words: string;
    }
  | {
      kind: "contract";
      /** repo-relative path of the test that enforces the sentence's claim */
      testPath: string;
    };

export interface ReadingLine {
  sentence: string;
  backing: ReadingBacking;
}

export const READING_LINES: ReadingLine[] = [
  {
    sentence:
      "When three of your memories say the same thing, WAKA says it back to you in a sentence of its own.",
    backing: {
      kind: "constant",
      constant: "SIGNAL_PROMOTION_MIN_EVIDENCE",
      value: SIGNAL_PROMOTION_MIN_EVIDENCE,
      words: "three",
    },
  },
  {
    sentence:
      "A new thought joins one of those sentences only when they are all but the same thought; otherwise it stands on its own.",
    backing: {
      kind: "constant",
      constant: "SIGNAL_MATCH_MIN_COSINE",
      value: SIGNAL_MATCH_MIN_COSINE,
      words: "all but the same",
    },
  },
  {
    sentence:
      "A sentence nobody feeds cools — half of its warmth is gone in about a month and a half.",
    backing: {
      kind: "constant",
      constant: "CONFIDENCE_RECENCY_HALF_LIFE_DAYS",
      value: CONFIDENCE_RECENCY_HALF_LIFE_DAYS,
      words: "a month and a half",
    },
  },
  {
    sentence:
      "A sentence that stirs again after three quiet weeks is noticed for coming back.",
    backing: {
      kind: "constant",
      constant: "COMEBACK_MIN_DORMANT_DAYS",
      value: COMEBACK_MIN_DORMANT_DAYS,
      words: "three quiet weeks",
    },
  },
  {
    sentence:
      "Your top of mind is first written once three of those sentences are alive to write it from.",
    backing: {
      kind: "constant",
      constant: "TOP_OF_MIND_MIN_SIGNALS",
      value: TOP_OF_MIND_MIN_SIGNALS,
      words: "three",
    },
  },
  {
    sentence:
      "Each rewrite of your top of mind reads from at most twelve of them — the ones with the most life in them.",
    backing: {
      kind: "constant",
      constant: "TOP_OF_MIND_SIGNAL_LIMIT",
      value: TOP_OF_MIND_SIGNAL_LIMIT,
      words: "twelve",
    },
  },
  {
    sentence:
      "A sentence you called untrue steps far back in the choosing — and is never erased.",
    backing: {
      kind: "constant",
      constant: "SELECTION_DISPUTED_MULTIPLIER",
      value: SELECTION_DISPUTED_MULTIPLIER,
      words: "far back",
    },
  },
  {
    sentence:
      "A room first speaks only after three shared statements have been affirmed by someone besides their owner.",
    backing: {
      kind: "constant",
      constant: "GROUP_DRAFT_MIN_AFFIRMED",
      value: GROUP_DRAFT_MIN_AFFIRMED,
      words: "three",
    },
  },
  {
    sentence: "A sentence you have written yourself is never rewritten.",
    backing: {
      kind: "contract",
      testPath: "packages/api/src/lib/signal-lock-contract.db.test.ts",
    },
  },
  {
    sentence:
      "Hand a sentence back, and WAKA may write it again; released words that nothing supports are let go to retire.",
    backing: {
      kind: "contract",
      testPath: "packages/api/src/lib/signal-lock-contract.db.test.ts",
    },
  },
  {
    sentence:
      "A sentence's receipts are verified quotes — your words, or your saved page's, and never invented.",
    backing: {
      kind: "contract",
      testPath: "packages/api/src/lib/signal-lock-contract.db.test.ts",
    },
  },
  {
    sentence: "A sentence you set aside does not return to your top of mind.",
    backing: {
      kind: "contract",
      testPath: "packages/api/src/lib/top-of-mind-synthesis.test.ts",
    },
  },
  {
    sentence:
      "A sentence you let go is refused ground: nothing is deleted, nothing that close grows there again, and every refusal is written down — until you put it back.",
    backing: {
      kind: "contract",
      testPath: "packages/api/src/lib/signal-suppression.db.test.ts",
    },
  },
  {
    sentence:
      "A room's top of mind changes only when more than half the room carries the change — a no is counted, never a veto.",
    backing: {
      kind: "contract",
      testPath: "packages/api/src/routes/room-decline.db.test.ts",
    },
  },
  {
    sentence: "Every reading of your memory is itself on the record.",
    backing: {
      kind: "contract",
      testPath: "packages/api/src/routes/consultations.db.test.ts",
    },
  },
];

/**
 * The one rendering, markdown. The world's panel and the wire format both
 * derive from this — no second phrasing anywhere.
 */
export function renderTheReading(): string {
  const lines: string[] = [];
  lines.push("# How WAKA reads you");
  lines.push("");
  lines.push(
    "> Each sentence below is pinned to the code that enforces it — the",
  );
  lines.push(
    "> build fails the day any of them stops being true.",
  );
  lines.push("");
  for (const line of READING_LINES) {
    lines.push(`- ${line.sentence}`);
  }
  lines.push("");
  lines.push("What you do teaches it: an answer weighs, a star holds, a release returns.");
  return lines.join("\n") + "\n";
}
