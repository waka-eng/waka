// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/data` and `lib/api` supply the
 * world's layers (`helpers/render-home`'s fixtures), `lib/auth-context` the
 * session, and `lib/api/conversations` one committed conversation.
 * `helpers/render-home` and `helpers/canvas-stub` replace canvas, viewport and
 * clock; the real world, its pages and sheets render, and React Router history
 * runs. The rest reads `src` as text.
 *
 * THE NAVIGATION SYSTEM, LOCKED (2026-11-09). Founder: "still inconsistencies
 * like some parts just use < but some are < back and like certain headers and
 * things appear in certain places vs disappear in certain". The audit found
 * 52 such places; this suite is what keeps them from coming back:
 *
 *   - every page and sheet draws the ONE shared header: one left "<" named
 *     Back or Close, no word beside it, at most one right-hand item;
 *   - Escape on every page does exactly what its "<" does;
 *   - the corners (Me / My agent, i, settings) stand on home only, and the
 *     home bar on home only (and under the Kept sheet that rises from it). */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installCanvasStub, setViewport } from './helpers/canvas-stub';
import { mountWorld, dataMockFrom, apiMockFrom, pressHomeBar, VIEWER_ID, type MountedWorld } from './helpers/render-home';
import { createConversation, fetchConversation, listConversations, type ApiConversation } from '../src/lib/api/conversations';

const FACTS = vi.hoisted(() => ({ inspirations: [{ id: 'kept', text: 'A thought I kept', daysAgo: 1 }] }));
vi.mock('../src/lib/data', async (original) => ({ ...await original<typeof import('../src/lib/data')>(), ...dataMockFrom(FACTS) }));
vi.mock('../src/lib/api', async (original) => ({ ...await original<typeof import('../src/lib/api')>(), ...apiMockFrom(FACTS) }));
vi.mock('../src/lib/api/conversations', async (original) => ({
  ...await original<typeof import('../src/lib/api/conversations')>(), fetchConversation: vi.fn(), listConversations: vi.fn(), createConversation: vi.fn(),
}));
vi.mock('../src/lib/auth-context', async (original) => {
  const session = { status: 'authenticated', account: { id: 'account-1', email: 'you@example.test' },
    profile: { id: VIEWER_ID, name: 'You', type: 'human' }, profiles: [], refresh: async () => undefined, signOut: async () => undefined };
  return { ...await original<typeof import('../src/lib/auth-context')>(), useOptionalAuth: () => session, useAuth: () => session };
});

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
const CHAT = '22222222-2222-4222-8222-222222222222';
let world: MountedWorld | undefined, location: ReturnType<typeof useLocation>;
let go: ReturnType<typeof useNavigate>;
function RouterTools() { location = useLocation(); go = useNavigate(); return null; }
const where = () => {
  const query = new URLSearchParams(location.search);
  query.delete('t');
  return `${location.pathname}?${[...query].sort().map(([key, value]) => `${key}=${value}`).join('&')}`;
};
beforeAll(() => { installCanvasStub(); setViewport(390, 844); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const row: ApiConversation = { id: CHAT, profileId: VIEWER_ID, revision: 1, generationEnabled: true, createdAt: '2026-10-15T00:00:00Z', updatedAt: '2026-10-15T00:00:00Z',
    messages: [{ id: '33333333-3333-4333-8333-333333333333', profileId: VIEWER_ID, conversationId: CHAT, position: 1, role: 'user', content: 'An earlier chat', createdAt: '2026-10-15T00:00:00Z' }] };
  vi.mocked(listConversations).mockImplementation(async (profile) => ({ profileId: profile, generationEnabled: true,
    conversations: [{ id: CHAT, profileId: profile, revision: 1, updatedAt: '2026-10-15T00:00:00Z', preview: 'An earlier chat' }] } as Awaited<ReturnType<typeof listConversations>>));
  vi.mocked(fetchConversation).mockImplementation(async (_profile, id) => structuredClone(id === CHAT ? row : { ...row, id }));
  vi.mocked(createConversation).mockImplementation(async (profile, id) => ({ ...structuredClone(row), id, profileId: profile }));
});
afterEach(() => { world?.unmount(); world = undefined; vi.clearAllMocks(); vi.useRealTimers(); });
async function settle() {
  for (let turn = 0; turn < 8; turn += 1) { await world!.step(100); await act(async () => { await vi.advanceTimersByTimeAsync(100); }); }
}

const c = () => world!.container;
/** Headers on screen: not inside something hidden or inert. */
const headers = () => [...c().querySelectorAll<HTMLElement>('.waka-surface-head')]
  .filter(node => !node.closest('[hidden], [aria-hidden="true"], [inert]'));
const topBack = () => headers().at(-1)?.querySelector<HTMLButtonElement>('.waka-surface-back') ?? null;
function seen(node: Element): string {
  const copy = node.cloneNode(true) as Element;
  copy.querySelectorAll('.sr-only').forEach(part => part.remove());
  return copy.textContent?.trim() ?? '';
}

/** The one header rule, said once and asked of every surface. */
function expectOneHeader(what: string, { homeBar = false } = {}) {
  const heads = headers();
  expect(heads, `${what}: not exactly one shared header on screen`).toHaveLength(1);
  const head = heads[0]!;
  const backs = head.querySelectorAll<HTMLButtonElement>('.waka-surface-back');
  expect(backs, `${what}: not exactly one "<"`).toHaveLength(1);
  const glyph = backs[0]!;
  expect(head.firstElementChild, `${what}: the "<" is not on the left`).toBe(glyph);
  expect(['Back', 'Close'], `${what}: the "<" is named ${glyph.getAttribute('aria-label')}`).toContain(glyph.getAttribute('aria-label'));
  expect(seen(glyph), `${what}: a word is written beside the "<"`).toBe('');
  /* no "Back" or "Home" written anywhere in the row but the title */
  const row = head.cloneNode(true) as Element;
  row.querySelectorAll('.sr-only, .waka-surface-title').forEach(part => part.remove());
  expect(row.textContent ?? '', `${what}: "Back" or "Home" is written in the header`).not.toMatch(/\b(Back|Home)\b/);
  const right = head.querySelector('.waka-surface-right');
  expect(right?.children.length ?? 0, `${what}: more than one thing on the right`).toBeLessThanOrEqual(1);
  /* No other way back on screen: no floating "<", no "⌄ Home", no foot "Back". */
  expect(c().querySelector('.waka-page-back, .waka-stream-home, .waka-page-aside, .waka-sheet-back'), `${what}: an old way back came back`).toBeNull();
  expect(c().querySelector('.waka-corners'), `${what}: the corners stand over a surface that is not home`).toBeNull();
  if (homeBar) expect(c().querySelector('.waka-home-bar'), `${what}: the home bar left the sheet that rises from it`).not.toBeNull();
  else expect(c().querySelector('.waka-home-bar'), `${what}: the home bar stands on a page`).toBeNull();
  return glyph;
}

async function openSavedNote() {
  world = await mountWorld(FACTS, { initialEntries: ['/?open=saves'], routerTools: <RouterTools /> }); await settle();
  await act(async () => c().querySelector<HTMLButtonElement>('.waka-list-row')!.click()); await settle();
}
async function openChatFromPastChats() {
  world = await mountWorld(FACTS, { initialEntries: ['/?open=conversations'], routerTools: <RouterTools /> }); await settle();
  const row = [...c().querySelectorAll<HTMLButtonElement>('.waka-list-row')].find(b => b.textContent?.includes('An earlier chat'))!;
  await act(async () => row.click()); await settle();
}
async function openPastChatsFromAChat() {
  world = await mountWorld(FACTS, { routerTools: <RouterTools /> }); await settle();
  await pressHomeBar(c(), 'Chat'); await settle();
  await act(async () => c().querySelector<HTMLButtonElement>('.waka-surface-right .waka-surface-act')!.click()); await settle();
}
async function openAt(address: string) {
  world = await mountWorld(FACTS, { initialEntries: [address], routerTools: <RouterTools /> }); await settle();
}
async function openKeptSheet() {
  world = await mountWorld(FACTS, { routerTools: <RouterTools /> }); await settle();
  await act(async () => c().querySelector<HTMLButtonElement>('.waka-home-bar-pull')!.click()); await settle();
}

/* EVERY PAGE AND SHEET: [what, how to get there, its "<" name, its title, home bar under it]. */
const SURFACES: Array<[string, () => Promise<void>, 'Back' | 'Close', RegExp | null, boolean]> = [
  ['the Kept list', () => openAt('/?open=saves'), 'Close', /^Kept/, false],
  ['Past chats', () => openAt('/?open=conversations'), 'Close', /^Past chats$/, false],
  ['a new chat', () => openAt('/chat/new'), 'Close', /^Chat$/, false],
  ['a chat from Past chats', openChatFromPastChats, 'Back', /^Chat$/, false],
  ['Past chats from a chat', openPastChatsFromAChat, 'Back', /^Past chats$/, false],
  ['the notepad', () => openAt('/?compose=1'), 'Close', /^Saving to You · /, false],
  ['a saved note', openSavedNote, 'Back', /^You · /, false],
  ['Principles', () => openAt('/?open=principles'), 'Close', /^Principles$/, false],
  ['the Kept sheet', openKeptSheet, 'Close', /^Kept$/, true],
];

describe('every page and sheet draws the one header', () => {
  it.each(SURFACES)('%s', async (what, open, name, title, homeBar) => {
    await open();
    const glyph = expectOneHeader(what, { homeBar });
    expect(glyph.getAttribute('aria-label'), `${what}: the "<" says the wrong thing for what it does`).toBe(name);
    const shown = headers()[0]!.querySelector('h2.waka-surface-title:not(.sr-only)')?.textContent ?? '';
    if (title) expect(shown, `${what}: the title`).toMatch(title);
  });

  it('home has no header, and is the one place the corners and the home bar stand', async () => {
    await openAt('/');
    expect(headers(), 'a header stands on home').toHaveLength(0);
    expect(c().querySelector('.waka-corners'), 'the corners left home').not.toBeNull();
    expect(c().querySelector('.waka-home-bar'), 'the home bar left home').not.toBeNull();
  });

  it('keeps "Past chats" the one word top right of a chat, and nothing top right of the notepad or the Kept list', async () => {
    await openAt('/chat/new');
    expect(headers()[0]!.querySelector('.waka-surface-right')?.textContent).toBe('Past chats');
    world!.unmount();
    await openAt('/?compose=1');
    expect(headers()[0]!.querySelector('.waka-surface-right')?.children.length ?? 0).toBe(0);
    world!.unmount();
    await openAt('/?open=saves');
    expect(headers()[0]!.querySelector('.waka-surface-right')?.textContent ?? '', 'Keep a thought came back to the Kept list').toBe('');
  });
});

/* ESCAPE IS THE "<": the same surface opened twice, left once by each, must
   land in the same place. */
describe('Escape goes exactly where the "<" goes', () => {
  const CASES: Array<[string, () => Promise<void>]> = [
    ['a saved note (to its list)', openSavedNote],
    ['a chat opened from Past chats (back to them)', openChatFromPastChats],
    ['Past chats opened from a chat (back to it)', openPastChatsFromAChat],
    ['the Kept list (home)', () => openAt('/?open=saves')],
    ['Principles (home)', () => openAt('/?open=principles')],
    ['an empty notepad (home)', () => openAt('/?compose=1')],
  ];
  it.each(CASES)('%s', async (what, open) => {
    await open();
    await act(async () => topBack()!.click()); await settle();
    const byGlyph = where();
    const sheetByGlyph = Boolean(c().querySelector('.waka-stream'));
    world!.unmount(); world = undefined;
    await open();
    const target = document.activeElement && headers().at(-1)?.closest('[data-jar-surface]')?.contains(document.activeElement)
      ? document.activeElement : headers().at(-1)!.closest('[data-jar-surface]') ?? headers().at(-1)!;
    await act(async () => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))); await settle();
    expect(where(), `${what}: Escape went somewhere the "<" does not`).toBe(byGlyph);
    expect(Boolean(c().querySelector('.waka-stream')), `${what}: Escape and the "<" disagree about the sheet`).toBe(sheetByGlyph);
  });
});

/* THE PLACES THAT NEVER RENDERED IN A BROWSER-LESS WORLD, held in the source. */
describe('the source keeps one system', () => {
  function files(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) files(path, out);
      else if (/\.(tsx?|css)$/.test(name)) out.push(path);
    }
    return out;
  }
  const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  it('has no second way back left anywhere', () => {
    const offenders = files(SRC).filter(path => /<PageBack\b|<SheetBack\b|waka-page-back|waka-sheet-back|waka-stream-home|waka-page-aside|belowCorners|glyphOnly/
      .test(code(readFileSync(path, 'utf8'))));
    expect(offenders.map(path => path.slice(SRC.length + 1))).toEqual([]);
  });

  it('gives every surface the shared header (the orb panel on the ground excepted)', () => {
    const missing = files(SRC).filter(path => path.endsWith('.tsx')).flatMap(path => {
      const text = code(readFileSync(path, 'utf8'));
      const surfaces = (text.match(/<DialogSurface\b/g) ?? []).length;
      if (!surfaces) return [];
      const heads = (text.match(/<SurfaceHeader\b|<NotePage\b/g) ?? []).length;
      /* Home's third surface is `jar-panel`, the orb panel on the ground:
         furniture with its own step carets, released by Escape (audit S14). */
      const exempt = path.endsWith('pages/Home.tsx') ? 1 : 0;
      return heads >= surfaces - exempt ? [] : [path.slice(SRC.length + 1)];
    });
    expect(missing).toEqual([]);
  });

  it('reads the corners off one boolean, and that boolean means home', () => {
    const home = code(readFileSync(join(SRC, 'pages/Home.tsx'), 'utf8'));
    expect(home).toMatch(/const homeChromeShown = atNowView && !reviewing && !streamShown/);
    expect(home.match(/hidden=\{!homeChromeShown\}/g), 'a corner cluster has its own hide list again').toHaveLength(2);
  });

  it('never fills a control in a bar, focused or not', () => {
    const css = code(readFileSync(join(SRC, 'styles/claims.css'), 'utf8'));
    const ring = /\.waka-home-bar button:focus-visible, \.waka-note-bar button:focus-visible[^{]*\{([^}]*)\}/.exec(css);
    expect(ring, 'the bars lost their thin focus ring').not.toBeNull();
    expect(ring![1]).toMatch(/background:\s*none/);
    expect(ring![1]).toMatch(/box-shadow:\s*0 0 0 1px/);
  });
});
