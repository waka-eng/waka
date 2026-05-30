import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  createInspiration,
  createFeedback,
  fetchSavedSignalDetail,
  fetchSavedSignals,
  fetchInspirations,
  fetchTopOfMindNote,
  fetchTopOfMindNotes,
  fetchLegacyTopOfMindCompatibilityMoments,
  formatMeaningGraphRebuildError,
  updateAuthPreferences,
  type ApiInspiration,
  type ApiSavedSignalDetail,
  type ApiSavedSignalSearchResult,
  type ApiTopOfMindNoteSurface,
  type ListTopOfMindCompatibilityMomentsResponse,
} from "../src/lib/api";

const emptySuccess: ListTopOfMindCompatibilityMomentsResponse = { wowMoments: [] };

const topOfMindNote: ApiTopOfMindNoteSurface = {
  id: "note-1",
  userId: "user-1",
  title: "Recurring signal",
  type: "pattern",
  body: "Three saved signals rhyme.",
  prompt: null,
  guidance: null,
  confidence: 91,
  status: "active",
  relatedSignalIds: ["signal-1"],
  relatedContextNodeIds: [],
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-01T00:00:00.000Z",
  source: "wow_moment_compatibility",
  isProvisional: true,
  legacy: {
    wowMomentId: "note-1",
    wowKind: "recurrence",
    wowScore: 91,
  },
  evidencePreviews: [
    {
      signalId: "signal-1",
      role: "Source signal",
      reason: "This signal shows the recurring ritual.",
      textPreview: "Signal text",
      kind: "note",
      createdAt: "2026-04-30T00:00:00.000Z",
      resonanceScore: 64,
    },
  ],
  relatedSignals: [
    {
      id: "signal-1",
      preview: "Signal text",
      kind: "note",
      createdAt: "2026-04-30T00:00:00.000Z",
      resonanceScore: 64,
    },
  ],
};

const signalLayerInspiration: ApiInspiration = {
  id: "insp-1",
  userId: "user-1",
  text: "light bends around dense thoughts",
  kind: "note",
  category: 3,
  importanceScore: 44,
  wowScore: 71,
  cluster: null,
  classifiedAt: null,
  createdAt: "2026-05-30T20:00:00.000Z",
  updatedAt: "2026-05-30T20:00:00.000Z",
  signalScores: {
    resonance: 71,
    recurrence: 71,
    agency: 44,
    identitySignal: 44,
    decisionRelevance: 44,
  },
  signal: {
    id: "insp-1",
    userId: "user-1",
    text: "light bends around dense thoughts",
    kind: "note",
    category: 3,
    scores: {
      resonance: 71,
      recurrence: 71,
      agency: 44,
      identitySignal: 44,
      decisionRelevance: 44,
    },
    capturedAt: "2026-05-30T20:00:00.000Z",
    updatedAt: "2026-05-30T20:00:00.000Z",
    interpretation: {
      cluster: null,
      classifiedAt: null,
    },
    legacy: {
      inspirationId: "insp-1",
      importanceScore: 44,
      wowScore: 71,
    },
  },
};

const savedSignalResult: ApiSavedSignalSearchResult = {
  id: "sig-1",
  userId: "user-1",
  textPreview: "A saved signal about quiet research rooms.",
  kind: "note",
  capturedAt: "2026-05-30T12:00:00.000Z",
  updatedAt: "2026-05-30T12:00:00.000Z",
  resonanceScore: 84,
  signalScores: {
    resonance: 84,
    recurrence: 62,
    agency: 71,
    identitySignal: 73,
    decisionRelevance: 70,
  },
  highlightedSnippets: [
    {
      id: "spark-1",
      text: "quiet research rooms",
      source: "user_selected",
      confidence: 100,
      isPrimary: true,
    },
  ],
  matchingSnippets: ["quiet research rooms"],
  relatedContextTerms: ["environment: quiet rooms"],
  relatedTopOfMindNoteTitles: ["Rooms for honest work keep returning"],
  attachmentSummary: [],
  relevanceReasons: ["highlight match"],
};

const savedSignalDetail: ApiSavedSignalDetail = {
  ...savedSignalResult,
  rawText: "A saved signal about quiet research rooms and who gets to think there.",
  attachments: [],
  resonanceFeedback: [],
  signalPacket: {
    id: "packet-1",
    text: "waka.signal_packet.v1\nWHY_IT_MATTERS: quiet rooms keep recurring.",
    primarySpark: "quiet research rooms",
    artifactExcerpt: "A saved signal about quiet research rooms.",
    updatedAt: "2026-05-30T12:30:00.000Z",
  },
  relatedContextNodes: [
    {
      id: "node-1",
      type: "environment",
      label: "quiet research rooms",
      description: "Where attention seems to work.",
      confidence: 78,
      evidenceReason: "The signal names the environment directly.",
    },
  ],
  relatedTopOfMindNotes: [
    {
      id: "note-1",
      title: "Rooms for honest work keep returning",
      type: "pattern",
      body: "Several signals point at this room.",
      confidence: 86,
      status: "active",
    },
  ],
};

function stubFetch(response: Response): void {
  vi.stubGlobal("fetch", vi.fn(async () => response));
}

describe("fetchLegacyTopOfMindCompatibilityMoments", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns top-of-mind compatibility moments from a successful JSON response", async () => {
    const body: ListTopOfMindCompatibilityMomentsResponse = {
      wowMoments: [
        {
          id: "moment-1",
          userId: "user-1",
          title: "Recurring signal",
          kind: "recurrence",
          why: "Three saved inspirations rhyme.",
          beliefStatement: null,
          reflectionQuestion: null,
          reflectionGuide: "Choose the one rhyme that feels most alive, then write a small next question.",
          wowScore: 91,
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z",
          relatedInspirations: [],
          topOfMindNote: {
            id: "moment-1",
            userId: "user-1",
            title: "Recurring signal",
            type: "action",
            body: "Three saved inspirations rhyme.",
            prompt: null,
            guidance: "Choose the one rhyme that feels most alive, then write a small next question.",
            confidence: 91,
            status: "active",
            relatedSignalIds: [],
            relatedContextNodeIds: [],
            createdAt: "2026-05-01T00:00:00.000Z",
            updatedAt: "2026-05-01T00:00:00.000Z",
            source: "wow_moment_compatibility",
            isProvisional: true,
            legacy: {
              wowMomentId: "moment-1",
              wowKind: "recurrence",
              wowScore: 91,
            },
          },
        },
      ],
    };
    stubFetch(Response.json(body));

    await expect(fetchLegacyTopOfMindCompatibilityMoments()).resolves.toEqual(body.wowMoments);
    expect(fetch).toHaveBeenCalledWith("/api/wow-moments", {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  });

  it("preserves non-2xx API errors", async () => {
    stubFetch(Response.json({ error: "Please sign in" }, { status: 401 }));

    await expect(fetchLegacyTopOfMindCompatibilityMoments()).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      message: "Please sign in",
    } satisfies Partial<ApiError>);
  });

  it("throws ApiError for a successful response missing wowMoments", async () => {
    stubFetch(Response.json({ moments: [] }));

    await expect(fetchLegacyTopOfMindCompatibilityMoments()).rejects.toMatchObject({
      name: "ApiError",
      status: 200,
      message: "Malformed top-of-mind compatibility response",
    } satisfies Partial<ApiError>);
  });

  it("throws ApiError for a successful response with non-array wowMoments", async () => {
    stubFetch(Response.json({ wowMoments: null }));

    await expect(fetchLegacyTopOfMindCompatibilityMoments()).rejects.toMatchObject({
      name: "ApiError",
      status: 200,
      message: "Malformed top-of-mind compatibility response",
    } satisfies Partial<ApiError>);
  });

  it("throws ApiError for a successful non-JSON response", async () => {
    stubFetch(new Response("<html>ok</html>", { status: 200 }));

    await expect(fetchLegacyTopOfMindCompatibilityMoments()).rejects.toMatchObject({
      name: "ApiError",
      status: 200,
      message: "Malformed top-of-mind compatibility response",
    } satisfies Partial<ApiError>);
  });

  it("still accepts an empty successful compatibility list", async () => {
    stubFetch(Response.json(emptySuccess));

    await expect(fetchLegacyTopOfMindCompatibilityMoments()).resolves.toEqual([]);
  });
});

describe("fetchTopOfMindNotes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns active top-of-mind notes from the user-facing route", async () => {
    stubFetch(Response.json({ topOfMindNotes: [topOfMindNote] }));

    await expect(fetchTopOfMindNotes({ limit: 3 })).resolves.toEqual([
      topOfMindNote,
    ]);
    expect(fetch).toHaveBeenCalledWith("/api/top-of-mind?limit=3", {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  });

  it("throws ApiError for a malformed note list response", async () => {
    stubFetch(Response.json({ topOfMindNotes: null }));

    await expect(fetchTopOfMindNotes()).rejects.toMatchObject({
      name: "ApiError",
      status: 200,
      message: "Malformed top-of-mind notes response",
    } satisfies Partial<ApiError>);
  });
});

describe("fetchTopOfMindNote", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a single top-of-mind note detail", async () => {
    stubFetch(Response.json({ topOfMindNote }));

    await expect(fetchTopOfMindNote("note-1")).resolves.toEqual(topOfMindNote);
    expect(fetch).toHaveBeenCalledWith("/api/top-of-mind/note-1", {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  });

  it("preserves API errors from the detail endpoint", async () => {
    stubFetch(Response.json({ error: "Top-of-mind note not found" }, { status: 404 }));

    await expect(fetchTopOfMindNote("missing")).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
      message: "Top-of-mind note not found",
    } satisfies Partial<ApiError>);
  });
});

describe("saved signal archive API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches saved signal search results with search, filter, and sort params", async () => {
    stubFetch(Response.json({ signals: [savedSignalResult] }));

    await expect(
      fetchSavedSignals({
        q: "room",
        filter: "highlighted",
        sort: "resonance",
        limit: 12,
      }),
    ).resolves.toEqual([savedSignalResult]);
    expect(fetch).toHaveBeenCalledWith(
      "/api/signals?q=room&filter=highlighted&sort=resonance&limit=12",
      {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
      },
    );
  });

  it("fetches a saved signal deep dive", async () => {
    stubFetch(Response.json({ signal: savedSignalDetail }));

    await expect(fetchSavedSignalDetail("sig-1")).resolves.toEqual(savedSignalDetail);
    expect(fetch).toHaveBeenCalledWith("/api/signals/sig-1", {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  });

  it("throws ApiError for malformed saved signal list responses", async () => {
    stubFetch(Response.json({ signals: null }));

    await expect(fetchSavedSignals()).rejects.toMatchObject({
      name: "ApiError",
      status: 200,
      message: "Malformed saved signals response",
    } satisfies Partial<ApiError>);
  });
});

describe("createFeedback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists top-of-mind note feedback through the feedback route", async () => {
    const feedback = {
      id: "feedback-1",
      userId: "user-1",
      targetType: "top_of_mind_note" as const,
      targetId: "note-1",
      value: "partly" as const,
      emotionLabel: null,
      correctionText: "This is closer if it mentions the workshop.",
      source: "user",
      metadata: {},
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    };
    stubFetch(Response.json({ feedback }, { status: 201 }));

    await expect(
      createFeedback({
        targetType: "top_of_mind_note",
        targetId: "note-1",
        value: "partly",
        correctionText: "This is closer if it mentions the workshop.",
      }),
    ).resolves.toEqual(feedback);
    expect(fetch).toHaveBeenCalledWith("/api/feedback", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetType: "top_of_mind_note",
        targetId: "note-1",
        value: "partly",
        correctionText: "This is closer if it mentions the workshop.",
      }),
    });
  });

  it("preserves feedback API failures", async () => {
    stubFetch(Response.json({ error: "Feedback target not found" }, { status: 404 }));

    await expect(
      createFeedback({
        targetType: "top_of_mind_note",
        targetId: "missing",
        value: "not_true",
      }),
    ).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
      message: "Feedback target not found",
    } satisfies Partial<ApiError>);
  });
});

describe("inspiration signal compatibility", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps createInspiration on the existing route while preserving signal-facing scores", async () => {
    stubFetch(Response.json({ inspiration: signalLayerInspiration }, { status: 201 }));

    await expect(
      createInspiration({
        text: "light bends around dense thoughts",
        kind: "note",
        category: 3,
      }),
    ).resolves.toEqual(signalLayerInspiration);

    expect(fetch).toHaveBeenCalledWith("/api/inspirations", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "light bends around dense thoughts",
        kind: "note",
        category: 3,
      }),
    });
  });

  it("keeps fetchInspirations on the existing route while exposing signal-facing scores", async () => {
    stubFetch(Response.json({ inspirations: [signalLayerInspiration] }));

    await expect(fetchInspirations()).resolves.toEqual([signalLayerInspiration]);

    expect(fetch).toHaveBeenCalledWith("/api/inspirations", {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  });
});

describe("updateAuthPreferences", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("PATCHes the preferred locale and returns the updated user", async () => {
    const body = {
      user: {
        id: "user-1",
        email: "user@example.com",
        name: "User",
        preferredLocale: "ko-KR" as const,
      },
    };
    stubFetch(Response.json(body));

    await expect(updateAuthPreferences({ preferredLocale: "ko-KR" })).resolves.toEqual(body);
    expect(fetch).toHaveBeenCalledWith("/api/auth/me/preferences", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferredLocale: "ko-KR" }),
    });
  });
});

describe("formatMeaningGraphRebuildError", () => {
  it("explains ambiguous remote timeout and proxy failures", () => {
    const message = formatMeaningGraphRebuildError(
      new ApiError({ status: 502, message: "Bad Gateway" }),
    );

    expect(message).toContain("timed out or the remote proxy returned HTTP 502/504");
    expect(message).toContain("may still be running server-side");
    expect(message).toContain("click Refresh");
  });

  it("adds rebuild context to ordinary API failures", () => {
    expect(
      formatMeaningGraphRebuildError(new ApiError({ status: 500, message: "Gemini quota exhausted" })),
    ).toBe("Rebuild failed: Gemini quota exhausted");
  });
});
