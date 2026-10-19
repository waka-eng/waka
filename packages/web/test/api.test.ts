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
  deleteInspiration,
  fetchCurrentViewer,
  fetchInspiration,
  fetchInspirationProcessing,
  fetchInspirationSaveRequest,
  fetchInspirationPage,
  fetchAttachmentUrl,
  presignAttachment,
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
import { loadInspiration, loadSignal, loadTopOfMindVersion } from "../src/lib/data";

/* EVERY READ CARRIES THE TRANSPORT'S OWN SIGNAL NOW — the deadline in
   `lib/api/transport.ts` that ends a stalled request instead of letting a
   loading screen wait forever. It is the transport's signal, not the
   caller's, so the exact-request assertions below name it as "an
   AbortSignal"; that a caller's own abort still reaches the network, and
   that the deadline fires, are proved once in their own cases at the end. */
const DEADLINE = expect.any(AbortSignal);

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
it('refuses an upload ticket that cannot prove the expected profile', async () => {
  const input = { filename: 'Photo.png', contentType: 'image/png', size: 50 };
  stubFetch(Response.json({ uploadUrl: 'https://storage.example/put', key: 'key', profileId: 'other-profile' }));
  await expect(presignAttachment(input, undefined, { profile: 'profile-1' })).rejects.toMatchObject({ code: 'upload_scope_unverified' });
  stubFetch(Response.json({ uploadUrl: 'https://storage.example/put', key: 'key', profileId: 'profile-1' }));
  await expect(presignAttachment(input, undefined, { profile: 'profile-1' })).resolves.toMatchObject({ profileId: 'profile-1' });
  expect(fetch).toHaveBeenCalledWith('/api/attachments/presign?profile=profile-1', expect.objectContaining({ method: 'POST', credentials: 'include' }));
});
it('refuses a read URL for the wrong attachment or an unsafe protocol', async () => {
  stubFetch(Response.json({ attachmentId: 'other', url: 'https://storage.example/read' }));
  await expect(fetchAttachmentUrl('file-1')).rejects.toMatchObject({ code: 'invalid_response' });
  stubFetch(Response.json({ attachmentId: 'file-1', url: 'javascript:alert(1)' }));
  await expect(fetchAttachmentUrl('file-1')).rejects.toMatchObject({ code: 'invalid_response' });
});
it('reads archive pages with an explicit profile, cursor and cancellation signal', async () => {
  stubFetch(Response.json({ inspirations: [inspirationSummary], nextCursor: 'older', total: 2002 }));
  const controller = new AbortController();
  await expect(fetchInspirationPage({ profile: 'profile-1', q: 'garden', limit: 50, cursor: 'page-2' }, controller.signal))
    .resolves.toMatchObject({ inspirations: [inspirationSummary], nextCursor: 'older', total: 2002 });
  expect(fetch).toHaveBeenCalledWith('/api/inspirations?profile=profile-1&q=garden&limit=50&cursor=page-2', { method: 'GET', headers: { Accept: 'application/json' }, credentials: 'include', signal: DEADLINE });
});
it('treats a malformed search page as a failure rather than an empty archive', async () => {
  stubFetch(Response.json({ total: 2002 }));
  await expect(fetchInspirationPage({ q: 'garden' })).rejects.toMatchObject({ code: 'invalid_response' });
});
it('checks the identity and profile of a linked inspiration before translating it', async () => {
  stubFetch(Response.json({ inspiration: { ...inspiration, profileId: 'other-profile' } }));
  await expect(loadInspiration('inspiration-1', 'profile-1')).rejects.toThrow();
  stubFetch(Response.json({ inspiration: { ...inspiration, id: 'wrong-id' } }));
  await expect(loadInspiration('inspiration-1', 'profile-1')).rejects.toThrow();
});
/* `fetchGroupInspiration` IS GONE, with every other verb in the groups
   client (founder, 2026-10-12: "방 없애" — remove rooms). This case pinned
   three things and two of them are pinned elsewhere: that the request is an
   authenticated GET with the JSON Accept header (every other case here), and
   that an abort signal is forwarded (`loadInspiration`'s own case). The third
   was the only one specific to a room — resolving ONE of somebody else's
   public memories by id, which was the bookmarkable `/w/:wall/:label` path
   reaching into a member's ground. There is nothing left that reads a memory
   this account does not own. */

it('preserves the processing receipt on a saved inspiration', async () => {
  const processing = { id: 'receipt', profileId: 'profile-1', inspirationId: inspiration.id, materialRevision: '2', jobId: 'job', requestVersion: '3' };
  stubFetch(Response.json({ inspiration, processing }));
  await expect(createInspiration({ text: inspiration.text })).resolves.toMatchObject({ processing });
});

/* THE SAVED-REFLECTION RECEIPT SUITE IS GONE (2026-10-10), with
   `createReflection` itself. The property — a processing receipt survives the
   client unwrapping the response — is asserted on either side of where this
   stood, for `createInspiration` above and `updateInspiration` below. It was
   never a property of answers; it is a property of how this module reads a
   `{ thing, processing }` envelope. */

it('preserves the processing receipt after editing saved material', async () => {
  const processing = { id: 'receipt', profileId: 'profile-1', inspirationId: inspiration.id, materialRevision: '4', jobId: 'job', requestVersion: '5' };
  stubFetch(Response.json({ inspiration, processing }));
  await expect(updateInspiration(inspiration.id, { text: inspiration.text })).resolves.toMatchObject({ processing });
  expect(fetch).toHaveBeenCalledWith('/api/inspirations/inspiration-1', {
    method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: inspiration.text }),
  });
});

/* THE ANSWER HALF OF THIS WENT WITH `createReflection` (2026-10-10). A
   capture is still bound to the profile that opened the composer, which is
   the half that can still be got wrong — and an answer given at capture time
   now travels INSIDE that same body as `input.reflections`, so it is bound by
   this very assertion rather than by a second one. */
it('binds a capture to the profile that opened the composer', async () => {
  stubFetch(Response.json({ inspiration }));
  await createInspiration({ text: 'A thought', reflections: [{ question: 'Why?', answer: 'An answer' }] }, { profile: 'profile-1' });
  expect(fetch).toHaveBeenCalledWith('/api/inspirations?profile=profile-1', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'A thought', reflections: [{ question: 'Why?', answer: 'An answer' }] }),
  });
});

it('checks processing as a cancellable scoped read, with no generation request', async () => {
  const status = { profileId: 'profile-1', inspirationId: 'inspiration-1', phase: 'queued', currentMaterialRevision: '9007199254740993', result: null };
  stubFetch(Response.json(status));
  const controller = new AbortController();
  await expect(fetchInspirationProcessing(inspiration.id, { profile: 'profile-1', receiptId: 'receipt-1' }, controller.signal)).resolves.toEqual(status);
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/inspirations/inspiration-1/processing?profile=profile-1&receipt=receipt-1', {
    method: 'GET', credentials: 'include', headers: { Accept: 'application/json' }, signal: DEADLINE,
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

/* SAME ASSERTION, MOVED OFF THE ANSWER VERB (2026-10-10). What it guards is
   that a retry re-sends the SAME identity instead of minting a new one, which
   is how a lost response turns into two copies of the same words. That lives
   in `reconcileInspirationSave`, which both verbs went through and only one
   of them still exists — so it is asserted on the one that does. The words
   carried here include an answer, so the body under test is no smaller. */
it('sends the save intent unchanged on a replay, not a new identity for each call', async () => {
  const requestId = '00000000-0000-4000-8000-000000000124';
  const saveRequest = { requestId, replayed: true };
  const options = { profile: 'profile-1', requestId };
  const input = { text: 'A thought', reflections: [{ question: 'Why?', answer: 'An answer' }] };
  stubFetch(Response.json({ inspiration: { ...inspiration, saveRequest } }));
  await expect(createInspiration(input, options)).resolves.toMatchObject({ saveRequest });
  expect(fetch).toHaveBeenCalledWith('/api/inspirations?profile=profile-1', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestId },
    body: JSON.stringify(input),
  });
  stubFetch(Response.json({ inspiration: { ...inspiration, saveRequest } }));
  await createInspiration(input, options);
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
    method: 'GET', credentials: 'include', headers: { Accept: 'application/json' }, signal: DEADLINE,
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

/* ALSO MOVED OFF THE ANSWER VERB, AND THIS ONE MATTERS MORE (2026-10-10).
   A 410 from the save-request lookup is the ONE path by which this client can
   still learn that the thing a journalled save points at is gone — and
   `useAuthoredSave`'s `onRemoved` is still wired to it. Asserting it on
   `createInspiration` is asserting it on the live path rather than the
   deleted one: reconciliation must stop, not retry forever. */
it('stops reconciliation when the saved item was deliberately removed', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('Response lost'))
    .mockResolvedValueOnce(Response.json({ error: 'Removed', code: 'saved_item_removed' }, { status: 410 })));
  await expect(createInspiration({ text: 'A thought' }, { profile: 'profile-1', requestId: 'request' }))
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
      signal: DEADLINE,
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

  it("opens one capture with its attachments and reflections", async () => {
    stubFetch(Response.json({ inspiration }));

    await expect(fetchInspiration("inspiration-1")).resolves.toEqual(inspiration);
    expect(fetch).toHaveBeenCalledWith("/api/inspirations/inspiration-1", {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
      signal: DEADLINE,
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
  it('scopes review deletion and sends its observed material revision', async () => {
    stubFetch(Response.json({id:'inspiration-1'}));const controller=new AbortController();
    await deleteInspiration('inspiration-1',{profile:'owner-profile',sourceRevision:'7',signal:controller.signal});
    expect(fetch).toHaveBeenCalledWith('/api/inspirations/inspiration-1?profile=owner-profile',{
      method:'DELETE',credentials:'include',signal:controller.signal,
      headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({sourceRevision:'7'}),
    });
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
      signal: DEADLINE,
    });
  });

  it("adds the evidence when one signal is opened", async () => {
    stubFetch(Response.json({ signal: signalDetail }));

    await expect(fetchSignal("signal-1")).resolves.toEqual(signalDetail);
    expect(fetch).toHaveBeenCalledWith("/api/signals/signal-1", {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
      signal: DEADLINE,
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
      method: 'GET', credentials: 'include', headers: { Accept: 'application/json' }, signal: DEADLINE,
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
      method: 'GET', credentials: 'include', headers: { Accept: 'application/json' }, signal: DEADLINE,
    });
  });

  it("reads the one current artifact and its entries", async () => {
    stubFetch(Response.json({ topOfMind }));

    await expect(fetchTopOfMind()).resolves.toEqual(topOfMind);
    expect(fetch).toHaveBeenCalledWith("/api/top-of-mind", {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
      signal: DEADLINE,
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
      signal: DEADLINE,
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

describe("the read deadline", () => {
  it("passes a caller's cancellation through to the network", async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => new Promise<Response>((_, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    const reading = fetchInspirationPage({ profile: "profile-1" }, controller.signal);
    controller.abort();
    await expect(reading).rejects.toMatchObject({ status: 0 });
    expect((fetch.mock.calls[0]![1] as RequestInit).signal?.aborted).toBe(true);
  });

  it("gives up on a read the server never answers, as an unreachable server", async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn(async (_url: string, init: RequestInit) => new Promise<Response>((_, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")));
      }));
      vi.stubGlobal("fetch", fetch);
      const reading = fetchInspirationPage({ profile: "profile-1" });
      const settled = expect(reading).rejects.toMatchObject({ status: 0 });
      await vi.advanceTimersByTimeAsync(20_000);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the shared principle status across a session change", () => {
  it("drops the cached status and ignores an in-flight answer from the session before", async () => {
    const { fetchPrincipleStatus, recentPrincipleStatus, onPrincipleStatus, principleStatusFor } = await import("../src/lib/api/principles");
    const status = (signalCount: number) => ({ phase: "ready", eligible: true, signalCount, topOfMindCount: 1 });
    let answer!: (response: Response) => void;
    const fetch = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { answer = resolve; }))
      .mockImplementationOnce(async () => new Response(JSON.stringify({ status: status(9) }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const heard: number[] = [];
    const stop = onPrincipleStatus((value) => heard.push(value.signalCount));
    const old = fetchPrincipleStatus();
    principleStatusFor("someone-else");
    expect(recentPrincipleStatus(60_000), "a status outlived the sign-out").toBeNull();
    const fresh = await fetchPrincipleStatus();
    expect(fetch, "the new session joined the old session's request").toHaveBeenCalledTimes(2);
    expect(fresh.signalCount).toBe(9);
    answer(new Response(JSON.stringify({ status: status(3) }), { status: 200 }));
    await old;
    expect(recentPrincipleStatus(60_000)?.signalCount, "the old session's answer overwrote the new one").toBe(9);
    expect(heard).toEqual([9]);
    stop();
  });

  it("starts a new status GET for a fresh read even while an older one is in flight", async () => {
    const { fetchPrincipleStatus } = await import("../src/lib/api/principles");
    const status = (signalCount: number) => ({ phase: "ready", eligible: true, signalCount, topOfMindCount: 1 });
    let answerOld!: (response: Response) => void;
    const fetch = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { answerOld = resolve; }))
      .mockImplementationOnce(async () => new Response(JSON.stringify({ status: status(5) }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const old = fetchPrincipleStatus();
    const fresh = await fetchPrincipleStatus({ fresh: true });
    expect(fetch, "a fresh read joined the GET from before").toHaveBeenCalledTimes(2);
    expect(fresh.signalCount).toBe(5);
    answerOld(new Response(JSON.stringify({ status: status(1) }), { status: 200 }));
    await old;
  });

  it("publishes the status a principles refresh POST answers with, as a refresh", async () => {
    const { requestPrincipleRead, onPrincipleStatus } = await import("../src/lib/api/principles");
    const fetch = vi.fn(async () => new Response(JSON.stringify({ status: { phase: "processing", eligible: true, signalCount: 3, topOfMindCount: 1, readingPaused: false } }), { status: 202 }));
    vi.stubGlobal("fetch", fetch);
    const heard: Array<[string, string]> = [];
    const stop = onPrincipleStatus((value, source) => heard.push([value.phase, source]));
    await requestPrincipleRead(true);
    stop();
    expect(fetch.mock.calls[0]![0]).toBe("/api/principles/refresh?retry=1");
    expect(heard, "the paused notice never heard the restart").toEqual([["processing", "refresh"]]);
  });
});
