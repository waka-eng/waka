// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY: `lib/api` transport and timers only. The real
 * hook and localStorage prove immutable intent, resumption and account
 * guards. Where a case is about duplicates, `createInspiration` is a small
 * stand-in for the server's own rule — idempotent on the request id, 409
 * `save_in_progress` for a concurrent POST of the same id — so "one
 * inspiration" is counted rather than assumed. */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError, createInspiration, type ApiInspiration } from '../src/lib/api';
import { RESEND_BACKOFF_MS, useAuthoredSave, type AuthoredSaveInput } from '../src/lib/use-authored-save';

vi.mock('../src/lib/api', async (original) => ({ ...await original<typeof import('../src/lib/api')>(), createInspiration: vi.fn() }));
const scope = { accountId: 'account-A', profileId: 'profile-A' };
const source: ApiInspiration = { id: 'source-A', profileId: scope.profileId, text: 'One thought', kind: 'note', source: 'app',
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', attachments: [], reflections: [] };
const input: AuthoredSaveInput = { operation: 'inspiration', input: { text: source.text, visibility: 'private' } };
const resolved = vi.fn(), removed = vi.fn(), rejected = vi.fn();
let host: HTMLDivElement, root: Root, latest: ReturnType<typeof useAuthoredSave>;
const records = () => Object.keys(localStorage).filter((key) => key.includes(':pendingSave:'));
function Probe({ owner = scope }) {
  latest = useAuthoredSave({ scope: owner, operation: 'inspiration', onResolved: resolved, onRemoved: removed, onEditRejected: rejected });
  return <span>{latest.phase}</span>;
}
const remount = async () => { await act(async () => root.unmount()); root = createRoot(host); await act(async () => root.render(<Probe />)); };

/** The server's own rule, small: one row per request id. */
function idempotentServer() {
  const rows = new Map<string, ApiInspiration>(), inFlight = new Set<string>();
  let hold: Promise<void> | null = null;
  vi.mocked(createInspiration).mockImplementation(async (payload, options) => {
    const id = options!.requestId!;
    const row = rows.get(id);
    if (row) return { ...row, saveRequest: { requestId: id, replayed: true } };
    if (inFlight.has(id)) throw new ApiError({ status: 409, code: 'save_in_progress', message: 'In progress' });
    inFlight.add(id);
    if (hold) await hold;
    const made = { ...source, id: `row-${rows.size + 1}`, text: payload.text };
    rows.set(id, made); inFlight.delete(id);
    return { ...made, saveRequest: { requestId: id, replayed: false } };
  });
  return { rows, holdNext: (until: Promise<void>) => { hold = until; }, release: () => { hold = null; } };
}

beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks(); localStorage.clear();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.mocked(createInspiration).mockResolvedValue(source);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

it('durably owns the input before the first send, then settles once', async () => {
  vi.mocked(createInspiration).mockImplementation(async () => {
    expect(records()).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(records()[0]!)!)).toMatchObject({ ...scope, input: input.input });
    return source;
  });
  await act(async () => root.render(<Probe />));
  await act(async () => { expect(latest.start(input)).toBe(true); });
  expect(createInspiration).toHaveBeenCalledOnce();
  expect(vi.mocked(createInspiration).mock.calls[0]?.[1]).toMatchObject({ profile: scope.profileId, requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  expect(resolved).toHaveBeenCalledOnce(); expect(records()).toHaveLength(0); expect(latest.phase).toBe('idle');
});

it('sends nothing when the journal cannot be kept', async () => {
  await act(async () => root.render(<Probe />));
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
  try {
    await act(async () => { expect(latest.start(input)).toBe(false); });
    expect(latest.phase).toBe('storage_error'); expect(createInspiration).not.toHaveBeenCalled();
  } finally { write.mockRestore(); }
});

it('re-sends the same id and the same body after a lost response, and never decides it did not land', async () => {
  vi.mocked(createInspiration).mockRejectedValueOnce(new Error('Lost response')).mockRejectedValueOnce(new ApiError({ status: 503, message: 'Gateway' }))
    .mockResolvedValue(source);
  await act(async () => root.render(<Probe />));
  const mutable = structuredClone(input);
  await act(async () => { latest.start(mutable); });
  mutable.input.text = 'Later draft';
  expect(latest.phase).toBe('uncertain'); expect(records()).toHaveLength(1);
  await remount();
  expect(latest.phase).toBe('uncertain'); expect(records()).toHaveLength(1);
  await act(async () => { await latest.retry(); });
  const calls = vi.mocked(createInspiration).mock.calls;
  expect(calls).toHaveLength(3);
  expect(new Set(calls.map((call) => call[1]?.requestId)).size).toBe(1);
  for (const call of calls) expect(call[0]).toEqual(input.input);
  expect(resolved).toHaveBeenCalledOnce(); expect(records()).toHaveLength(0);
});

it('a POST that timed out but committed is replayed on reload: one inspiration', async () => {
  const server = idempotentServer();
  let finish!: () => void;
  server.holdNext(new Promise((resolve) => { finish = resolve; }));
  await act(async () => root.render(<Probe />)); await act(async () => { latest.start(input); });
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(latest.phase).toBe('uncertain'); expect(records()).toHaveLength(1);
  server.release(); await act(async () => { finish(); });   // the timed-out POST commits after all
  await remount();                                            // reload: same id, same body
  expect(server.rows.size).toBe(1); expect(records()).toHaveLength(0);
  expect(resolved).toHaveBeenCalledOnce(); expect(resolved.mock.calls[0]![1].recovered).toBe(true);
});

it('two tabs re-sending the same id make one inspiration', async () => {
  const server = idempotentServer();
  let finish!: () => void;
  server.holdNext(new Promise((resolve) => { finish = resolve; }));
  await act(async () => root.render(<Probe />)); await act(async () => { latest.start(input); });
  const hostB = document.createElement('div'); document.body.append(hostB); const rootB = createRoot(hostB);
  let tabB!: ReturnType<typeof useAuthoredSave>;
  function ProbeB() { tabB = useAuthoredSave({ scope, operation: 'inspiration', onResolved: resolved, onRemoved: removed }); return null; }
  await act(async () => rootB.render(<ProbeB />));            // tab B sends the same id: "in progress"
  expect(tabB.phase).toBe('uncertain'); expect(records()).toHaveLength(1);
  server.release(); await act(async () => { finish(); });    // tab A's POST lands
  await act(async () => vi.advanceTimersByTimeAsync(RESEND_BACKOFF_MS[0]));
  await act(async () => { await tabB.retry(); });
  expect(server.rows.size).toBe(1); expect(records()).toHaveLength(0);
  await act(async () => rootB.unmount()); hostB.remove();
});

it('asks before saving edited words while a save is pending; "Save as new" makes each land once', async () => {
  const server = idempotentServer();
  let finish!: () => void;
  server.holdNext(new Promise((resolve) => { finish = resolve; }));
  await act(async () => root.render(<Probe />)); await act(async () => { latest.start(input); });
  await act(async () => vi.advanceTimersByTimeAsync(15_000)); // the first is not confirmed
  const edited: AuthoredSaveInput = { ...input, input: { ...input.input, text: 'One thought, edited' } };
  await act(async () => { expect(latest.start(edited)).toBe(false); });
  expect(latest.phase).toBe('diverged'); expect(records()).toHaveLength(1);
  server.release(); await act(async () => { finish(); });
  await act(async () => { expect(latest.saveAsNew()).toBe(true); });
  await act(async () => { await latest.retry(); });
  expect([...server.rows.values()].map((row) => row.text).sort()).toEqual(['One thought', 'One thought, edited']);
  expect(records()).toHaveLength(0);
  // Each id once: nothing more than the two rows, however often it is sent.
  await act(async () => { await latest.retry(); });
  expect(server.rows.size).toBe(2);
});

it('re-sends the same words with the CURRENT draft revision, so the composer can settle', async () => {
  vi.mocked(createInspiration).mockRejectedValueOnce(new Error('Lost response')).mockResolvedValue(source);
  await act(async () => root.render(<Probe />));
  await act(async () => { latest.start({ ...input, draft: { id: 'draft-1', revision: 1 } }); });
  const id = vi.mocked(createInspiration).mock.calls[0]![1]?.requestId;
  await act(async () => { expect(latest.start({ ...input, draft: { id: 'draft-1', revision: 4 } })).toBe(true); });
  expect(vi.mocked(createInspiration).mock.calls[1]![1]?.requestId).toBe(id);
  expect(resolved.mock.calls[0]![0].draft).toEqual({ id: 'draft-1', revision: 4 });
});

it('on a validation refusal, offers the whole input back and lets go only then', async () => {
  const why: AuthoredSaveInput = { ...input, input: { ...input.input, reflections: [{ question: 'Why?', answer: 'The light' }] } };
  vi.mocked(createInspiration).mockRejectedValueOnce(new ApiError({ status: 400, message: 'Invalid', fieldErrors: { text: ['Inspiration text is too long'] } }));
  await act(async () => root.render(<Probe />)); await act(async () => { latest.start(why); });
  expect(latest.phase).toBe('rejected'); expect(latest.pending?.validationMessage).toBe('Inspiration text is too long');
  expect(records()).toHaveLength(1);
  await act(async () => { latest.editRejected(); });
  expect(rejected).toHaveBeenCalledOnce(); expect(rejected.mock.calls[0]![0].input).toEqual(why.input);
  expect(records()).toHaveLength(0);
});

it('keeps the journal if matching-draft cleanup fails after a landed save, and replays it', async () => {
  resolved.mockImplementationOnce(() => { throw new Error('Could not clear matching draft'); });
  await act(async () => root.render(<Probe />)); await act(async () => { latest.start(input); });
  expect(records()).toHaveLength(1); expect(latest.phase).toBe('uncertain');
  await act(async () => { await latest.retry(); });
  expect(new Set(vi.mocked(createInspiration).mock.calls.map((call) => call[1]?.requestId)).size).toBe(1);
  expect(records()).toHaveLength(0);
});

it('ignores a late response for an account that has since changed', async () => {
  let finish!: (value: ApiInspiration) => void;
  vi.mocked(createInspiration).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await act(async () => root.render(<Probe />)); await act(async () => { latest.start(input); });
  await act(async () => root.render(<Probe owner={{ accountId: 'account-B', profileId: 'profile-B' }} />));
  await act(async () => finish(source));
  expect(latest.pending).toBeNull(); expect(resolved).not.toHaveBeenCalled(); expect(records()).toHaveLength(1);
});

it('removes a save whose item was deleted, without recreating its words', async () => {
  vi.mocked(createInspiration).mockRejectedValue(new ApiError({ status: 410, code: 'saved_item_removed', message: 'Removed' }));
  await act(async () => root.render(<Probe />)); await act(async () => { latest.start(input); });
  expect(removed).toHaveBeenCalledOnce(); expect(resolved).not.toHaveBeenCalled();
  expect(records()).toHaveLength(0); expect(latest.phase).toBe('removed');
});

it('does not submit corrupt pending data; an explicit reset retains uninterpreted recovery bytes', async () => {
  vi.mocked(createInspiration).mockRejectedValue(new Error('Ambiguous response'));
  await act(async () => root.render(<Probe />)); await act(async () => { latest.start(input); });
  const key = records()[0]!, value = JSON.parse(localStorage.getItem(key)!);
  value.input.text = 'Damaged payload';
  localStorage.setItem(key, JSON.stringify(value));
  await remount();
  expect(latest.phase).toBe('invalid'); expect(createInspiration).toHaveBeenCalledOnce();
  await act(async () => { latest.resetInvalid(); });
  expect(records()).toHaveLength(0);
  const backup = Object.keys(localStorage).find((item) => item.includes(':unrecoveredSave:'))!;
  expect(localStorage.getItem(backup)).toContain('Damaged payload');
});
