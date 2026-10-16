import { z } from 'zod';

export const MAX_INSPIRATION_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * WHAT "ADD FILE" ACCEPTS (2026-10-15: files in notes and chats). A positive
 * list of documents a person plausibly keeps or talks about — PDF, plain
 * text / Markdown / CSV, the Office formats and their OpenDocument twins —
 * plus the common photo formats, because a file picker hands a photo over as
 * readily as a PDF. Executables, archives and arbitrary `application/*` stay
 * out: the bucket is private and served only through short presigned GETs,
 * so the risk managed here is junk storage, not bucket compromise, and a
 * named list keeps that bounded. The size cap is the image cap (25 MiB).
 *
 * Mirrored for the browser in `packages/web/src/lib/api/file-accept.ts`.
 */
export const FILE_ATTACHMENT_CONTENT_TYPES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/rtf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/heif',
] as const;
const fileContentTypes = new Set<string>(FILE_ATTACHMENT_CONTENT_TYPES);
export function isAllowedFileContentType(value: string): boolean {
  return fileContentTypes.has(value.trim().toLowerCase());
}
export const IMAGE_CONTENT_TYPE = /^image\/[a-z0-9.+-]+$/i;

/**
 * What the presigner will sign. A superset of the file list above: images of
 * any subtype, the recording formats, and the older document entries
 * (`zip`, `json`, `octet-stream`) earlier clients may still send to the
 * inspiration finalize route, whose behaviour is unchanged.
 */
const OFFICE = 'msword|rtf|vnd\\.openxmlformats-officedocument\\.(wordprocessingml\\.document|spreadsheetml\\.sheet|presentationml\\.presentation)|vnd\\.ms-excel|vnd\\.ms-powerpoint|vnd\\.oasis\\.opendocument\\.(text|spreadsheet|presentation)';
export const ALLOWED_ATTACHMENT_CONTENT_TYPE = new RegExp(`^(image\\/[a-z0-9.+-]+|audio\\/(webm|mp4|mpeg|wav|x-wav|ogg)(;\\s*codecs=[a-z0-9., _-]+)?|application\\/(pdf|zip|json|octet-stream|${OFFICE})|text\\/[a-z0-9.+-]+)$`, 'i');
const name = z.string().trim().max(255).optional();
export const inspirationAttachmentInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('link'), url: z.string().trim().url().max(2048).refine((value) => /^https?:\/\//i.test(value), 'Use an HTTP or HTTPS link'), name }).strict(),
  z.object({ type: z.literal('image'), key: z.string().min(1).max(1024), name,
    contentType: z.string().trim().max(255).regex(IMAGE_CONTENT_TYPE), size: z.number().int().positive().max(MAX_ATTACHMENT_UPLOAD_BYTES) }).strict(),
  z.object({ type: z.literal('audio'), key: z.string().min(1).max(1024), name,
    contentType: z.string().trim().max(255).refine((value) => value.toLowerCase().startsWith('audio/') && ALLOWED_ATTACHMENT_CONTENT_TYPE.test(value), 'Unsupported recording format'),
    size: z.number().int().positive().max(MAX_ATTACHMENT_UPLOAD_BYTES) }).strict(),
  /* A FILE IN A NOTE (2026-10-15). Same shape and the same HEAD check as a
     photo (`prepareInspirationAttachments`); no machine reading, so it is
     recorded `unavailable` rather than queued. */
  z.object({ type: z.literal('file'), key: z.string().min(1).max(1024), name,
    contentType: z.string().trim().max(255).refine((value) => isAllowedFileContentType(value) && ALLOWED_ATTACHMENT_CONTENT_TYPE.test(value), 'Unsupported file type'),
    size: z.number().int().positive().max(MAX_ATTACHMENT_UPLOAD_BYTES) }).strict(),
]);
export type InspirationAttachmentInput = z.infer<typeof inspirationAttachmentInputSchema>;
