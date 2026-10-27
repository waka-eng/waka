// @vitest-environment jsdom
/** WHAT THIS MOCKS: `lib/data` supplies owned memory, `lib/api` supplies
 * auxiliary reads, and `lib/auth-context` supplies the account.
 * `helpers/canvas-stub` and `helpers/render-home` replace
 * canvas/viewport/clock/randomness. Real Home and simulation run.
 * Counts measure scheduled frames and submitted draws, not GPU/battery time. */
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { installCanvasStub, setViewport } from './helpers/canvas-stub';
import { apiMockFrom, dataMockFrom, mountWorld, VIEWER_ID, type MountedWorld } from './helpers/render-home';
import type { SimApi } from '../src/canvas/simulation';

const facts = vi.hoisted(() => ({ inspirations: [{ id: 'kept', text: 'A quiet morning', daysAgo: 1 }] }));
vi.mock('../src/lib/data', async original => ({ ...await original<typeof import('../src/lib/data')>(), ...dataMockFrom(facts) }));
vi.mock('../src/lib/api', async original => ({ ...await original<typeof import('../src/lib/api')>(), ...apiMockFrom(facts) }));
vi.mock('../src/lib/auth-context', async original => {
  const session = { status: 'authenticated', account: { id: 'account-1', email: 'you@example.test' },
    profile: { id: VIEWER_ID, name: 'You', type: 'human' }, profiles: [], refresh: async () => undefined, signOut: async () => undefined };
  return { ...await original<typeof import('../src/lib/auth-context')>(), useOptionalAuth: () => session, useAuth: () => session };
});

let world: MountedWorld;
beforeAll(() => { installCanvasStub(); setViewport(390, 844); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { localStorage.clear(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
afterEach(() => { world?.unmount(); vi.useRealTimers(); vi.restoreAllMocks(); });

it.each(['Inspirations', 'Chats'])('parks the covered canvas on %s and resumes when Home returns', async label => {
  world = await mountWorld(facts);
  const context = world.container.querySelector<HTMLCanvasElement>('.jar-canvas')!.getContext('2d')!;
  const draw = vi.fn(context.clearRect);
  context.clearRect = draw;
  // Only the companion paints ellipses on the main canvas (eyes/glasses).
  const features = vi.fn(context.ellipse);
  context.ellipse = features;
  await world.step(120);
  expect(draw.mock.calls.length).toBe(120);
  expect(features).toHaveBeenCalled();
  const tab = (name: string) => [...world.container.querySelectorAll<HTMLButtonElement>('.waka-primary-navigation button')]
    .find(button => button.textContent?.trim() === name)!;
  draw.mockClear(); features.mockClear();
  await act(async () => tab(label).click());
  await world.step(120);
  expect(draw).toHaveBeenCalled(); // Clear the old creature before sleeping.
  expect(features).not.toHaveBeenCalled();
  draw.mockClear();
  const schedule = vi.spyOn(globalThis, 'requestAnimationFrame');
  await world.step(600);
  expect(draw.mock.calls.length).toBe(0);
  expect(schedule).not.toHaveBeenCalled();
  await act(async () => tab('Home').click());
  await world.step(120);
  draw.mockClear();
  await world.step(120);
  expect(draw.mock.calls.length).toBe(120);
  expect(features).toHaveBeenCalled();
});

const simulation = () => (window as unknown as { wakaSim: () => SimApi }).wakaSim();

const pointer = (target: EventTarget, type: string, x: number, y: number) => {
  target.dispatchEvent(new window.PointerEvent(type, { bubbles: true, pointerId: 1,
    pointerType: 'mouse', clientX: x, clientY: y, buttons: type === 'pointerdown' ? 1 : 0 }));
};

it.each(['Inspirations', 'Chats'])('removes the avatar click target and hover cursor on %s', async label => {
  world = await mountWorld(facts);
  const root = world.container.querySelector<HTMLElement>('.jar')!;
  const spot = simulation().creatureAt()!;
  const tab = (name: string) => [...world.container.querySelectorAll<HTMLButtonElement>('.waka-primary-navigation button')]
    .find(button => button.textContent?.trim() === name)!;
  await act(async () => { pointer(window, 'pointermove', spot.x, spot.y); pointer(window, 'pointermove', spot.x, spot.y); });
  expect(root.style.cursor).toBe('pointer');
  await act(async () => tab(label).click());
  expect(root.style.cursor).toBe(''); // No pointer movement needed to clear it.
  expect(world.container.querySelector('.jar-char-press')).toBeNull();
  await world.step(120);
  const schedule = vi.spyOn(globalThis, 'requestAnimationFrame');
  await act(async () => {
    pointer(window, 'pointermove', spot.x, spot.y);
    pointer(window, 'pointermove', spot.x, spot.y);
    pointer(root, 'pointerdown', spot.x, spot.y);
    pointer(window, 'pointerup', spot.x, spot.y);
  });
  await world.step(120);
  expect(root.style.cursor).toBe('');
  expect(schedule).not.toHaveBeenCalled();
  await act(async () => tab('Home').click());
  await world.step(120);
  expect(world.container.querySelector('.jar-char-press--lit')).toBeNull();
  const returned = simulation().creatureAt()!;
  await act(async () => {
    pointer(root, 'pointerdown', returned.x, returned.y);
    pointer(window, 'pointerup', returned.x, returned.y);
  });
  expect(world.container.querySelector('.jar-char-press--lit')).not.toBeNull();
});

it.each(['/?compose=1', '/chat/new', '/?open=principles'])(
  'does not expose the background avatar on a direct %s page', async path => {
    world = await mountWorld(facts, { initialEntries: [path] });
    expect(world.container.querySelector('.jar-char-press')).toBeNull();
    const root = world.container.querySelector<HTMLElement>('.jar')!, spot = simulation().creatureAt()!;
    await act(async () => { pointer(window, 'pointermove', spot.x, spot.y); pointer(window, 'pointermove', spot.x, spot.y); });
    expect(root.style.cursor).toBe('');
  },
);

it('finishes navigation under a covered page before parking, including a cold list link', async () => {
  world = await mountWorld(facts, { initialEntries: ['/?open=saves'] });
  const sim = simulation();
  await act(async () => sim.toGround());
  expect(sim.navigationState().moving).toBe(true);
  await world.step(180);
  expect(sim.navigationState().section).toBe('field');
  expect(sim.isResting()).toBe(true);
  expect(world.container.querySelector('.waka-page')).not.toBeNull();
  const schedule = vi.spyOn(globalThis, 'requestAnimationFrame');
  await world.step(600);
  expect(schedule).not.toHaveBeenCalled();
});

it('does not restart a hidden tab when new data wakes the simulation', async () => {
  world = await mountWorld(facts);
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  const schedule = vi.spyOn(globalThis, 'requestAnimationFrame');
  await act(async () => simulation().reflectionChanged('kept', 1));
  await world.step(120);
  expect(schedule).not.toHaveBeenCalled();
  hidden.mockReturnValue(false);
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  await world.step(120);
  expect(schedule).toHaveBeenCalled();
});
