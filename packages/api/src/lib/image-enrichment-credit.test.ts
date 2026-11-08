/** WHAT THIS MOCKS, AND WHY: the S3 client hands back fixed image bytes and
 * the global fetch plays the model provider. The real `enrichImageAttachment`
 * and `describeImage` decide the verdict, so this pins the end-to-end rule:
 * a screenshot read while the provider account is out of credit (HTTP 402)
 * rests as `failed` — the state queue backoff and inspiration recovery read
 * again — never as `unavailable`, which nothing ever revisits. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
vi.mock('./s3-client.js', () => ({ makeAttachmentsS3Client: () => ({
  send: async () => ({ Body: { transformToByteArray: async () => PNG }, ContentType: 'image/png' }),
}) }));

const { enrichImageAttachment } = await import('./signal-enrichment.js');
type Row = Parameters<typeof enrichImageAttachment>[0];
const image = { id: '00000000-0000-4000-8000-000000000001', type: 'image', url: 'https://bucket.test/owned/shot.png',
  s3Key: 'owned/shot.png', contentType: 'image/png' } as unknown as Row;

beforeEach(() => { vi.stubEnv('ATTACHMENTS_BUCKET', 'bucket'); vi.stubEnv('OPENROUTER_API_KEY', 'openrouter-key'); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('enrichImageAttachment', () => {
  it.each([402, 429, 503])('leaves an image read that hit HTTP %s retryable', async status => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Insufficient credits' } }), { status }));
    vi.stubGlobal('fetch', fetchFn);
    const verdict = await enrichImageAttachment(image);
    expect(fetchFn).toHaveBeenCalled();
    expect(verdict).toMatchObject({ status: 'failed' });
    expect(verdict.reason).toContain(String(status));
    expect(verdict.reason).not.toContain('Insufficient credits');
  });

  it('marks a request the provider will never accept as unreadable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 400 })));
    expect(await enrichImageAttachment(image)).toMatchObject({ status: 'unavailable' });
  });
});
