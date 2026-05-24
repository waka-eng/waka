import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  fetchWowMoments,
  updateAuthPreferences,
  type ListWowMomentsResponse,
} from "../src/lib/api";

const emptySuccess: ListWowMomentsResponse = { wowMoments: [] };

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
