// @vitest-environment jsdom
/**
 * A SHARE FROM OUTSIDE IS OFFERED, NOT TAKEN.
 *
 * `/share` can be opened by any page on the web with words of its choosing,
 * so what it hands the home must never touch the person's notepad — whose
 * draft is kept on this device — without a press. It arrives in the
 * creature's bubble with a short preview: "Add words" puts it in the notepad
 * (after anything already written there), "Not this" drops it, and only Save
 * keeps it.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `lib/data` and `lib/api` via
 * `dataMockFrom` / `apiMockFrom` — the seams Home reads through — and
 * `createInspiration`, recorded, so a save on arrival would show, and
 * `fetchProfiles`, so an agent's wall can be stood on.
 * `lib/auth-context` states the owner. `helpers/canvas-stub` and
 * `helpers/render-home` replace drawing and time.
 */
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { SHARED_KEY } from '../src/components/ShareArrival';
import { installCanvasStub, setViewport } from './helpers/canvas-stub';
import { mountWorld, dataMockFrom, apiMockFrom, VIEWER_ID, type MountedWorld } from './helpers/render-home';

const FACTS = vi.hoisted(() => ({ inspirations: [] as Array<{ id: string; text: string; daysAgo: number }> }));
const created = vi.hoisted(() => ({ calls: [] as unknown[] }));
const AGENTS = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock('../src/lib/data', async (original) => ({ ...await original<typeof import('../src/lib/data')>(), ...dataMockFrom(FACTS) }));
vi.mock('../src/lib/api', async (original) => ({ ...await original<typeof import('../src/lib/api')>(), ...apiMockFrom(FACTS),
  createInspiration: async (input: unknown) => { created.calls.push(input); throw new Error('not in this test'); },
  fetchProfiles: async () => AGENTS.rows }));
vi.mock('../src/lib/auth-context', async (original) => {
  const session = { status: 'authenticated', account: { id: 'account-1', email: 'you@example.test' },
    profile: { id: VIEWER_ID, name: 'You', type: 'human' }, profiles: [], refresh: async () => undefined, signOut: async () => undefined };
  return { ...await original<typeof import('../src/lib/auth-context')>(), useOptionalAuth: () => session, useAuth: () => session };
});

let world: MountedWorld;
beforeAll(() => { installCanvasStub(); setViewport(390, 844); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); created.calls = []; AGENTS.rows = [];
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => { world?.unmount(); vi.useRealTimers(); });
async function settle() {
  for (let turn = 0; turn < 8; turn += 1) { await world.step(100); await act(async () => { await vi.advanceTimersByTimeAsync(100); }); }
}
function share(text: string, url = '') {
  sessionStorage.setItem(SHARED_KEY, JSON.stringify({ title: '', text, url, via: 'share', at: Date.now() }));
}

const bubbleText = () => world.container.querySelector('.jar-char-bubble')?.textContent ?? '';
const field = () => world.container.querySelector<HTMLTextAreaElement>('textarea.jar-composer-text');
async function press(label: string) {
  const button = [...world.container.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label);
  expect(button, `no control named ${label}`).toBeTruthy();
  await act(async () => { button!.click(); });
  await settle();
}

it('offers the share in the bubble and leaves the notepad alone until asked', async () => {
  share('a line someone sent me', 'https://example.com/post');
  world = await mountWorld(FACTS); await settle();
  expect(bubbleText()).toContain('Want to say why?');
  expect(bubbleText()).toContain('a line someone sent me');
  expect(field(), 'the notepad opened with the share before any press').toBeNull();
  expect(sessionStorage.getItem(SHARED_KEY), 'the share was left to be taken twice').toBeNull();
  expect(created.calls).toEqual([]);
  await press('Add words');
  expect(field()!.value).toBe('a line someone sent me\nhttps://example.com/post');
  expect(created.calls, 'the share was saved without a press').toEqual([]);
});

it('drops the share on Not this, and the draft never sees it', async () => {
  share('words from a page I did not choose');
  world = await mountWorld(FACTS); await settle();
  expect(bubbleText()).toContain('Want to say why?');
  await press('Not this');
  expect(bubbleText()).not.toContain('words from a page');
  expect(field()).toBeNull();
  expect(JSON.stringify({ ...localStorage })).not.toContain('words from a page');
});

it('puts the share after what is already in the notepad, not over it', async () => {
  world = await mountWorld(FACTS, { initialEntries: ['/?compose=1'] }); await settle();
  const typed = field()!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(typed, 'half a thought');
    typed.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
  world.unmount();
  share('https://example.com/later');
  world = await mountWorld(FACTS); await settle();
  await press('Add words');
  expect(field()?.value).toBe('half a thought\n\nhttps://example.com/later');
});

it('ignores a share left behind long ago', async () => {
  sessionStorage.setItem(SHARED_KEY, JSON.stringify({ title: '', text: 'stale', url: '', via: 'share', at: Date.now() - 60 * 60 * 1000 }));
  world = await mountWorld(FACTS); await settle();
  expect(bubbleText()).not.toContain('stale');
  expect(field()?.value ?? '').not.toContain('stale');
});

it('offers a waiting share on human Home after a retired profile link, without putting it in a draft', async () => {
  share('words for my memory');
  world = await mountWorld(FACTS, { initialEntries: ['/w/agent-noah'] }); await settle();
  expect(bubbleText()).toContain('words for my memory');
  expect(field()?.value ?? '').not.toContain('words for my memory');
  expect([...world.container.querySelectorAll('button')].some(node => node.textContent?.trim() === 'Add words')).toBe(true);
});
