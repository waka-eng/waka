// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY: only `lib/api` transport methods and timers. The
 * real hook and notice own resumption, identity isolation, and explicit view. */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError, fetchInspirationProcessing, retryInspirationProcessing, type ApiInspirationProcessingStatus } from '../src/lib/api';
import { useInspirationProcessing } from '../src/lib/use-inspiration-processing';
import { InspirationProcessingNotice } from '../src/components/InspirationProcessingNotice';
import { profileStorageKey } from '../src/lib/profile-storage';
import { isNativeSurface } from '../src/lib/surface-input';

vi.mock('../src/lib/api', async (original) => ({ ...await original<typeof import('../src/lib/api')>(),
  fetchInspirationProcessing: vi.fn(), retryInspirationProcessing: vi.fn(),
}));
const scope = { accountId: 'account-A', profileId: 'profile-A' };
const receipt = { id: 'receipt-A', profileId: scope.profileId, inspirationId: 'source-A', materialRevision: '1', jobId: 'job-A', requestVersion: '1' };
const waiting: ApiInspirationProcessingStatus = { profileId: scope.profileId, inspirationId: 'source-A', receipt,
  currentMaterialRevision: '1', requestedMaterialRevision: '1', latestDerivedRevision: '0', latestCompletedRevision: '0',
  superseded: false, phase: 'queued', stage: 'derivation', runAfter: null, result: null, unavailableAttachments: 0, canRetry: false };
const ready: ApiInspirationProcessingStatus = { ...waiting, phase: 'ready', stage: null, latestDerivedRevision: '1', latestCompletedRevision: '1',
  result: { kind: 'top_of_mind', topOfMindId: 'reading-2', version: 2, outcome: 'changed' } };
const view = vi.fn(async () => {});
let host: HTMLDivElement, root: Root;
let latest: ReturnType<typeof useInspirationProcessing>;
function Probe({ owner = scope, quiet = false }: { owner?: typeof scope; quiet?: boolean }) {
  latest = useInspirationProcessing(owner);
  return <><span data-phase>{latest.phase}</span><button onClick={() => latest.track(receipt.inspirationId, receipt)}>save</button>
    <InspirationProcessingNotice processing={latest} locale="en-US" onView={() => void latest.open(view)} displayedVersion={1} quiet={quiet} introducePrinciples={quiet} /></>;
}
const click = async (label: string) => act(async () => {
  const button = [...host.querySelectorAll('button')].find((el) => el.textContent === label);
  expect(button).toBeTruthy(); button!.click();
});
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); sessionStorage.clear();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.mocked(fetchInspirationProcessing).mockResolvedValue(waiting);
  vi.mocked(retryInspirationProcessing).mockResolvedValue(waiting);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

it('offers a ready reading without adopting it until pressed, then checks again before viewing', async () => {
  await act(async () => root.render(<Probe />)); await click('save');
  expect(host.textContent).toContain('Kept. Waiting to be read.');
  vi.mocked(fetchInspirationProcessing).mockResolvedValue(ready);
  await act(async () => vi.advanceTimersByTimeAsync(1500));
  expect(host.textContent).toContain('Your reading has an update.');
  expect(view).not.toHaveBeenCalled();
  await click('See reading');
  expect(view).toHaveBeenCalledOnce();
  expect(sessionStorage.getItem(profileStorageKey(scope, 'sourceProcessing')!)).toBeNull();
});

it('introduces forming memory quietly, animates only confirmed processing, then offers the ready reading', async () => {
  await act(async () => root.render(<Probe quiet />)); await click('save');
  expect(host.textContent).toContain('Taking shape…');
  expect(host.textContent).toContain('Patterns can become principles.');
  expect(host.querySelector('.jar-source-mark')?.hasAttribute('data-processing')).toBe(false);
  vi.mocked(fetchInspirationProcessing).mockResolvedValue({ ...waiting, phase: 'processing' });
  await act(async () => vi.advanceTimersByTimeAsync(1500));
  expect(host.querySelector('.jar-source-mark')?.getAttribute('data-processing')).toBe('true');
  vi.mocked(fetchInspirationProcessing).mockResolvedValue(ready);
  await act(async () => vi.advanceTimersByTimeAsync(2250));
  expect(host.textContent).toContain('Your reading has an update.');
  expect(host.textContent).not.toContain('Taking shape…');
  expect(host.querySelector('.jar-source-mark')?.hasAttribute('data-processing')).toBe(false);
  expect(view).not.toHaveBeenCalled();
});

it('keeps a scheduled or failed reading honest instead of suggesting continuous work', async () => {
  vi.mocked(fetchInspirationProcessing).mockResolvedValue({ ...waiting, phase: 'waiting', stage: 'reading', runAfter: new Date(Date.now() + 86400000).toISOString() });
  await act(async () => root.render(<Probe quiet />)); await click('save');
  expect(host.textContent).toContain('The next reading is scheduled');
  expect(host.querySelector('.jar-source-mark')?.hasAttribute('data-processing')).toBe(false);
  vi.mocked(fetchInspirationProcessing).mockResolvedValue({ ...waiting, phase: 'failed', canRetry: true });
  await act(async () => latest.check());
  expect(host.textContent).toContain("The reading couldn't finish.");
  expect(host.textContent).not.toContain('Taking shape…');
  expect(host.querySelector('.jar-source-mark')?.hasAttribute('data-processing')).toBe(false);
  expect([...host.querySelectorAll('button')].some(button => button.textContent === 'Try again')).toBe(true);
});

it('does not open a previously-ready result if new material is now processing', async () => {
  vi.mocked(fetchInspirationProcessing).mockResolvedValue(ready);
  await act(async () => root.render(<Probe />)); await click('save');
  vi.mocked(fetchInspirationProcessing).mockResolvedValue({ ...waiting, currentMaterialRevision: '2', superseded: true, receipt: { ...receipt, id: 'new-receipt', materialRevision: '2' } });
  await click('See reading');
  expect(view).not.toHaveBeenCalled();
  expect(host.textContent).toContain('Waiting to be read');
});

it('does not open an old ready result when the confirmation check fails', async () => {
  vi.mocked(fetchInspirationProcessing).mockResolvedValue(ready);
  await act(async () => root.render(<Probe />)); await click('save');
  vi.mocked(fetchInspirationProcessing).mockRejectedValue(new Error('Could not verify the latest saved material'));
  await click('See reading');
  expect(view).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(profileStorageKey(scope, 'sourceProcessing')!)).not.toBeNull();
});

it.each([
  { ...ready, result: null },
  { ...ready, receipt: { ...receipt, profileId: 'another-profile' } },
])('does not claim completion from a malformed result or foreign receipt', async (response) => {
  vi.mocked(fetchInspirationProcessing).mockResolvedValue(response);
  await act(async () => root.render(<Probe />)); await click('save');
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(host.querySelector('[data-phase]')?.textContent).toBe('error');
  expect(host.textContent).not.toContain('See reading');
  expect(host.textContent).not.toContain('Your reading still holds.');
  expect(view).not.toHaveBeenCalled();
});

it('resumes scoped receipts without starting another job', async () => {
  sessionStorage.setItem(profileStorageKey(scope, 'sourceProcessing')!, JSON.stringify({ profileId: scope.profileId, inspirationId: receipt.inspirationId, receiptId: receipt.id }));
  await act(async () => root.render(<Probe />));
  expect(fetchInspirationProcessing).toHaveBeenCalledWith(receipt.inspirationId, { profile: scope.profileId, receiptId: receipt.id }, expect.any(AbortSignal));
  expect(retryInspirationProcessing).not.toHaveBeenCalled();
});

it('keeps saved data and checks rather than retries generation after network failure', async () => {
  vi.mocked(fetchInspirationProcessing).mockRejectedValue(new Error('Network unavailable'));
  await act(async () => root.render(<Probe />)); await click('save');
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(host.textContent).toContain("Your thought is kept. Couldn't check its reading.");
  vi.mocked(fetchInspirationProcessing).mockResolvedValue(ready); await click('Check progress');
  expect(retryInspirationProcessing).not.toHaveBeenCalled();
});

it('retries confirmed failure only on request and deduplicates a repeated press', async () => {
  vi.mocked(fetchInspirationProcessing).mockResolvedValue({ ...waiting, phase: 'failed', canRetry: true });
  let finish!: (status: ApiInspirationProcessingStatus) => void;
  vi.mocked(retryInspirationProcessing).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await act(async () => root.render(<Probe />)); await click('save'); await click('Try again');
  await act(async () => { void latest.retry(); });
  expect(retryInspirationProcessing).toHaveBeenCalledOnce();
  await act(async () => finish(waiting));
  expect(host.textContent).toContain('Waiting to be read');
});

it('ignores an old account response after the storage scope changes', async () => {
  let finish!: (status: ApiInspirationProcessingStatus) => void;
  vi.mocked(fetchInspirationProcessing).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await act(async () => root.render(<Probe />)); await click('save');
  const b = { accountId: 'account-B', profileId: 'profile-B' };
  await act(async () => root.render(<Probe owner={b} />)); await act(async () => finish(ready));
  expect(host.querySelector('[data-phase]')?.textContent).toBe('idle');
  expect(host.textContent).not.toContain('See reading');
  expect(sessionStorage.getItem(profileStorageKey(b, 'sourceProcessing')!)).toBeNull();
});

it('retains a hung check for recovery without claiming terminal failure', async () => {
  vi.mocked(fetchInspirationProcessing).mockImplementation(() => new Promise(() => {}));
  await act(async () => root.render(<Probe />)); await click('save');
  await act(async () => vi.advanceTimersByTimeAsync(48_000));
  expect(host.querySelector('[data-phase]')?.textContent).toBe('error');
  expect(sessionStorage.getItem(profileStorageKey(scope, 'sourceProcessing')!)).not.toBeNull();
  expect(view).not.toHaveBeenCalled();
});

it('waits until a known future eligibility time rather than polling continuously', async () => {
  vi.mocked(fetchInspirationProcessing).mockResolvedValue({ ...waiting, phase: 'waiting', runAfter: new Date(Date.now() + 3_600_000).toISOString() });
  await act(async () => root.render(<Probe />)); await click('save');
  await act(async () => vi.advanceTimersByTimeAsync(120_000));
  expect(fetchInspirationProcessing).toHaveBeenCalledOnce();
  expect(host.textContent).toContain('Saved. WAKA will revisit this inspiration after');
  expect(host.textContent).not.toContain('next reading');
  expect(host.querySelector<HTMLDetailsElement>('.jar-source-details')?.open).toBe(false);
  expect(isNativeSurface(host.querySelector('.jar-source-details summary'))).toBe(true);
});
it('describes scheduled reading separately from the successful save without claiming completion',async()=>{
  vi.mocked(fetchInspirationProcessing).mockResolvedValue({...waiting,phase:'waiting',stage:'reading',runAfter:new Date(Date.now()+3600000).toISOString()});
  await act(async()=>root.render(<Probe/>));await click('save');
  expect(host.textContent).toContain('Saved. The next reading is scheduled for');
  expect(host.textContent).not.toContain('Your reading has an update');
  expect(view).not.toHaveBeenCalled();expect(retryInspirationProcessing).not.toHaveBeenCalled();
});
it('keeps the expanded progress control and focus while rechecking a scheduled read',async()=>{
  const scheduled={...waiting,phase:'waiting' as const,stage:'reading' as const,runAfter:new Date(Date.now()+3600000).toISOString()};
  vi.mocked(fetchInspirationProcessing).mockResolvedValue(scheduled);
  await act(async()=>root.render(<Probe/>));await click('save');
  const details=host.querySelector<HTMLDetailsElement>('.jar-source-details')!;
  await act(async()=>details.querySelector('summary')!.click());
  const check=details.querySelector('button')!;check.focus();
  let resolve!:(value:ApiInspirationProcessingStatus)=>void;
  vi.mocked(fetchInspirationProcessing).mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
  await click('Check progress');
  expect(host.querySelector('.jar-source-details')).toBe(details);expect(details.open).toBe(true);expect(document.activeElement).toBe(check);
  await act(async()=>resolve(scheduled));expect(details.open).toBe(true);expect(document.activeElement).toBe(check);
});

it('starts a fresh observation window when a scheduled hold ends', async () => {
  vi.mocked(fetchInspirationProcessing).mockResolvedValue({ ...waiting, phase: 'waiting', runAfter: new Date(Date.now() + 3_600_000).toISOString() });
  await act(async () => root.render(<Probe />)); await click('save');
  vi.mocked(fetchInspirationProcessing).mockResolvedValue({ ...waiting, phase: 'processing' });
  await act(async () => vi.advanceTimersByTimeAsync(3_600_000));
  expect(fetchInspirationProcessing).toHaveBeenCalledTimes(2);
  expect(host.querySelector('[data-phase]')?.textContent).toBe('processing');
});

it('removes progress when the saved source is no longer available, without claiming it is still kept', async () => {
  await act(async () => root.render(<Probe />)); await click('save');
  vi.mocked(fetchInspirationProcessing).mockRejectedValue(new ApiError({ status: 404, message: 'Processing request not found' }));
  await act(async () => vi.advanceTimersByTimeAsync(1500));
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(sessionStorage.getItem(profileStorageKey(scope, 'sourceProcessing')!)).toBeNull();
  expect(retryInspirationProcessing).not.toHaveBeenCalled();
});

it('checks an ambiguous retry response rather than repeating a potentially accepted POST', async () => {
  vi.mocked(fetchInspirationProcessing).mockResolvedValue({ ...waiting, phase: 'failed', canRetry: true });
  vi.mocked(retryInspirationProcessing).mockRejectedValue(new Error('The response was lost'));
  await act(async () => root.render(<Probe />)); await click('save'); await click('Try again');
  expect(host.textContent).toContain("Couldn't check its reading");
  vi.mocked(fetchInspirationProcessing).mockResolvedValue(waiting);
  await click('Check progress');
  expect(retryInspirationProcessing).toHaveBeenCalledOnce();
  expect(host.textContent).toContain('Waiting to be read');
});

it('does not let an older source response replace the latest saved inspiration', async () => {
  let finish!: (status: ApiInspirationProcessingStatus) => void;
  vi.mocked(fetchInspirationProcessing).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await act(async () => root.render(<Probe />)); await click('save');
  const newer = { ...waiting, inspirationId: 'source-B', receipt: { ...receipt, inspirationId: 'source-B', id: 'receipt-B' } };
  vi.mocked(fetchInspirationProcessing).mockResolvedValue(newer);
  await act(async () => latest.track('source-B', newer.receipt!));
  await act(async () => finish(ready));
  expect(latest.active?.inspirationId).toBe('source-B');
  expect(host.textContent).not.toContain('See reading');
  expect(latest.status?.phase).toBe('queued');
});

it('reports unchanged completion without offering another reading or silently restarting work', async () => {
  vi.mocked(fetchInspirationProcessing).mockResolvedValue({ ...ready, result: { kind: 'top_of_mind', topOfMindId: 'reading-1', version: 1, outcome: 'unchanged' } });
  await act(async () => root.render(<Probe />)); await click('save');
  expect(host.textContent).toContain('Your reading still holds.');
  expect(host.textContent).not.toContain('See reading');
  expect(retryInspirationProcessing).not.toHaveBeenCalled();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Dismiss processing notice"]')!.click());
  expect(host.querySelector('[role="status"]')).toBeNull();
});
