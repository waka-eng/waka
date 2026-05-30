import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  createInspiration,
  fetchInspirations,
  fetchWowMoments,
  formatMeaningGraphRebuildError,
  updateAuthPreferences,
  type ApiInspiration,
  type ListWowMomentsResponse,
} from "../src/lib/api";

const emptySuccess: ListWowMomentsResponse = { wowMoments: [] };

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

function stubFetch(response: Response): void {
  vi.stubGlobal("fetch", vi.fn(async () => response));
}

describe("fetchWowMoments", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns WOW moments from a successful JSON response", async () => {
    const body: ListWowMomentsResponse = {
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

    await expect(fetchWowMoments()).resolves.toEqual(body.wowMoments);
    expect(fetch).toHaveBeenCalledWith("/api/wow-moments", {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  });

  it("preserves non-2xx API errors", async () => {
    stubFetch(Response.json({ error: "Please sign in" }, { status: 401 }));

    await expect(fetchWowMoments()).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      message: "Please sign in",
    } satisfies Partial<ApiError>);
  });

  it("throws ApiError for a successful response missing wowMoments", async () => {
    stubFetch(Response.json({ moments: [] }));

    await expect(fetchWowMoments()).rejects.toMatchObject({
      name: "ApiError",
      status: 200,
      message: "Malformed WOW moments response",
    } satisfies Partial<ApiError>);
  });

  it("throws ApiError for a successful response with non-array wowMoments", async () => {
    stubFetch(Response.json({ wowMoments: null }));

    await expect(fetchWowMoments()).rejects.toMatchObject({
      name: "ApiError",
      status: 200,
      message: "Malformed WOW moments response",
    } satisfies Partial<ApiError>);
  });

  it("throws ApiError for a successful non-JSON response", async () => {
    stubFetch(new Response("<html>ok</html>", { status: 200 }));

    await expect(fetchWowMoments()).rejects.toMatchObject({
      name: "ApiError",
      status: 200,
      message: "Malformed WOW moments response",
    } satisfies Partial<ApiError>);
  });

  it("still accepts an empty successful WOW moment list", async () => {
    stubFetch(Response.json(emptySuccess));

    await expect(fetchWowMoments()).resolves.toEqual([]);
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
