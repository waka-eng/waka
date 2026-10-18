// @vitest-environment jsdom
/**
 * THE EMPTY ARCHIVE'S "SAVE" PUTS THE ARCHIVE AWAY BEFORE IT FOCUSES THE NOTE.
 *
 * Saves can stand over a notepad that is still open (`?compose=1&open=saves`).
 * With nothing kept yet, Saves offers the first save — and pressing it
 * focused that notepad while Saves stayed on top of it, so the cursor sat in
 * a field nobody could see. The overlay closes first now.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `lib/data` and `lib/api` via
 * `dataMockFrom` / `apiMockFrom` with an EMPTY archive — the seams Home and
 * the Saves overlay read through. `lib/auth-context` states the owner.
 * `helpers/canvas-stub` and `helpers/render-home` replace drawing and time.
 */
import { act } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { installCanvasStub, setViewport } from './helpers/canvas-stub';
import { mountWorld, dataMockFrom, apiMockFrom, VIEWER_ID, type MountedWorld } from './helpers/render-home';

const FACTS = vi.hoisted(() => ({ inspirations: [] as Array<{ id: string; text: string; daysAgo: number }> }));
vi.mock('../src/lib/data', async (original) => ({ ...await original<typeof import('../src/lib/data')>(), ...dataMockFrom(FACTS) }));
vi.mock('../src/lib/api', async (original) => ({ ...await original<typeof import('../src/lib/api')>(), ...apiMockFrom(FACTS) }));
vi.mock('../src/lib/auth-context', async (original) => {
  const session = { status: 'authenticated', account: { id: 'account-1', email: 'you@example.test' },
    profile: { id: VIEWER_ID, name: 'You', type: 'human' }, profiles: [], refresh: async () => undefined, signOut: async () => undefined };
  return { ...await original<typeof import('../src/lib/auth-context')>(), useOptionalAuth: () => session, useAuth: () => session };
});

let world: MountedWorld, location: ReturnType<typeof useLocation>, go: ReturnType<typeof useNavigate>;
function RouterTools() { location = useLocation(); go = useNavigate(); return null; }
beforeAll(() => { installCanvasStub(); setViewport(1280, 900); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { localStorage.clear(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
afterEach(() => { world?.unmount(); vi.useRealTimers(); });
async function settle() {
  for (let turn = 0; turn < 8; turn += 1) { await world.step(100); await act(async () => { await vi.advanceTimersByTimeAsync(100); }); }
}

it('closes Saves before focusing the open note when the empty archive offers the first save', async () => {
  world = await mountWorld(FACTS, { initialEntries: ['/?compose=1&open=saves'], routerTools: <RouterTools /> }); await settle();
  expect(new URLSearchParams(location.search).get('open')).toBe('saves');
  expect(new URLSearchParams(location.search).get('compose'), 'the note is not open under Saves').toBe('1');
  const first = world.container.querySelector<HTMLButtonElement>('.waka-over-new');
  expect(first, 'the empty archive offered no first save').toBeTruthy();
  await act(async () => first!.click()); await settle();
  expect(new URLSearchParams(location.search).get('open'), 'Saves stayed over the note it focused').toBeNull();
  expect(world.container.querySelector('.waka-over-new')).toBeNull();
  expect(document.activeElement, 'the note was not focused').toBe(world.container.querySelector('textarea.jar-composer-text'));
});

it('keeps what is already written in the open note when that save button focuses it', async () => {
  world = await mountWorld(FACTS, { initialEntries: ['/?compose=1'], routerTools: <RouterTools /> }); await settle();
  const field = world.container.querySelector<HTMLTextAreaElement>('textarea.jar-composer-text')!;
  expect(field, 'the note did not open').toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'half a thought');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
  await act(async () => { go('/?compose=1&open=saves'); }); await settle();
  const first = world.container.querySelector<HTMLButtonElement>('.waka-over-new');
  expect(first, 'the empty archive offered no first save').toBeTruthy();
  await act(async () => first!.click()); await settle();
  expect(new URLSearchParams(location.search).get('open')).toBeNull();
  expect(world.container.querySelector<HTMLTextAreaElement>('textarea.jar-composer-text')?.value,
    'the save button threw the draft away').toBe('half a thought');
});
