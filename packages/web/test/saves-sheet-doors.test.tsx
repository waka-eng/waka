// @vitest-environment jsdom
/**
 * THE HOME'S FOUR ACTIONS, WHERE THEY LIVE NOW (2026-11-08).
 *
 * Founder, on the home's Actions menu (Search / Past chats / View principles /
 * Nothing to review right now): "i hate this. better position these 4 actions
 * in current experience." Search is a field at the top of the Saves sheet,
 * "View principles" is the sheet's "Principles ›", and the sheet's way down
 * ("⌄ Home") stands in the top bar's row, left, with only info and settings
 * on the right. Review is the creature's (see `inspiration-review.test.tsx`);
 * past chats are the chat page's (`home-navigation.test.tsx`).
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `lib/data` supplies the field, `lib/api`
 * the principles read and the archive's server search (`fetchInspirationPage`,
 * which the field runs through `useArchiveSearch`), and `lib/auth-context`
 * the viewer whose principles are read. Server boundaries only; the page is
 * the shipped one. `helpers/render-home` and `helpers/canvas-stub` replace
 * drawing and timing, never Home's behaviour.
 */
import { act } from 'react';
import { useLocation } from 'react-router-dom';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { installCanvasStub, setViewport } from './helpers/canvas-stub';
import { apiMockFrom, dataMockFrom, mountWorld, openSavesSheet, pressSheetDoor, VIEWER_ID, type MountedWorld } from './helpers/render-home';
import { fetchInspirationPage } from '../src/lib/api';

const FACTS = vi.hoisted(() => ({ inspirations: [{ id: 'near', text: 'A save in the window', daysAgo: 1 }] }));
vi.mock('../src/lib/data', async original => ({ ...await original<typeof import('../src/lib/data')>(), ...dataMockFrom(FACTS) }));
vi.mock('../src/lib/api', async original => ({ ...await original<typeof import('../src/lib/api')>(), ...apiMockFrom(FACTS),
  fetchPrinciples: async () => [{ id: 'p1', statement: 'Keep the quiet hours.', type: 'value', state: 'held', origin: 'minted', rank: 0,
    locked: false, heldSince: null, conflictsWithId: null, citedSignals: [], createdAt: '2026-08-01T00:00:00Z' }],
  fetchInspirationPage: vi.fn(async (options: { q?: string }) => ({ total: 1, inspirations: options.q === 'quiet' ? [{
    id: 'near', textPreview: 'An older quiet morning', kind: 'note', source: 'app', createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z', attachmentSummary: [], reflectionCount: 0 }] : [] })),
}));
vi.mock('../src/lib/auth-context', async original => ({ ...await original<typeof import('../src/lib/auth-context')>(),
  useOptionalAuth: () => ({ status: 'authenticated', account: { id: 'account', email: 'owner@example.test' }, profile: { id: VIEWER_ID, name: 'Owner', type: 'human' }, profiles: [] }) }));

let world: MountedWorld | undefined;
let where: ReturnType<typeof useLocation>;
function Where() { where = useLocation(); return null; }
const query = (name: string) => new URLSearchParams(where.search).get(name);
beforeAll(() => { installCanvasStub(); setViewport(390, 844); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { world?.unmount(); world = undefined; vi.clearAllMocks(); });
async function settle() { for (let turn = 0; turn < 6; turn += 1) { await world!.step(20); await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); } }

it('has no Actions menu, and puts ⌄ Home in the top bar row while the sheet is up', async () => {
  world = await mountWorld(FACTS, { routerTools: <Where /> }); await settle();
  expect(world.container.querySelector('.waka-home-actions'), 'the Actions menu is still on home').toBeNull();
  const sheet = await openSavesSheet(world.container); await settle();
  const home = world.container.querySelector<HTMLButtonElement>('.waka-corners > .waka-stream-home');
  expect(home?.textContent?.trim(), 'the way down is not in the top bar row').toBe('Home');
  expect(world.container.querySelector('.waka-corners')!.firstElementChild, '⌄ Home is not the row\'s left end').toBe(home);
  expect(sheet.querySelector('.waka-stream-close'), 'the sheet still carries its own centred Home').toBeNull();
  /* The right end holds only info and settings. */
  expect([...world.container.querySelectorAll<HTMLButtonElement>('.waka-corner-place > button')].map(b => b.getAttribute('aria-label')))
    .toEqual(['How WAKA works', 'Settings']);
  await act(async () => home!.click()); await settle();
  expect(world.container.querySelector('.waka-stream'), '⌄ Home left the sheet up').toBeNull();
  expect(world.container.querySelector('.waka-stream-home')).toBeNull();
  expect(world.container.querySelector('.waka-home-bar-pull'), 'the pull did not come back').toBeTruthy();
});

it('searches what you kept from the top of the sheet, with the archive\'s own server search', async () => {
  world = await mountWorld(FACTS, { routerTools: <Where /> }); await settle();
  const sheet = await openSavesSheet(world.container); await settle();
  const field = sheet.querySelector<HTMLInputElement>('.waka-stream-find input[type="search"]');
  expect(field?.getAttribute('aria-label')).toBe('Search what you kept');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'quiet');
    field!.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 260)); }); await settle();
  expect(vi.mocked(fetchInspirationPage).mock.calls.some(([options]) => options?.q === 'quiet'), 'the field did not search the server').toBe(true);
  const hit = [...sheet.querySelectorAll<HTMLButtonElement>('.waka-stream-save')].find(b => b.textContent?.includes('An older quiet morning'));
  expect(hit, 'the result is not on the sheet').toBeTruthy();
  expect(sheet.textContent, 'the unmatched save stayed up under a search').not.toContain('A save in the window');
  /* The clear is there only while there is something to clear. */
  await act(async () => sheet.querySelector<HTMLButtonElement>('.waka-over-find-clear')!.click());
  expect(sheet.textContent).toContain('A save in the window');
  expect(sheet.querySelector('.waka-over-find-clear')).toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'quiet');
    field!.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 260)); }); await settle();
  await act(async () => [...sheet.querySelectorAll<HTMLButtonElement>('.waka-stream-save')].find(b => b.textContent?.includes('An older quiet morning'))!.click());
  await settle();
  expect(query('open')).toBe('saves');
  expect(query('note'), 'the result did not open its own page').toBe('near');

  /* AND ITS "<" COMES BACK TO THE SHEET, on the same query: a save found on
     the sheet never steps back to a list the person did not come from. */
  await act(async () => world!.container.querySelector<HTMLButtonElement>('button.waka-page-back')!.click()); await settle();
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 260)); }); await settle();
  expect(query('open'), 'the "<" landed on the list of saves').toBeNull();
  const back = world!.container.querySelector('.waka-stream');
  expect(back, 'the sheet is not back').toBeTruthy();
  expect(back!.querySelector<HTMLInputElement>('.waka-stream-find input[type="search"]')?.value, 'the query was dropped').toBe('quiet');
});

it('opens Principles from the sheet\'s "Principles ›", the walk View principles took', async () => {
  world = await mountWorld(FACTS, { routerTools: <Where /> }); await settle();
  const sheet = await openSavesSheet(world.container); await settle();
  expect(sheet.textContent).toContain('Keep the quiet hours.');
  await pressSheetDoor(world.container, 'Principles'); await settle();
  expect(query('open')).toBe('principles');
  expect(world.container.querySelector('.waka-stream'), 'the sheet stayed up over Principles').toBeNull();
});

it('opens the whole archive from the sheet\'s "Saves ›"', async () => {
  world = await mountWorld(FACTS, { routerTools: <Where /> }); await settle();
  await pressSheetDoor(world.container, 'Kept'); await settle();
  expect(query('open')).toBe('saves');
  expect(query('note')).toBeNull();
});

it('keeps the door to the archive on the sheet with nothing kept, so the Deleted shelf is reachable', async () => {
  /* The Actions menu's Search was home's other way to the archive. Without
     it, an empty sheet with no "Kept ›" left someone who deleted their last
     save no way to bring it back. */
  const kept = FACTS.inspirations.splice(0);
  try {
    world = await mountWorld(FACTS, { routerTools: <Where /> }); await settle();
    const sheet = await openSavesSheet(world.container); await settle();
    expect(sheet.textContent).toContain('Nothing kept yet.');
    await pressSheetDoor(world.container, 'Kept'); await settle();
    expect(query('open'), 'an empty sheet has no way to the archive').toBe('saves');
  } finally { FACTS.inspirations.push(...kept); }
});
