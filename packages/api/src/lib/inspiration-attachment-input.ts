import { z } from 'zod';

export const MAX_INSPIRATION_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_UPLOAD_BYTES = 25 * 1024 * 1024;
export const ALLOWED_ATTACHMENT_CONTENT_TYPE = /^(image\/[a-z0-9.+-]+|audio\/(webm|mp4|mpeg|wav|x-wav|ogg)(;\s*codecs=[a-z0-9., _-]+)?|application\/(pdf|zip|json|octet-stream)|text\/[a-z0-9.+-]+)$/i;
const name = z.string().trim().max(255).optional();
export const inspirationAttachmentInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('link'), url: z.string().trim().url().max(2048).refine((value) => /^https?:\/\//i.test(value), 'Use an HTTP or HTTPS link'), name }).strict(),
  z.object({ type: z.literal('image'), key: z.string().min(1).max(1024), name,
    contentType: z.string().trim().max(255).regex(/^image\/[a-z0-9.+-]+$/i), size: z.number().int().positive().max(MAX_ATTACHMENT_UPLOAD_BYTES) }).strict(),
  z.object({ type: z.literal('audio'), key: z.string().min(1).max(1024), name,
    contentType: z.string().trim().max(255).refine((value) => value.toLowerCase().startsWith('audio/') && ALLOWED_ATTACHMENT_CONTENT_TYPE.test(value), 'Unsupported recording format'),
    size: z.number().int().positive().max(MAX_ATTACHMENT_UPLOAD_BYTES) }).strict(),
]);
export type InspirationAttachmentInput = z.infer<typeof inspirationAttachmentInputSchema>;
