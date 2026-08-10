import { describe, expect, it } from "vitest";

import { formedSpanCopy, publicConsent, pulseProfileCopy } from "../src/components/AmbitionDocument";

import {
  SHARING_MEANING,
  SHARING_NOTE,
  confirmHoldingMessage,
  confirmLettingSpeakMessage,
  roomDirectionCtaCopy,
  roomIntentMetaCopy,
  roomArrivalSignature,
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

    expect(copy).toBe("2 pulses behind this draft · 2 of 5 members represented");
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
 * There are two states and they are named by the product's own physics: a
 * signal speaks OUT LOUD in your rooms, or it is HELD. The hint carries the
 * meaning, and the meaning has a boundary that matters: "out loud" is the
 * rooms you are in, never the internet. A public PROFILE is a separate
 * setting the person turns on themselves, so this copy must not imply it.
 */
describe("sharing copy", () => {
  it("scopes out loud to rooms, and never to anyone", () => {
    expect(SHARING_MEANING.outLoud).toBe("Any room you join can read this. It stays yours.");
    for (const overclaim of ["anyone", "everyone", "the internet", "the web", "public profile"]) {
      expect(SHARING_MEANING.outLoud.toLowerCase()).not.toContain(overclaim);
    }
  });

  it("says held stops shared rooms without claiming it stops the owner's own", () => {
    // The decision on record: held excludes a save from rooms, and it still
    // shapes the owner's own pulls. "Private" was retired for implying inert —
    // a held save still works for its owner, and the copy has to say so.
    expect(SHARING_MEANING.held).toBe(
      "Only your own room reads this. It still shapes your own pulls.",
    );
    expect(SHARING_MEANING.held).toContain("your own room");
    expect(SHARING_MEANING.held).toContain("your own pulls");
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
    expect(SHARING_NOTE.outLoud).toContain("excerpt");
    expect(SHARING_NOTE.outLoud).toContain("your name");
    expect(SHARING_NOTE.outLoud).toContain("every room you are in");
  });

  it("says held stays out of the pool a reading is made from", () => {
    expect(SHARING_NOTE.held).toContain("only your own room reads it");
    expect(SHARING_NOTE.held).toContain("cannot be quoted");
  });

  it("does not promise held hides a save from the owner's own readings", () => {
    // The decision on record: held gates rooms, not the solo pipeline.
    expect(SHARING_NOTE.both).toContain("your own pulls");
    expect(SHARING_NOTE.both).toContain("stays yours");
  });

  it("never claims the save reaches the public internet", () => {
    // A public PROFILE is a separate setting. "Out loud" here is rooms only.
    for (const line of [SHARING_NOTE.outLoud, SHARING_NOTE.held, SHARING_NOTE.both]) {
      for (const overclaim of ["anyone", "everyone", "the internet", "the web", "publicly"]) {
        expect(line.toLowerCase()).not.toContain(overclaim);
      }
    }
  });

  it("agrees with the short hint beside the control", () => {
    // Two surfaces, one promise. They may differ in length, never in meaning.
    expect(SHARING_MEANING.held).toContain("your own room");
    expect(SHARING_NOTE.held.toLowerCase()).toContain("your own room");
    expect(SHARING_MEANING.outLoud).toContain("room");
    expect(SHARING_NOTE.outLoud).toContain("room");
  });
});

/**
 * The rule, named: rooms can't unhear. Holding is recoverable in every
 * respect but one — it does not unmake a reading a room already produced.
 * That asymmetry is why the confirmation sits on letting a save speak, and
 * why the caveat has to be stated rather than implied by "held".
 */
describe("rooms can't unhear", () => {
  it("names the rule and says what holding stops", () => {
    expect(SHARING_NOTE.cantUnhear.startsWith("Rooms can't unhear.")).toBe(true);
    expect(SHARING_NOTE.cantUnhear).toContain("stops it being read");
    expect(SHARING_NOTE.cantUnhear).toContain("quoted");
    expect(SHARING_NOTE.cantUnhear).toContain("shown as evidence");
    // The part people would otherwise assume.
    expect(SHARING_NOTE.cantUnhear).toContain("already made from it stays");
  });

  it("does not promise the reading is retired or withdrawn", () => {
    for (const wrong of ["deleted", "removed from", "retired", "undone", "erased"]) {
      expect(SHARING_NOTE.cantUnhear.toLowerCase()).not.toContain(wrong);
    }
  });
});

describe("the confirmation shown before a save speaks", () => {
  const message = confirmLettingSpeakMessage();

  it("asks a plain question first — what pressing OK does, in ordinary words", () => {
    expect(message.startsWith("Let every room you are in read this?")).toBe(true);
  });

  it("says who gains access and what they would see", () => {
    expect(message).toContain("Every room you are in can read it");
    expect(message).toContain("short excerpt");
    expect(message).toContain("your name");
  });

  it("carries the rule about keeping it back", () => {
    // The whole reason this prompt exists: speaking is the step that cannot
    // be fully taken back.
    expect(message).toContain("Rooms can't unhear");
    expect(message).toContain("keeping it to yourself again later");
    expect(message).toContain("stays on that room's wall");
  });

  it("reads as prose in a dialog, not as one wall of text", () => {
    const paragraphs = message.split("\n\n");
    expect(paragraphs).toHaveLength(3);
    for (const paragraph of paragraphs) expect(paragraph.trim().length).toBeGreaterThan(0);
  });

  it("never widens out loud beyond the rooms", () => {
    for (const overclaim of ["anyone", "everyone", "the internet", "the web"]) {
      expect(message.toLowerCase()).not.toContain(overclaim);
    }
  });
});

/**
 * Holding asks nothing — until rooms have already read the save. Then the
 * dialog exists to say the two concrete things: what stops now, and the
 * readings that stay standing because rooms can't unhear.
 */
describe("the confirmation shown before a read save is held", () => {
  it("speaks this save's own numbers, in singular and plural", () => {
    expect(confirmHoldingMessage(1)).toContain(
      "the 1 reading rooms already made from it stays",
    );
    expect(confirmHoldingMessage(3)).toContain(
      "the 3 readings rooms already made from it stay",
    );
  });

  it("says what stops now and names the rule", () => {
    const message = confirmHoldingMessage(2);
    expect(message.startsWith("Stop rooms from reading this?")).toBe(true);
    expect(message).toContain("Rooms stop reading it now");
    expect(message).toContain("withdraws from the evidence");
    expect(message).toContain("Rooms can't unhear");
  });

  it("does not promise the standing readings go anywhere", () => {
    for (const wrong of ["deleted", "removed from the wall", "retired", "undone", "erased"]) {
      expect(confirmHoldingMessage(2).toLowerCase()).not.toContain(wrong);
    }
  });

  it("reads as prose in a dialog, not as one wall of text", () => {
    expect(confirmHoldingMessage(2).split("\n\n")).toHaveLength(3);
  });
});

/**
 * A button names its destination in that destination's own words.
 *
 * "open shared read" failed that: the page it opens is labelled SHARED TOP OF
 * AMBITION under the heading "What we're finding together", and the noun "read"
 * appears nowhere on it. Three names for one surface were live at once —
 * "shared read" on the button, "shared top of mind" on the page and every
 * aria-label, "direction" in the URL and the API. Only one was ever shown to a
 * person, so that is the one these assert.
 */
describe("the button that opens a room's ambition", () => {
  const cta = (over: Partial<Parameters<typeof roomDirectionCtaCopy>[0]> = {}) =>
    roomDirectionCtaCopy({
      memberCount: 4,
      hasProposal: false,
      hasCurrent: true,
      inviteCopied: false,
      ...over,
    });

  it("names the page it opens, in the words that page uses", () => {
    expect(cta()).toBe("open the ambition");
  });

  it("never calls it a 'read', which is a noun the destination never uses", () => {
    const everyState = [
      cta(),
      cta({ hasCurrent: false }),
      cta({ hasProposal: true }),
      cta({ memberCount: 1 }),
      cta({ memberCount: 1, inviteCopied: true }),
    ];
    for (const label of everyState) {
      expect(label).not.toContain("shared read");
    }
  });

  it("offers the invite instead of an empty page when the room is one person", () => {
    // Opening a shared reading of one person is not a thing that exists.
    expect(cta({ memberCount: 1 })).toBe("invite someone");
    expect(cta({ memberCount: 1, inviteCopied: true })).toBe("invite link copied");
  });

  it("puts a waiting decision ahead of ordinary browsing", () => {
    expect(cta({ hasProposal: true })).toBe("review the proposed version");
    // Even when a current version exists, the decision is the more useful door.
    expect(cta({ hasProposal: true, hasCurrent: true })).toBe("review the proposed version");
  });

  it("says the read has not happened yet rather than offering to open nothing", () => {
    expect(cta({ hasCurrent: false })).toBe("see the first ambition");
  });

  it("always says what it does — never a bare verb with no object", () => {
    for (const label of [cta(), cta({ hasCurrent: false }), cta({ hasProposal: true })]) {
      expect(label.split(" ").length).toBeGreaterThan(2);
    }
  });
});

/**
 * The strip's meta line replaced a four-clause sentence — pool size, a
 * traces-to count the faces beside it already show, a version date, a new-save
 * count. What survives is only what the faces cannot say.
 */
describe("the room strip's meta line", () => {
  it("says how old the version is, and nothing the faces already show", () => {
    const line = roomIntentMetaCopy({
      hasCurrent: true,
      when: "yesterday",
      newInspirationCount: 0,
      sharedContributorCount: 2,
      memberCount: 6,
    });
    expect(line).toBe("from yesterday");
    expect(line).not.toContain("traces");
    expect(line).not.toContain("members");
    expect(line).not.toContain("shared inspiration");
  });

  it("adds arrivals since the reading, because that is the actionable part", () => {
    expect(
      roomIntentMetaCopy({
        hasCurrent: true,
        when: "3 days ago",
        newInspirationCount: 3,
        sharedContributorCount: 2,
        memberCount: 6,
      }),
    ).toBe("from 3 days ago · 3 new saves since");
    expect(
      roomIntentMetaCopy({
        hasCurrent: true,
        when: "today",
        newInspirationCount: 1,
        sharedContributorCount: 2,
        memberCount: 6,
      }),
    ).toBe("from today · 1 new save since");
  });

  it("falls back to the progress fact before a first version exists", () => {
    // No version yet means no faces to point at, so the line carries the one
    // number that moves: who has brought material.
    expect(
      roomIntentMetaCopy({
        hasCurrent: false,
        when: "",
        newInspirationCount: 0,
        sharedContributorCount: 2,
        memberCount: 6,
      }),
    ).toBe("2 of 6 members brought material");
  });

  it("stays one glance long in every state", () => {
    for (const line of [
      roomIntentMetaCopy({ hasCurrent: true, when: "yesterday", newInspirationCount: 12, sharedContributorCount: 5, memberCount: 6 }),
      roomIntentMetaCopy({ hasCurrent: false, when: "", newInspirationCount: 0, sharedContributorCount: 5, memberCount: 6 }),
    ]) {
      expect(line.length).toBeLessThanOrEqual(45);
      // One separator at most — the old line had three.
      expect(line.split("·").length).toBeLessThanOrEqual(2);
    }
  });
});

/**
 * An open room wall polls a cheap status endpoint every 30s to notice work
 * somebody else started. This signature is what decides whether that tick is
 * free or pays for a board and a direction — so it has to move when the room
 * moved, and hold absolutely still when it did not.
 */
describe("noticing that a room moved without you", () => {
  const status = (over = {}) => ({
    phase: "ready" as const,
    message: "",
    memberCount: 6,
    sharedSignalCount: 64,
    noteCount: 5,
    job: {
      id: "job-1",
      type: "group_reading_refresh" as const,
      status: "succeeded" as const,
      lastError: null,
      updatedAt: "2026-08-06T10:00:00.000Z",
    },
    ...over,
  });

  it("holds still when nothing changed, so an idle tab costs one small request", () => {
    expect(roomArrivalSignature(status())).toBe(roomArrivalSignature(status()));
  });

  it("moves when a reread produced a new job", () => {
    expect(roomArrivalSignature(status())).not.toBe(
      roomArrivalSignature(status({ job: { ...status().job, id: "job-2" } })),
    );
  });

  it("moves when a running job finishes", () => {
    // pending -> running -> succeeded each land a different board state.
    const running = status({ phase: "processing" as const, job: { ...status().job, status: "running" as const } });
    expect(roomArrivalSignature(running)).not.toBe(roomArrivalSignature(status()));
  });

  it("moves when the board gained or lost a note", () => {
    expect(roomArrivalSignature(status())).not.toBe(
      roomArrivalSignature(status({ noteCount: 6 })),
    );
  });

  it("moves when the same job is retried and its timestamp advances", () => {
    expect(roomArrivalSignature(status())).not.toBe(
      roomArrivalSignature(status({ job: { ...status().job, updatedAt: "2026-08-06T11:00:00.000Z" } })),
    );
  });

  it("survives a room that has never been read", () => {
    // No job yet is a legitimate state, not a crash.
    expect(() => roomArrivalSignature(status({ job: null }))).not.toThrow();
    expect(roomArrivalSignature(status({ job: null }))).not.toBe(roomArrivalSignature(status()));
  });
});

/**
 * The report's provenance lines: dates and mixes spoken as sentences,
 * silent when the data can't carry them.
 */
describe("the formed-from lines", () => {
  // Local noon survives the round-trip through ISO in every timezone, so the
  // spoken dates are the same wherever the suite runs.
  const noon = (y: number, m: number, d: number) => new Date(y, m, d, 12).toISOString();

  it("names the span as dates, never counts", () => {
    expect(formedSpanCopy(noon(2026, 5, 12), noon(2026, 7, 3))).toBe(
      "formed from pulses between June 12 and August 3",
    );
  });

  it("collapses a single-day span instead of repeating the date", () => {
    expect(formedSpanCopy(noon(2026, 7, 3), noon(2026, 7, 3))).toBe(
      "formed from pulses on August 3",
    );
  });

  it("says nothing when either end is missing", () => {
    expect(formedSpanCopy(null, noon(2026, 7, 3))).toBeNull();
    expect(formedSpanCopy(noon(2026, 7, 3), null)).toBeNull();
  });

  it("reads the pulse mix as the manifesto, and stays silent when unknown", () => {
    expect(
      pulseProfileCopy({ reactionCount: 7, compositionCount: 2, unknownCount: 0, medianElapsedMs: 900 }),
    ).toBe("mostly quickened pulses — saved before thinking");
    expect(
      pulseProfileCopy({ reactionCount: 1, compositionCount: 8, unknownCount: 0, medianElapsedMs: null }),
    ).toBe("mostly composed — written slowly, on purpose");
    expect(
      pulseProfileCopy({ reactionCount: 3, compositionCount: 3, unknownCount: 1, medianElapsedMs: null }),
    ).toBe("part quickened pulse, part composition");
    expect(pulseProfileCopy(null)).toBeNull();
    expect(
      pulseProfileCopy({ reactionCount: 0, compositionCount: 0, unknownCount: 4, medianElapsedMs: null }),
    ).toBeNull();
  });
});

/** Draft vs public: the press is publish consent; majority clears it. */
describe("public consent on the key ambition", () => {
  it("stays a room-only draft below the majority", () => {
    expect(publicConsent({ agreedCount: 2, requiredResponses: 3 })).toEqual({
      cleared: false,
      modeLabel: "draft — room only",
    });
  });

  it("clears to go public at the majority", () => {
    expect(publicConsent({ agreedCount: 3, requiredResponses: 3 }).cleared).toBe(true);
    expect(publicConsent({ agreedCount: 5, requiredResponses: 3 }).modeLabel).toBe(
      "cleared to go public",
    );
  });

  it("never clears when the room has no threshold yet", () => {
    expect(publicConsent({ agreedCount: 4, requiredResponses: 0 }).cleared).toBe(false);
  });
});
