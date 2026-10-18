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

/* ═══ RELEASE ONLY ON THE SERVER'S WORD (review of the f2afcbe2 fix) ═══════
   Missing on remount earns ONE unprompted re-send under the same id. What the
   re-send says decides the rest: a definitive refusal lets go; anything that
   might still commit keeps the journal and the id, across reloads. */
const conflict = () => new ApiError({ status: 409, code: 'save_in_progress', message: 'In progress' });
const remount = async () => { await act(async () => root.unmount()); root = createRoot(host); await act(async () => root.render(<Probe />)); };

it('resends a missing save once under its own identity on remount, and lands it', async () => {
  vi.mocked(createInspiration).mockRejectedValueOnce(new Error('Lost response')).mockResolvedValue(source);
  await act(async () => root.render(<Probe />)); await act(async () => { latest.start(input); });
  expect(latest.phase).toBe('uncertain');
  const first = vi.mocked(createInspiration).mock.calls[0]![1]?.requestId;
  await remount();
  expect(createInspiration).toHaveBeenCalledTimes(2);
  expect(vi.mocked(createInspiration).mock.calls[1]![1]?.requestId).toBe(first);
  expect(resolved).toHaveBeenCalledOnce(); expect(records()).toHaveLength(0); expect(latest.phase).toBe('idle');
});

it('keeps the journal and id when the re-send times out — and a late commit is read, never duplicated, after reload', async () => {
  vi.mocked(createInspiration).mockRejectedValueOnce(new Error('Lost response'))
    .mockImplementationOnce(() => new Promise(() => {}));
  await act(async () => root.render(<Probe />)); await act(async () => { latest.start(input); });
  const id = latest.pending!.requestId;
  await remount();
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(latest.phase).toBe('uncertain'); expect(records()).toHaveLength(1); expect(latest.pending?.requestId).toBe(id);
  // The timed-out POST committed after all. The next load reads it.
  vi.mocked(fetchInspirationSaveRequest).mockResolvedValue({ requestId: id, operation: 'inspiration', inspirationId: source.id, reflectionId: null,
    processing: { id: 'receipt', profileId: scope.profileId, inspirationId: source.id, materialRevision: '1', jobId: 'job', requestVersion: '1' }, createdAt: source.createdAt });
  await remount();
  expect(createInspiration).toHaveBeenCalledTimes(2); expect(resolved).toHaveBeenCalledOnce(); expect(records()).toHaveLength(0);
});

it('asks before saving edited words while an earlier save is not known, and never sends a second copy on its own', async () => {
  vi.mocked(createInspiration).mockRejectedValue(new Error('Lost response'));
  await act(async () => root.render(<Probe />)); await act(async () => { latest.start(input); });
  const id = latest.pending!.requestId;
  const edited: AuthoredSaveInput = { ...input, input: { ...input.input, text: 'One thought, edited' } };
  await act(async () => { expect(latest.start(edited)).toBe(false); });
  expect(latest.phase).toBe('diverged'); expect(createInspiration).toHaveBeenCalledOnce(); expect(records()).toHaveLength(1);
  // The same words retry the same id.
  await act(async () => { expect(latest.start(input)).toBe(true); });
  expect(vi.mocked(createInspiration).mock.calls[1]![1]?.requestId).toBe(id);
  // Only the explicit choice makes a new identity.
  vi.mocked(createInspiration).mockResolvedValue(source);
  await act(async () => { latest.start(edited); });
  await act(async () => { latest.saveAsNew(); });
  const last = vi.mocked(createInspiration).mock.calls.at(-1)!;
  expect(last[0]).toEqual(edited.input); expect(last[1]?.requestId).not.toBe(id);
});

it('releases only on a definitive answer: a 5xx on record and then nothing found', async () => {
  vi.mocked(createInspiration).mockRejectedValue(new ApiError({ status: 503, message: 'Unavailable' }));
  await act(async () => root.render(<Probe />)); await act(async () => { latest.start(input); });
  expect(latest.phase).toBe('uncertain'); expect(records()).toHaveLength(1);
  expect(JSON.parse(localStorage.getItem(records()[0]!)!).answered).toBe(true);
  await remount();
  expect(latest.phase).toBe('unsent'); expect(records()).toHaveLength(0); expect(resolved).not.toHaveBeenCalled();
});

it('releases on a refusal of the POST itself', async () => {
  vi.mocked(createInspiration).mockRejectedValue(new ApiError({ status: 409, code: 'save_request_conflict', message: 'Used' }));
  await act(async () => root.render(<Probe />)); await act(async () => { latest.start(input); });
  expect(latest.phase).toBe('unsent'); expect(records()).toHaveLength(0);
});

it('never releases while another tab may still be committing the same save', async () => {
  // Tab A's POST is still running; tab B finds the journal and is told "in progress".
  vi.mocked(createInspiration).mockImplementationOnce(() => new Promise(() => {})).mockRejectedValue(conflict());
  await act(async () => root.render(<Probe />)); await act(async () => { latest.start(input); });
  const tabA = latest;
  const hostB = document.createElement('div'); document.body.append(hostB); const rootB = createRoot(hostB);
  let tabB!: ReturnType<typeof useAuthoredSave>;
  function ProbeB() { tabB = useAuthoredSave({ scope, operation: 'inspiration', onResolved: resolved, onRemoved: removed }); return null; }
  await act(async () => rootB.render(<ProbeB />));
  expect(createInspiration).toHaveBeenCalledTimes(2);
  expect(tabB.phase).toBe('uncertain'); expect(records()).toHaveLength(1);
  await act(async () => { tabB.check(); });
  expect(tabB.phase).toBe('uncertain'); expect(records()).toHaveLength(1);
  expect(tabA.pending?.requestId).toBe(tabB.pending?.requestId);
  await act(async () => rootB.unmount()); hostB.remove();
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
