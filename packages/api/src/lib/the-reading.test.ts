/**
 * THE READING CANNOT LIE.
 *
 * goal: the-legible-loop, Phase 1. Three properties, each of which would
 * make the page a quiet lie if it broke:
 *
 *   1. Every constant-backed sentence carries the words for the constant's
 *      CURRENT value. This file holds its own value→words expectations, so
 *      a tuned constant fails here until the registry's words and the
 *      sentence change with it — the same both-directions drift lock
 *      `generation-doc.test.ts` gives the doc, extended to the surface a
 *      person reads.
 *
 *   2. Every contract-backed sentence names a test file that exists. A
 *      sentence about a law may not outlive the law's test.
 *
 *   3. The rendering carries no digits anywhere and includes every
 *      registered sentence — constants arrive as words, and no sentence
 *      reaches the page without a registered backing.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { READING_LINES, renderTheReading } from "./the-reading.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

/**
 * The independent half of the drift lock: what value each constant-backed
 * sentence was WORDED for. If a constant is tuned, its imported value in the
 * registry moves, stops matching this table, and this suite fails until the
 * words — here and in the sentence — are re-worded for the new value.
 */
const WORDED_FOR: Record<string, { value: number; words: string; wordsKo: string }> = {
  SIGNAL_PROMOTION_MIN_EVIDENCE: { value: 3, words: "three", wordsKo: "셋" },
  SIGNAL_MATCH_MIN_COSINE: { value: 0.86, words: "all but the same", wordsKo: "거의 같은" },
  CONFIDENCE_RECENCY_HALF_LIFE_DAYS: { value: 45, words: "a month and a half", wordsKo: "한 달 반" },
  COMEBACK_MIN_DORMANT_DAYS: { value: 21, words: "three quiet weeks", wordsKo: "조용한 세 주" },
  TOP_OF_MIND_MIN_SIGNALS: { value: 3, words: "three", wordsKo: "셋" },
  TOP_OF_MIND_SIGNAL_LIMIT: { value: 12, words: "twelve", wordsKo: "열두" },
  SELECTION_DISPUTED_MULTIPLIER: { value: 0.4, words: "far back", wordsKo: "멀찍이" },
  GROUP_DRAFT_MIN_AFFIRMED: { value: 3, words: "three", wordsKo: "셋" },
  GROUP_DRAFT_SMALL_MAX_MEMBERS: { value: 3, words: "three people or fewer", wordsKo: "세 명 이하" },
  GROUP_DRAFT_MIN_AFFIRMED_SMALL: { value: 2, words: "two", wordsKo: "둘" },
};

describe("the reading", () => {
  it("words every constant-backed sentence for the constant's current value", () => {
    const constantLines = READING_LINES.filter(
      (line) => line.backing.kind === "constant",
    );
    expect(
      constantLines.map((line) =>
        line.backing.kind === "constant" ? line.backing.constant : "",
      ).sort(),
      "every worded constant is registered, and every registered constant is worded",
    ).toEqual(Object.keys(WORDED_FOR).sort());

    for (const line of constantLines) {
      if (line.backing.kind !== "constant") continue;
      const expected = WORDED_FOR[line.backing.constant]!;
      expect(
        line.backing.value,
        `${line.backing.constant} was tuned — re-word its sentence and update WORDED_FOR`,
      ).toBe(expected.value);
      expect(
        line.backing.words,
        `${line.backing.constant}'s registered words drifted from this suite's expectation`,
      ).toBe(expected.words);
      expect(
        line.sentence.includes(line.backing.words),
        `the sentence for ${line.backing.constant} does not carry its own words: "${line.sentence}"`,
      ).toBe(true);
      /* and the Korean voice is pinned exactly the same way — neither
         language can drift alone */
      expect(
        line.backing.wordsKo,
        `${line.backing.constant}'s Korean words drifted from this suite's expectation`,
      ).toBe(expected.wordsKo);
      expect(
        line.sentenceKo.includes(line.backing.wordsKo),
        `the Korean sentence for ${line.backing.constant} does not carry its own words: "${line.sentenceKo}"`,
      ).toBe(true);
    }
  });

  it("backs every law sentence with a contract test that exists", () => {
    for (const line of READING_LINES) {
      if (line.backing.kind !== "contract") continue;
      expect(
        existsSync(resolve(REPO_ROOT, line.backing.testPath)),
        `"${line.sentence}" claims a law whose test is gone: ${line.backing.testPath}`,
      ).toBe(true);
    }
  });

  it("renders every sentence, and not one digit — in both languages", () => {
    const rendered = renderTheReading();
    for (const line of READING_LINES) {
      expect(rendered).toContain(line.sentence);
    }
    expect(
      /\d/.test(rendered),
      "a numeral reached the reading — constants arrive as words, always",
    ).toBe(false);

    const renderedKo = renderTheReading("ko-KR");
    for (const line of READING_LINES) {
      expect(renderedKo).toContain(line.sentenceKo);
    }
    expect(
      /\d/.test(renderedKo),
      "a numeral reached the Korean reading — constants arrive as words in every language",
    ).toBe(false);
  });
});
