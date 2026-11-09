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
  vi.mocked(fetchImageWords).mockResolvedValue(row({ status: 'failed', text: null, read: null, canRetry: false, retryAfter: reopens }));
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


it('asks only while the inline read is still going', async () => {
  vi.mocked(fetchImageWords).mockResolvedValue(row({}));
  await mountInline({ status: 'reading', text: null, read: null, correction: null, revision: '0' });
  expect(fetchImageWords).toHaveBeenCalledTimes(1);
  expect(host.querySelector('.waka-note-read-text')?.textContent).toBe('“Nobody feels ready.”');
});


/* CODE REVIEW, 2026-11-08 (fourth round). */
it('offers "Try reading it again" when nothing is queued, promises nothing, and queues a read only on the press', async () => {
  vi.useFakeTimers();
  const queued = row({ status: 'retrying', text: null, read: null, canRetry: false, retryAfter: null });
  vi.mocked(fetchImageWords).mockResolvedValueOnce(row({ status: 'failed', text: null, read: null, canRetry: true }))
    .mockResolvedValueOnce(queued).mockResolvedValue(row({}));
  vi.mocked(retryImageWords).mockResolvedValue(queued);
  await mount();
  expect(host.textContent).toContain("I couldn't make out the words. Which line stuck?");
  expect(host.textContent, 'it promised a retry nothing will make').not.toContain("I'll try reading it again in a bit.");
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(retryImageWords, 'the screen queued a paid read by itself').not.toHaveBeenCalled();
  await press('Try reading it again');
  expect(retryImageWords).toHaveBeenCalledTimes(1);
  expect(host.textContent, 'a queued read is not said').toContain("I'll try reading it again in a bit.");
  await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
  expect(host.querySelector('.waka-note-read-text')?.textContent, 'the queued read was not followed').toBe('“Nobody feels ready.”');
});

it('says when the retry budget is spent instead of failing quietly', async () => {
  vi.mocked(fetchImageWords).mockResolvedValue(row({ status: 'failed', text: null, read: null, canRetry: true }));
  vi.mocked(retryImageWords).mockRejectedValue(new ApiError({ status: 429, code: 'words_retry_limit', message: 'Too many' }));
  await mount();
  await press('Try reading it again');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Try again in an hour.');
});

it('shows the detail\'s words at once, and offers Fix only once the read says this session may edit', async () => {
  let answer!: (value: ApiImageWords) => void;
  vi.mocked(fetchImageWords).mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
  await mountInline({ status: 'ready', text: 'Nobody feels ready.', read: 'Nobody feels ready.', correction: null, revision: '3' });
  expect(host.querySelector('.waka-note-read-text')?.textContent).toBe('“Nobody feels ready.”');
  expect([...host.querySelectorAll('button')].map(b => b.textContent), 'Fix offered before editability was known').not.toContain('Fix');
  await act(async () => answer(row({ revision: '3', canEdit: false })));
  expect([...host.querySelectorAll('button')].map(b => b.textContent), 'a read-only session was offered Fix').not.toContain('Fix');
  expect(fetchImageWords, 'a settled reading was polled').toHaveBeenCalledTimes(1);
});

it('keeps a fix when a read that left before it answers after it', async () => {
  vi.useFakeTimers();
  const queued = row({ status: 'retrying', text: null, read: null, canRetry: false, retryAfter: null });
  let late!: (value: ApiImageWords) => void;
  vi.mocked(fetchImageWords).mockResolvedValueOnce(queued)
    .mockImplementationOnce(() => new Promise(resolve => { late = resolve; }));
  vi.mocked(correctImageWords).mockResolvedValue(row({ text: 'My line.', correction: 'My line.', revision: '2' }));
  await mount();
  await act(async () => { await vi.advanceTimersByTimeAsync(1_600); }); // the second read has left
  expect(late, 'the second read never left').toBeTypeOf('function');
  await press('Type the line'); await type('My line.'); await press('Done');
  expect(host.querySelector('.waka-note-read-text')?.textContent).toBe('“My line.”');
  await act(async () => { late(queued); });
  expect(host.querySelector('.waka-note-read-text')?.textContent, 'an older read overwrote the fix').toBe('“My line.”');
});


/* Code review, 2026-11-08: 'failed' (nothing queued) never promises a read;
   'retrying' (a read queued) always does — inline too. */
it('promises a read only for one that is queued, from the inline summary as from the read', async () => {
  vi.mocked(fetchImageWords).mockImplementation(() => new Promise(() => {}));
  await mountInline({ status: 'failed', text: null, read: null, correction: null, revision: '0' });
  expect(host.textContent).toContain("I couldn't make out the words. Which line stuck?");
  expect(host.textContent).not.toContain("I'll try reading it again in a bit.");
  await mountInline({ status: 'retrying', text: null, read: null, correction: null, revision: '0' });
  expect(host.textContent).toContain("I'll try reading it again in a bit.");
});

/* Code review, 2026-11-08: a poll dropped as stale (a write began while it
   was out) stopped the asking for good, even when that write then failed. */
it('keeps following a queued read when a write it raced with fails', async () => {
  vi.useFakeTimers();
  const queued = row({ status: 'retrying', text: null, read: null, canRetry: false, retryAfter: null });
  let late!: (value: ApiImageWords) => void;
  vi.mocked(fetchImageWords).mockResolvedValueOnce(queued)
    .mockImplementationOnce(() => new Promise(resolve => { late = resolve; }))
    .mockResolvedValue(queued);
  vi.mocked(correctImageWords).mockRejectedValue(new ApiError({ status: 500, code: 'server', message: 'Down' }));
  await mount();
  await act(async () => { await vi.advanceTimersByTimeAsync(1_600); });
  await press('Type the line'); await type('My line.'); await press('Done');
  await act(async () => { late(queued); });
  const asked = vi.mocked(fetchImageWords).mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  expect(vi.mocked(fetchImageWords).mock.calls.length, 'the asking stopped after a stale answer').toBeGreaterThan(asked);
});

/* Code review, 2026-11-08: a new inline summary (after a Fix) reset what the
   session may do to "nothing", and Fix flickered away until the read came back. */
it('keeps what this session may do across a new inline summary', async () => {
  vi.mocked(fetchImageWords).mockResolvedValueOnce(row({ canEdit: true }))
    .mockImplementation(() => new Promise(() => {}));
  await mountInline({ status: 'ready', text: 'Nobody feels ready.', read: 'Nobody feels ready.', correction: null, revision: '1' });
  expect([...host.querySelectorAll('button')].map(b => b.textContent)).toContain('Fix');
  await mountInline({ status: 'ready', text: 'My line.', read: 'Nobody feels ready.', correction: 'My line.', revision: '2' });
  expect(host.querySelector('.waka-note-read-text')?.textContent).toBe('“My line.”');
  expect([...host.querySelectorAll('button')].map(b => b.textContent), 'Fix flickered away').toContain('Fix');
});
