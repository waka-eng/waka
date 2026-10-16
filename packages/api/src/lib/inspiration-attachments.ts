import { HeadObjectCommand, type HeadObjectCommandOutput } from '@aws-sdk/client-s3';
import { inArray } from 'drizzle-orm';
import { attachments } from '../db/index.js';
import type { getDb } from './db.js';
import { attachmentKeyPrefix, attachmentObjectUrl, getAttachmentsBucket } from './attachment-storage.js';
import { attachmentsRegion, makeAttachmentsS3Client } from './s3-client.js';
import type { InspirationAttachmentInput } from './inspiration-attachment-input.js';

export type AttachmentHead = (bucket: string, key: string) => Promise<Pick<HeadObjectCommandOutput, 'ContentLength' | 'ContentType'>>;
export class InspirationAttachmentError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409 | 503, readonly code: string, message: string) { super(message); }
}
export const headUploadedAttachment: AttachmentHead = async (bucket, key) => {
  const client = makeAttachmentsS3Client();
  try { return await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(8000) }); }
  finally { client.destroy(); }
};

/** Run only for a new save intent, inside its transaction. A committed replay
 * reads the saved rows and does not need S3 to be available again. */
export async function prepareInspirationAttachments(inputs: InspirationAttachmentInput[], owner: {
  uploaderProfileId: string; profileId: string; inspirationId: string;
}, head: AttachmentHead = headUploadedAttachment): Promise<Array<typeof attachments.$inferInsert>> {
  return Promise.all(inputs.map(async (input, index) => {
    const common = { profileId: owner.profileId, inspirationId: owner.inspirationId, name: input.name ?? null,
      createdAt: new Date(Date.now() + index) };
    if (input.type === 'link') return { ...common, type: 'link' as const, url: input.url, enrichmentStatus: 'pending' as const };
    const object = await verifyUploadedAttachment(input, owner.uploaderProfileId, head);
    return { ...common, type: input.type, ...object,
      // A file has nothing a machine reads, so its honest verdict is recorded
      // now — the same one the finalize route records — not queued.
      enrichmentStatus: input.type === 'file' ? 'unavailable' as const : 'pending' as const };
  }));
}

/**
 * THE UPLOAD IS WHAT IT SAYS IT IS. The key must sit under the uploader's own
 * prefix with a server-shaped tail, and S3's HEAD must report exactly the
 * declared byte length and content type — the two facts the presign pinned
 * into its signature. Shared by note capture and chat finalize so the two
 * doors cannot drift apart.
 */
export async function verifyUploadedAttachment(input: { key: string; contentType: string; size: number },
  uploaderProfileId: string, head: AttachmentHead = headUploadedAttachment) {
  const prefix = attachmentKeyPrefix(uploaderProfileId);
  if (!input.key.startsWith(prefix) || !/^[a-z0-9._-]+$/i.test(input.key.slice(prefix.length))) {
    throw new InspirationAttachmentError(403, 'attachment_owner_mismatch', 'This upload does not belong to this profile.');
  }
  let bucket: string;
  try { bucket = getAttachmentsBucket(); }
  catch { throw new InspirationAttachmentError(503, 'attachment_unavailable', 'Uploads are unavailable. Your draft can be retried.'); }
  let object: Awaited<ReturnType<AttachmentHead>>;
  try { object = await head(bucket, input.key); }
  catch (error) {
    const value = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (value.$metadata?.httpStatusCode === 404 || value.name === 'NotFound' || value.name === 'NoSuchKey') {
      throw new InspirationAttachmentError(404, 'attachment_upload_missing', 'The upload was not found. Upload it again.');
    }
    throw new InspirationAttachmentError(503, 'attachment_unverified', 'Could not confirm the upload. Try again.');
  }
  if (object.ContentLength !== input.size || object.ContentType?.trim().toLowerCase() !== input.contentType.toLowerCase()) {
    throw new InspirationAttachmentError(400, 'attachment_upload_mismatch', 'The uploaded file does not match this draft.');
  }
  return { s3Key: input.key, contentType: input.contentType, size: input.size,
    url: attachmentObjectUrl(bucket, attachmentsRegion(), input.key) };
}

/**
 * ONE STORED OBJECT, ONE ATTACHMENT. Every door that writes an uploaded key
 * onto a row — note capture, the inspiration finalize, the chat finalize —
 * refuses a key some row already names, because every delete path sweeps the
 * bytes behind the rows it removes: a second row on the same object would
 * have its file deleted out from under it. Call inside the inserting
 * transaction. (Not a UNIQUE index: rows written before these checks may
 * hold legacy duplicates; `attachments_s3_key_idx` serves this lookup.)
 */
export async function assertAttachmentKeysUnused(db: Pick<ReturnType<typeof getDb>, 'select'>, keys: string[]): Promise<void> {
  if (!keys.length) return;
  const [reused] = await db.select({ id: attachments.id }).from(attachments).where(inArray(attachments.s3Key, keys)).limit(1);
  if (reused) throw new InspirationAttachmentError(409, 'attachment_already_attached', 'This upload is already attached. Upload it again.');
}
