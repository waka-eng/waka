import { presignAttachment, uploadToPresignedUrl } from './api';
import type { InspirationDraftMedia } from './inspiration-draft-store';

/** Each successful object ticket is made durable before starting another.
 * A failed object does not erase the first one or discard the selected files. */
export async function uploadInspirationMedia(input: {
  media: InspirationDraftMedia[]; profileId: string; signal: AbortSignal;
  assertCurrent: () => void;
  uploading: (id: string) => void;
  persist: (id: string, update: Pick<InspirationDraftMedia, 'uploaded' | 'uploadError'>) => Promise<void>;
}) {
  for (const item of input.media) {
    input.assertCurrent();
    if (item.validationError) throw new Error(item.validationError);
    if (!item.blob || item.uploaded) continue;
    input.uploading(item.id);
    let uploaded: InspirationDraftMedia['uploaded'];
    try {
      const signed = await presignAttachment({ filename: item.name, contentType: item.blob.type, size: item.blob.size }, input.signal, { profile: input.profileId });
      input.assertCurrent();
      await uploadToPresignedUrl(signed.uploadUrl, item.blob, signed.headers, input.signal);
      input.assertCurrent();
      uploaded = { key: signed.key, contentType: item.blob.type, size: item.blob.size };
    } catch (reason) {
      input.assertCurrent();
      await input.persist(item.id, { uploadError: 'Upload didn’t finish. Your file is still in this draft.' });
      throw reason;
    }
    await input.persist(item.id, { uploaded, uploadError: undefined });
    input.assertCurrent();
  }
}
