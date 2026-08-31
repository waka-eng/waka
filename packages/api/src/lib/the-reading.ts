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
  GROUP_DRAFT_MIN_AFFIRMED_SMALL,
  GROUP_DRAFT_SMALL_MAX_MEMBERS,
  SELECTION_DISPUTED_MULTIPLIER,
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
      "기억 셋이 같은 것을 말하면, WAKA가 그걸 자기 문장으로 되돌려 말해요.",
    backing: {
      kind: "constant",
      constant: "SIGNAL_PROMOTION_MIN_EVIDENCE",
      value: SIGNAL_PROMOTION_MIN_EVIDENCE,
      words: "three",
      wordsKo: "셋",
    },
  },
  {
    sentence:
      "A new thought joins one of those sentences only when they are all but the same thought; otherwise it stands on its own.",
    sentenceKo:
      "새로운 생각은 거의 같은 생각일 때만 기존 문장에 합류해요. 아니면 홀로 서요.",
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
      "A sentence nobody feeds cools — half of its warmth is gone in about a month and a half.",
    sentenceKo:
      "아무도 먹이지 않는 문장은 식어요 — 한 달 반이면 온기가 절반으로 줄어요.",
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
      "조용한 세 주가 지나 다시 일렁이는 문장은, 돌아왔구나 하고 알아봐요.",
    backing: {
      kind: "constant",
      constant: "COMEBACK_MIN_DORMANT_DAYS",
      value: COMEBACK_MIN_DORMANT_DAYS,
      words: "three quiet weeks",
      wordsKo: "조용한 세 주",
    },
  },
  {
    sentence:
      "Your top of mind is first written once three of those sentences are alive to write it from.",
    sentenceKo:
      "톱 오브 마인드는 살아 있는 문장이 셋은 되어야 처음 쓰여요.",
    backing: {
      kind: "constant",
      constant: "TOP_OF_MIND_MIN_SIGNALS",
      value: TOP_OF_MIND_MIN_SIGNALS,
      words: "three",
      wordsKo: "셋",
    },
  },
  {
    sentence:
      "Each rewrite of your top of mind reads from at most twelve of them — the ones with the most life in them.",
    sentenceKo:
      "톱 오브 마인드를 다시 쓸 때는 많아야 열두 문장만 읽어요. 가장 생기 있는 것들이에요.",
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
      "A sentence you called untrue steps far back in the choosing — and is never erased.",
    sentenceKo:
      "아니라고 답한 문장은 고르는 자리에서 멀찍이 물러나요. 지워지지는 않아요.",
    backing: {
      kind: "constant",
      constant: "SELECTION_DISPUTED_MULTIPLIER",
      value: SELECTION_DISPUTED_MULTIPLIER,
      words: "far back",
      wordsKo: "멀찍이",
    },
  },
  {
    sentence:
      "A room first speaks only after three shared statements have been affirmed by someone besides their owner.",
    sentenceKo:
      "방은 주인 아닌 누군가가 함께 실어 준 공유 문장이 셋은 되어야 처음 말해요.",
    backing: {
      kind: "constant",
      constant: "GROUP_DRAFT_MIN_AFFIRMED",
      value: GROUP_DRAFT_MIN_AFFIRMED,
      words: "three",
      wordsKo: "셋",
    },
  },
  {
    sentence:
      "A room of three people or fewer is held to a smaller bar, because three statements is most of everything a pair has ever said.",
    sentenceKo:
      "세 명 이하의 방은 기준이 더 낮아요. 두 사람이 나눈 말의 거의 전부가 문장 셋이니까요.",
    backing: {
      kind: "constant",
      constant: "GROUP_DRAFT_SMALL_MAX_MEMBERS",
      value: GROUP_DRAFT_SMALL_MAX_MEMBERS,
      words: "three people or fewer",
      wordsKo: "세 명 이하",
    },
  },
  {
    sentence:
      "That smaller bar is two, and it never falls to one: one person agreeing once is not a room agreeing.",
    sentenceKo:
      "그 낮은 기준은 둘이에요. 하나까지 내려가지는 않아요 — 한 사람이 한 번 동의한 걸 방이 동의했다고 할 수는 없으니까요.",
    backing: {
      kind: "constant",
      constant: "GROUP_DRAFT_MIN_AFFIRMED_SMALL",
      value: GROUP_DRAFT_MIN_AFFIRMED_SMALL,
      words: "two",
      wordsKo: "둘",
    },
  },
  {
    sentence: "A sentence you have written yourself is never rewritten.",
    sentenceKo: "내 손으로 쓴 문장은 절대 다시 쓰이지 않아요.",
    backing: {
      kind: "contract",
      testPath: "packages/api/src/lib/signal-lock-contract.db.test.ts",
    },
  },
  {
    sentence:
      "Hand a sentence back, and WAKA may write it again; released words that nothing supports are let go to retire.",
    sentenceKo:
      "문장을 다시 맡기면 그때부터 WAKA가 다시 써요. 풀려났는데 아무것도 받치지 않는 말은 물러나게 놓아줘요.",
    backing: {
      kind: "contract",
      testPath: "packages/api/src/lib/signal-lock-contract.db.test.ts",
    },
  },
  {
    sentence:
      "A sentence's receipts are verified quotes — your words, or your saved page's, and never invented.",
    sentenceKo:
      "문장의 영수증은 검증된 인용이에요. 내 말이거나 내가 저장한 페이지의 말이고, 지어내는 법은 없어요.",
    backing: {
      kind: "contract",
      testPath: "packages/api/src/lib/signal-lock-contract.db.test.ts",
    },
  },
  {
    sentence: "A sentence you set aside does not return to your top of mind.",
    sentenceKo: "치워 둔 문장은 톱 오브 마인드로 돌아오지 않아요.",
    backing: {
      kind: "contract",
      testPath: "packages/api/src/lib/top-of-mind-synthesis.test.ts",
    },
  },
  {
    sentence:
      "A sentence you let go is refused ground: nothing is deleted, nothing that close grows there again, and every refusal is written down — until you put it back.",
    sentenceKo:
      "놓아준 문장은 땅을 거절당해요. 아무것도 지워지지 않고, 그만큼 가까운 것은 다시 자라지 않고, 모든 거절이 기록에 남아요 — 내가 되돌리기 전까지는요.",
    backing: {
      kind: "contract",
      testPath: "packages/api/src/lib/signal-suppression.db.test.ts",
    },
  },
  {
    sentence:
      "A room's top of mind changes only when more than half the room carries the change — a no is counted, never a veto.",
    sentenceKo:
      "방의 톱 오브 마인드는 방의 절반 넘는 사람이 실어 줘야 바뀌어요. 아니오는 세어질 뿐, 거부권이 아니에요.",
    backing: {
      kind: "contract",
      testPath: "packages/api/src/routes/room-decline.db.test.ts",
    },
  },
  {
    sentence: "Every reading of your memory is itself on the record.",
    sentenceKo: "기억을 읽는 일은 그 자체로 기록에 남아요.",
    backing: {
      kind: "contract",
      testPath: "packages/api/src/routes/consultations.db.test.ts",
    },
  },
  /* WHAT THE LIGHT MEANS, WHERE THE RULES ARE (founder, 2026-08-27: "how to
     add legend somewhere to explain why balls are different colors").

     The world has two channels and only one of them was ever unexplained.
     COLOUR already legends itself where it carries meaning: in a room, the
     rows at the bottom-left name whose ground each hue belongs to, and on
     your own wall there is one voice, so there is nothing to key. What had
     no words anywhere was BRIGHTNESS — the channel that is the whole reason
     the field is not a uniform scatter.

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
      "기억은 생각이 얼마나 그 위에 기대는지만큼 빛나요. 읽어 간 문장이 많을수록 땅에서 더 밝게 서요.",
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
    lines.push("# WAKA가 나를 읽는 방식");
    lines.push("");
    lines.push("> 아래 문장 하나하나가 그것을 지키는 코드에 고정되어 있어요 —");
    lines.push("> 하나라도 사실이 아니게 되는 날, 빌드가 멈춰요.");
    lines.push("");
    for (const line of READING_LINES) {
      lines.push(`- ${line.sentenceKo}`);
    }
    lines.push("");
    lines.push("행동이 가르쳐요. 답은 무게가 되고, 별은 붙들고, 되맡기면 되돌아가요.");
    return lines.join("\n") + "\n";
  }
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
