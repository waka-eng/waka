import { describe, expect, it } from "vitest";

import {
  SHARING_MEANING,
  SHARING_NOTE,
  confirmGoingPublicMessage,
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

/**
 * There are two states and they are named by one word each. The hint carries
 * the meaning, and the meaning has a boundary that matters: "public" is the
 * rooms you are in, never the internet. A public PROFILE is a separate setting
 * the person turns on themselves, so this copy must not imply it.
 */
describe("sharing copy", () => {
  it("scopes public to rooms, and never to anyone", () => {
    expect(SHARING_MEANING.public).toBe("Any room you join can read this. It stays yours.");
    for (const overclaim of ["anyone", "everyone", "the internet", "the web", "public profile"]) {
      expect(SHARING_MEANING.public.toLowerCase()).not.toContain(overclaim);
    }
  });

  it("says private stops rooms without claiming it stops your own readings", () => {
    // The decision on record: private excludes a save from rooms, and it still
    // shapes the owner's own Top of Mind. Copy that implied otherwise would be
    // a promise the pipeline does not keep.
    expect(SHARING_MEANING.private).toBe(
      "No room can read this. It still shapes your own Top of Mind.",
    );
    expect(SHARING_MEANING.private).toContain("No room");
    expect(SHARING_MEANING.private).toContain("your own Top of Mind");
  });

  it("keeps both meanings short enough to sit under a one-word control", () => {
    for (const meaning of Object.values(SHARING_MEANING)) {
      expect(meaning.length).toBeLessThanOrEqual(72);
      expect(meaning.endsWith(".")).toBe(true);
    }
  });
});

/**
 * The archive note is the one place the product explains a privacy setting at
 * length, so every claim in it has to match what the room code does. These
 * assertions are the check that it still does — if a future change makes rooms
 * show more than an excerpt, or stops attributing it, this fails.
 */
describe("sharing note", () => {
  it("answers who sees it and what they see of it", () => {
    // Rooms serve truncatePreview output (PREVIEW_LENGTH = 180) with ownerName
    // attached — never the full text, per canLoadFullSignal.
    expect(SHARING_NOTE.public).toContain("excerpt");
    expect(SHARING_NOTE.public).toContain("your name");
    expect(SHARING_NOTE.public).toContain("every room you are in");
  });

  it("says private stays out of the pool a reading is made from", () => {
    expect(SHARING_NOTE.private).toContain("no room can read it");
    expect(SHARING_NOTE.private).toContain("cannot be quoted");
  });

  it("does not promise private hides a save from the owner's own readings", () => {
    // The decision on record: private gates rooms, not the solo pipeline.
    expect(SHARING_NOTE.both).toContain("your own Top of Mind");
    expect(SHARING_NOTE.both).toContain("stays yours");
  });

  it("never claims the save reaches the public internet", () => {
    // A public PROFILE is a separate setting. "Public" here is rooms only.
    for (const line of [SHARING_NOTE.public, SHARING_NOTE.private, SHARING_NOTE.both]) {
      for (const overclaim of ["anyone", "everyone", "the internet", "the web", "publicly"]) {
        expect(line.toLowerCase()).not.toContain(overclaim);
      }
    }
  });

  it("agrees with the short hint beside the control", () => {
    // Two surfaces, one promise. They may differ in length, never in meaning.
    expect(SHARING_MEANING.private).toContain("No room");
    expect(SHARING_NOTE.private.toLowerCase()).toContain("no room");
    expect(SHARING_MEANING.public).toContain("room");
    expect(SHARING_NOTE.public).toContain("room");
  });
});

/**
 * Going private is recoverable in every respect but one: it does not unmake a
 * reading a room already produced. That asymmetry is why the confirmation is
 * on the way in rather than the way out, and why the caveat has to be stated
 * rather than implied by "private".
 */
describe("the caveat on turning a save private", () => {
  it("says what going private stops, and what it cannot undo", () => {
    expect(SHARING_NOTE.goingPrivate).toContain("stops it being read");
    expect(SHARING_NOTE.goingPrivate).toContain("quoted");
    expect(SHARING_NOTE.goingPrivate).toContain("shown as evidence");
    // The part people would otherwise assume.
    expect(SHARING_NOTE.goingPrivate).toContain("already made from it stays");
  });

  it("does not promise the reading is retired or withdrawn", () => {
    for (const wrong of ["deleted", "removed from", "retired", "undone", "erased"]) {
      expect(SHARING_NOTE.goingPrivate.toLowerCase()).not.toContain(wrong);
    }
  });
});

describe("the confirmation shown before a save is made public", () => {
  const message = confirmGoingPublicMessage();

  it("asks the question first", () => {
    expect(message.startsWith("Make this public?")).toBe(true);
  });

  it("says who gains access and what they would see", () => {
    expect(message).toContain("Every room you are in can read it");
    expect(message).toContain("short excerpt");
    expect(message).toContain("your name");
  });

  it("carries the caveat about turning it back", () => {
    // The whole reason this prompt exists: public is the step that cannot be
    // fully taken back.
    expect(message).toContain("Making it private again later");
    expect(message).toContain("stays on that room's wall");
  });

  it("reads as prose in a dialog, not as one wall of text", () => {
    const paragraphs = message.split("\n\n");
    expect(paragraphs).toHaveLength(3);
    for (const paragraph of paragraphs) expect(paragraph.trim().length).toBeGreaterThan(0);
  });

  it("never widens public beyond the rooms", () => {
    for (const overclaim of ["anyone", "everyone", "the internet", "the web"]) {
      expect(message.toLowerCase()).not.toContain(overclaim);
    }
  });
});
