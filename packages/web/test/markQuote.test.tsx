import { describe, expect, it } from "vitest";

import { markQuote, paragraphs } from "../src/pages/Surface";
import { whenShort } from "../src/lib/when";

/**
 * The surface marks one span per citation — a citation IS one quote there — so
 * the behaviour that matters is whitespace tolerance and refusing to guess.
 */
function marked(node: unknown): string | null {
  const kids = (node as { props?: { children?: unknown[] } })?.props?.children;
  if (!Array.isArray(kids)) return null;
  const mark = kids.find(
    (part): part is { props: { children: string } } =>
      typeof part === "object" && part !== null && "props" in part,
  );
  return mark?.props.children ?? null;
}

const SAVE =
  "미드저니가 next MRI를 만듭니다.\n\n병원에서 검사는 이벤트지만,\n스파에서 검사는 리추얼이 됩니다.\n\n우리는 이미 워치로 심박을 넘기고 있습니다.";

describe("markQuote", () => {
  it("lights up the words a signal rested on", () => {
    expect(marked(markQuote(SAVE, "병원에서 검사는 이벤트지만"))).toBe("병원에서 검사는 이벤트지만");
  });

  it("finds a span the model re-wrapped", () => {
    // The quote was verified with whitespace normalized, so locating it again
    // has to be whitespace-tolerant — an exact search would miss the very span
    // we already proved was there.
    expect(marked(markQuote(SAVE, "이벤트지만, 스파에서 검사는"))).toBe(
      "이벤트지만,\n스파에서 검사는",
    );
  });

  it("marks nothing when the quote is no longer in the capture", () => {
    // The capture was edited, or enrichment replaced the passage. A missing
    // mark is honest; a wrong one attributes words to someone who did not
    // write them.
    expect(marked(markQuote(SAVE, "something that was never here at all"))).toBeNull();
  });

  it("refuses a quote too short to be meant", () => {
    // Under twelve characters a "quote" matches by accident, and an accidental
    // mark is worse than none.
    expect(marked(markQuote(SAVE, "검사는"))).toBeNull();
  });

  it("does nothing when no words were named", () => {
    expect(marked(markQuote(SAVE, null))).toBeNull();
  });
});

describe("markQuote — bounds", () => {
  it("refuses a quote long enough to be a payload rather than a span", () => {
    // This builds a RegExp out of whatever it is handed, so it enforces its own
    // ceiling rather than trusting the field. Extraction is asked for a span.
    const huge = "x".repeat(500);
    const out = markQuote(`before ${huge} after`, huge);
    const kids = (out as { props?: { children?: unknown } }).props?.children;
    expect(Array.isArray(kids)).toBe(false);
  });
});

describe("paragraphs", () => {
  it("keeps the writer's blank lines and drops the source's wrapping", () => {
    expect(paragraphs(SAVE)).toEqual([
      "미드저니가 next MRI를 만듭니다.",
      "병원에서 검사는 이벤트지만, 스파에서 검사는 리추얼이 됩니다.",
      "우리는 이미 워치로 심박을 넘기고 있습니다.",
    ]);
  });

  it("has nothing to render for an empty capture", () => {
    expect(paragraphs("   \n\n  ")).toEqual([]);
  });
});

describe("whenShort", () => {
  it("says the recent days in words, because a wall is read at a glance", () => {
    const now = Date.now();
    expect(whenShort(new Date(now).toISOString())).toBe("today");
    expect(whenShort(new Date(now - 86_400_000).toISOString())).toBe("yesterday");
    expect(whenShort(new Date(now - 3 * 86_400_000).toISOString())).toBe("3 days ago");
  });

  it("renders nothing at all for a timestamp it cannot read", () => {
    expect(whenShort("not a date")).toBe("");
  });
});
