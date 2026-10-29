import { DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { getAttachmentsBucket } from './attachment-storage.js';
import { makeAttachmentsS3Client } from './s3-client.js';

export type DeleteAttachmentObjects = (keys: string[]) => Promise<void>;

/**
 * Remove the bytes behind rows Postgres has just removed. Best-effort, after
 * commit, the same policy `inspirations-editing.ts` keeps for a deleted note:
 * a person deleting their own chat must not be blocked by a flaky bucket.
 * Failures are logged; durable orphan cleanup remains an operational follow-up.
 */
export const sweepAttachmentObjects: DeleteAttachmentObjects = async (keys) => {
  const unique = [...new Set(keys.filter((key) => key.length > 0))];
  if (unique.length === 0) return;
  let bucket: string;
  try { bucket = getAttachmentsBucket(); }
  catch { console.warn('[attachments] S3 sweep skipped: bucket not configured', { keyCount: unique.length }); return; }
  const client = makeAttachmentsS3Client();
  try {
    for (let start = 0; start < unique.length; start += 1000) {
      const result = await client.send(new DeleteObjectsCommand({ Bucket: bucket,
        Delete: { Objects: unique.slice(start, start + 1000).map((Key) => ({ Key })), Quiet: true } }),
      { abortSignal: AbortSignal.timeout(8000) });
      if (result.Errors?.length) {
        console.warn('[attachments] S3 sweep incomplete', { keyCount: result.Errors.length });
      }
    }
  } catch (error) {
    console.warn('[attachments] S3 sweep failed', { keyCount: unique.length, error: error instanceof Error ? error.name : 'unknown' });
  } finally { client.destroy(); }
};
