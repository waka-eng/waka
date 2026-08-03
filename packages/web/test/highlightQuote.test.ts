import { describe, expect, it } from "vitest";

import { highlightQuotes } from "../src/pages/Home";

/** The marked spans, in order, or null when the text came back untouched. */
function marks(node: unknown): Array<{ text: string; ledTo: string }> | null {
  if (!Array.isArray(node)) return null;
  return node
    .filter(
      (part): part is { props: { children: string; "data-led-to": string } } =>
        typeof part === "object" && part !== null && "props" in part,
    )
    .map((part) => ({ text: part.props.children, ledTo: part.props["data-led-to"] }));
}

const SAVE =
  "미드저니가 next MRI를 만듭니다.\n\n병원에서 검사는 이벤트지만,\n스파에서 검사는 리추얼이 됩니다.\n\n우리는 이미 워치로 심박을 넘기고 있습니다.";

describe("highlightQuotes", () => {
  it("lights up the words a reading rested on, and names what it became", () => {
    const out = marks(highlightQuotes(SAVE, [{ quote: "병원에서 검사는 이벤트지만", ledTo: "led to A" }]));
    expect(out).toEqual([{ text: "병원에서 검사는 이벤트지만", ledTo: "led to A" }]);
  });

  it("finds a span the model re-wrapped", () => {
    /**
     * The quote was verified with whitespace normalized, so locating it again
     * has to be whitespace-tolerant — an exact search would miss the very span
     * we already proved was there.
     */
    expect(marks(highlightQuotes(SAVE, [{ quote: "이벤트지만, 스파에서 검사는", ledTo: "x" }]))?.[0]?.text)
      .toBe("이벤트지만,\n스파에서 검사는");
  });

  it("lights every span when you open the save directly", () => {
    const out = marks(
      highlightQuotes(SAVE, [
        { quote: "우리는 이미 워치로 심박을", ledTo: "led to B" },
        { quote: "미드저니가 next MRI를 만듭니다", ledTo: "led to A" },
      ]),
    );
    // In the order they appear in the text, not the order they were given.
    expect(out?.map((m) => m.ledTo)).toEqual(["led to A", "led to B"]);
  });

  it("gives two readings that rest on the same words one mark, not two", () => {
    /**
     * Overlapping <mark> elements would nest, and the wash would double where
     * they meet. One mark, both names.
     */
    const out = marks(
      highlightQuotes(SAVE, [
        { quote: "병원에서 검사는 이벤트지만", ledTo: "led to A" },
        { quote: "병원에서 검사는 이벤트지만, 스파에서", ledTo: "led to B" },
      ]),
    );
    expect(out).toHaveLength(1);
    expect(out?.[0]?.ledTo).toBe("led to A\nled to B");
  });

  it("skips a span the save no longer contains, and keeps the rest", () => {
    // Honest: showing it plain beats highlighting words nobody pointed at.
    const out = marks(
      highlightQuotes(SAVE, [
        { quote: "무언가 완전히 다른 문장입니다", ledTo: "gone" },
        { quote: "우리는 이미 워치로 심박을", ledTo: "kept" },
      ]),
    );
    expect(out?.map((m) => m.ledTo)).toEqual(["kept"]);
  });

  it("leaves the text alone when nothing can be located", () => {
    expect(highlightQuotes(SAVE, [{ quote: "없는 문장", ledTo: "x" }])).toBe(SAVE);
    expect(highlightQuotes(SAVE, [])).toBe(SAVE);
  });

  it("does not let a quote's punctuation act as a pattern", () => {
    // A naive regex would read `.` as a wildcard and match anywhere.
    expect(highlightQuotes("we shipped itX did weY", [{ quote: "we shipped it.", ledTo: "x" }]))
      .toBe("we shipped itX did weY");
  });
});
