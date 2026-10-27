// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/data` supplies the initial archive
 * window and full-note reads; `lib/api` supplies paginated server matches and
 * mutations, with deliberately delayed replies. `helpers/archive` mounts the
 * real recorder; `helpers/note-actions` opens the real menu. Database search
 * and tenant isolation are covered separately by API SQL tests. */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Archive } from './helpers/archive';
import { openNoteActions } from './helpers/note-actions';
import { DOCK_SLOT } from '../src/components/NoteTools';
import { fetchInspirationPage, updateInspiration, type ApiInspirationPage, type ApiInspirationSummary } from '../src/lib/api';
import { invalidateSourceRequest } from '../src/lib/inspiration-snapshots';
import type { ListViewState } from '../src/lib/list-view-state';

vi.mock('../src/lib/data', async original => ({ ...await original<typeof import('../src/lib/data')>(),
  loadInspirations: async () => ({ total: 2100, short: true, inspirations: ['Work', 'Life'].map((category, index) => ({
    id: `recent-${index}`, category, preview: `${category} capture`, capturedMs: Date.now(), attachments: [],
  })) }),
  loadInspiration: async (id: string) => ({ id, preview: 'An older capture', text: 'Deep inside: needle', capturedMs: Date.now(), updatedMs: Date.now(), attachments: [], reflections: [] }),
}));
vi.mock('../src/lib/api', async original => ({ ...await original<typeof import('../src/lib/api')>(),
  fetchInspirationPage: vi.fn(), listDeletedInspirations: async () => [], updateInspiration: vi.fn(async () => ({})), deleteInspiration: vi.fn(async () => ({})),
}));

const summary = (id: string, textPreview = `Capture ${id}`): ApiInspirationSummary => ({ id, textPreview, category: 'Work', kind: 'note', source: 'app',
  visibility: 'private', createdAt: '2020-01-01T12:00:00Z', updatedAt: '2020-01-01T12:00:00Z', attachmentSummary: [], reflectionCount: 0 });
let root: Root, host: HTMLDivElement, profile: string, closeNote: (() => void) | null;
let memories: Map<string, ListViewState>;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); localStorage.clear(); profile = 'noah'; closeNote = null; memories = new Map();
  vi.mocked(fetchInspirationPage).mockReset().mockResolvedValue({ inspirations: [summary('older')], total: 1 });
  vi.mocked(updateInspiration).mockClear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
async function show(nextProfile = profile, visible = true) {
  profile = nextProfile;
  if (!memories.has(profile)) memories.set(profile, { query: '', category: null, onShelf: false, scrollTop: 0 });
  await act(async () => root.render(<><span id={DOCK_SLOT}/>{visible ? <Archive key={profile} profileId={profile}
    scope={{ accountId: 'account', profileId: profile }} viewState={memories.get(profile)} locale="en-US" title="Inspirations"
    onClose={() => {}} onNoteOpen={closer => { closeNote = closer; }} /> : null}</>));
}
async function settle() { await act(async () => { await vi.advanceTimersByTimeAsync(201); }); }
async function search(value: string) {
  await act(async () => {
    const input = host.querySelector('input')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }); await settle();
}
async function click(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label || node.getAttribute('aria-label') === label || node.querySelector('.waka-list-lead')?.textContent === label);
  expect(button, label).toBeTruthy(); await act(async () => button!.click());
}
const leads = () => [...host.querySelectorAll('.waka-list-lead')].map(node => node.textContent);

it('uses full-profile search even when words are outside the preview, opens older results, and clears all filters', async () => {
  await show(); await click('Work'); await search('needle');
  expect(vi.mocked(fetchInspirationPage).mock.lastCall?.[0]).toMatchObject({ profile: 'noah', q: 'needle', category: 'Work' });
  expect(leads()).toEqual(['Capture older']);
  expect(host.querySelector('.waka-list-index')).toBeNull(); // No invented ordinal for a result outside the initial window.
  await click('Capture older'); expect(host.querySelector('textarea')?.value).toBe('Deep inside: needle');
  await act(async () => closeNote?.()); expect(leads()).toEqual(['Capture older']);
  vi.mocked(fetchInspirationPage).mockResolvedValue({ inspirations: [], total: 0 });
  await search('absent'); await click('Clear filters');
  expect(host.querySelector('input')?.value).toBe('');
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('All');
  expect(leads()).toEqual(['Life capture', 'Work capture']); expect(document.activeElement).toBe(host.querySelector('input'));
});

it('paginates on demand, keeps existing results on a page failure, and restores loaded pages and scroll on return', async () => {
  let fail = true;
  vi.mocked(fetchInspirationPage).mockImplementation(async options => {
    if (!options?.cursor) return { inspirations: [summary('first')], total: 2, nextCursor: 'next-page' };
    if (fail) throw new Error('offline');
    return { inspirations: [summary('second')], total: 2 };
  });
  await show(); await search('needle'); expect(leads()).toEqual(['Capture first']);
  await click('More results'); expect(leads()).toEqual(['Capture first']); expect(host.querySelector('[role="alert"]')).not.toBeNull();
  fail = false; await click('Try again'); expect(leads()).toEqual(['Capture first', 'Capture second']);
  const list = host.querySelector<HTMLDivElement>('.waka-over')!;
  await act(async () => { list.scrollTop = 400; list.dispatchEvent(new Event('scroll')); });
  await show(profile, false); await show(); await settle();
  expect(leads()).toEqual(['Capture first', 'Capture second']); expect(host.querySelector('.waka-over')?.scrollTop).toBe(400);
});

it('ignores stale queries and late results after switching profiles', async () => {
  const pending: Array<{ options: Parameters<typeof fetchInspirationPage>[0]; resolve: (page: ApiInspirationPage) => void }> = [];
  vi.mocked(fetchInspirationPage).mockImplementation(options => new Promise(resolve => pending.push({ options, resolve })));
  await show(); await search('first'); await search('second');
  await act(async () => pending[1]!.resolve({ inspirations: [summary('current')] }));
  await act(async () => pending[0]!.resolve({ inspirations: [summary('stale')] }));
  expect(leads()).toEqual(['Capture current']);
  await search('third'); await show('anotherone'); await search('third');
  expect(pending.at(-1)?.options?.profile).toBe('anotherone');
  await act(async () => pending.at(-1)!.resolve({ inspirations: [summary('anotherone')] }));
  await act(async () => pending[2]!.resolve({ inspirations: [summary('noah-private')] }));
  expect(leads()).toEqual(['Capture anotherone']);
});

it('refreshes a search after an edit and keeps deleted results hidden through Undo', async () => {
  await show(); await search('needle'); await click('Capture older');
  await act(async () => {
    const input = host.querySelector('textarea')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Changed words');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  vi.mocked(fetchInspirationPage).mockResolvedValue({ inspirations: [], total: 0 });
  await act(async () => closeNote?.()); await settle();
  expect(updateInspiration).toHaveBeenCalledWith('older', { text: 'Changed words' }, { profile: 'noah' });
  expect(leads()).toEqual([]);
  vi.mocked(fetchInspirationPage).mockResolvedValue({ inspirations: [summary('older')], total: 1 });
  await search('changed'); await click('Capture older'); await openNoteActions(); await click('Delete');
  expect(leads()).toEqual([]);
  await click('Undo'); await settle(); expect(leads()).toEqual(['Capture older']);
});


it('restores results before the background read finishes and retains them with a retry if refresh fails', async () => {
  await show(); await search('needle'); await show(profile, false);
  let reject!: (error: Error) => void;
  vi.mocked(fetchInspirationPage).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  await show();
  expect(leads()).toEqual(['Capture older']);
  await settle();
  expect(leads()).toEqual(['Capture older']);
  await act(async () => reject(new Error('offline')));
  expect(leads()).toEqual(['Capture older']); expect(host.textContent).toContain('Showing previous results');
  vi.mocked(fetchInspirationPage).mockResolvedValueOnce({ inspirations: [summary('fresh')], total: 1 });
  await click('Try again'); await settle();
  expect(leads()).toEqual(['Capture fresh']);
});

it('never reuses cached results after a source write or a different account view', async () => {
  await show(); await search('needle'); await show(profile, false);
  invalidateSourceRequest('/api/inspirations/older');
  vi.mocked(fetchInspirationPage).mockResolvedValueOnce({ inspirations: [summary('updated')], total: 1 });
  await show(); expect(leads()).toEqual([]); await settle(); expect(leads()).toEqual(['Capture updated']);
  await show(profile, false);
  memories.set(profile, { query: 'needle', category: null, onShelf: false, scrollTop: 0 });
  vi.mocked(fetchInspirationPage).mockResolvedValueOnce({ inspirations: [], total: 0 });
  await show(); expect(leads()).toEqual([]); await settle(); expect(leads()).toEqual([]);
});
