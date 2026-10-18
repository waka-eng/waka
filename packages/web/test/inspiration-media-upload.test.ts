/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/api` methods `presignAttachment`
 * and `uploadToPresignedUrl` supply network outcomes. The actual sequential
 * uploader and durable-receipt callbacks run; owned IndexedDB has its own suite. */
import { beforeEach, expect, it, vi } from 'vitest';
import { presignAttachment, uploadToPresignedUrl } from '../src/lib/api';
import { uploadInspirationMedia } from '../src/lib/inspiration-media-upload';
import { draftProblem } from '../src/lib/draft-problem';
import type { InspirationDraftMedia } from '../src/lib/inspiration-draft-store';

vi.mock('../src/lib/api', async original => ({ ...await original<typeof import('../src/lib/api')>(), presignAttachment: vi.fn(), uploadToPresignedUrl: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(presignAttachment).mockImplementation(async file => ({ profileId: 'owner', key: `objects/${file.filename}`, uploadUrl: 'https://objects.test/upload', expiresAt: '', headers: { 'Content-Type': file.contentType, 'Content-Length': String(file.size) } }));
  vi.mocked(uploadToPresignedUrl).mockResolvedValue(undefined);
});
function fixture() {
  let media: InspirationDraftMedia[] = ['first', 'second', 'third'].map(id => ({ id, type: 'image', name: `${id}.png`, blob: new Blob(['photo'], { type: 'image/png' }) }));
  const controller = new AbortController();
  const persist = vi.fn(async (id: string, update: Pick<InspirationDraftMedia, 'uploaded' | 'uploadError'>) => {
    media = media.map(row => row.id === id ? { ...row, ...update } : row);
  });
  return { get media() { return media; }, controller, persist,
    run: (selected?: InspirationDraftMedia[]) => uploadInspirationMedia({ media: selected ?? media, profileId: 'owner', signal: controller.signal,
      assertCurrent: () => { if (controller.signal.aborted) throw new Error('Owner changed'); }, uploading: vi.fn(), persist }) };
}
it('preserves completed receipts and all originals when a later file fails, then skips uploaded files', async () => {
  const f = fixture();
  vi.mocked(uploadToPresignedUrl).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('offline'));
  await expect(f.run()).rejects.toThrow('worldComposerUploadFailed');
  expect(f.media[0]?.uploaded?.key).toBe('objects/first.png');
  expect(f.media[1]?.uploadError, 'a flag the surface says in the reader’s language, never a sentence').toBe('worldComposerUploadFailed');
  expect(f.media.every(row => row.blob?.size === 5)).toBe(true);
  expect(presignAttachment).toHaveBeenCalledTimes(2);
  await f.run();
  expect(vi.mocked(presignAttachment).mock.calls.map(call => call[0].filename)).toEqual(['first.png', 'second.png', 'second.png', 'third.png']);
  expect(f.media.every(row => row.uploaded && !row.uploadError)).toBe(true);
});
it('says a network failure of the presigned upload as an upload failure, like the tile', async () => {
  const f = fixture();
  const network = new TypeError('Failed to fetch');
  vi.mocked(uploadToPresignedUrl).mockRejectedValueOnce(network);
  const reason = await f.run().catch((error: unknown) => error);
  expect(draftProblem(reason, 'worldComposerSaveFailed')).toBe('worldComposerUploadFailed');
  expect((reason as { cause?: unknown }).cause).toBe(network);
  expect(f.media[0]?.uploadError).toBe('worldComposerUploadFailed');
});
it('an individual retry uploads only the chosen file and cannot save an inspiration itself', async () => {
  const f = fixture(); await f.run([f.media[1]!]);
  expect(presignAttachment).toHaveBeenCalledOnce();
  expect(f.media.filter(row => row.uploaded).map(row => row.id)).toEqual(['second']);
});
it('does not write a late upload receipt into a changed owner draft', async () => {
  const f = fixture();
  vi.mocked(uploadToPresignedUrl).mockImplementationOnce(async () => { f.controller.abort(); });
  await expect(f.run()).rejects.toThrow('Owner changed');
  expect(f.persist).not.toHaveBeenCalled(); expect(presignAttachment).toHaveBeenCalledOnce();
});
it('stops before the next upload if making the first receipt durable fails', async () => {
  const f = fixture(); f.persist.mockRejectedValueOnce(new Error('Storage full'));
  await expect(f.run()).rejects.toThrow('Storage full'); expect(presignAttachment).toHaveBeenCalledOnce();
});
it('does not upload a selected file with a validation problem', async () => {
  const f = fixture(); await expect(f.run([{...f.media[0]!, validationError:'Too large'}])).rejects.toThrow('worldComposerFileNeedsAttention');
  expect(presignAttachment).not.toHaveBeenCalled(); expect(uploadToPresignedUrl).not.toHaveBeenCalled();
});
