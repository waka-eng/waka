// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/api` methods `fetchAttachmentDetails`
 * and `retryAttachmentAnalysis` stand in for HTTP only. The actual preview,
 * original-link fallback, bounded polling and response cancellation run. */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AttachmentPreview } from '../src/components/AttachmentPreview';
import { fetchAttachmentDetails, retryAttachmentAnalysis, type ApiAttachmentDetails } from '../src/lib/api';

vi.mock('../src/lib/api', async original => ({ ...await original<typeof import('../src/lib/api')>(),
  fetchAttachmentDetails: vi.fn(), retryAttachmentAnalysis: vi.fn(),
}));
let host: HTMLDivElement, root: Root, current: ApiAttachmentDetails;
beforeEach(() => {
  vi.resetAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  current = { attachment: { id: 'link', inspirationId: 'source', type: 'link', url: 'https://example.test/article',
    name: null, contentType: null, size: null, createdAt: new Date().toISOString(),
    enrichment: { status: 'ready', kind: 'page_body', text: 'Extracted page text', errorReason: null, updatedAt: null,
      image: null, link: { title: 'A place to think', description: 'A short introduction', siteName: 'Example journal',
        hostname: 'example.test', finalUrl: 'https://example.test/article', previewImageUrl: null } } }, previewImageAvailable: true,
    analysis: { status: 'ready', canRetry: false, retryAfter: null } };
  vi.mocked(fetchAttachmentDetails).mockImplementation(async () => current);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
const mount = (id = 'link', url = 'https://example.test/article') => act(async () => root.render(<AttachmentPreview item={{ id, type: 'link', label: url, url }} />));
const button = (label: string) => [...host.querySelectorAll('button')].find(item => item.textContent === label)!;

it('keeps the original usable during loading and metadata failure', async () => {
  let reject!: (reason: Error) => void;
  vi.mocked(fetchAttachmentDetails).mockImplementationOnce(() => new Promise((_done, fail) => { reject = fail; }));
  await mount();
  expect(host.textContent).toContain('Loading preview');
  expect(host.querySelector('a')?.href).toBe(current.attachment.url);
  await act(async () => reject(new Error('private provider text')));
  expect(host.querySelector('a')?.href).toBe(current.attachment.url);
  expect(host.textContent).toContain('Your original is kept');
  expect(host.textContent).not.toContain('private provider text');
  expect(retryAttachmentAnalysis).not.toHaveBeenCalled();
});
it('renders source metadata separately, using only the authenticated thumbnail route', async () => {
  await mount();
  expect(host.querySelector('h3')?.textContent).toContain('A place to think');
  expect(host.textContent).toContain('Example journal');
  expect(host.textContent).toContain('A short introduction');
  expect(host.querySelector('details')?.open).toBe(false);
  expect(host.querySelector('details')?.textContent).toContain('Extracted page text');
  expect(host.querySelector('img')?.getAttribute('src')).toBe('/api/attachments/link/preview-image');
  await act(async () => host.querySelector('img')!.dispatchEvent(new Event('error')));
  expect(host.querySelector('img')).toBeNull();
  expect(host.querySelector('a')?.href).toBe(current.attachment.url);
});
it('never automatically retries analysis, and retries only the selected attachment on request', async () => {
  current.analysis = { status: 'failed', canRetry: true, retryAfter: null };
  current.attachment.enrichment.errorReason = 'SECRET_PROVIDER_DETAIL';
  vi.mocked(retryAttachmentAnalysis).mockImplementation(async () => {
    current = { ...current, analysis: { status: 'pending', canRetry: false, retryAfter: null } }; return current;
  });
  await mount(); expect(retryAttachmentAnalysis).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain('SECRET_PROVIDER_DETAIL');
  await act(async () => button('Retry preview').click());
  expect(retryAttachmentAnalysis).toHaveBeenCalledWith('link', expect.any(AbortSignal));
  expect(host.textContent).toContain('Reading this link');
});
it('explains access-required pages without exposing error details', async () => {
  current.analysis = { status: 'unavailable', canRetry: true, retryAfter: null };
  current.attachment.enrichment.errorReason = 'http_403 secret';
  await mount(); expect(host.textContent).toContain('needs access');
  expect(host.textContent).not.toContain('http_403');
  expect(host.querySelector('a')?.href).toBe(current.attachment.url);
});
it.each(['javascript:alert(1)', 'https://user:password@example.test/'])('does not navigate unsafe original %s', async url => {
  current.attachment.url = url;
  await mount('link', url); expect(host.querySelector('a')).toBeNull();
});
it('does not show the previous attachment while a new attachment loads or accept its late response', async () => {
  await mount();
  let finish!: (value: ApiAttachmentDetails) => void;
  vi.mocked(fetchAttachmentDetails).mockImplementationOnce(() => new Promise(done => { finish = done; }));
  await mount('second', 'https://second.test/');
  expect(host.textContent).not.toContain('A place to think');
  expect(host.querySelector('a')?.href).toBe('https://second.test/');
  const oldSignal = vi.mocked(fetchAttachmentDetails).mock.calls.at(-1)?.[1];
  const third = { ...current, attachment: { ...current.attachment, id: 'third', url: 'https://third.test/' } };
  vi.mocked(fetchAttachmentDetails).mockResolvedValueOnce(third);
  await mount('third', 'https://third.test/');
  expect(oldSignal?.aborted).toBe(true);
  await act(async () => finish({ ...current, attachment: { ...current.attachment, id: 'second' } }));
  expect(host.querySelector('a')?.href).toBe('https://third.test/');
});
it('bounds read-only polling and offers an explicit check after waiting', async () => {
  vi.useFakeTimers(); Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  current.analysis = { status: 'pending', canRetry: false, retryAfter: null };
  await mount(); await act(async () => vi.advanceTimersByTimeAsync(90_000));
  expect(fetchAttachmentDetails).toHaveBeenCalledTimes(20);
  expect(button('Check preview')).toBeDefined(); expect(retryAttachmentAnalysis).not.toHaveBeenCalled();
});
