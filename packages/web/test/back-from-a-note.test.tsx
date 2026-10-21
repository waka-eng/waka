// @vitest-environment jsdom
/**
 * BACK FROM AN OPEN SAVED NOTE RETURNS TO THE LIST, AND THE NEXT BACK LEAVES
 * THE ARCHIVE — on the real router over jsdom's real session history, so the
 * pop is the browser's own (`history.back()`), not a hand-raised event.
 *
 * Usability audit at f2afcbe2 (desk/27, /32): the note had no entry of its own,
 * so one Back skipped the list and closed the whole archive. The note still
 * has no entry (`docs/plans/back-from-layers.md`): `useBackLayer` catches the
 * one-step Back and closes the note instead.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): the same layers as
 * `leaving-a-note.test.tsx`, for its reasons. `lib/data` supplies the three
 * layers, so the archive's row is a fixture. `lib/api` supplies group reads
 * and records `updateInspiration`, the write under test. `lib/api/principles`
 * supplies principle reads, and `lib/auth-context` supplies the signed-in
 * viewer. `helpers/render-home` and `helpers/canvas-stub` replace canvas,
 * viewport, clock and randomness. The router, the history, the world and the
 * archive are real.
 */
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { installCanvasStub, setViewport } from './helpers/canvas-stub';
import { mountWorld, dataMockFrom, apiMockFrom, chooseFromMenu, VIEWER_ID, type MountedWorld } from './helpers/render-home';
import { updateInspiration } from '../src/lib/api';

const FACTS = vi.hoisted(() => ({
  inspirations: [{ id: 'kept', text: 'dusk on the hill', daysAgo: 2 }],
  groups: [] as never[],
}));
vi.mock('../src/lib/api/principles', async original => ({
  ...await original<typeof import('../src/lib/api/principles')>(),
  fetchPrincipleRead: vi.fn(async () => ({ principles: [], status: { phase: 'ready', eligible: false } })),
}));
vi.mock('../src/lib/data', async original => ({
  ...await original<typeof import('../src/lib/data')>(), ...dataMockFrom(FACTS),
}));
vi.mock('../src/lib/api', async original => ({
  ...await original<typeof import('../src/lib/api')>(), ...apiMockFrom(FACTS),
  fetchPrinciples: vi.fn(async () => []),
  updateInspiration: vi.fn(),
}));
vi.mock('../src/lib/auth-context', async original => {
  const session = { status: 'authenticated', account: { id: 'account-1', email: 'you@example.test' },
    profile: { id: VIEWER_ID, name: 'You', type: 'human' }, profiles: [], refresh: async () => undefined, signOut: async () => undefined };
  return { ...await original<typeof import('../src/lib/auth-context')>(), useOptionalAuth: () => session, useAuth: () => session };
});

let world: MountedWorld;
beforeAll(() => { installCanvasStub(); setViewport(1280, 900); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.mocked(updateInspiration).mockReset().mockResolvedValue(undefined as never);
});
afterEach(() => { world?.unmount(); vi.useRealTimers(); });

async function settle() {
  for (let turn = 0; turn < 8; turn += 1) { await world.step(100); await act(async () => { await vi.advanceTimersByTimeAsync(100); }); }
}
const page = () => world.container.querySelector<HTMLTextAreaElement>('textarea.waka-note-page');
const archive = () => world.container.querySelector('.waka-over[data-jar-surface]');
const open = () => new URLSearchParams(window.location.search).get('open');
async function back() { await act(async () => { window.history.back(); }); await settle(); }

async function openNote(): Promise<number> {
  world = await mountWorld(FACTS, { browserRouter: true }); await settle();
  await chooseFromMenu(world.container, 'Inspirations'); await settle();
  expect(open()).toBe('saves');
  const length = window.history.length;
  await act(async () => world.container.querySelector<HTMLButtonElement>('.waka-list-row')!.click());
  await settle();
  expect(page(), 'the opened row is not showing its words').toBeTruthy();
  return length;
}
async function retype(words: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(page(), words);
    page()!.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
}

it('Back from an open note returns to the list, and Back from the list leaves the archive', async () => {
  const length = await openNote();
  expect(window.history.length, 'opening a note added a history entry').toBe(length);
  await back();
  expect(page(), 'Back left the note open').toBeNull();
  expect(archive(), 'Back closed the archive instead of the note').toBeTruthy();
  expect(open()).toBe('saves');
  expect(window.history.length, 'closing the note left an entry behind').toBe(length);
  await back();
  expect(open(), 'Back from the list did not leave the archive').toBeNull();
  expect(archive()).toBeNull();
  expect(updateInspiration).not.toHaveBeenCalled();
});

it('Back from an edited note commits it once and stays on the list', async () => {
  await openNote();
  await retype('dusk on the hill, and the light went');
  await back();
  expect(vi.mocked(updateInspiration).mock.calls.map(([id, patch]) => ({ id, text: patch.text })))
    .toEqual([{ id: 'kept', text: 'dusk on the hill, and the light went' }]);
  expect(page()).toBeNull();
  expect(open()).toBe('saves');
});

it('a note whose save fails stays open with its words, and the next Back still reaches the list', async () => {
  await openNote();
  await retype('words that must not be lost');
  /* refused after a moment, as a network does: the page renders the save in flight first */
  vi.mocked(updateInspiration).mockImplementationOnce(() => new Promise((_, refuse) => setTimeout(() => refuse(new Error('offline')), 350)));
  await back();
  expect(page()?.value, 'the failed save lost the words').toBe('words that must not be lost');
  expect(open()).toBe('saves');
  await back();
  expect(page()).toBeNull();
  expect(open(), 'the second Back went past the list').toBe('saves');
  expect(updateInspiration).toHaveBeenCalledTimes(2);
});
