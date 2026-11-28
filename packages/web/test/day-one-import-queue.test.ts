/**
 * THE DAY ONE QUEUE, BELOW THE PAGE (`lib/day-one-import`).
 *
 * The page test pins one save per photo and the quiet retry. These pin what
 * the page cannot see: the account's hourly upload budget (20 uploads, see
 * `ATTACHMENT_UPLOAD_HOUR_LIMITS` in the API) is never asked to sign more
 * than it can, a refusal for capacity stops the queue rather than being
 * retried, a save retried after an ambiguous failure keeps its request id
 * (so the server replays instead of saving twice), and a file of a kind no
 * save takes is left out before anything is uploaded.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `lib/api`'s three upload verbs, and
 * `lib/inspiration-photo`'s sniffer (it passes a file through).
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '../src/lib/api/http';
import { createInspiration, presignAttachment, uploadToPresignedUrl } from '../src/lib/api';
import { IMPORT_MAX_ITEMS, bringInImports } from '../src/lib/day-one-import';

vi.mock('../src/lib/api', async original => ({ ...await original<typeof import('../src/lib/api')>(),
  presignAttachment: vi.fn(async (input: { filename: string }) => ({ uploadUrl: `https://bucket.test/${input.filename}`, key: `uploads/${input.filename}`,
    expiresAt: '', headers: { 'Content-Type': 'image/png', 'Content-Length': '8' } })),
  uploadToPresignedUrl: vi.fn(async () => undefined),
  createInspiration: vi.fn(async (input: { attachments: Array<{ key: string }> }) => ({ id: `saved-${input.attachments[0]!.key}` })),
}));
vi.mock('../src/lib/inspiration-photo', async original => ({ ...await original<typeof import('../src/lib/inspiration-photo')>(),
  inspectInspirationPhoto: async (file: File) => file }));

const photo = (name: string) => new File([new Uint8Array(8)], name, { type: 'image/png' });
const signs = async (input: { filename: string }) => ({ uploadUrl: `https://bucket.test/${input.filename}`, key: `uploads/${input.filename}`,
  expiresAt: '', headers: { 'Content-Type': 'image/png', 'Content-Length': '8' } });
beforeEach(() => {
  vi.mocked(presignAttachment).mockReset().mockImplementation(signs);
  vi.mocked(uploadToPresignedUrl).mockReset().mockImplementation(async () => undefined);
  vi.mocked(createInspiration).mockReset().mockImplementation(async (input) =>
    ({ id: `saved-${input.attachments![0]!.type !== 'link' && input.attachments![0]!.key}` }) as Awaited<ReturnType<typeof createInspiration>>);
});
const run = (files: File[], door: 'photos' | 'files' = 'photos') =>
  bringInImports({ files, door, profileId: 'p1', signal: new AbortController().signal, onLanded: () => undefined });

it('never asks to sign more than the hourly budget', async () => {
  const result = await run(Array.from({ length: IMPORT_MAX_ITEMS + 5 }, (_, i) => photo(`${i}.png`)));
  expect(vi.mocked(presignAttachment)).toHaveBeenCalledTimes(IMPORT_MAX_ITEMS);
  expect(result).toEqual({ landed: IMPORT_MAX_ITEMS, leftOut: 5, capacity: false });
});

it('stops the queue when the budget runs out, without retrying', async () => {
  let signed = 0;
  vi.mocked(presignAttachment).mockImplementation(async (input) => {
    if (++signed > 2) throw new ApiError({ status: 429, code: 'attachment_upload_capacity', message: 'This account reached its hourly upload limit.' });
    return { uploadUrl: `https://bucket.test/${input.filename}`, key: `uploads/${input.filename}`, expiresAt: '', headers: { 'Content-Type': 'image/png', 'Content-Length': '8' } };
  });
  const result = await run(Array.from({ length: 8 }, (_, i) => photo(`${i}.png`)));
  expect(result.landed).toBe(2);
  expect(result.leftOut).toBe(6);
  expect(result.capacity, 'the run did not say the budget ran out').toBe(true);
  expect(signed, 'the queue kept asking after the budget ran out').toBeLessThanOrEqual(2 + 3);
});

it('retries a failed save under the same request id, without uploading again', async () => {
  let saves = 0;
  vi.mocked(createInspiration).mockImplementation(async (_input, options) => {
    saves += 1;
    if (saves === 1) throw new ApiError({ status: 503, message: 'Busy' });
    return { id: `saved-${options?.requestId}` } as Awaited<ReturnType<typeof createInspiration>>;
  });
  const result = await run([photo('one.png')]);
  expect(result).toEqual({ landed: 1, leftOut: 0, capacity: false });
  const [first, second] = vi.mocked(createInspiration).mock.calls;
  expect(first![1]!.requestId).toBeTruthy();
  expect(second![1]!.requestId, 'the retry made a second save identity').toBe(first![1]!.requestId);
  expect(vi.mocked(uploadToPresignedUrl), 'the bytes were sent twice').toHaveBeenCalledTimes(1);
});

it('leaves out a file no save takes before uploading it, and saves a PDF as a note', async () => {
  const pdf = new File([new Uint8Array(8)], 'letter.pdf', { type: 'application/pdf' });
  const program = new File([new Uint8Array(8)], 'setup.exe', { type: 'application/x-msdownload' });
  const result = await run([pdf, program], 'files');
  expect(result).toEqual({ landed: 1, leftOut: 1, capacity: false });
  expect(vi.mocked(presignAttachment)).toHaveBeenCalledTimes(1);
  expect(vi.mocked(createInspiration).mock.calls[0]![0]).toMatchObject({ kind: 'note', attachments: [{ type: 'file', contentType: 'application/pdf' }] });
});

/* CODE REVIEW, 2026-11-27: the same status means different things at the API
   and at the bucket. */
it('tries a bucket 403 again with a fresh ticket, and goes on with the queue', async () => {
  let puts = 0;
  vi.mocked(uploadToPresignedUrl).mockImplementation(async () => {
    if (++puts === 1) throw new ApiError({ status: 403, message: 'Upload failed (HTTP 403). Please try again.' });
  });
  const result = await run([photo('a.png'), photo('b.png')]);
  expect(result).toEqual({ landed: 2, leftOut: 0, capacity: false });
  expect(vi.mocked(presignAttachment), 'the retry did not ask for a fresh ticket').toHaveBeenCalledTimes(3);
});

it('stops the queue when the API refuses the session', async () => {
  vi.mocked(presignAttachment).mockImplementation(async () => { throw new ApiError({ status: 403, message: 'Forbidden' }); });
  const result = await run(Array.from({ length: 6 }, (_, i) => photo(`${i}.png`)));
  expect(result).toEqual({ landed: 0, leftOut: 6, capacity: false });
  expect(vi.mocked(presignAttachment).mock.calls.length, 'the queue went on after a refused session').toBeLessThanOrEqual(3);
});

it('does not try again what would only be refused again', async () => {
  vi.mocked(createInspiration)
    .mockImplementationOnce(async () => { throw new ApiError({ status: 400, message: 'Add text or an attachment' }); })
    .mockImplementationOnce(async () => { throw new ApiError({ status: 409, code: 'save_request_conflict', message: 'Used' }); });
  const result = await run([photo('a.png')]);
  expect(result.landed).toBe(0);
  expect(vi.mocked(createInspiration), 'a 400 was tried again').toHaveBeenCalledTimes(1);
  const conflict = await run([photo('b.png')]);
  expect(conflict.landed).toBe(0);
  expect(vi.mocked(createInspiration), 'a 409 was tried again').toHaveBeenCalledTimes(2);
});

afterEach(() => { vi.useRealTimers(); });
it('gives a stalled upload a deadline, so the run always finishes', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.mocked(uploadToPresignedUrl).mockImplementation((_url, _file, _headers, signal) => new Promise((_, reject) => {
    signal?.addEventListener('abort', () => reject(new ApiError({ status: 0, message: 'Network unreachable while uploading attachment' })));
  }));
  let done = false;
  const running = run([photo('stuck.png')]).then(result => { done = true; return result; });
  await vi.advanceTimersByTimeAsync(119_000);
  expect(done, 'the run gave up before the deadline').toBe(false);
  await vi.advanceTimersByTimeAsync(2 * 120_000);
  expect(await running).toEqual({ landed: 0, leftOut: 1, capacity: false });
  expect(vi.mocked(uploadToPresignedUrl), 'the stalled upload was not tried once more').toHaveBeenCalledTimes(2);
});
