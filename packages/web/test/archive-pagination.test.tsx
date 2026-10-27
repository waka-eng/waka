// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/api` supplies cursor pages and
 * full originals. `helpers/archive` provides the real recorder. Real data
 * conversion, pagination, categories and note navigation run together. */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Archive } from './helpers/archive';
import { fetchInspirationPage, fetchInspiration, type ApiInspirationPage } from '../src/lib/api';
vi.mock('../src/lib/api', async original => ({ ...await original<typeof import('../src/lib/api')>(),
  fetchInspirationPage: vi.fn(), fetchInspiration: vi.fn(), listDeletedInspirations: async () => [],
}));
const summary = (id: string) => ({ id, textPreview: `Note ${id}`, kind: 'note' as const, source: 'app' as const,
  visibility: 'private' as const, createdAt: '2026-10-01T12:00:00Z', updatedAt: '2026-10-01T12:00:00Z', attachmentSummary: [], reflectionCount: 0 });
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); localStorage.clear(); vi.mocked(fetchInspirationPage).mockReset(); vi.mocked(fetchInspiration).mockReset();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.mocked(fetchInspirationPage).mockResolvedValue({ inspirations: Array.from({ length: 50 }, (_, n) => summary(`first-${n}`)), total: 120, nextCursor: 'older', categories: ['Recent', 'Older category'] });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
async function show(profile = 'noah', note?: string) {
  await act(async () => root.render(<Archive key={profile} profileId={profile} scope={{ accountId: 'account', profileId: profile }}
    locale="en-US" title="Inspirations" note={note} onClose={() => {}} onNoteAddress={() => {}} />));
}
async function click(name: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === name)!;
  expect(button).toBeTruthy(); await act(async () => button.click());
}
it('fetches and renders only 50 first, adds older pages on demand, and retains rows on failure', async () => {
  await show();
  expect(fetchInspirationPage).toHaveBeenCalledTimes(1);
  expect(vi.mocked(fetchInspirationPage).mock.lastCall?.[0]).toMatchObject({ profile: 'noah', limit: 50, includeCategories: true });
  expect(host.querySelectorAll('.waka-list-row')).toHaveLength(50);
  expect(host.querySelector('.waka-list-index')?.textContent).toBe('#120');
  vi.mocked(fetchInspirationPage).mockRejectedValueOnce(new Error('offline'));
  await click('More inspirations');
  expect(host.querySelectorAll('.waka-list-row')).toHaveLength(50);
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  vi.mocked(fetchInspirationPage).mockResolvedValueOnce({ inspirations: [summary('old')], total: 120 });
  await click('Try again');
  expect(vi.mocked(fetchInspirationPage).mock.lastCall?.[0]).toMatchObject({ cursor: 'older', limit: 50, profile: 'noah' });
  expect(host.querySelectorAll('.waka-list-row')).toHaveLength(51);
  expect(host.textContent).not.toContain('More inspirations');
});
it('keeps categories from older pages available and applies them on the server', async () => {
  await show();
  vi.mocked(fetchInspirationPage).mockResolvedValueOnce({ inspirations: [summary('very-old')], total: 1 });
  await click('Older category'); await act(async () => { await vi.advanceTimersByTimeAsync(201); });
  expect(vi.mocked(fetchInspirationPage).mock.lastCall?.[0]).toMatchObject({ category: 'Older category', profile: 'noah' });
  expect(host.querySelectorAll('.waka-list-row')).toHaveLength(1);
  expect(host.textContent).toContain('Note very-old');
});
it('opens an older linked original without downloading intervening pages', async () => {
  vi.mocked(fetchInspiration).mockResolvedValue({ ...summary('linked'), profileId: 'noah', text: 'The complete older original', attachments: [], reflections: [] });
  await show('noah', 'linked');
  expect(fetchInspirationPage).toHaveBeenCalledTimes(1);
  expect(vi.mocked(fetchInspiration).mock.calls.every(([id, options]) => id === 'linked' && options?.profile === 'noah')).toBe(true);
  expect(host.querySelector('textarea')?.value).toBe('The complete older original');
});
it('ignores an older-page response after switching profiles', async () => {
  await show();
  let resolve!: (page: ApiInspirationPage) => void;
  vi.mocked(fetchInspirationPage).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await click('More inspirations');
  vi.mocked(fetchInspirationPage).mockResolvedValueOnce({ inspirations: [summary('anotherone')], total: 1 });
  await show('anotherone');
  await act(async () => resolve({ inspirations: [summary('noah-private')], total: 120 }));
  expect(host.textContent).toContain('Note anotherone'); expect(host.textContent).not.toContain('noah-private');
});
