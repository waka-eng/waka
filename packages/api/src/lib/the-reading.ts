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
  SELECTION_DISPUTED_MULTIPLIER,
  TOP_OF_MIND_MIN_SHIFT_HOURS,
  TOP_OF_MIND_MIN_SIGNALS,
  TOP_OF_MIND_SIGNAL_LIMIT,
} from "./top-of-mind-synthesis.js";

export type ProseLocale = "en-US" | "ko-KR";

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
      /** the same value's words in the Korean sentence — pinned the same way,
          so neither language can drift alone */
      wordsKo: string;
    }
  | {
      kind: "contract";
      /** repo-relative path of the test that enforces the sentence's claim */
      testPath: string;
    };

export interface ReadingLine {
  sentence: string;
  /** the same rule in Korean — one registry, two voices, one backing */
  sentenceKo: string;
  backing: ReadingBacking;
}

export const READING_LINES: ReadingLine[] = [
  {
    sentence:
      "When three of your memories say the same thing, WAKA says it back to you in a sentence of its own.",
    sentenceKo:
      "서로 다른 메모 세 개에서 같은 생각이 드러나면 WAKA가 그 패턴을 한 문장으로 정리해요.",
    backing: {
      kind: "constant",
      constant: "SIGNAL_PROMOTION_MIN_EVIDENCE",
      value: SIGNAL_PROMOTION_MIN_EVIDENCE,
      words: "three",
      wordsKo: "세 개",
    },
  },
  {
    sentence:
      "A new thought joins one of those sentences only when they are all but the same thought; otherwise it stands on its own.",
    sentenceKo:
      "새 메모가 기존 패턴과 거의 같은 뜻일 때만 함께 묶어요. 다른 뜻이면 별개의 패턴으로 남겨요.",
    backing: {
      kind: "constant",
      constant: "SIGNAL_MATCH_MIN_COSINE",
      value: SIGNAL_MATCH_MIN_COSINE,
      words: "all but the same",
      wordsKo: "거의 같은",
    },
  },
  {
    sentence:
      "A sentence nobody feeds cools. Half of its warmth is gone in about a month and a half.",
    sentenceKo:
      "관련 메모가 더 쌓이지 않으면 그 패턴의 비중은 약 한 달 반마다 절반으로 줄어요.",
    backing: {
      kind: "constant",
      constant: "CONFIDENCE_RECENCY_HALF_LIFE_DAYS",
      value: CONFIDENCE_RECENCY_HALF_LIFE_DAYS,
      words: "a month and a half",
      wordsKo: "한 달 반",
    },
  },
  {
    sentence:
      "A sentence that stirs again after three quiet weeks is noticed for coming back.",
    sentenceKo:
      "세 주 이상 뜸했던 패턴이 다시 나타나면 최근에 다시 눈에 띄기 시작한 것으로 봐요.",
    backing: {
      kind: "constant",
      constant: "COMEBACK_MIN_DORMANT_DAYS",
      value: COMEBACK_MIN_DORMANT_DAYS,
      words: "three quiet weeks",
      wordsKo: "세 주",
    },
  },
  {
    sentence:
      "Your top of mind is first written once three of those sentences are alive to write it from.",
    sentenceKo:
      "‘요즘 드는 생각’을 처음 정리할 때는 참고할 패턴이 적어도 세 개 있어야 해요.",
    backing: {
      kind: "constant",
      constant: "TOP_OF_MIND_MIN_SIGNALS",
      value: TOP_OF_MIND_MIN_SIGNALS,
      words: "three",
      wordsKo: "세 개",
    },
  },
  {
    sentence:
      "Your top of mind shifts at most once a day. A rewrite that arrives early waits its turn, and your own hand never waits.",
    sentenceKo:
      "‘요즘 드는 생각’은 자동으로는 하루에 한 번까지만 달라져요. 직접 고친 내용은 바로 반영돼요.",
    backing: {
      kind: "constant",
      constant: "TOP_OF_MIND_MIN_SHIFT_HOURS",
      value: TOP_OF_MIND_MIN_SHIFT_HOURS,
      words: "once a day",
      wordsKo: "하루에 한 번",
    },
  },
  {
    sentence:
      "Each rewrite of your top of mind reads from at most twelve of them: the ones with the most life in them.",
    sentenceKo:
      "‘요즘 드는 생각’을 다시 정리할 때는 지금 가장 뚜렷한 패턴을 열두 개까지 살펴봐요.",
    backing: {
      kind: "constant",
      constant: "TOP_OF_MIND_SIGNAL_LIMIT",
      value: TOP_OF_MIND_SIGNAL_LIMIT,
      words: "twelve",
      wordsKo: "열두",
    },
  },
  {
    sentence:
      "A sentence you called untrue steps far back in the choosing, and is never erased.",
    sentenceKo:
      "내 얘기가 아니라고 답한 패턴은 이후에 반영되는 비중이 줄어요. 내용은 그대로 남아요.",
    backing: {
      kind: "constant",
      constant: "SELECTION_DISPUTED_MULTIPLIER",
      value: SELECTION_DISPUTED_MULTIPLIER,
      words: "far back",
      wordsKo: "비중이 줄어요",
    },
  },
  /* ── FOUR SENTENCES ABOUT ROOMS CAME OUT HERE (2026-10-15) ─────────────
     Founder: "방 없애". Three pinned the draft bar — "a room first speaks
     only after three shared statements have been affirmed by someone
     besides their owner", the smaller bar for rooms of three or fewer, and
     that the smaller bar is two and never one. The fourth, further down,
     pinned the majority rule and the counted no.

     THEY HAD TO GO FOR THIS FILE'S OWN REASON, not merely because the
     feature did. Every sentence here is registered with a backing and the
     whole point is that a sentence cannot outlive its mechanism: the
     fourth's contract test (`routes/room-decline.db.test.ts`) was deleted
     in this same pass and `the-reading.test.ts` failed on it immediately,
     which is the gate working exactly as designed. The other three are
     still backed by live constants at the time — `GROUP_DRAFT_MIN_AFFIRMED`
     and its two companions only left `top-of-mind-synthesis.ts` with the
     room engine on 2026-10-17 — so they would have stayed GREEN while
     describing something a reader can no longer do. That is worse than a red build, and it is why they are
     leaving by hand rather than waiting for a test to notice.

     A reading that says "a room first speaks after three" to somebody with
     no rooms is the vague-explanation failure this file was built against
     (docs/craft/the-legible-loop.md, finding 8): an explanation
     disconnected from mechanism reads as less trustworthy than silence. */
  {
    sentence: "A sentence you have written yourself is never rewritten.",
    sentenceKo: "직접 고친 문장은 WAKA가 다시 쓰지 않아요.",
    backing: {
      kind: "contract",
      testPath: "packages/api/src/lib/signal-lock-contract.db.test.ts",
    },
  },
  {
    sentence:
      "Hand a sentence back, and WAKA may write it again; released words that nothing supports are let go to retire.",
    sentenceKo:
      "문장을 WAKA에 다시 맡기면 표현이 달라질 수 있어요. 뒷받침할 메모가 없으면 더 이상 표시하지 않을 수 있어요.",
    backing: {
      kind: "contract",
      testPath: "packages/api/src/lib/signal-lock-contract.db.test.ts",
    },
  },
  {
    sentence:
      "A sentence's receipts are verified quotes: your words, or your saved page's, and never invented.",
    sentenceKo:
      "인용문은 내 글이나 저장한 페이지에서 실제로 확인한 구절이에요.",
    backing: {
      kind: "contract",
      testPath: "packages/api/src/lib/signal-lock-contract.db.test.ts",
    },
  },
  {
    sentence: "A sentence you set aside does not return to your top of mind.",
    sentenceKo: "빼기로 한 문장은 ‘요즘 드는 생각’에 다시 나오지 않아요.",
    backing: {
      kind: "contract",
      testPath: "packages/api/src/lib/top-of-mind-synthesis.test.ts",
    },
  },
  {
    sentence:
      "A sentence you let go is refused ground: nothing is deleted, nothing that close grows there again, and every refusal is written down, until you put it back.",
    sentenceKo:
      "패턴을 빼면 되돌릴 때까지 비슷한 패턴도 다시 나타나지 않아요. 메모는 그대로 남고 제외한 기록도 보관해요.",
    backing: {
      kind: "contract",
      testPath: "packages/api/src/lib/signal-suppression.db.test.ts",
    },
  },
  {
    sentence: "Every reading of your memory is itself on the record.",
    sentenceKo: "내 기억을 조회할 때마다 기록이 남아요.",
    backing: {
      kind: "contract",
      testPath: "packages/api/src/routes/consultations.db.test.ts",
    },
  },
  /* WHAT THE LIGHT MEANS, WHERE THE RULES ARE (founder, 2026-08-27: "how to
     add legend somewhere to explain why balls are different colors").

     The world has two channels and only one of them was ever unexplained.
     COLOUR carried meaning in a room, where the rows at the bottom-left
     named whose ground each hue belonged to; on your own wall there is one
     voice, so there is nothing to key, and since the rooms came out
     (2026-10-15) that is the only case left. What had no words anywhere was
     BRIGHTNESS — the channel that is the whole reason the field is not a
     uniform scatter.

     It belongs here rather than in a key floating over the world: a legend
     pinned to the frame is chrome that must be read before the world makes
     sense, and this product's answer to "what does that mean" is one
     surface, reached from the sentence it explains. Said in the loop's own
     voice and pinned like every other line, so the day light stops meaning
     this, the build says so. */
  {
    sentence:
      "A memory shines by how much of your thinking rests on it: the more sentences read from it, the brighter it stands in the ground.",
    sentenceKo:
      "여러 패턴의 바탕이 된 메모일수록 화면에서 더 밝게 보여요.",
    backing: {
      kind: "contract",
      testPath: "packages/web/test/home-light.test.tsx",
    },
  },
];

/**
 * The one rendering, markdown. The world's panel and the wire format both
 * derive from this — no second phrasing anywhere.
 */
export function renderTheReading(locale: ProseLocale = "en-US"): string {
  const lines: string[] = [];
  if (locale === "ko-KR") {
    lines.push("# WAKA가 메모에서 패턴을 찾는 방법");
    lines.push("");
    lines.push("> 아래 설명은 WAKA가 실제로 메모를 정리하는 방식을 담고 있어요.");
    lines.push("> 설명과 코드가 일치하는지 배포 전에 자동으로 확인해요.");
    lines.push("");
    for (const line of READING_LINES) {
      lines.push(`- ${line.sentenceKo}`);
    }
    lines.push("");
    lines.push("답변은 다음에 어떤 내용을 보여 줄지에 반영돼요. 문장을 고정하거나 다시 WAKA에 맡길 수도 있어요.");
    return lines.join("\n") + "\n";
  }
  lines.push("# How WAKA reads you");
  lines.push("");
  lines.push(
    "> Each sentence below is pinned to the code that enforces it. The",
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
