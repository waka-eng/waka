// @vitest-environment jsdom
/**
 * ═══ EVERY WAY OUT OF A NOTE COMMITS IT — INCLUDING THE ONES NOBODY ADDED
 * A CALL TO ═══════════════════════════════════════════════════════════════
 *
 * `Home.tsx` carries a comment block titled "EVERY WAY OUT OF A NOTE COMMITS
 * IT". It was true of the five presses it counted — the dock's rows each call
 * `commitOpenNote()` before they navigate — and false of the three ways out
 * nobody had to write a line of code for:
 *
 *   ESCAPE. `DialogSurface` answers the key itself and calls `onClose`, and
 *   the archive's `onClose` was `viewNavigation.closeOpen` with nothing in
 *   front of it.
 *
 *   BROWSER BACK. `closeOpen` IS a history step, so the browser's own Back
 *   reaches the same place by the same route — which is the property the
 *   history-based dismissal was deliberately chosen for.
 *
 *   A PRESS ON "NOW" FROM INSIDE AN OPEN NOTE, which goes through
 *   `openOverHome(null)` rather than through the dock row's own handler.
 *
 * Probed before the fix: open a saved row, retype the words, press Escape —
 * `updateInspiration` called zero times, and the words gone. That is the one
 * failure this product cannot have; the archive's own header says so about
 * the boolean it refused to hand up ("the version of this that silently
 * discards edits"), and the discard happened anyway one layer further out.
 *
 * SO WHAT IS ASSERTED HERE IS THE RULE, NOT THE KEY. A rule enforced by
 * remembering to call something at five sites is a rule that will be broken
 * by the sixth, which is precisely what happened. `leaveOpen` commits and
 * then closes, and every `closeOpen` an overlay or a key handler can reach
 * goes through it — so these cases are about the places, not about the one
 * press that was reported.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `lib/data` supplies the three layers,
 * so the archive's rows arrive as fixtures rather than over HTTP — mocked
 * there rather than at `lib/api` because `loadInspirations` follows the
 * cursor and translates on the way, and the overlay catches its own loader's
 * throw. `lib/api` supplies the group reads AND `updateInspiration`, which is
 * the write under test: it is recorded rather than read back, because a
 * committed note closes and the list behind it is re-rendered from what the
 * page already holds. `lib/api/principles` supplies principle reads,
 * `lib/auth-context` supplies the signed-in viewer — the world renders
 * nothing without one. `helpers/render-home` and `helpers/canvas-stub`
 * replace canvas, viewport, clock and randomness; the real world simulation,
 * the real router history and the real archive all run.
 */
import { act } from 'react';
import { useLocation } from 'react-router-dom';
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

let world: MountedWorld, location: ReturnType<typeof useLocation>;
function RouterTools() { location = useLocation(); return null; }

beforeAll(() => { installCanvasStub(); setViewport(1280, 900); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.mocked(updateInspiration).mockReset().mockResolvedValue(undefined as never);
});
afterEach(() => { world?.unmount(); vi.useRealTimers(); });

async function settle() {
  for (let turn = 0; turn < 8; turn += 1) { await world.step(100); await act(async () => { await vi.advanceTimersByTimeAsync(100); }); }
}

/** The archive, with its one row open and new words typed over the old. */
const RETYPED = 'dusk on the hill, and the light went';
async function openAndRetype(): Promise<void> {
  world = await mountWorld(FACTS, { routerTools: <RouterTools/> }); await settle();
  await chooseFromMenu(world.container, 'Inspirations'); await settle();
  const row = world.container.querySelector<HTMLButtonElement>('.waka-list-row');
  expect(row, 'the archive shows no saved row to open').toBeTruthy();
  await act(async () => row!.click()); await settle();
  const page = world.container.querySelector<HTMLTextAreaElement>('textarea.waka-note-page');
  expect(page, 'the opened row is not showing its words').toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(page, RETYPED);
    page!.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
}

/** What the archive was asked to store, which is the only honest observation
    available: the note closes on commit and the orb behind it is canvas. */
const stored = () => vi.mocked(updateInspiration).mock.calls.map(([id, patch]) => ({ id, text: patch.text }));

it('commits an edited note when Escape takes you out of it', async () => {
  await openAndRetype();
  const surface = world.container.querySelector<HTMLElement>('.waka-over[data-jar-surface]');
  expect(surface, 'the archive is not on screen as a surface').toBeTruthy();
  /* THE KEY GOES WHERE A PERSON'S WOULD, which is on the words they were
     just typing. `DialogSurface` hears it on the way up and answers it
     itself, so this is the shipped path rather than a direct call to a
     handler. */
  await act(async () => {
    world.container.querySelector<HTMLTextAreaElement>('textarea.waka-note-page')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await settle();
  expect(stored()).toEqual([{ id: 'kept', text: RETYPED }]);
  expect(new URLSearchParams(location.search).get('open'), 'Escape did not leave the archive').toBeNull();
});

/**
 * AND THE BROWSER'S OWN BACK, WHICH IS THE SAME EXIT BY A ROUTE NO HANDLER
 * CAN SEE.
 *
 * `closeOpen` IS a history step — chosen so "the browser's own Back keeps
 * agreeing with Escape and with the close" — so Back out of an open note
 * lands in the same place and, before the fix, with the same loss. There is
 * no press to put a commit in front of: the pop arrives from outside React,
 * the address changes, the archive unmounts, and the autosave that lives
 * inside the unmounting component never runs.
 *
 * THE EVENT IS RAISED HERE RATHER THAN THE KEY PRESSED, and that is a real
 * limitation of this harness rather than a shortcut. `MemoryRouter` keeps its
 * history in a variable and raises no `popstate` at all, so `go(-1)` through
 * it cannot exercise the listener — and swapping this suite to
 * `BrowserRouter` would mean a jsdom `history.back()`, which is asynchronous
 * and would make the one assertion here a race. What is pinned is the thing
 * the browser actually delivers: a pop with the note still mounted.
 */
it('commits an edited note when a history pop takes you out of it', async () => {
  await openAndRetype();
  await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')); });
  await settle();
  expect(stored()).toEqual([{ id: 'kept', text: RETYPED }]);
});

/**
 * AND ONE EXIT IS ONE WRITE.
 *
 * Escape's own `closeOpen` is a history step, so the key and the pop meet on
 * every press: two mechanisms, one exit, and the archive must be written
 * once.
 *
 * WHAT THIS CASE CANNOT SEE, said here rather than left to be found by
 * deleting the thing it looks like it is guarding. `commitOpenNote` compares
 * closer identity so it cannot commit the same note twice, and this case
 * passes with that comparison removed — because the commit is awaited before
 * the pop is dispatched, and by then the archive has closed the note and
 * re-registered nothing. The ordering the guard is actually for is a browser
 * one: a real pop arriving while the write is still in flight. `MemoryRouter`
 * raises no pop, so the harness cannot stage it, and `Home.tsx` says so at
 * the guard rather than claiming cover it does not have.
 */
it('commits once when Escape and the pop it raises both arrive', async () => {
  await openAndRetype();
  await act(async () => {
    world.container.querySelector<HTMLTextAreaElement>('textarea.waka-note-page')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')); });
  await settle();
  expect(stored()).toEqual([{ id: 'kept', text: RETYPED }]);
});

/**
 * AND AN UNCHANGED NOTE IS NOT WRITTEN AT ALL.
 *
 * The counterweight, and it is not pedantry: the cheap version of this fix
 * is to write on every exit, which would make READING one of your memories
 * cost a round trip and bump its `updatedAt` for having been looked at.
 * `leaveNote` already refuses that — "Unchanged words close immediately" —
 * and routing more exits through it must not quietly change what it refuses.
 */
it('writes nothing when the note was only read', async () => {
  world = await mountWorld(FACTS, { routerTools: <RouterTools/> }); await settle();
  await chooseFromMenu(world.container, 'Inspirations'); await settle();
  await act(async () => world.container.querySelector<HTMLButtonElement>('.waka-list-row')!.click());
  await settle();
  await act(async () => {
    world.container.querySelector<HTMLTextAreaElement>('textarea.waka-note-page')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await settle();
  expect(stored()).toEqual([]);
});
