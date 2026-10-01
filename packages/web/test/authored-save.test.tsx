// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY: `lib/api` transport and timers only. The real
 * hook and localStorage prove immutable intent, resumption and account guards. */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError, createInspiration, createReflection, fetchInspiration, fetchInspirationSaveRequest, type ApiInspiration } from '../src/lib/api';
import { useAuthoredSave, type AuthoredSaveInput } from '../src/lib/use-authored-save';

vi.mock('../src/lib/api', async (original) => ({ ...await original<typeof import('../src/lib/api')>(),
  createInspiration: vi.fn(), createReflection: vi.fn(), fetchInspiration: vi.fn(), fetchInspirationSaveRequest: vi.fn(),
}));
const scope = { accountId: 'account-A', profileId: 'profile-A' };
const source: ApiInspiration = { id: 'source-A', profileId: scope.profileId, text: 'One thought', kind: 'note', source: 'app',
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', attachments: [], reflections: [] };
const input: AuthoredSaveInput = { operation: 'inspiration', input: { text: source.text, visibility: 'private' }, reflect: false };
const resolved = vi.fn(), removed = vi.fn();
let host: HTMLDivElement, root: Root, latest: ReturnType<typeof useAuthoredSave>;
const records = () => Object.keys(localStorage).filter((key) => key.includes(':pendingSave:'));
const missing = () => new ApiError({ status: 404, code: 'save_not_found', message: 'No committed save found' });
function Probe({ owner = scope, operation = 'inspiration' as 'inspiration' | 'reflection' }) {
  latest = useAuthoredSave({ scope: owner, operation, inspirationId: operation === 'reflection' ? source.id : undefined,
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

it('only reads a pending save on remount; missing is not permission to repost', async () => {
  vi.mocked(createInspiration).mockRejectedValue(new Error('Lost response'));
  await act(async () => root.render(<Probe />)); await act(async () => { latest.start(input); });
  const key = records()[0]!, before = localStorage.getItem(key);
  await act(async () => root.unmount()); root = createRoot(host);
  await act(async () => root.render(<Probe />));
  expect(latest.phase).toBe('uncertain'); expect(localStorage.getItem(key)).toBe(before);
  expect(createInspiration).toHaveBeenCalledOnce(); expect(resolved).not.toHaveBeenCalled();
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

it('preserves a reflection question and loads current answers before continuation', async () => {
  const reflection = { id: 'answer-1', inspirationId: source.id, question: 'The original question?', answer: 'An answer', skipped: false, createdAt: source.createdAt };
  vi.mocked(createReflection).mockResolvedValue(reflection);
  vi.mocked(fetchInspiration).mockResolvedValue({ ...source, reflections: [reflection, { ...reflection, id: 'answer-2', answer: 'A later answer from another device' }] });
  await act(async () => root.render(<Probe operation="reflection" />));
  await act(async () => { latest.start({ operation: 'reflection', inspirationId: source.id, input: { question: reflection.question, answer: reflection.answer }, afterId: null, continueReflecting: true }); });
  expect(resolved.mock.calls[0]?.[1].inspiration.reflections).toHaveLength(2);
  expect(vi.mocked(createReflection).mock.calls[0]?.[1]).toEqual({ question: reflection.question, answer: reflection.answer });
});

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
