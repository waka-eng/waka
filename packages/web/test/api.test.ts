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
  disputePrinciple,
  createInspiration,
  createReflection,
  deleteInspiration,
  fetchCurrentViewer,
  fetchInspiration,
  fetchInspirationProcessing,
  fetchInspirationSaveRequest,
  fetchInspirations,
  fetchPublicProfile,
  fetchSignal,
  fetchSignals,
  fetchTopOfMind,
  fetchTopOfMindRefresh,
  refreshTopOfMind,
  retryInspirationProcessing,
  holdTopOfMindEntry,
  updateAuthPreferences,
  updateInspiration,
  updateSignal,
  updateTopOfMindEntry,
  type ApiInspiration,
  type ApiInspirationSummary,
  type ApiSignal,
  type ApiSignalDetail,
  type ApiTopOfMind,
  type ApiViewer,
} from "../src/lib/api";
import { loadSignal, loadTopOfMindVersion } from "../src/lib/data";

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

it("carries an exact reflection reference through the client and data adapter", async () => {
  stubFetch(Response.json({ signal: { ...signal, evidence: [{ inspirationId: "inspiration-1", preview: "Original note",
    quote: "A reflected answer", quoteSource: "own", quoteReflectionId: "reflection-1", reason: null,
    createdAt: "2026-05-30T20:00:00.000Z" }] } }));
  const result = await loadSignal(signal.id);
  expect(result.evidence[0]?.quoteReflectionId).toBe("reflection-1");
  expect(result.evidence[0]?.quote).toBe("A reflected answer");
});

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

it('preserves the processing receipt on a saved inspiration', async () => {
  const processing = { id: 'receipt', profileId: 'profile-1', inspirationId: inspiration.id, materialRevision: '2', jobId: 'job', requestVersion: '3' };
  stubFetch(Response.json({ inspiration, processing }));
  await expect(createInspiration({ text: inspiration.text })).resolves.toMatchObject({ processing });
});

it('preserves the processing receipt on a saved reflection', async () => {
  const processing = { id: 'receipt', profileId: 'profile-1', inspirationId: inspiration.id, materialRevision: '3', jobId: 'job', requestVersion: '4' };
  stubFetch(Response.json({ reflection: inspiration.reflections[0], processing }));
  await expect(createReflection(inspiration.id, { question: 'Why?', answer: 'An answer' })).resolves.toMatchObject({ processing });
});

it('preserves the processing receipt after editing saved material', async () => {
  const processing = { id: 'receipt', profileId: 'profile-1', inspirationId: inspiration.id, materialRevision: '4', jobId: 'job', requestVersion: '5' };
  stubFetch(Response.json({ inspiration, processing }));
  await expect(updateInspiration(inspiration.id, { text: inspiration.text })).resolves.toMatchObject({ processing });
  expect(fetch).toHaveBeenCalledWith('/api/inspirations/inspiration-1', {
    method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: inspiration.text }),
  });
});

it('binds captures and answers to the profile that opened the composer', async () => {
  stubFetch(Response.json({ inspiration }));
  await createInspiration({ text: 'A thought' }, { profile: 'profile-1' });
  expect(fetch).toHaveBeenCalledWith('/api/inspirations?profile=profile-1', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'A thought' }),
  });
  stubFetch(Response.json({ reflection: inspiration.reflections[0] }));
  await createReflection(inspiration.id, { question: 'Why?', answer: 'An answer' }, { profile: 'profile-1' });
  expect(fetch).toHaveBeenCalledWith('/api/inspirations/inspiration-1/reflections?profile=profile-1', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'Why?', answer: 'An answer' }),
  });
});

it('checks processing as a cancellable scoped read, with no generation request', async () => {
  const status = { profileId: 'profile-1', inspirationId: 'inspiration-1', phase: 'queued', currentMaterialRevision: '9007199254740993', result: null };
  stubFetch(Response.json(status));
  const controller = new AbortController();
  await expect(fetchInspirationProcessing(inspiration.id, { profile: 'profile-1', receiptId: 'receipt-1' }, controller.signal)).resolves.toEqual(status);
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/inspirations/inspiration-1/processing?profile=profile-1&receipt=receipt-1', {
    method: 'GET', credentials: 'include', headers: { Accept: 'application/json' }, signal: controller.signal,
  });
});

it('retries only the explicitly named saved source, not another capture', async () => {
  const status = { profileId: 'profile-1', inspirationId: 'inspiration-1', phase: 'queued', result: null };
  stubFetch(Response.json(status, { status: 202 }));
  const controller = new AbortController();
  await expect(retryInspirationProcessing(inspiration.id, { profile: 'profile-1', receiptId: 'receipt-1' }, controller.signal)).resolves.toEqual(status);
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/inspirations/inspiration-1/processing/retry?profile=profile-1', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ receiptId: 'receipt-1' }),
  });
});

it('sends a stable save identity and preserves replay metadata for an inspiration', async () => {
  const requestId = '00000000-0000-4000-8000-000000000123';
  const saveRequest = { requestId, replayed: true };
  const controller = new AbortController();
  stubFetch(Response.json({ inspiration, saveRequest }));
  await expect(createInspiration({ text: 'A thought' }, { profile: 'profile-1', requestId, signal: controller.signal }))
    .resolves.toMatchObject({ saveRequest });
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/inspirations?profile=profile-1', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestId },
    signal: controller.signal, body: JSON.stringify({ text: 'A thought' }),
  });
});

it('sends the answer intent unchanged on a replay, not a new identity for each call', async () => {
  const requestId = '00000000-0000-4000-8000-000000000124';
  const saveRequest = { requestId, replayed: true };
  const options = { profile: 'profile-1', requestId };
  stubFetch(Response.json({ reflection: inspiration.reflections[0], saveRequest }));
  await expect(createReflection(inspiration.id, { question: 'Why?', answer: 'An answer' }, options)).resolves.toMatchObject({ saveRequest });
  expect(fetch).toHaveBeenCalledWith('/api/inspirations/inspiration-1/reflections?profile=profile-1', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestId },
    body: JSON.stringify({ question: 'Why?', answer: 'An answer' }),
  });
  stubFetch(Response.json({ reflection: inspiration.reflections[0], saveRequest }));
  await createReflection(inspiration.id, { question: 'Why?', answer: 'An answer' }, options);
  expect(vi.mocked(fetch).mock.calls[0]?.[1]?.headers).toMatchObject({ 'Idempotency-Key': requestId });
});

it('keeps the distinct failure code for an in-flight save instead of treating it as a content conflict', async () => {
  stubFetch(Response.json({ error: 'Still saving', code: 'save_in_progress' }, { status: 409 }));
  await expect(createInspiration({ text: 'A thought' })).rejects.toMatchObject({ status: 409, code: 'save_in_progress' });
});

it('looks up a save by identity without reposting authored words', async () => {
  const requestId = '00000000-0000-4000-8000-000000000125';
  const processing = { id: 'receipt', profileId: 'profile-1', inspirationId: inspiration.id, materialRevision: '1', jobId: 'job', requestVersion: '1' };
  const saved = { requestId, operation: 'inspiration', inspirationId: inspiration.id, reflectionId: null, processing, createdAt: inspiration.createdAt };
  const controller = new AbortController();
  stubFetch(Response.json({ saveRequest: saved }));
  await expect(fetchInspirationSaveRequest(requestId, { profile: 'profile-1' }, controller.signal)).resolves.toEqual(saved);
  expect(fetch).toHaveBeenCalledExactlyOnceWith(`/api/inspirations/save-requests/${requestId}?profile=profile-1`, {
    method: 'GET', credentials: 'include', headers: { Accept: 'application/json' }, signal: controller.signal,
  });
});

it('refuses save lookup metadata from a different owner', async () => {
  const requestId = '00000000-0000-4000-8000-000000000126';
  stubFetch(Response.json({ saveRequest: { requestId, operation: 'inspiration', inspirationId: inspiration.id, reflectionId: null,
    processing: { profileId: 'other-profile', inspirationId: inspiration.id } } }));
  await expect(fetchInspirationSaveRequest(requestId, { profile: 'profile-1' })).rejects.toMatchObject({ message: 'Could not verify this save' });
});

it('preserves missing-versus-removed save lookup errors for reconciliation', async () => {
  for (const [status, code] of [[404, 'save_not_found'], [410, 'saved_item_removed']] as const) {
    stubFetch(Response.json({ error: 'Unavailable', code }, { status }));
    await expect(fetchInspirationSaveRequest('a-request')).rejects.toMatchObject({ status, code });
  }
});

it('does not turn an explicitly empty request identity into an unkeyed create', async () => {
  stubFetch(Response.json({ error: 'Invalid key', code: 'invalid_save_request' }, { status: 400 }));
  await expect(createInspiration({ text: 'A thought' }, { requestId: '' })).rejects.toMatchObject({ status: 400 });
  expect(vi.mocked(fetch).mock.calls[0]?.[1]?.headers).toMatchObject({ 'Idempotency-Key': '' });
});

it('reconciles a lost response and confirms the same input against its committed identity', async () => {
  const requestId = '00000000-0000-4000-8000-000000000127';
  const processing = { id: 'receipt', profileId: 'profile-1', inspirationId: inspiration.id, materialRevision: '1', jobId: 'job', requestVersion: '1' };
  vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('Response lost'))
    .mockResolvedValueOnce(Response.json({ saveRequest: { requestId, operation: 'inspiration', inspirationId: inspiration.id, reflectionId: null, processing } }))
    .mockResolvedValueOnce(Response.json({ inspiration, processing, saveRequest: { requestId, replayed: true } })));
  await expect(createInspiration({ text: 'A thought' }, { profile: 'profile-1', requestId })).resolves.toMatchObject({ id: inspiration.id, saveRequest: { requestId, replayed: true } });
  expect(fetch).toHaveBeenCalledTimes(3);
  const calls = vi.mocked(fetch).mock.calls;
  expect(calls[1]?.[1]?.method).toBe('GET');
  expect(calls[1]?.[1]?.body).toBeUndefined();
  expect(calls[2]).toEqual(calls[0]);
});

it('does not turn an unobserved in-flight save into another automatic POST', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('Response lost'))
    .mockResolvedValueOnce(Response.json({ error: 'No committed save found', code: 'save_not_found' }, { status: 404 })));
  await expect(createInspiration({ text: 'A thought' }, { profile: 'profile-1', requestId: 'request' })).rejects.toMatchObject({ status: 0 });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('does not call an unrelated payload saved merely because its key exists', async () => {
  const requestId = '00000000-0000-4000-8000-000000000128';
  const processing = { id: 'receipt', profileId: 'profile-1', inspirationId: inspiration.id, materialRevision: '1', jobId: 'job', requestVersion: '1' };
  vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('Conflict response lost'))
    .mockResolvedValueOnce(Response.json({ saveRequest: { requestId, operation: 'inspiration', inspirationId: inspiration.id, reflectionId: null, processing } }))
    .mockResolvedValueOnce(Response.json({ error: 'Different content', code: 'save_request_conflict' }, { status: 409 })));
  await expect(createInspiration({ text: 'Changed words under a reused identity' }, { profile: 'profile-1', requestId }))
    .rejects.toMatchObject({ status: 409, code: 'save_request_conflict' });
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('stops reconciliation when the saved item was deliberately removed', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('Response lost'))
    .mockResolvedValueOnce(Response.json({ error: 'Removed', code: 'saved_item_removed' }, { status: 410 })));
  await expect(createReflection(inspiration.id, { question: 'Why?', answer: 'An answer' }, { profile: 'profile-1', requestId: 'request' }))
    .rejects.toMatchObject({ status: 410, code: 'saved_item_removed' });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('does not turn cancellation into another request or recurse after a second lost response', async () => {
  const controller = new AbortController(); controller.abort();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Aborted')));
  await expect(createInspiration({ text: 'A thought' }, { requestId: 'request', signal: controller.signal })).rejects.toMatchObject({ status: 0 });
  expect(fetch).toHaveBeenCalledOnce();

  const requestId = '00000000-0000-4000-8000-000000000129';
  const processing = { profileId: 'profile-1', inspirationId: inspiration.id };
  vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('Lost'))
    .mockResolvedValueOnce(Response.json({ saveRequest: { requestId, operation: 'inspiration', inspirationId: inspiration.id, reflectionId: null, processing } }))
    .mockRejectedValueOnce(new TypeError('Lost again')));
  await expect(createInspiration({ text: 'A thought' }, { profile: 'profile-1', requestId })).rejects.toMatchObject({ status: 0 });
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('freezes the owner, identity and payload before waiting for a network response', async () => {
  const requestId = '00000000-0000-4000-8000-000000000130';
  const processing = { profileId: 'profile-1', inspirationId: inspiration.id };
  const options = { profile: 'profile-1', requestId };
  const input = { text: 'Original words', reflections: [{ question: 'Why?', answer: 'Original answer' }] };
  vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(async () => {
    options.profile = 'another-profile'; options.requestId = 'another-key'; input.text = 'Later words'; input.reflections[0]!.answer = 'Later answer';
    throw new TypeError('Response lost');
  }).mockResolvedValueOnce(Response.json({ saveRequest: { requestId, operation: 'inspiration', inspirationId: inspiration.id, reflectionId: null, processing } }))
    .mockResolvedValueOnce(Response.json({ inspiration, saveRequest: { requestId, replayed: true } })));
  await expect(createInspiration(input, options)).resolves.toMatchObject({ saveRequest: { requestId, replayed: true } });
  const calls = vi.mocked(fetch).mock.calls;
  expect(calls[1]?.[0]).toBe(`/api/inspirations/save-requests/${requestId}?profile=profile-1`);
  expect(calls[2]).toEqual(calls[0]);
  expect(JSON.parse(String(calls[2]?.[1]?.body))).toEqual({ text: 'Original words', reflections: [{ question: 'Why?', answer: 'Original answer' }] });
});

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

    await expect(updateAuthPreferences({ preferredLocale: "en-US" })).resolves.toEqual(
      viewer,
    );
    expect(fetch).toHaveBeenCalledWith("/api/auth/me/preferences", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferredLocale: "en-US" }),
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

});

describe("top of mind", () => {
  it("requests the numbered reading receipt and carries its completion counters unchanged", async () => {
    const state = { status: 'pending', requestVersion: '9007199254740993', completedVersion: '9007199254740992', runAfter: null, result: null };
    stubFetch(Response.json(state));
    const controller = new AbortController();
    await expect(fetchTopOfMindRefresh('job-id', controller.signal, state.requestVersion)).resolves.toEqual(state);
    expect(fetch).toHaveBeenCalledWith('/api/top-of-mind/refresh/job-id?requestVersion=9007199254740993', {
      method: 'GET', credentials: 'include', headers: { Accept: 'application/json' }, signal: controller.signal,
    });
  });

  it("checks a shown version in its explicit profile with cancellation and support metadata intact", async () => {
    const controller = new AbortController();
    stubFetch(Response.json({ topOfMind: { ...topOfMind, profileId: 'profile-1', generationRevision: '9007199254740993', supportChanged: true,
      entries: topOfMind.entries.map((entry) => ({ ...entry, supportChanged: true })) } }));
    const result = await loadTopOfMindVersion(topOfMind.id, 'profile-1', controller.signal);
    expect(result).toMatchObject({ id: topOfMind.id, profileId: 'profile-1', generationRevision: '9007199254740993', supportChanged: true });
    expect(result?.entries[0]).toMatchObject({ supportChanged: true });
    expect(fetch).toHaveBeenCalledWith('/api/top-of-mind/versions/top-of-mind-1?profile=profile-1', {
      method: 'GET', credentials: 'include', headers: { Accept: 'application/json' }, signal: controller.signal,
    });
  });

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

  it("keeps the queue receipt rather than treating acceptance as completion", async () => {
    stubFetch(Response.json({ status: "queued", jobId: "read-job", requestVersion: "2" }, { status: 202 }));

    await expect(refreshTopOfMind()).resolves.toEqual({ jobId: "read-job", requestVersion: "2" });
    expect(fetch).toHaveBeenCalledWith("/api/top-of-mind/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
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
  it('sends the displayed wording revision with signal feedback', async () => {
    const input = { targetType: 'signal' as const, targetId: 'signal-1', value: 'true' as const, targetRevision: '3' };
    stubFetch(Response.json({ feedback: { ...input, id: 'feedback-1' } }, { status: 201 }));
    await expect(createFeedback(input)).resolves.toMatchObject({ targetRevision: '3' });
    expect(fetch).toHaveBeenCalledWith('/api/feedback', expect.objectContaining({ body: JSON.stringify(input) }));
  });

  it('sends the displayed wording revision with a principle dispute', async () => {
    stubFetch(Response.json({ feedback: { id: 'feedback-1' } }, { status: 201 }));
    await disputePrinciple('principle-1', '4');
    expect(fetch).toHaveBeenCalledWith('/api/feedback', expect.objectContaining({ body: JSON.stringify({
      targetType: 'principle', targetId: 'principle-1', value: 'not_true', targetRevision: '4',
    }) }));
  });
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
