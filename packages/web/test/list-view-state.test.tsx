// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/data` supplies small archives
 * and delayed reloads; `lib/api` supplies deleted rows; `lib/api/conversations`
 * supplies chats. `helpers/archive` mounts the real recorder provider. Real
 * lists and profile view memory run. JSDOM supplies scrollTop, not layout. */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Archive } from './helpers/archive';
import { ConversationsOverlay } from '../src/components/ConversationsOverlay';
import { useProfileListViews } from '../src/lib/list-view-state';
import { listConversations } from '../src/lib/api/conversations';

const pending = vi.hoisted(() => ({ hold: false, release: null as (() => void) | null, searchRelease: null as (() => void) | null }));
vi.mock('../src/lib/data', async original => {
  const row = (id: string, category: string) => ({ id, preview: `${category} idea`, text: `${category} idea`, category,
    capturedMs: Date.now(), updatedMs: Date.now(), attachments: [], reflections: [] });
  const rows = [row('one', 'Work'), row('two', 'Life')];
  return { ...await original<typeof import('../src/lib/data')>(),
    loadInspirations: async () => {
      if (pending.hold) await new Promise<void>(resolve => { pending.release = resolve; });
      return { inspirations: rows, total: rows.length, short: false };
    },
    loadInspiration: async (id: string) => rows.find(row => row.id === id),
  };
});
vi.mock('../src/lib/api', async original => ({ ...await original<typeof import('../src/lib/api')>(), listDeletedInspirations: async () => [],
  fetchInspirationPage: async ({ q, category }: { q?: string; category?: string }) => {
    if (pending.hold) await new Promise<void>(resolve => { pending.searchRelease = resolve; });
    const rows = ['Work', 'Life'].filter(name => (!q || `${name} idea`.toLowerCase().includes(q.toLowerCase())) && (!category || name === category))
      .map(name => ({ id: name === 'Work' ? 'one' : 'two', category: name, textPreview: `${name} idea`, kind: 'note', source: 'app', visibility: 'private',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), attachmentSummary: [], reflectionCount: 0 }));
    return { inspirations: rows, total: rows.length };
  },
}));
vi.mock('../src/lib/api/conversations', async original => ({ ...await original<typeof import('../src/lib/api/conversations')>(),
  listConversations: vi.fn(async (profileId: string) => ({ profileId, generationEnabled: false,
    conversations: [{ id: `${profileId}-chat`, profileId, revision: 1, preview: 'Walk ideas', updatedAt: new Date().toISOString() }] })),
}));

let root: Root, host: HTMLDivElement, closeNote: (() => void) | null;
function Lists({ account = 'account', profile = 'noah', tab = 'inspirations' }: { account?: string; profile?: string; tab?: 'inspirations' | 'chats' | 'home' }) {
  const scope = { accountId: account, profileId: profile };
  const views = useProfileListViews(scope);
  return tab === 'home' ? null : tab === 'inspirations'
    ? <Archive key={`${account}:${profile}:saves`} scope={scope} profileId={profile} viewState={views.inspirations}
        locale="en-US" title="Inspirations" onClose={() => {}} onNoteOpen={closer => { closeNote = closer; }} />
    : <ConversationsOverlay key={`${account}:${profile}:chats`} profileId={profile} viewState={views.chats}
        locale="en-US" title="Chats" onClose={() => {}} onOpen={() => {}} />;
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); pending.hold = false; pending.release = null; pending.searchRelease = null; closeNote = null;
  localStorage.clear(); vi.mocked(listConversations).mockClear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
async function settleSearch() { await act(async () => { await vi.advanceTimersByTimeAsync(201); }); }
async function show(props: Parameters<typeof Lists>[0] = {}) { await act(async () => root.render(<Lists {...props} />)); await settleSearch(); }
async function search(value: string) {
  await act(async () => {
    const input = host.querySelector('input')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(201); });
}
const surface = () => host.querySelector<HTMLDivElement>('.waka-over')!;
async function scrollTo(top: number) { await act(async () => { surface().scrollTop = top; surface().dispatchEvent(new Event('scroll')); }); }
async function category(name: string) { await act(async () => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(tab => tab.textContent === name)!.click()); await settleSearch(); }

it('restores independent searches, filters and scroll across tabs, including after an async reload', async () => {
  await show(); await search('idea'); await category('Work'); await scrollTo(420);
  await show({ tab: 'chats' }); await search('walk'); await scrollTo(180);
  pending.hold = true; await show();
  expect(host.querySelector('input')?.value).toBe('idea');
  expect(surface().scrollTop).toBe(420); // Cached results restore immediately during the refresh.
  expect(host.textContent).toContain('Work idea');
  await act(async () => { pending.hold = false; pending.release?.(); pending.searchRelease?.(); }); await settleSearch();
  expect(surface().scrollTop).toBe(420);
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Work');
  expect(host.textContent).toContain('Work idea'); expect(host.textContent).not.toContain('Life idea');
  await show({ tab: 'chats' });
  expect(host.querySelector('input')?.value).toBe('walk'); expect(surface().scrollTop).toBe(180);
  expect(vi.mocked(listConversations).mock.lastCall?.[2]).toBe('walk');
  await search('other'); expect(surface().scrollTop).toBe(0);
});

it('keeps each profile independent and clears preferences when the account changes', async () => {
  await show(); await search('Work'); await scrollTo(220);
  await show({ profile: 'anotherone' });
  expect(host.querySelector('input')?.value).toBe(''); expect(surface().scrollTop).toBe(0);
  await search('Life'); await scrollTo(90);
  await show(); expect(host.querySelector('input')?.value).toBe('Work'); expect(surface().scrollTop).toBe(220);
  await show({ profile: 'anotherone' }); expect(host.querySelector('input')?.value).toBe('Life'); expect(surface().scrollTop).toBe(90);
  await show({ account: 'other-account' }); expect(host.querySelector('input')?.value).toBe(''); expect(surface().scrollTop).toBe(0);
  await show(); expect(host.querySelector('input')?.value).toBe('');
});

it('retains list position through an opened note and resets it when the filter changes', async () => {
  await show(); await scrollTo(350);
  await act(async () => host.querySelector<HTMLButtonElement>('.waka-list-row')!.click());
  expect(closeNote).not.toBeNull(); await scrollTo(20);
  await act(async () => closeNote?.()); expect(surface().scrollTop).toBe(350);
  await category('Life'); expect(surface().scrollTop).toBe(0);
});
