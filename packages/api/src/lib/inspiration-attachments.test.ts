/** WHAT THIS MOCKS, AND WHY (gate G6): `AttachmentHead` returns scripted S3 metadata;
 * schema, owner-prefix checks and preparation run unchanged. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInspirationSchema } from '../routes/inspirations-validation.js';
import { prepareInspirationAttachments, type AttachmentHead } from './inspiration-attachments.js';
import { ALLOWED_ATTACHMENT_CONTENT_TYPE } from './inspiration-attachment-input.js';
const owner = { uploaderProfileId: 'profile-a', profileId: 'profile-a', inspirationId: 'inspiration-a' };
const audio = { type: 'audio' as const, key: 'profiles/profile-a/attachments/123-voice.webm', name: 'Recording.webm', contentType: 'audio/webm;codecs=opus', size: 120 };
afterEach(() => vi.unstubAllEnvs());

describe('one capture manifest', () => {
  it('accepts an attachment-only source without manufacturing a text placeholder', () => {
    expect(createInspirationSchema.parse({ attachments: [audio] }).text).toBe('');
    expect(createInspirationSchema.parse({ text: '  ', attachments: [{ type: 'link', url: 'https://example.test/note' }] }).text).toBe('');
    expect(createInspirationSchema.safeParse({ text: '' }).success).toBe(false);
    expect(createInspirationSchema.safeParse({ text: ' ', attachments: [] }).success).toBe(false);
  });
  it('refuses duplicates, unsafe links, oversized uploads and mismatched formats', () => {
    expect(createInspirationSchema.safeParse({ attachments: [audio, audio] }).success).toBe(false);
    expect(createInspirationSchema.safeParse({ attachments: [{ type: 'link', url: 'javascript:alert(1)' }] }).success).toBe(false);
    expect(createInspirationSchema.safeParse({ attachments: [{ ...audio, size: 26 * 1024 * 1024 }] }).success).toBe(false);
    expect(createInspirationSchema.safeParse({ attachments: [{ ...audio, contentType: 'application/octet-stream' }] }).success).toBe(false);
    expect(ALLOWED_ATTACHMENT_CONTENT_TYPE.test('audio/webm;codecs=opus')).toBe(true);
    expect(ALLOWED_ATTACHMENT_CONTENT_TYPE.test('audio/mp4')).toBe(true);
    expect(ALLOWED_ATTACHMENT_CONTENT_TYPE.test('application/x-msdownload')).toBe(false);
  });
  it('checks the uploader before S3 and refuses traversal within their prefix', async () => {
    const head = vi.fn<AttachmentHead>();
    await expect(prepareInspirationAttachments([{ ...audio, key: 'profiles/other/attachments/1.webm' }], owner, head)).rejects.toMatchObject({ status: 403 });
    await expect(prepareInspirationAttachments([{ ...audio, key: 'profiles/profile-a/attachments/../other.webm' }], owner, head)).rejects.toMatchObject({ status: 403 });
    expect(head).not.toHaveBeenCalled();
  });
  it('requires exact uploaded byte length and content type before a source can claim to be saved', async () => {
    vi.stubEnv('ATTACHMENTS_BUCKET', 'unit-fixture');
    const head = vi.fn<AttachmentHead>().mockResolvedValueOnce({ ContentLength: 119, ContentType: audio.contentType })
      .mockResolvedValueOnce({ ContentLength: 120, ContentType: 'image/png' });
    await expect(prepareInspirationAttachments([audio], owner, head)).rejects.toMatchObject({ code: 'attachment_upload_mismatch' });
    await expect(prepareInspirationAttachments([audio], owner, head)).rejects.toMatchObject({ code: 'attachment_upload_mismatch' });
  });
  it('keeps storage uncertainty retryable instead of accepting an unverified upload', async () => {
    vi.stubEnv('ATTACHMENTS_BUCKET', 'unit-fixture');
    const head = vi.fn<AttachmentHead>().mockRejectedValueOnce(new Error('Transport failed')).mockRejectedValueOnce({ name: 'NotFound' });
    await expect(prepareInspirationAttachments([audio], owner, head)).rejects.toMatchObject({ status: 503, code: 'attachment_unverified' });
    await expect(prepareInspirationAttachments([audio], owner, head)).rejects.toMatchObject({ status: 404, code: 'attachment_upload_missing' });
  });
  it('binds uploaded bytes to the target profile without claiming a transcription job exists', async () => {
    vi.stubEnv('ATTACHMENTS_BUCKET', 'unit-fixture');
    const rows = await prepareInspirationAttachments([audio], { ...owner, profileId: 'owned-agent' }, async () => ({ ContentLength: 120, ContentType: audio.contentType }));
    expect(rows[0]).toMatchObject({ profileId: 'owned-agent', inspirationId: owner.inspirationId, type: 'audio', enrichmentStatus: 'unavailable', s3Key: audio.key });
  });
});
