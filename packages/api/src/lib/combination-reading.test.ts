import { describe, expect, it } from "vitest";

import {
  GeminiCombinationReader,
  borrowsVerbatim,
  buildCombinationReaderRequest,
  evidenceSpan,
  restatesANote,
  signalSetHash,
  summarizePulse,
  verifyQuotes,
  type CombinationReaderEvidence,
  type CombinationReaderInput,
} from "./combination-reading.js";

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b2";

function evidence(
  overrides: Partial<CombinationReaderEvidence> & Pick<CombinationReaderEvidence, "signalId">,
): CombinationReaderEvidence {
  return {
    userId: A,
    memberLabel: "member A",
    text: "the bench they put in the window so the making was visible from the street",
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    ...overrides,
  };
}

const input: CombinationReaderInput = {
  memberLabels: ["member A", "member B"],
  notes: [
    {
      id: "note-1",
      title: "Rooms that instruct without speaking",
      why: "Both collections circle architecture as instruction.",
      evidenceSignalIds: ["sig-a", "sig-b"],
    },
  ],
  evidence: [
    evidence({ signalId: "sig-a" }),
    evidence({
      signalId: "sig-b",
      userId: B,
      memberLabel: "member B",
      text: "a hallway that tells you where to stand without a single sign",
    }),
  ],
};

/** Minimal Gemini envelope around a reader payload. */
function stubFetch(payload: unknown): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
}

const revealed = {
  state: "revealed",
  ambition: "To build places where the making is visible, and to build them with people who notice that.",
  facets: [{ dimension: "what it teaches", text: "spaces that instruct by being entered" }],
  quotes: [
    { savedBy: "member A", signalId: "sig-a", quote: "the bench they put in the window" },
    { savedBy: "member B", signalId: "sig-b", quote: "a hallway that tells you where to stand" },
  ],
  groundedNoteIds: ["note-1"],
};

describe("pulse profile", () => {
  it("separates reactions from compositions and ignores unrecorded saves", () => {
    // A fast save is a pulse before the reasons arrived; a slow one is writing.
    const profile = summarizePulse([
      { captureElapsedMs: 4_000 },
      { captureElapsedMs: 20_000 },
      { captureElapsedMs: 300_000 },
      { captureElapsedMs: null },
      {},
    ]);
    expect(profile.reactionCount).toBe(2);
    expect(profile.compositionCount).toBe(1);
    expect(profile.unknownCount).toBe(2);
    expect(profile.medianElapsedMs).toBe(20_000);
  });
});

describe("evidence span", () => {
  it("reports the earliest and latest save a reading rests on", () => {
    const span = evidenceSpan([
      { createdAt: new Date("2026-01-05T00:00:00.000Z") },
      { createdAt: new Date("2025-03-02T00:00:00.000Z") },
      { createdAt: new Date("2026-07-30T00:00:00.000Z") },
    ]);
    expect(span.start?.toISOString()).toBe("2025-03-02T00:00:00.000Z");
    expect(span.end?.toISOString()).toBe("2026-07-30T00:00:00.000Z");
  });

  it("is empty rather than wrong when there is no evidence", () => {
    expect(evidenceSpan([])).toEqual({ start: null, end: null });
  });
});

describe("signal set hash", () => {
  it("is stable across ordering but changes when the material changes", () => {
    // Provenance: a reading you cannot tie to what produced it cannot be
    // compared across runs or invalidated when members save more.
    const reordered: CombinationReaderInput = {
      ...input,
      evidence: [...input.evidence].reverse(),
    };
    expect(signalSetHash(reordered)).toBe(signalSetHash(input));

    const grown: CombinationReaderInput = {
      ...input,
      evidence: [...input.evidence, evidence({ signalId: "sig-c" })],
    };
    expect(signalSetHash(grown)).not.toBe(signalSetHash(input));
  });
});

describe("quote verification", () => {
  it("keeps only lines that actually appear in the cited save", () => {
    const kept = verifyQuotes(
      [
        { savedBy: "member A", signalId: "sig-a", quote: "bench they put in the window" },
        { savedBy: "member A", signalId: "sig-a", quote: "a line nobody ever wrote" },
        { savedBy: "member B", signalId: "missing", quote: "from a save that is not here" },
      ],
      input.evidence,
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ userId: A, signalId: "sig-a" });
  });

  it("tolerates whitespace and case differences", () => {
    const kept = verifyQuotes(
      [{ savedBy: "member A", signalId: "sig-a", quote: "  The BENCH   they put  " }],
      input.evidence,
    );
    expect(kept).toHaveLength(1);
  });
});

describe("restatement guard", () => {
  it("catches an ambition that is a note title in other clothes", () => {
    expect(restatesANote("Rooms that instruct without speaking", input.notes)).toBe(true);
  });

  it("allows a want that says something the notes did not", () => {
    expect(restatesANote(revealed.ambition, input.notes)).toBe(false);
  });
});

describe("speaking their language without quoting them", () => {
  // A top-of-mind must dissolve its saves, not stack them. Verbatim quotes
  // inside the ambition are the seams of the evidence showing through a
  // sentence that was supposed to have absorbed it. The quotes belong in the
  // grounding layer beside the reading, never inside it.
  it("catches an ambition built out of citations", () => {
    expect(
      borrowsVerbatim(
        'We want places where "the bench they put in the window so the making was visible" is normal.',
        input.evidence,
      ),
    ).toBe(true);
  });

  it("catches lifted phrasing even without the quotation marks", () => {
    expect(
      borrowsVerbatim(
        "We want a hallway that tells you where to stand without a single sign.",
        input.evidence,
      ),
    ).toBe(true);
  });

  it("allows their vocabulary when the sentence is genuinely rewritten", () => {
    // "making" and "stand" are their words; no run of theirs survives intact.
    // Note "visible from the street" would NOT pass — that is a borrowed
    // phrase, not shared vocabulary, and the line between them is the point.
    expect(
      borrowsVerbatim(
        "We want making to be something a passer-by can see, and to build it beside people who read a room the same way.",
        input.evidence,
      ),
    ).toBe(false);
  });
});

describe("what reaches the model", () => {
  it("carries saves that ground no note, so a quiet member still has a voice", () => {
    // Notes are the integrity gate; they are not the vocabulary. A reading
    // built only from notes is a summary of summaries, which is how the first
    // real run came back at industry-trend level.
    const request = buildCombinationReaderRequest({
      ...input,
      evidence: [
        ...input.evidence,
        evidence({ signalId: "sig-quiet", userId: B, memberLabel: "member B", text: "a spa is not a hospital" }),
      ],
    });
    const payload = request.contents[0]!.parts[0]!.text;
    expect(payload).toContain("alsoSaved");
    expect(payload).toContain("a spa is not a hospital");
  });

  it("ranks the saves the combination changed the most, first", () => {
    const request = buildCombinationReaderRequest({
      ...input,
      evidence: [
        ...input.evidence,
        evidence({ signalId: "sig-dull", userId: B, memberLabel: "member B", text: "dull one", divergenceScore: 5 }),
        evidence({ signalId: "sig-sharp", userId: B, memberLabel: "member B", text: "sharp one", divergenceScore: 92 }),
      ],
    });
    const payload = request.contents[0]!.parts[0]!.text;
    // The signal that means something else here than alone leads.
    expect(payload.indexOf("sharp one")).toBeLessThan(payload.indexOf("dull one"));
    expect(payload).toContain('"readsDifferentlyHere": 92');
  });
});

describe("the request sent to the model", () => {
  it("carries anonymous labels and pulse, never member names", () => {
    const request = buildCombinationReaderRequest({
      ...input,
      evidence: [
        evidence({ signalId: "sig-a", captureElapsedMs: 3_000 }),
        evidence({
          signalId: "sig-b",
          userId: B,
          memberLabel: "member B",
          captureElapsedMs: 400_000,
        }),
      ],
    });
    const payload = request.contents[0]!.parts[0]!.text;
    expect(payload).toContain('"savedBy": "member A"');
    expect(payload).toContain('"pulse": "reaction"');
    expect(payload).toContain('"pulse": "composition"');
    // Deterministic, like every other judged stage in this pipeline.
    expect(request.generationConfig.temperature).toBe(0);
  });
});

describe("reading integrity, enforced on our side", () => {
  it("accepts a grounded reading and returns only verified quotes", async () => {
    const reader = new GeminiCombinationReader({ apiKey: "k", fetchFn: stubFetch(revealed) });
    const result = await reader.read(input);
    expect(result.state).toBe("revealed");
    if (result.state !== "revealed") return;
    expect(result.ambition).toBe(revealed.ambition);
    expect(result.quotes).toHaveLength(2);
    // A facet names its own dimension rather than filling a fixed column.
    expect(result.facets).toEqual([
      { dimension: "what it teaches", text: "spaces that instruct by being entered" },
    ]);
    // Dimensions the model did not speak to stay absent rather than padded.
    expect(result.tension).toBeNull();
  });

  it("falls back to forming when the words trace to only one heart", async () => {
    // The whole claim is that the combination revealed it. One member's words
    // cannot demonstrate that, however fluent the sentence.
    const oneHeart = {
      ...revealed,
      quotes: [
        { savedBy: "member A", signalId: "sig-a", quote: "the bench they put in the window" },
      ],
    };
    const reader = new GeminiCombinationReader({ apiKey: "k", fetchFn: stubFetch(oneHeart) });
    const result = await reader.read(input);
    expect(result.state).toBe("forming");
    if (result.state !== "forming") return;
    expect(result.whatsMissing).toContain("two members");
  });

  it("falls back to forming when quotes were invented", async () => {
    const invented = {
      ...revealed,
      quotes: [
        { savedBy: "member A", signalId: "sig-a", quote: "a line that was never saved" },
        { savedBy: "member B", signalId: "sig-b", quote: "nor was this one" },
      ],
    };
    const reader = new GeminiCombinationReader({ apiKey: "k", fetchFn: stubFetch(invented) });
    expect((await reader.read(input)).state).toBe("forming");
  });

  it("falls back to forming when the ambition quotes a save", async () => {
    const quoting = {
      ...revealed,
      ambition: 'We want more of "a hallway that tells you where to stand" in the world.',
    };
    const reader = new GeminiCombinationReader({ apiKey: "k", fetchFn: stubFetch(quoting) });
    const result = await reader.read(input);
    expect(result.state).toBe("forming");
    if (result.state !== "forming") return;
    expect(result.whatsMissing).toContain("verbatim");
  });

  it("falls back to forming when the ambition restates a note", async () => {
    const restated = { ...revealed, ambition: "Rooms that instruct without speaking" };
    const reader = new GeminiCombinationReader({ apiKey: "k", fetchFn: stubFetch(restated) });
    const result = await reader.read(input);
    expect(result.state).toBe("forming");
    if (result.state !== "forming") return;
    expect(result.whatsMissing).toContain("restated");
  });

  it("passes through an honest forming answer", async () => {
    const reader = new GeminiCombinationReader({
      apiKey: "k",
      fetchFn: stubFetch({ state: "forming", whatsMissing: "Only one heart has been readable." }),
    });
    const result = await reader.read(input);
    expect(result).toEqual({ state: "forming", whatsMissing: "Only one heart has been readable." });
  });

  it("throws on an unreadable reply rather than calling it silence", async () => {
    // The lesson from the judge: a reply we cannot parse is not a refusal.
    // Throwing lets the caller retry; returning "forming" would record a
    // transport failure as an answer about these people.
    const broken = (async () =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{{{" }] } }] }), {
        status: 200,
      })) as unknown as typeof fetch;
    const reader = new GeminiCombinationReader({ apiKey: "k", fetchFn: broken });
    await expect(reader.read(input)).rejects.toThrow(/unparseable/i);
  });
});
