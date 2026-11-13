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
  await press('Edit'); await type('Nobody feels ready, ever.'); await press('Save');
  expect(correctImageWords).toHaveBeenCalledWith('a', { revision: 'r1', correction: 'Nobody feels ready, ever.' });
  expect(host.querySelector('.waka-note-read-text')?.textContent).toBe('“Nobody feels ready, ever.”');
});

it('on a stale revision, reads the words again, keeps the line, and says so plainly', async () => {
  vi.mocked(fetchImageWords).mockResolvedValueOnce(row({})).mockResolvedValueOnce(row({ text: 'Changed elsewhere.', revision: 'r9' }));
  vi.mocked(correctImageWords).mockRejectedValue(new ApiError({ status: 409, code: 'words_changed', message: 'changed' }));
  await mount();
  await press('Edit'); await type('My line'); await press('Save');
  expect(fetchImageWords).toHaveBeenCalledTimes(2);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('These words changed while you were editing.');
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
  expect([...host.querySelectorAll('button')].map(b => b.textContent)).not.toContain('Edit');
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




it('shows the detail\'s words at once, and offers Fix only once the read says this session may edit', async () => {
  let answer!: (value: ApiImageWords) => void;
  vi.mocked(fetchImageWords).mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
  await mountInline({ status: 'ready', text: 'Nobody feels ready.', read: 'Nobody feels ready.', correction: null, revision: '3' });
  expect(host.querySelector('.waka-note-read-text')?.textContent).toBe('“Nobody feels ready.”');
  expect([...host.querySelectorAll('button')].map(b => b.textContent), 'Fix offered before editability was known').not.toContain('Edit');
  await act(async () => answer(row({ revision: '3', canEdit: false })));
  expect([...host.querySelectorAll('button')].map(b => b.textContent), 'a read-only session was offered Fix').not.toContain('Edit');
  expect(fetchImageWords, 'a settled reading was polled').toHaveBeenCalledTimes(1);
});





/* Code review, 2026-11-08: a new inline summary (after a Fix) reset what the
   session may do to "nothing", and Fix flickered away until the read came back. */
it('keeps what this session may do across a new inline summary', async () => {
  vi.mocked(fetchImageWords).mockResolvedValueOnce(row({ canEdit: true }))
    .mockImplementation(() => new Promise(() => {}));
  await mountInline({ status: 'ready', text: 'Nobody feels ready.', read: 'Nobody feels ready.', correction: null, revision: '1' });
  expect([...host.querySelectorAll('button')].map(b => b.textContent)).toContain('Edit');
  await mountInline({ status: 'ready', text: 'My line.', read: 'Nobody feels ready.', correction: 'My line.', revision: '2' });
  expect(host.querySelector('.waka-note-read-text')?.textContent).toBe('“My line.”');
  expect([...host.querySelectorAll('button')].map(b => b.textContent), 'Fix flickered away').toContain('Edit');
});

/* A PICTURE WHOSE WORDS COULD NOT BE READ SAYS NOTHING ABOUT IT (founder,
   2026-11-12: "don't write this thing"): no question, no field, no retry. */
it('draws nothing for words it could not read, whether or not a read is queued', async () => {
  vi.mocked(fetchImageWords).mockImplementation(() => new Promise(() => {}));
  for (const status of ['unreadable', 'failed', 'retrying'] as const) {
    await mountInline({ status, text: null, read: null, correction: null, revision: '0' });
    expect(host.querySelector('.waka-note-read'), `${status} still drew a words line`).toBeNull();
    expect(host.textContent).not.toContain('Which line stuck?');
  }
});
