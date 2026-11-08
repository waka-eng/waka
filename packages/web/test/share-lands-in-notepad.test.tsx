// @vitest-environment jsdom
/**
 * A SHARE FROM OUTSIDE LANDS IN THE NOTEPAD, AND WAITS FOR SAVE.
 *
 * `/share` can be opened by any page on the web with words of its choosing,
 * so what it hands the home must never be kept on arrival: it goes into the
 * notepad, after anything already written there, and only Save keeps it.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `lib/data` and `lib/api` via
 * `dataMockFrom` / `apiMockFrom` — the seams Home reads through — and
 * `createInspiration`, recorded, so a save on arrival would show.
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
vi.mock('../src/lib/data', async (original) => ({ ...await original<typeof import('../src/lib/data')>(), ...dataMockFrom(FACTS) }));
vi.mock('../src/lib/api', async (original) => ({ ...await original<typeof import('../src/lib/api')>(), ...apiMockFrom(FACTS),
  createInspiration: async (input: unknown) => { created.calls.push(input); throw new Error('not in this test'); } }));
vi.mock('../src/lib/auth-context', async (original) => {
  const session = { status: 'authenticated', account: { id: 'account-1', email: 'you@example.test' },
    profile: { id: VIEWER_ID, name: 'You', type: 'human' }, profiles: [], refresh: async () => undefined, signOut: async () => undefined };
  return { ...await original<typeof import('../src/lib/auth-context')>(), useOptionalAuth: () => session, useAuth: () => session };
});

let world: MountedWorld;
beforeAll(() => { installCanvasStub(); setViewport(390, 844); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); created.calls = [];
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => { world?.unmount(); vi.useRealTimers(); });
async function settle() {
  for (let turn = 0; turn < 8; turn += 1) { await world.step(100); await act(async () => { await vi.advanceTimersByTimeAsync(100); }); }
}
function share(text: string, url = '') {
  sessionStorage.setItem(SHARED_KEY, JSON.stringify({ title: '', text, url, via: 'share', at: Date.now() }));
}

it('opens the notepad with what was shared, and keeps nothing until Save', async () => {
  share('a line someone sent me', 'https://example.com/post');
  world = await mountWorld(FACTS); await settle();
  const field = world.container.querySelector<HTMLTextAreaElement>('textarea.jar-composer-text');
  expect(field, 'the notepad did not open for the share').toBeTruthy();
  expect(field!.value).toBe('a line someone sent me\nhttps://example.com/post');
  expect(sessionStorage.getItem(SHARED_KEY), 'the share was left to be taken twice').toBeNull();
  expect(created.calls, 'the share was saved without a press').toEqual([]);
});

it('puts the share after what is already in the notepad, not over it', async () => {
  world = await mountWorld(FACTS, { initialEntries: ['/?compose=1'] }); await settle();
  const field = world.container.querySelector<HTMLTextAreaElement>('textarea.jar-composer-text')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'half a thought');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
  world.unmount();
  share('https://example.com/later');
  world = await mountWorld(FACTS); await settle();
  expect(world.container.querySelector<HTMLTextAreaElement>('textarea.jar-composer-text')?.value)
    .toBe('half a thought\n\nhttps://example.com/later');
});

it('ignores a share left behind long ago', async () => {
  sessionStorage.setItem(SHARED_KEY, JSON.stringify({ title: '', text: 'stale', url: '', via: 'share', at: Date.now() - 60 * 60 * 1000 }));
  world = await mountWorld(FACTS); await settle();
  expect(world.container.querySelector<HTMLTextAreaElement>('textarea.jar-composer-text')?.value ?? '').not.toContain('stale');
});
