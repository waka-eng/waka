// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/api/attachments`'s three words
 * calls — the seam `useImageWords` reads through — so each status and the
 * revision conflict can be chosen. Nothing else. */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../src/lib/api/attachments', async original => ({ ...await original<typeof import('../src/lib/api/attachments')>(),
  fetchImageWords: vi.fn(), correctImageWords: vi.fn(), retryImageWords: vi.fn() }));
import { correctImageWords, fetchImageWords, retryImageWords, type ApiImageWords } from '../src/lib/api/attachments';
import { ApiError } from '../src/lib/api/http';
import { SavedImageWords } from '../src/components/ImageWords';

const row = (over: Partial<ApiImageWords>): ApiImageWords => ({ attachmentId: 'a', inspirationId: 'i', profileId: 'p', status: 'ready',
  text: 'Nobody feels ready.', read: 'Nobody feels ready.', correction: null, revision: 'r1', correctedAt: null, canEdit: true, canRetry: false, retryAfter: null, ...over });
let host: HTMLDivElement, root: Root;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.clearAllMocks(); vi.useRealTimers(); });
const mount = () => act(async () => root.render(<SavedImageWords attachmentId="a" locale="en-US" />));
const press = (name: string) => act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === name)!.click());
const type = (value: string) => act(async () => { const field = host.querySelector('textarea')!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); });

it('quotes the words read off a saved screenshot, and Fix sends the line with its revision', async () => {
  vi.mocked(fetchImageWords).mockResolvedValue(row({}));
  vi.mocked(correctImageWords).mockResolvedValue(row({ text: 'Nobody feels ready, ever.', correction: 'Nobody feels ready, ever.', revision: 'r2' }));
  await mount();
  expect(host.querySelector('.waka-note-read-label')?.textContent).toBe('The words I read');
  expect(host.querySelector('.waka-note-read-text')?.textContent).toBe('“Nobody feels ready.”');
  await press('Fix'); await type('Nobody feels ready, ever.'); await press('Done');
  expect(correctImageWords).toHaveBeenCalledWith('a', { revision: 'r1', correction: 'Nobody feels ready, ever.' });
  expect(host.querySelector('.waka-note-read-text')?.textContent).toBe('“Nobody feels ready, ever.”');
});

it('on a stale revision, reads the words again, keeps the line, and says so plainly', async () => {
  vi.mocked(fetchImageWords).mockResolvedValueOnce(row({})).mockResolvedValueOnce(row({ text: 'Changed elsewhere.', revision: 'r9' }));
  vi.mocked(correctImageWords).mockRejectedValue(new ApiError({ status: 409, code: 'words_changed', message: 'changed' }));
  await mount();
  await press('Fix'); await type('My line'); await press('Done');
  expect(fetchImageWords).toHaveBeenCalledTimes(2);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('These words changed while you were fixing them.');
  expect(host.querySelector('textarea')?.value, 'the typed line was lost').toBe('My line');
});

it('asks which line stuck when it could not read them, says it will try again, and queues no read of its own', async () => {
  vi.useFakeTimers();
  vi.mocked(fetchImageWords).mockResolvedValue(row({ status: 'retrying', text: null, read: null, canRetry: true }));
  await mount();
  expect(host.textContent).toContain("I couldn't make out the words. Which line stuck?");
  expect(host.textContent).toContain("I'll try reading it again in a bit.");
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  /* Code review, 2026-11-08: a paid re-read was queued on every mount,
     spending the shared budget so the person's own retry met a 429. */
  expect(retryImageWords, 'the screen queued a paid read by itself').not.toHaveBeenCalled();
  expect(fetchImageWords, 'it kept asking though nothing is queued').toHaveBeenCalledTimes(1);
  await act(async () => root.render(<></>)); await mount();
  expect(retryImageWords, 'a second opening queued a read').not.toHaveBeenCalled();
});

it('follows a queued read until it lands', async () => {
  vi.useFakeTimers();
  vi.mocked(fetchImageWords).mockResolvedValueOnce(row({ status: 'retrying', text: null, read: null, canRetry: false, retryAfter: null }))
    .mockResolvedValue(row({}));
  await mount();
  await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
  expect(host.querySelector('.waka-note-read-text')?.textContent).toBe('“Nobody feels ready.”');
});


it('offers no Fix where the server says the words may not be edited', async () => {
  vi.mocked(fetchImageWords).mockResolvedValue(row({ canEdit: false }));
  await mount();
  expect([...host.querySelectorAll('button')].map(b => b.textContent)).not.toContain('Fix');
});

/* CODE REVIEW, 2026-11-08: the asking must end when asking cannot help. */
it('stops asking on a permanent refusal', async () => {
  vi.useFakeTimers();
  vi.mocked(fetchImageWords).mockRejectedValue(new ApiError({ status: 404, code: 'not_found', message: 'Not found' }));
  await mount();
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(fetchImageWords, 'a 404 was asked about again').toHaveBeenCalledTimes(1);
});

it('keeps asking through a timeout or a rate limit', async () => {
  vi.useFakeTimers();
  vi.mocked(fetchImageWords).mockRejectedValueOnce(new ApiError({ status: 429, code: 'rate_limited', message: 'Slow down' })).mockResolvedValue(row({}));
  await mount();
  await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
  expect(vi.mocked(fetchImageWords).mock.calls.length).toBe(2);
  expect(host.querySelector('.waka-note-read-text')?.textContent).toBe('“Nobody feels ready.”');
});

it('stops asking when the retry budget is spent, instead of polling an answer that cannot change', async () => {
  vi.useFakeTimers();
  const reopens = new Date(Date.now() + 60_000).toISOString();
  vi.mocked(fetchImageWords).mockResolvedValue(row({ status: 'retrying', text: null, read: null, canRetry: false, retryAfter: reopens }));
  await mount();
  await act(async () => { await vi.advanceTimersByTimeAsync(180_000); });
  expect(fetchImageWords, 'it polled a read nothing could hurry').toHaveBeenCalledTimes(1);
});


it('shows nothing for words it cannot tell apart from the description (a reading from before the two-part shape)', async () => {
  vi.mocked(fetchImageWords).mockResolvedValue(row({ status: 'unknown', text: null, read: null }));
  await mount();
  expect(host.textContent).toBe('');
});

/* CODE REVIEW, 2026-11-08: the detail already carries the words inline
   (`enrichment.words`); a settled reading is shown from it without asking. */
const mountInline = (inline: Parameters<typeof SavedImageWords>[0]['inline']) =>
  act(async () => root.render(<SavedImageWords attachmentId="a" locale="en-US" inline={inline} />));

it('shows settled words from the detail without asking for them again', async () => {
  await mountInline({ status: 'ready', text: 'Nobody feels ready.', read: 'Nobody feels ready.', correction: null, revision: '3' });
  expect(host.querySelector('.waka-note-read-text')?.textContent).toBe('“Nobody feels ready.”');
  expect(fetchImageWords, 'it asked for words the detail already carried').not.toHaveBeenCalled();
  for (const status of ['unknown', 'unreadable'] as const) {
    await mountInline({ status, text: null, read: null, correction: null, revision: '3' });
    expect(fetchImageWords).not.toHaveBeenCalled();
  }
});

it('asks only while the inline read is still going', async () => {
  vi.mocked(fetchImageWords).mockResolvedValue(row({}));
  await mountInline({ status: 'reading', text: null, read: null, correction: null, revision: '0' });
  expect(fetchImageWords).toHaveBeenCalledTimes(1);
  expect(host.querySelector('.waka-note-read-text')?.textContent).toBe('“Nobody feels ready.”');
});

