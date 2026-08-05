import { describe, expect, it } from "vitest";

import {
  canLoadFullSignal,
  markQuote,
  roomDirectionEvidenceCopy,
  roomFirstReadPresentation,
  roomProposalReviewCopy,
  roomShapingNextStepCopy,
  roomShapingProgressCopy,
} from "../src/pages/Surface";

/**
 * Ported from `highlightQuote.test.ts`, which tested the same job on the old
 * wall. The surface marks one span per citation rather than every span in a
 * save — a citation IS one quote there — so the multi-span cases become
 * separate calls, and the behaviour that actually matters is unchanged:
 * whitespace tolerance, and refusing to guess.
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
  it("lights up the words a reading rested on", () => {
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

  it("marks nothing when the quote is no longer in the save", () => {
    // The save was edited, or enrichment replaced the passage. A missing mark
    // is honest; a wrong one attributes words to someone who did not write them.
    expect(marked(markQuote(SAVE, "something that was never here at all"))).toBeNull();
  });

  it("refuses a quote too short to be meant", () => {
    // Under twelve characters a "quote" matches by accident, and an accidental
    // mark is worse than none.
    expect(marked(markQuote(SAVE, "검사는"))).toBeNull();
  });

  it("does nothing when no words were named", () => {
    // 87% of citations name none.
    expect(marked(markQuote(SAVE, null))).toBeNull();
  });
});

describe("markQuote — bounds", () => {
  it("refuses a quote long enough to be a payload rather than a span", () => {
    // This builds a RegExp out of whatever it is handed, so it enforces its own
    // ceiling rather than trusting the field. The judge is asked for a span.
    const huge = "x".repeat(500);
    const out = markQuote(`before ${huge} after`, huge);
    const kids = (out as { props?: { children?: unknown } }).props?.children;
    expect(Array.isArray(kids)).toBe(false);
  });
});

describe("room evidence access", () => {
  it("loads full detail for the viewer's own evidence", () => {
    expect(canLoadFullSignal("group", "viewer-1", "viewer-1")).toBe(true);
  });

  it("keeps another member's evidence at the shared-excerpt boundary", () => {
    expect(canLoadFullSignal("group", "member-2", "viewer-1")).toBe(false);
  });

  it("continues to load full detail on the viewer's solo wall", () => {
    expect(canLoadFullSignal("solo", null, "viewer-1")).toBe(true);
  });
});

describe("room top-of-mind formation copy", () => {
  it("does not flash a ready-to-shape message before status arrives", () => {
    const presentation = roomFirstReadPresentation({
      memberCount: 3,
      sharedInspirationCount: 5,
      phase: null,
      loading: true,
      hasFormingRead: false,
    });

    expect(presentation.title).toBe("Opening the shared read…");
    expect(presentation.title).not.toMatch(/ready to shape/i);
  });

  it("explains that processing will create the first draft automatically", () => {
    const presentation = roomFirstReadPresentation({
      memberCount: 5,
      sharedInspirationCount: 5,
      phase: "processing",
      loading: false,
      hasFormingRead: false,
    });

    expect(presentation).toEqual({
      label: "FIRST READ · IN PROGRESS",
      title: "Finding the room’s first shared thread…",
      detail: "If a shared thread holds, a living draft appears here automatically.",
    });
  });

  it("separates an honest forming result from background processing", () => {
    const presentation = roomFirstReadPresentation({
      memberCount: 5,
      sharedInspirationCount: 5,
      phase: "needs_more_context",
      loading: false,
      hasFormingRead: true,
    });

    expect(presentation.title).toBe("No shared thread holds yet.");
    expect(presentation.detail).toContain("Member takes");
  });

  it("keeps the invite state distinct", () => {
    expect(roomFirstReadPresentation({
      memberCount: 1,
      sharedInspirationCount: 3,
      phase: "needs_people",
      loading: false,
      hasFormingRead: false,
    }).label).toBe("WAITING FOR SOMEONE");
  });
});

describe("room direction evidence copy", () => {
  it("names evidence representation without implying active participation", () => {
    const copy = roomDirectionEvidenceCopy([
      { signalId: "signal-a", userId: "member-a" },
      { signalId: "signal-a", userId: "member-a" },
      { signalId: "signal-b", userId: "member-b" },
    ], 5);

    expect(copy).toBe("2 inspirations behind this draft · 2 of 5 members represented");
    expect(copy).not.toMatch(/contributed|shaped|approved/i);
  });
});

describe("room shaping progress copy", () => {
  it("makes the denominator explicitly the room's members", () => {
    expect(roomShapingProgressCopy(0, 5)).toBe("0 of 5 members added a take");
    expect(roomShapingProgressCopy(1, 6)).toBe("1 of 6 members added a take");
  });

  it("says that participation earns a reread rather than promising an update", () => {
    expect(roomShapingNextStepCopy({
      contributorCount: 1,
      requiredContributors: 3,
      state: "revealed",
      phase: "ready",
      hasProposal: false,
    })).toBe("2 more members before WAKA looks for a possible next version.");
    expect(roomShapingNextStepCopy({
      contributorCount: 3,
      requiredContributors: 3,
      state: "revealed",
      phase: "processing",
      hasProposal: false,
    })).toBe("WAKA is rereading the room for a possible next version.");
    expect(roomShapingNextStepCopy({
      contributorCount: 3,
      requiredContributors: 3,
      state: "revealed",
      phase: "ready",
      hasProposal: false,
    })).toBe("The room was reread; this version still holds.");
  });

  it("keeps the first-draft and proposal outcomes distinct", () => {
    expect(roomShapingNextStepCopy({
      contributorCount: 1,
      requiredContributors: 2,
      state: "forming",
      phase: "needs_more_context",
      hasProposal: false,
    })).toBe("1 more member before WAKA looks for a grounded first draft.");
    expect(roomShapingNextStepCopy({
      contributorCount: 3,
      requiredContributors: 3,
      state: "revealed",
      phase: "ready",
      hasProposal: true,
    })).toBe("A possible next version is ready for the room to decide.");
  });
});

describe("room proposal review copy", () => {
  it("distinguishes participation from the matching choice that decides", () => {
    expect(roomProposalReviewCopy(2, 6, 4)).toBe(
      "2 of 6 members responded · 4 matching choices decide",
    );
  });
});
