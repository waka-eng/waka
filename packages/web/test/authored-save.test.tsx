// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY: `lib/api` transport and timers only. The real
 * hook and localStorage prove immutable intent, resumption and account guards. */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError, createInspiration, fetchInspiration, fetchInspirationSaveRequest, type ApiInspiration } from '../src/lib/api';
import { useAuthoredSave, type AuthoredSaveInput } from '../src/lib/use-authored-save';

vi.mock('../src/lib/api', async (original) => ({ ...await original<typeof import('../src/lib/api')>(),
  createInspiration: vi.fn(), fetchInspiration: vi.fn(), fetchInspirationSaveRequest: vi.fn(),
}));
const scope = { accountId: 'account-A', profileId: 'profile-A' };
const source: ApiInspiration = { id: 'source-A', profileId: scope.profileId, text: 'One thought', kind: 'note', source: 'app',
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', attachments: [], reflections: [] };
const input: AuthoredSaveInput = { operation: 'inspiration', input: { text: source.text, visibility: 'private' } };
const resolved = vi.fn(), removed = vi.fn();
let host: HTMLDivElement, root: Root, latest: ReturnType<typeof useAuthoredSave>;
const records = () => Object.keys(localStorage).filter((key) => key.includes(':pendingSave:'));
const missing = () => new ApiError({ status: 404, code: 'save_not_found', message: 'No committed save found' });
function Probe({ owner = scope, operation = 'inspiration' as const }) {
  latest = useAuthoredSave({ scope: owner, operation,
    onResolved: resolved, onRemoved: removed });
  return <span>{latest.phase}</span>;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks(); localStorage.clear();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.mocked(fetchInspirationSaveRequest).mockRejectedValue(missing());
  vi.mocked(createInspiration).mockResolvedValue(source);
  vi.mocked(fetchInspiration).mockResolvedValue(source);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

it('durably owns the input before the first network check, then settles once', async () => {
  vi.mocked(fetchInspirationSaveRequest).mockImplementation(async () => {
    expect(records()).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(records()[0]!)!)).toMatchObject({ ...scope, input: input.input });
    throw missing();
  });
  await act(async () => root.render(<Probe />));
  await act(async () => { expect(latest.start(input)).toBe(true); expect(latest.start(input)).toBe(false); });
  expect(createInspiration).toHaveBeenCalledOnce();
  expect(vi.mocked(createInspiration).mock.calls[0]?.[1]).toMatchObject({ profile: scope.profileId, requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  expect(resolved).toHaveBeenCalledOnce(); expect(records()).toHaveLength(0);
});

it('reuses immutable words, visibility and identity after a lost response', async () => {
  vi.mocked(createInspiration).mockRejectedValueOnce(new Error('Lost response')).mockResolvedValue(source);
  await act(async () => root.render(<Probe />));
  const mutable = structuredClone(input);
  await act(async () => { latest.start(mutable); });
  const first = vi.mocked(createInspiration).mock.calls[0]!;
  mutable.input.text = 'Later draft'; mutable.input.visibility = 'public';
  expect(records()).toHaveLength(1);
  await act(async () => { expect(latest.start(mutable)).toBe(false); await latest.retry(); });
  const second = vi.mocked(createInspiration).mock.calls[1]!;
  expect(second[0]).toEqual(first[0]);
  expect(second[1]?.requestId).toBe(first[1]?.requestId);
  expect(resolved).toHaveBeenCalledOnce();
});

it('re-sends a pending save on remount under its original id and words, read from disk', async () => {
  vi.mocked(createInspiration).mockRejectedValueOnce(new Error('Lost response'));
  await act(async () => root.render(<Probe />)); await act(async () => { latest.start(input); });
  const key = records()[0]!, first = vi.mocked(createInspiration).mock.calls[0]!;
  await act(async () => root.unmount()); root = createRoot(host);
  await act(async () => root.render(<Probe />));
  const second = vi.mocked(createInspiration).mock.calls[1]!;
  expect(second[0]).toEqual(first[0]); expect(second[1]?.requestId).toBe(first[1]?.requestId);
  expect(resolved).toHaveBeenCalledOnce(); expect(resolved.mock.calls[0]?.[2]).toBe(false);
  expect(localStorage.getItem(key)).toBeNull(); expect(latest.pending).toBeNull();
});

/* A FAKE OF THE SERVER'S CONTRACT (inspiration-save-requests.ts): idempotent
   on the request id; a same-id POST while one is committing gets 409
   save_in_progress; a committed id replays. `rows` is what was created. */
const receipt = (inspirationId: string) => ({ id: 'receipt', profileId: scope.profileId, inspirationId, materialRevision: '1', jobId: 'job', requestVersion: '1' });
function server() {
  const rows = new Map<string, ApiInspiration>(), committing = new Map<string, () => void>();
  const commit = (id: string) => { const row = { ...source, id: `source-${rows.size + 1}` }; rows.set(id, row); return row; };
  vi.mocked(createInspiration).mockImplementation(async (_body, options) => {
    const id = options!.requestId!;
    if (committing.has(id)) throw new ApiError({ status: 409, code: 'save_in_progress', message: 'In progress' });
    const prior = rows.get(id);
    return prior ? { ...prior, saveRequest: { requestId: id, replayed: true } } : commit(id);
  });
  vi.mocked(fetchInspirationSaveRequest).mockImplementation(async (id) => {
    const row = rows.get(id); if (!row) throw missing();
    return { requestId: id, operation: 'inspiration', inspirationId: row.id, reflectionId: null, processing: receipt(row.id), createdAt: row.createdAt };
  });
  vi.mocked(fetchInspiration).mockImplementation(async (id) => [...rows.values()].find((row) => row.id === id)!);
  /** The next POST reaches the server, but its commit (and response) waits for the returned call. */
  const holdNext = () => {
    let release!: () => void;
    vi.mocked(createInspiration).mockImplementationOnce((_body, options) => new Promise((resolve) => {
      const id = options!.requestId!;
      committing.set(id, () => { committing.delete(id); resolve(commit(id)); });
      release = () => committing.get(id)?.();
    }));
    return () => release();
  };
  return { rows, holdNext };
}
const ids = () => new Set(vi.mocked(createInspiration).mock.calls.map((call) => call[1]?.requestId));

it('an offline save does not jam the composer: reconnecting re-sends it', async () => {
  const { rows } = server();
  vi.mocked(fetchInspirationSaveRequest).mockRejectedValueOnce(new ApiError({ status: 0, message: 'Failed to fetch' }));
  await act(async () => root.render(<Probe />)); await act(async () => { latest.start(input); });
  expect(latest.phase).toBe('uncertain'); expect(latest.pending).not.toBeNull(); expect(createInspiration).not.toHaveBeenCalled();
  await act(async () => { window.dispatchEvent(new Event('online')); });
  expect(latest.pending).toBeNull(); expect(latest.phase).toBe('idle'); expect(records()).toHaveLength(0);
  expect(rows.size).toBe(1); expect(resolved).toHaveBeenCalledOnce();
  expect(resolved.mock.calls[0]?.[2]).toBe(false); // a background send is not a press
});

it('timeout, then the first POST commits: reload re-POSTs the same id and there is exactly one inspiration', async () => {
  const { rows, holdNext } = server();
  const release = holdNext();
  await act(async () => root.render(<Probe />)); await act(async () => { latest.start(input); });
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(latest.phase).toBe('uncertain'); expect(records()).toHaveLength(1);
  await act(async () => root.unmount()); root = createRoot(host);
  // The reload's status read races the commit: it misses, the commit lands, the re-POST replays.
  vi.mocked(fetchInspirationSaveRequest).mockImplementationOnce(async () => { release(); throw missing(); });
  await act(async () => root.render(<Probe />));
  expect(createInspiration).toHaveBeenCalledTimes(2); expect(ids().size).toBe(1);
  expect(rows.size).toBe(1); expect(resolved).toHaveBeenCalledOnce(); expect(resolved.mock.calls[0]?.[1].recovered).toBe(true);
  expect(records()).toHaveLength(0); expect(latest.pending).toBeNull();
});

function secondTab() {
  const tab: { save?: ReturnType<typeof useAuthoredSave> } = {};
  const where = document.createElement('div'); document.body.append(where); const at = createRoot(where);
  function ProbeB() { tab.save = useAuthoredSave({ scope, operation: 'inspiration', onResolved: resolved, onRemoved: removed }); return null; }
  return { tab, open: () => act(async () => at.render(<ProbeB />)), close: async () => { await act(async () => at.unmount()); where.remove(); } };
}

it('two tabs re-sending the same id make one inspiration, and both settle', async () => {
  const { rows, holdNext } = server();
  const release = holdNext(), b = secondTab();
  try {
    await act(async () => root.render(<Probe />)); await act(async () => { latest.start(input); });
    await b.open(); // B finds A's journal on disk and re-sends it while A's POST is committing
    expect(b.tab.save?.phase).toBe('uncertain'); expect(createInspiration).toHaveBeenCalledTimes(2); expect(ids().size).toBe(1);
    await act(async () => { release(); });
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: null })); });
    expect(rows.size).toBe(1); expect(records()).toHaveLength(0);
    expect(latest.pending).toBeNull(); expect(b.tab.save?.pending).toBeNull(); expect(b.tab.save?.phase).toBe('idle');
    expect(resolved.mock.calls.map((call) => call[2])).toEqual([true, false]);
  } finally { await b.close(); }
});

it('a storage event only reads: B never POSTs the save A pressed, and A acknowledges its own press', async () => {
  const { rows, holdNext } = server();
  const release = holdNext(), b = secondTab();
  try {
    await act(async () => root.render(<Probe />)); await b.open();
    await act(async () => { latest.start(input); });
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: null })); });
    expect(createInspiration).toHaveBeenCalledOnce(); // A's press only
    expect(b.tab.save?.pending).not.toBeNull(); expect(b.tab.save?.phase).toBe('saving');
    await act(async () => { release(); });
    expect(resolved).toHaveBeenCalledOnce(); expect(resolved.mock.calls[0]?.[2]).toBe(true); // A: kept + "let's chat"
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: null })); });
    expect(b.tab.save?.pending).toBeNull(); expect(resolved.mock.calls[1]?.[2]).toBe(false);
    expect(createInspiration).toHaveBeenCalledOnce(); expect(rows.size).toBe(1); expect(records()).toHaveLength(0);
  } finally { await b.close(); }
});

it("focus re-sends another tab's journal only once its last send is stale", async () => {
  const { holdNext } = server();
  holdNext(); const b = secondTab();
  try {
    await act(async () => root.render(<Probe />)); await b.open();
    await act(async () => { latest.start(input); }); // A's POST never answers (A's owner vanished mid-send)
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(createInspiration).toHaveBeenCalledOnce();
    await act(async () => root.unmount()); root = createRoot(host);
    vi.setSystemTime(Date.now() + 31_000);
    vi.mocked(createInspiration).mockImplementation(async (_body, options) => ({ ...source, id: `late-${options!.requestId}` }));
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(createInspiration).toHaveBeenCalledTimes(2); expect(ids().size).toBe(1);
    expect(b.tab.save?.pending).toBeNull(); expect(records()).toHaveLength(0);
  } finally { await b.close(); }
});

it('a tab lets go of a journal another tab discarded, without re-sending it', async () => {
  vi.mocked(createInspiration).mockRejectedValueOnce(new ApiError({ status: 400, message: 'Invalid', fieldErrors: { text: ['Too long'] } }));
  const b = secondTab();
  try {
    await act(async () => root.render(<Probe />)); await act(async () => { latest.start(input); });
    await b.open();
    expect(b.tab.save?.phase).toBe('rejected');
    await act(async () => { latest.editRejected(); });
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: null })); });
    expect(b.tab.save?.pending).toBeNull(); expect(b.tab.save?.phase).toBe('idle');
    expect(records()).toHaveLength(0); expect(createInspiration).toHaveBeenCalledOnce();
  } finally { await b.close(); }
});

it('recovers a committed save by reading its current item, without another POST', async () => {
  vi.mocked(createInspiration).mockRejectedValue(new Error('Lost response'));
  await act(async () => root.render(<Probe />)); await act(async () => { latest.start(input); });
  const requestId = latest.pending!.requestId;
  vi.mocked(fetchInspirationSaveRequest).mockResolvedValue({ requestId, operation: 'inspiration', inspirationId: source.id, reflectionId: null,
    processing: { id: 'receipt', profileId: scope.profileId, inspirationId: source.id, materialRevision: '1', jobId: 'job', requestVersion: '1' }, createdAt: source.createdAt });
  await act(async () => root.unmount()); root = createRoot(host);
  await act(async () => root.render(<Probe />));
  expect(fetchInspiration).toHaveBeenCalledWith(source.id, { profile: scope.profileId }, expect.any(AbortSignal));
  expect(createInspiration).toHaveBeenCalledOnce(); expect(resolved).toHaveBeenCalledOnce();
  expect(resolved.mock.calls[0]?.[2]).toBe(false);
  expect(records()).toHaveLength(0);
});

it('cannot send before durable storage succeeds', async () => {
  await act(async () => root.render(<Probe />));
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
  try {
    await act(async () => { expect(latest.start(input)).toBe(false); });
    expect(latest.phase).toBe('storage_error'); expect(createInspiration).not.toHaveBeenCalled(); expect(fetchInspirationSaveRequest).not.toHaveBeenCalled();
  } finally { write.mockRestore(); }
});

it('retains the journal if matching-draft cleanup fails after a successful save', async () => {
  resolved.mockImplementation(() => { throw new Error('Could not clear matching draft'); });
  await act(async () => root.render(<Probe />)); await act(async () => { latest.start(input); });
  expect(records()).toHaveLength(1); expect(latest.phase).toBe('uncertain');
  resolved.mockImplementation(() => {});
  await act(async () => { await latest.retry(); });
  expect(createInspiration).toHaveBeenCalledOnce(); expect(records()).toHaveLength(0);
});

it('stops at a bounded timeout and ignores a later response from the old account', async () => {
  let finish!: (value: ApiInspiration) => void;
  vi.mocked(createInspiration).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await act(async () => root.render(<Probe />)); await act(async () => { latest.start(input); });
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(latest.phase).toBe('uncertain'); expect(records()).toHaveLength(1);
  await act(async () => root.render(<Probe owner={{ accountId: 'account-B', profileId: 'profile-B' }} />));
  await act(async () => finish(source));
  expect(latest.pending).toBeNull(); expect(resolved).not.toHaveBeenCalled(); expect(records()).toHaveLength(1);
});

it('does not resend into an older server that cannot honor save identities', async () => {
  vi.mocked(fetchInspirationSaveRequest).mockRejectedValue(new ApiError({ status: 404, message: 'Not Found' }));
  await act(async () => root.render(<Probe />)); await act(async () => { latest.start(input); });
  expect(latest.phase).toBe('unsupported'); expect(createInspiration).not.toHaveBeenCalled(); expect(records()).toHaveLength(1);
});

it('removes a deleted intent without recreating its words', async () => {
  vi.mocked(createInspiration).mockRejectedValue(new Error('Lost response'));
  await act(async () => root.render(<Probe />)); await act(async () => { latest.start(input); });
  vi.mocked(fetchInspirationSaveRequest).mockRejectedValue(new ApiError({ status: 410, code: 'saved_item_removed', message: 'Removed' }));
  await act(async () => { await latest.retry(); });
  expect(removed).toHaveBeenCalledOnce(); expect(resolved).not.toHaveBeenCalled(); expect(createInspiration).toHaveBeenCalledOnce();
  expect(records()).toHaveLength(0); expect(latest.phase).toBe('removed');
});

/* THE REFLECTION SUITE IS GONE, WITH THE OPERATION IT EXERCISED
   (2026-10-10). It asserted that a journalled answer POSTed exactly the words
   given and that the resolution carried the CURRENT answers — including one
   written on another device while this save was in flight. `useAuthoredSave`
   has one operation now; `components/ReflectionFlow.tsx`, its only caller,
   is folded into the claim queue's correction field.
   WHAT PROTECTED THE SAME INVARIANT IS STILL HERE, on the inspiration path:
   the suites above assert that the POST carries the immutable intent's own
   words, that a lost response is observed with a GET rather than re-POSTed,
   and that resolution reads the server's current row rather than the one this
   device remembers. Those were always the properties under test; the
   reflection operation was a second shape of the same protocol. */

it('allows editing only after a confirmed validation rejection, never after an ambiguous response', async () => {
  vi.mocked(createInspiration).mockRejectedValueOnce(new ApiError({ status: 400, message: 'Invalid inspiration', fieldErrors: { text: ['Inspiration text is too long'] } }));
  await act(async () => root.render(<Probe />)); await act(async () => { latest.start(input); });
  const original = latest.pending!.requestId;
  expect(latest.phase).toBe('rejected'); expect(latest.pending?.validationMessage).toBe('Inspiration text is too long');
  await act(async () => { latest.editRejected(); });
  expect(records()).toHaveLength(0);
  vi.mocked(createInspiration).mockRejectedValue(new Error('Ambiguous response'));
  await act(async () => { latest.start(input); });
  expect(latest.pending?.requestId).not.toBe(original);
  const pending = latest.pending!.requestId;
  await act(async () => { latest.editRejected(); });
  expect(latest.pending?.requestId).toBe(pending); expect(records()).toHaveLength(1);
});

it('treats a request id already used for different content as a refusal, not an uncertain save', async () => {
  vi.mocked(createInspiration).mockRejectedValue(new ApiError({ status: 409, code: 'save_request_conflict', message: 'Used for different content' }));
  await act(async () => root.render(<Probe />)); await act(async () => { latest.start(input); });
  expect(latest.phase).toBe('rejected');
  await act(async () => root.unmount()); root = createRoot(host);
  await act(async () => root.render(<Probe />));
  expect(latest.phase).toBe('rejected'); expect(createInspiration).toHaveBeenCalledOnce(); // refused journals are not re-sent
  await act(async () => { latest.editRejected(); });
  expect(records()).toHaveLength(0); expect(latest.pending).toBeNull();
});

it('does not submit corrupt pending data; an explicit reset retains uninterpreted recovery bytes', async () => {
  vi.mocked(createInspiration).mockRejectedValue(new Error('Ambiguous response'));
  await act(async () => root.render(<Probe />)); await act(async () => { latest.start(input); });
  const key = records()[0]!, value = JSON.parse(localStorage.getItem(key)!);
  value.input.text = 'Damaged payload';
  localStorage.setItem(key, JSON.stringify(value));
  await act(async () => root.unmount()); root = createRoot(host);
  await act(async () => root.render(<Probe />));
  expect(latest.phase).toBe('invalid'); expect(createInspiration).toHaveBeenCalledOnce();
  await act(async () => { latest.resetInvalid(); });
  expect(records()).toHaveLength(0);
  const backup = Object.keys(localStorage).find((item) => item.includes(':unrecoveredSave:'))!;
  expect(localStorage.getItem(backup)).toContain('Damaged payload');
});

it('ignores an old timed-out response after a same-account retry has settled', async () => {
  let first!: (value: ApiInspiration) => void;
  vi.mocked(createInspiration).mockImplementationOnce(() => new Promise((resolve) => { first = resolve; })).mockResolvedValue(source);
  await act(async () => root.render(<Probe />)); await act(async () => { latest.start(input); });
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  await act(async () => { await latest.retry(); });
  await act(async () => first({ ...source, id: 'an-old-response' }));
  expect(resolved).toHaveBeenCalledOnce(); expect(resolved.mock.calls[0]?.[1].inspiration.id).toBe(source.id);
  expect(records()).toHaveLength(0);
});
