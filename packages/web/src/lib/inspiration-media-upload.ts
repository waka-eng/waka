import { presignAttachment, uploadToPresignedUrl } from './api';
import type { InspirationDraftMedia } from './inspiration-draft-store';
import { DraftProblem } from './draft-problem';

/** Each successful object ticket is made durable before starting another.
 * A failed object does not erase the first one or discard the selected files. */
export async function uploadInspirationMedia(input: {
  media: InspirationDraftMedia[]; profileId: string; signal: AbortSignal;
  assertCurrent: () => void;
  uploading: (id: string) => void;
  persist: (id: string, update: Pick<InspirationDraftMedia, 'uploaded' | 'uploadError'>) => Promise<void>;
}) {
  const submitted: InspirationDraftMedia[] = [];
  for (const item of input.media) {
    input.assertCurrent();
    if (item.validationError) throw new DraftProblem('worldComposerFileNeedsAttention');
    if (!item.blob || item.uploaded) { submitted.push(item); continue; }
    input.uploading(item.id);
    let uploaded: InspirationDraftMedia['uploaded'];
    // Bound each transfer, including its presign. Its local bytes survive a
    // timeout and retry gets a fresh ticket; completed earlier files remain.
    const transfer = new AbortController();
    const abort = () => transfer.abort(input.signal.reason);
    if (input.signal.aborted) abort(); else input.signal.addEventListener('abort', abort, { once: true });
    const deadline = setTimeout(() => transfer.abort(new DOMException('Upload timed out', 'TimeoutError')), 120_000);
    try {
      const signed = await presignAttachment({ filename: item.name || 'attachment', contentType: item.blob.type, size: item.blob.size }, transfer.signal, { profile: input.profileId });
      input.assertCurrent();
      if (transfer.signal.aborted) throw transfer.signal.reason;
      await uploadToPresignedUrl(signed.uploadUrl, item.blob, signed.headers, transfer.signal);
      input.assertCurrent();
      if (transfer.signal.aborted) throw transfer.signal.reason;
      uploaded = { key: signed.key, contentType: item.blob.type, size: item.blob.size };
    } catch (reason) {
      input.assertCurrent();
      /* A FLAG, WRITTEN AS THE KEY THAT SAYS IT. This was an English sentence
         stored on the draft and printed as stored, so it reached a Korean
         screen in English — and, being durable, kept doing so after a reload.
         Surfaces treat any `uploadError` as "this one did not upload" and
         say `worldComposerUploadFailed` in the reader's language, which also
         covers a draft written before this change. */
      await input.persist(item.id, { uploadError: 'worldComposerUploadFailed' });
      /* AND THE SAVE SAYS THE SAME THING THE TILE DOES. A presigned PUT that
         never reached the bucket rejects with the browser's own `TypeError`
         ("Failed to fetch"), not an `ApiError`, so the composer fell through
         to "could not save" while the tile beside it said the upload failed.
         Every failure here is an upload failure; the original rides along. */
      throw Object.assign(new DraftProblem('worldComposerUploadFailed'), { cause: reason });
    } finally {
      clearTimeout(deadline);
      input.signal.removeEventListener('abort', abort);
    }
    await input.persist(item.id, { uploaded, uploadError: undefined });
    input.assertCurrent();
    submitted.push({ ...item, uploaded, uploadError: undefined });
  }
  return submitted;
}
