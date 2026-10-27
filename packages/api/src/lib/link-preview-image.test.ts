/** WHAT THIS MOCKS, AND WHY (gate G6): `node:dns/promises` supplies changing
 * answers, `undici` captures the connector configuration, and its package fetch supplies
 * bounded image responses. Real URL/redirect/size checks run without network. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const control = vi.hoisted(() => ({ lookup: vi.fn(), options: [] as Array<{ connect: { lookup: (host: string, options: { all?: boolean }, callback: (error: null, value: unknown, family?: number) => void) => void } }>, destroy: vi.fn(async () => undefined) }));
vi.mock('node:dns/promises', () => ({ lookup: control.lookup }));
vi.mock('undici', () => ({ fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args), Agent: class { constructor(options: typeof control.options[number]) { control.options.push(options); } destroy = control.destroy; } }));
import { fetchLinkPreviewImage } from './signal-enrichment.js';
beforeEach(() => { control.lookup.mockReset(); control.options.length = 0; control.destroy.mockClear(); vi.stubEnv('WAKA_ENRICHMENT_ALLOWED_HOSTS', ''); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const imageResponse = (bytes = new Uint8Array([1, 2, 3]), contentType = 'image/png') => new Response(bytes, { headers: { 'Content-Type': contentType } });
it('pins the socket lookup to the checked DNS answer and releases its dispatcher', async () => {
  control.lookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]).mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(imageResponse()); vi.stubGlobal('fetch', fetcher);
  expect((await fetchLinkPreviewImage('https://preview.example/image')).bytes).toEqual(new Uint8Array([1, 2, 3]));
  const connected = vi.fn(); control.options[0]!.connect.lookup('preview.example', { all: true }, connected);
  expect(connected).toHaveBeenCalledWith(null, [{ address: '93.184.216.34', family: 4 }]);
  expect(control.lookup).toHaveBeenCalledOnce(); expect(control.destroy).toHaveBeenCalledOnce();
});
it('refuses private destinations, credentials and a redirect into loopback', async () => {
  const fetcher = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', fetcher);
  await expect(fetchLinkPreviewImage('http://127.0.0.1/private')).rejects.toThrow('private_address');
  await expect(fetchLinkPreviewImage('https://user:secret@93.184.216.34/image')).rejects.toThrow('credentials_in_url');
  expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockResolvedValue(new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/' } }));
  await expect(fetchLinkPreviewImage('https://93.184.216.34/image')).rejects.toThrow('private_address');
  expect(fetcher).toHaveBeenCalledOnce();
});
it('refuses HTML/SVG and oversized bodies instead of proxying active content', async () => {
  const fetcher = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', fetcher);
  for (const type of ['text/html', 'image/svg+xml']) {
    fetcher.mockResolvedValueOnce(imageResponse(undefined, type));
    await expect(fetchLinkPreviewImage('https://93.184.216.34/image')).rejects.toThrow('preview_image_unavailable');
  }
  fetcher.mockResolvedValueOnce(imageResponse(new Uint8Array(2 * 1024 * 1024 + 1)));
  await expect(fetchLinkPreviewImage('https://93.184.216.34/image')).rejects.toThrow('preview_image_too_large');
});
