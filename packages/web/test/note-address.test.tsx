// @vitest-environment jsdom
/**
 * BACK FROM AN OPEN SAVED NOTE RETURNS TO THE LIST.
 *
 * Usability audit at f2afcbe2 (desk/27, /32): the note had no address, so
 * the browser's Back from an open note skipped the list and closed the whole
 * archive — two levels for one press. The note now has a real address,
 * `?open=saves&note=<id>`, the way the memory panel has `?inspiration=<id>`,
 * so Back, Forward, reload and cold links are the router's ordinary cases.
 *
 * WHAT IS PINNED is the whole round trip through the real world and the real
 * archive: the address follows the press; Back pops to the list and commits
 * what was typed; the next Back leaves the archive; Forward reopens the note;
 * a cold link (which is also what a reload reads) opens it; a link to a note
 * the archive does not hold is dropped rather than left promising one; and
 * the on-screen way back steps the same history Back does.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): the same seams `leaving-a-note.test.tsx`
 * uses — `lib/data` for the archive's rows, `lib/api` for `updateInspiration`
 * (recorded, the write under test), `lib/api/principles` and
 * `lib/auth-context` so the world renders; `helpers/render-home` and
 * `helpers/canvas-stub` replace canvas, viewport, clock and randomness. The
 * real world, the real archive and a real `MemoryRouter` run; its traversals
 * raise no `popstate`, which is exactly why the commit on leaving the address
 * must not depend on one.
 */
import { act } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { installCanvasStub, setViewport } from './helpers/canvas-stub';
import { mountWorld, dataMockFrom, apiMockFrom, chooseFromMenu, pressDockRow, VIEWER_ID, type MountedWorld } from './helpers/render-home';
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

let world: MountedWorld, location: ReturnType<typeof useLocation>, go: ReturnType<typeof useNavigate>;
function RouterTools() { location = useLocation(); go = useNavigate(); return null; }

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
const params = () => new URLSearchParams(location.search);
const page = () => world.container.querySelector<HTMLTextAreaElement>('textarea.waka-note-page');
const listRow = () => world.container.querySelector<HTMLButtonElement>('.waka-list-row');
async function back() { await act(async () => { go(-1); }); await settle(); }
async function forward() { await act(async () => { go(1); }); await settle(); }

async function openArchiveThenNote() {
  world = await mountWorld(FACTS, { routerTools: <RouterTools/> }); await settle();
  await chooseFromMenu(world.container, 'Inspirations'); await settle();
  expect(listRow(), 'the archive shows no saved row to open').toBeTruthy();
  await act(async () => listRow()!.click()); await settle();
  expect(page(), 'the opened row is not showing its words').toBeTruthy();
}

it('gives the open note its own address, and Back returns to the list before it leaves the archive', async () => {
  await openArchiveThenNote();
  expect(params().get('open')).toBe('saves');
  expect(params().get('note')).toBe('kept');
  await back();
  expect(params().get('open'), 'Back from the note left the archive').toBe('saves');
  expect(params().get('note')).toBeNull();
  expect(page(), 'Back did not close the note').toBeNull();
  expect(listRow(), 'Back did not show the list').toBeTruthy();
  await back();
  expect(params().get('open'), 'the second Back did not leave the archive').toBeNull();
});

it('commits what was typed when Back leaves the note, with no popstate to hear', async () => {
  await openArchiveThenNote();
  const RETYPED = 'dusk on the hill, and the light went';
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(page(), RETYPED);
    page()!.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
  await back();
  expect(vi.mocked(updateInspiration).mock.calls.map(([id, patch]) => ({ id, text: patch.text })))
    .toEqual([{ id: 'kept', text: RETYPED }]);
  expect(listRow()).toBeTruthy();
});

/* THE BROWSER'S ORDER: `popstate` first, the router's landing after it. A
   note let go of by the pop, while the rendered address still names it, must
   not be closed "on screen" as well — that was a second step back, past the
   list (Chromium and WebKit, `tools/e2e/back-from-a-note.ts`). */
it('a Back the browser delivers (popstate before the router lands) is one step, not two', async () => {
  await openArchiveThenNote();
  await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')); go(-1); });
  await settle();
  expect(params().get('open'), 'one Back walked out of the archive').toBe('saves');
  expect(params().get('note')).toBeNull();
  expect(listRow()).toBeTruthy();
});

/* Escape from a note closes the archive: the note commits on the way, and
   its letting go must not add a step of its own to the archive's. */
it('Escape from a note closes the archive in one step and leaves no note entry in Forward', async () => {
  world = await mountWorld(FACTS, { initialEntries: ['/?view=field', '/'], routerTools: <RouterTools/> }); await settle();
  await chooseFromMenu(world.container, 'Inspirations'); await settle();
  await act(async () => listRow()!.click()); await settle();
  await act(async () => { page()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  await settle();
  expect(params().get('open'), 'Escape did not close the archive').toBeNull();
  expect(params().get('view'), 'Escape walked past where the archive was opened from').toBeNull();
  await forward();
  expect(params().get('open'), 'a note entry was left in Forward history').toBeNull();
});

/* A SAVE STILL RUNNING WHEN THE PERSON WALKS FORWARD BACK INTO THE NOTE.
   Back starts the commit; Forward brings the address back to the note; the
   save then finishes and the note lets go. That is the save finishing, not a
   close on screen — it must not step back out of the note the person just
   walked into. */
it('a save finishing after Back then Forward does not close the note the person walked back into', async () => {
  let land: () => void = () => undefined;
  vi.mocked(updateInspiration).mockImplementation(() => new Promise((done) => { land = () => done(undefined as never); }));
  await openArchiveThenNote();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(page(), 'dusk on the hill, and then the rain');
    page()!.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
  await back();
  expect(vi.mocked(updateInspiration)).toHaveBeenCalledTimes(1);
  await forward();
  expect(params().get('note')).toBe('kept');
  await act(async () => { land(); }); await settle();
  expect(params().get('note'), 'the finished save stepped back out of the note').toBe('kept');
  expect(page(), 'the note is not on screen at its address').toBeTruthy();
});

it('Forward after Back reopens the note', async () => {
  await openArchiveThenNote();
  await back();
  expect(page()).toBeNull();
  await forward();
  expect(params().get('note')).toBe('kept');
  expect(page(), 'Forward did not reopen the note').toBeTruthy();
});

it('the on-screen way back steps the same history: the list, then one Back out of the archive', async () => {
  await openArchiveThenNote();
  await pressDockRow(world.container, 'Back'); await settle();
  expect(page()).toBeNull();
  expect(params().get('open')).toBe('saves');
  expect(params().get('note')).toBeNull();
  await back();
  expect(params().get('open'), 'a dead Back step was left by the on-screen close').toBeNull();
});

it('a cold link (what a reload reads) opens the note, and its close lands on the list', async () => {
  world = await mountWorld(FACTS, { initialEntries: ['/?open=saves&note=kept'], routerTools: <RouterTools/> }); await settle();
  expect(page(), 'the linked note did not open').toBeTruthy();
  await pressDockRow(world.container, 'Back'); await settle();
  expect(params().get('open')).toBe('saves');
  expect(params().get('note')).toBeNull();
  expect(listRow()).toBeTruthy();
});

it('a link to a note this archive does not hold opens the list and stops naming the note', async () => {
  world = await mountWorld(FACTS, { initialEntries: ['/?open=saves&note=gone'], routerTools: <RouterTools/> }); await settle();
  expect(page()).toBeNull();
  expect(listRow()).toBeTruthy();
  expect(params().get('open')).toBe('saves');
  expect(params().get('note')).toBeNull();
});

/* AFTER A BACK DURING A SAVE, THE NOTE IS STILL A NOTE. The record that the
   address left it ends when it lets go, so the next time it opens it can be
   closed on screen — and does not reopen itself from its own address. */
it('a note reopened after a Back-during-save can still be closed on screen', async () => {
  let land: () => void = () => undefined;
  vi.mocked(updateInspiration).mockImplementation(() => new Promise((done) => { land = () => done(undefined as never); }));
  await openArchiveThenNote();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(page(), 'dusk on the hill, and then the rain');
    page()!.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
  await back();
  await act(async () => { land(); }); await settle();
  expect(page()).toBeNull();
  vi.mocked(updateInspiration).mockReset().mockResolvedValue(undefined as never);
  await forward();
  expect(page(), 'Forward did not reopen the note').toBeTruthy();
  await pressDockRow(world.container, 'Back'); await settle();
  expect(page(), 'the on-screen way back did not close the note').toBeNull();
  expect(params().get('note')).toBeNull();
  expect(listRow()).toBeTruthy();
});
