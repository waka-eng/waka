/**
 * THE HTTP CLIENT, AGAINST A NETWORK THAT SAYS WHAT THE TEST TOLD IT TO.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). The global `fetch`, and nothing else.
 * `lib/api` IS the subject here — every function below is one request shape
 * and one response shape — so the only seam left underneath it is the network.
 * Mocking a module would remove the thing being measured; mocking anything
 * above it would measure a caller instead.
 *
 * This is therefore the one web suite where stubbing `fetch` is the right
 * answer rather than a shortcut. Every other suite sits on a page, and a page
 * sits on this module: reaching all the way down to `fetch` from up there
 * would make each of those files silently responsible for URL strings and
 * header casing it has no opinion about, and the first route rename would turn
 * a dozen unrelated suites red.
 *
 * WHY EVERY CASE ASSERTS TWICE. What the call RETURNS, and the exact request
 * it SENT. A client can decode a payload perfectly while calling the wrong
 * route, or calling the right one without `credentials: "include"` — which
 * reads as "not signed in" to every route on the server. Only the second half
 * of each pair can see that, and it is the half a type checker never will.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  createFeedback,
  createInspiration,
  deleteInspiration,
  fetchCurrentViewer,
  fetchInspiration,
  fetchInspirations,
  fetchPublicProfile,
  fetchSignal,
  fetchSignals,
  fetchTopOfMind,
  refreshTopOfMind,
  holdTopOfMindEntry,
  shareSignal,
  updateAuthPreferences,
  updateSignal,
  updateTopOfMindEntry,
  type ApiInspiration,
  type ApiInspirationSummary,
  type ApiSignal,
  type ApiSignalDetail,
  type ApiTopOfMind,
  type ApiViewer,
} from "../src/lib/api";

const viewer: ApiViewer = {
  account: {
    id: "account-1",
    email: "river@example.com",
    onboardingCompletedAt: "2026-05-01T00:00:00.000Z",
    isAdmin: false,
  },
  profile: {
    id: "profile-1",
    accountId: "account-1",
    type: "human",
    name: "River",
    avatarUrl: null,
    preferredLocale: "en-US",
    publicHandle: "river",
    publicProfileEnabled: true,
    publicTopOfMindEnabled: true,
  },
};

const inspirationSummary: ApiInspirationSummary = {
  id: "inspiration-1",
  textPreview: "Notion's first-run screen hands you a shape instead of a blank page.",
  kind: "link",
  source: "app",
  createdAt: "2026-05-30T20:00:00.000Z",
  updatedAt: "2026-05-30T20:00:00.000Z",
  attachmentSummary: [{ id: "attachment-1", type: "link", label: "Notion" }],
  reflectionCount: 1,
};

const inspiration: ApiInspiration = {
  id: "inspiration-1",
  profileId: "profile-1",
  text: "Notion's first-run screen hands you a shape instead of a blank page.",
  kind: "link",
  source: "app",
  createdAt: "2026-05-30T20:00:00.000Z",
  updatedAt: "2026-05-30T20:00:00.000Z",
  attachments: [
    {
      id: "attachment-1",
      inspirationId: "inspiration-1",
      type: "link",
      url: "https://notion.so",
      name: null,
      contentType: null,
      size: null,
      createdAt: "2026-05-30T20:00:00.000Z",
      enrichment: {
        status: "ready",
        kind: "page_body",
        text: "Pick a template to start from.",
        errorReason: null,
        updatedAt: "2026-05-30T20:01:00.000Z",
        link: {
          finalUrl: "https://www.notion.so/",
          hostname: "notion.so",
          title: "Notion",
          description: "Pick a template to start from.",
          siteName: "Notion",
          previewImageUrl: null,
        },
        image: null,
      },
    },
  ],
  reflections: [
    {
      id: "reflection-1",
      inspirationId: "inspiration-1",
      question: "Why did this catch you?",
      answer: "A blank page is a demand.",
      skipped: false,
      createdAt: "2026-05-30T20:02:00.000Z",
    },
  ],
};

const signal: ApiSignal = {
  id: "signal-1",
  statement: "You keep saving products that make the first move for you.",
  status: "active",
  confidence: 78,
  evidenceCount: 3,
  lastEvidenceAt: "2026-05-30T20:00:00.000Z",
  locked: false,
  unsupported: false,
  sharedGroupIds: [],
  createdAt: "2026-05-20T00:00:00.000Z",
};

const signalDetail: ApiSignalDetail = {
  ...signal,
  evidence: [
    {
      inspirationId: "inspiration-1",
      preview: "Notion's first-run screen hands you a shape instead of a blank page.",
      quote: "hands you a shape instead of a blank page",
      reason: "The capture names the move being made for the person.",
      createdAt: "2026-05-30T20:00:00.000Z",
    },
  ],
};

const topOfMind: ApiTopOfMind = {
  id: "top-of-mind-1",
  version: 4,
  reason: "regenerated",
  createdAt: "2026-06-01T00:00:00.000Z",
  entries: [
    {
      id: "entry-1",
      type: "pattern",
      body: "You are drawn to products that refuse to start empty.",
      belief: null,
      prompt: "Where else are you waiting to be handed a shape?",
      locked: false,
      pinned: false,
      dismissed: false,
      sortOrder: 0,
      citedSignals: [
        { id: "signal-1", statement: "You keep saving products that make the first move for you." },
      ],
      createdAt: "2026-06-01T00:00:00.000Z",
    },
  ],
};

function stubFetch(response: Response): void {
  vi.stubGlobal("fetch", vi.fn(async () => response));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the session", () => {
  it("reads the account and the profile it is acting as", async () => {
    stubFetch(Response.json(viewer));

    await expect(fetchCurrentViewer()).resolves.toEqual(viewer);
    expect(fetch).toHaveBeenCalledWith("/api/auth/me", {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  });

  /*
    An anonymous visitor is the expected case on a cold load, not a failure, so
    the guard can route to /login without a try/catch around every read.
  */
  it("treats a rejected cookie as nobody rather than as an error", async () => {
    stubFetch(Response.json({ error: "Authentication required" }, { status: 401 }));

    await expect(fetchCurrentViewer()).resolves.toBeNull();
  });

  it("PATCHes the preferred locale and returns both halves back", async () => {
    stubFetch(Response.json(viewer));

    await expect(updateAuthPreferences({ preferredLocale: "ko-KR" })).resolves.toEqual(
      viewer,
    );
    expect(fetch).toHaveBeenCalledWith("/api/auth/me/preferences", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferredLocale: "ko-KR" }),
    });
  });
});

describe("inspirations", () => {
  it("posts a capture and returns the row the server wrote", async () => {
    stubFetch(Response.json({ inspiration }, { status: 201 }));

    await expect(
      createInspiration({ text: inspiration.text, kind: "note" }),
    ).resolves.toEqual(inspiration);
    expect(fetch).toHaveBeenCalledWith("/api/inspirations", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: inspiration.text, kind: "note" }),
    });
  });

  /**
   * A capture belongs to the profile that made it and to nothing else. Sharing
   * happens a layer up, per signal and per group, so a capture request that
   * carried a group would be claiming a relationship the schema does not have.
   * This pins the request shape so a future "helpful" addition has to break a
   * test that says why it must not.
   */
  it("sends no group with a capture", async () => {
    stubFetch(Response.json({ inspiration }, { status: 201 }));

    await createInspiration({ text: "saved while looking at a wall" });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;

    expect(Object.keys(body)).toEqual(["text"]);
    for (const key of ["groupId", "group", "shareToGroups", "roomId"]) {
      expect(body).not.toHaveProperty(key);
    }
  });

  it("searches the archive through the query string", async () => {
    stubFetch(Response.json({ inspirations: [inspirationSummary] }));

    await expect(fetchInspirations({ q: "notion", limit: 40 })).resolves.toEqual([
      inspirationSummary,
    ]);
    expect(fetch).toHaveBeenCalledWith("/api/inspirations?q=notion&limit=40", {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  });

  it("opens one capture with its attachments and reflections", async () => {
    stubFetch(Response.json({ inspiration }));

    await expect(fetchInspiration("inspiration-1")).resolves.toEqual(inspiration);
    expect(fetch).toHaveBeenCalledWith("/api/inspirations/inspiration-1", {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  });

  it("surfaces the server's own words when a delete is refused", async () => {
    stubFetch(Response.json({ error: "Inspiration not found" }, { status: 404 }));

    await expect(deleteInspiration("missing")).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
      message: "Inspiration not found",
    } satisfies Partial<ApiError>);
  });
});

describe("signals", () => {
  it("lists the acting profile's distilled patterns", async () => {
    stubFetch(Response.json({ signals: [signal] }));

    await expect(fetchSignals({ status: "active", limit: 100 })).resolves.toEqual([
      signal,
    ]);
    expect(fetch).toHaveBeenCalledWith("/api/signals?status=active&limit=100", {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  });

  it("adds the evidence when one signal is opened", async () => {
    stubFetch(Response.json({ signal: signalDetail }));

    await expect(fetchSignal("signal-1")).resolves.toEqual(signalDetail);
    expect(fetch).toHaveBeenCalledWith("/api/signals/signal-1", {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  });

  it("sends a rewritten statement, which is what locks it", async () => {
    stubFetch(Response.json({ signal: { ...signal, locked: true } }));

    await expect(
      updateSignal("signal-1", { statement: "You save products that start you off." }),
    ).resolves.toMatchObject({ locked: true });
    expect(fetch).toHaveBeenCalledWith("/api/signals/signal-1", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statement: "You save products that start you off." }),
    });
  });

  it("shares one signal with one group", async () => {
    stubFetch(Response.json({ shared: true, groupId: "group-1" }, { status: 201 }));

    await expect(shareSignal("signal-1", "group-1")).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith("/api/signals/signal-1/shares", {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ groupId: "group-1" }),
    });
  });
});

describe("top of mind", () => {
  it("reads the one current artifact and its entries", async () => {
    stubFetch(Response.json({ topOfMind }));

    await expect(fetchTopOfMind()).resolves.toEqual(topOfMind);
    expect(fetch).toHaveBeenCalledWith("/api/top-of-mind", {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  });

  /*
    A profile with nothing to read has no artifact. That is a state the board
    renders, not an error it reports.
  */
  it("reports no artifact as null rather than as a failure", async () => {
    stubFetch(Response.json({ topOfMind: null }));

    await expect(fetchTopOfMind()).resolves.toBeNull();
  });

  it("accepts a queued refresh without a body to read", async () => {
    stubFetch(new Response(null, { status: 202 }));

    await expect(refreshTopOfMind()).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith("/api/top-of-mind/refresh", {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: "{}",
    });
  });

  it("edits and holds entries through the entry routes", async () => {
    stubFetch(Response.json({ entry: { ...topOfMind.entries[0]!, locked: true } }));
    await expect(
      updateTopOfMindEntry("entry-1", { body: "You want to be handed a shape." }),
    ).resolves.toMatchObject({ locked: true });
    expect(fetch).toHaveBeenCalledWith("/api/top-of-mind/entries/entry-1", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "You want to be handed a shape." }),
    });

    stubFetch(Response.json({ entry: { ...topOfMind.entries[0]!, pinned: true } }));
    await expect(holdTopOfMindEntry("entry-1")).resolves.toMatchObject({ pinned: true });
    expect(fetch).toHaveBeenCalledWith("/api/top-of-mind/entries/entry-1/pin", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  });
});

describe("feedback", () => {
  it("records a verdict about one top-of-mind entry", async () => {
    const feedback = {
      id: "feedback-1",
      profileId: "profile-1",
      targetType: "top_of_mind_entry" as const,
      targetId: "entry-1",
      value: "partly" as const,
      correctionText: "Closer if it mentions the workshop.",
      createdAt: "2026-06-01T00:00:00.000Z",
    };
    stubFetch(Response.json({ feedback }, { status: 201 }));

    await expect(
      createFeedback({
        targetType: "top_of_mind_entry",
        targetId: "entry-1",
        value: "partly",
        correctionText: "Closer if it mentions the workshop.",
      }),
    ).resolves.toEqual(feedback);
    expect(fetch).toHaveBeenCalledWith("/api/feedback", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetType: "top_of_mind_entry",
        targetId: "entry-1",
        value: "partly",
        correctionText: "Closer if it mentions the workshop.",
      }),
    });
  });

  it("preserves feedback API failures", async () => {
    stubFetch(Response.json({ error: "Feedback target not found" }, { status: 404 }));

    await expect(
      createFeedback({ targetType: "signal", targetId: "missing", value: "not_true" }),
    ).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
      message: "Feedback target not found",
    } satisfies Partial<ApiError>);
  });
});

describe("public profile", () => {
  it("strips the leading @ before asking for a handle", async () => {
    stubFetch(
      Response.json({
        profile: { name: "River", handle: "river", preferredLocale: "en-US" },
        topOfMind: {
          version: 4,
          publishedAt: "2026-06-01T00:00:00.000Z",
          entries: [
            {
              type: "pattern",
              body: "You are drawn to products that refuse to start empty.",
              belief: null,
              prompt: null,
              pinned: false,
            },
          ],
        },
      }),
    );

    const result = await fetchPublicProfile("@river");
    expect(result.profile.handle).toBe("river");
    expect(result.topOfMind?.entries).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith("/api/public/profiles/river", {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  });

  it("throws ApiError when the response carries no profile", async () => {
    stubFetch(Response.json({}));

    await expect(fetchPublicProfile("river")).rejects.toMatchObject({
      name: "ApiError",
      status: 200,
      message: "Malformed public profile response",
    } satisfies Partial<ApiError>);
  });
});
