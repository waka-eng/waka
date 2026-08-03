import { describe, expect, it } from "vitest";

import { highlightQuote } from "../src/pages/Home";

/** The marked span, or null when the text came back untouched. */
function marked(node: unknown): string | null {
  if (!Array.isArray(node)) return null;
  const mark = node.find(
    (part): part is { props: { children: string } } =>
      typeof part === "object" && part !== null && "props" in part,
  );
  return mark?.props.children ?? null;
}

const SAVE = "미드저니가 next MRI를 만듭니다.\n\n병원에서 검사는 이벤트지만,\n스파에서 검사는 리추얼이 됩니다.";

describe("highlightQuote", () => {
  it("lights up the words a reading rested on", () => {
    expect(marked(highlightQuote(SAVE, "병원에서 검사는 이벤트지만"))).toBe(
      "병원에서 검사는 이벤트지만",
    );
  });

  it("finds a span the model re-wrapped", () => {
    /**
     * The quote was verified against the save with whitespace normalized, so
     * locating it again has to be whitespace-tolerant — an exact search would
     * miss the very span we already proved was there.
     */
    expect(marked(highlightQuote(SAVE, "이벤트지만, 스파에서 검사는"))).toBe(
      "이벤트지만,\n스파에서 검사는",
    );
  });

  it("leaves the text alone when the save has changed since", () => {
    // Honest: showing it plain beats highlighting words nobody pointed at.
    expect(highlightQuote(SAVE, "무언가 완전히 다른 문장")).toBe(SAVE);
  });

  it("leaves the text alone when there is no quote", () => {
    expect(highlightQuote(SAVE, null)).toBe(SAVE);
  });

  it("does not let a quote's punctuation act as a pattern", () => {
    // A naive regex would read `.` and `?` as wildcards and match anywhere.
    const text = "we shipped it. did we?";
    expect(highlightQuote(text, "we shipped it.")).not.toBe(text);
    expect(marked(highlightQuote(text, "we shipped it."))).toBe("we shipped it.");
    expect(highlightQuote("we shipped itX did weY", "we shipped it.")).toBe(
      "we shipped itX did weY",
    );
  });
});
