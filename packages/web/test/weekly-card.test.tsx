// @vitest-environment jsdom
/**
 * YOUR WEEK, IN ONE LINE (insight goal, phase 5, 2026-11-26).
 *
 * The creature offers the week once, in the reading's place; See it opens a
 * card with the line and the week it covers; Share sends the line alone.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): through `helpers/render-home`,
 * `lib/data` (one save, no reading), `lib/api` (the verbs a mounted world
 * asks for on boot, and `fetchWeeklyLine`, the server's answer for the
 * week), `lib/auth-context` (a signed-in owner) and the canvas
 * (`helpers/canvas-stub`, plus a stand-in `toBlob` and object URL, which
 * jsdom does not make). The page, the offer, the drawn card, the sheet and
 * the share path are the shipped ones.
 */
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { installCanvasStub, setViewport } from './helpers/canvas-stub';
import { mountWorld, dataMockFrom, apiMockFrom, VIEWER_ID, type MountedWorld } from './helpers/render-home';
import { fetchWeeklyLine } from '../src/lib/api';
import { weekRange } from '../src/components/WeeklyCard';

const FACTS = vi.hoisted(() => ({ inspirations: [{ id: 'one', text: 'Walked home the long way.', daysAgo: 1 }] }));
const WEEK = { week: { from: '2026-11-20T12:00:00.000Z', to: '2026-11-26T12:00:00.000Z' }, line: 'Making the next step small enough to take.', saveIds: ['one', 'two'] };
vi.mock('../src/lib/data', async (original) => ({ ...await original<typeof import('../src/lib/data')>(), ...dataMockFrom(FACTS) }));
vi.mock('../src/lib/api', async (original) => ({ ...await original<typeof import('../src/lib/api')>(), ...apiMockFrom(FACTS),
  fetchWeeklyLine: vi.fn(async () => null) }));
vi.mock('../src/lib/auth-context', async (original) => {
  const session = { status: 'authenticated', account: { id: 'account-1', email: 'you@example.test' },
    profile: { id: VIEWER_ID, name: 'You', type: 'human' }, profiles: [], refresh: async () => undefined, signOut: async () => undefined };
  return { ...await original<typeof import('../src/lib/auth-context')>(), useOptionalAuth: () => session, useAuth: () => session };
});

let world: MountedWorld | undefined;
beforeAll(() => {
  installCanvasStub(); setViewport(390, 844); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  /* jsdom draws nothing and makes no files: the card's canvas hands back a
     stand-in PNG, and an object URL stands for it. */
  HTMLCanvasElement.prototype.toBlob = function toBlob(done: BlobCallback) { done(new Blob(['png'], { type: 'image/png' })); };
  URL.createObjectURL = () => 'blob:week'; URL.revokeObjectURL = () => undefined;
});
beforeEach(() => { localStorage.clear(); vi.mocked(fetchWeeklyLine).mockReset().mockResolvedValue(null); });
afterEach(() => { world?.unmount(); world = undefined; document.querySelector('.waka-week')?.remove(); });
async function settle() { for (let turn = 0; turn < 8; turn += 1) { await world!.step(50); await act(async () => { await Promise.resolve(); }); } }
const bubbles = () => [...world!.container.querySelectorAll('.jar-char-bubble')].map(node => node.textContent ?? '');

it('offers the week once, opens it as a card, and shares the line alone', async () => {
  vi.mocked(fetchWeeklyLine).mockResolvedValue(WEEK);
  world = await mountWorld(FACTS); await settle();
  const offer = [...world.container.querySelectorAll<HTMLElement>('.jar-char-bubble')].find(node => node.textContent?.includes('Your week, in one line.'));
  expect(offer, 'the creature did not offer the week').toBeTruthy();
  await act(async () => offer!.querySelector<HTMLButtonElement>('.jar-char-bubble-act')!.click()); await settle();
  /* The picture is the first principle's reveal: its own words, in order,
     and the week where the reveal's acts sit; nothing of the saves. */
  const picture = document.querySelector<HTMLElement>('.waka-week .waka-week-picture');
  expect(picture, 'the week has no picture').not.toBeNull();
  expect([...picture!.querySelectorAll('.waka-reveal-words > *')].map(node => node.textContent)).toEqual([
    'This week you came back to', WEEK.line, 'From 2 inspirations',
    `My week · ${weekRange(WEEK.week.from, WEEK.week.to, 'en-US', 'long')}`, 'WAKA']);
  expect(picture!.querySelector('button'), 'a button is inside the picture').toBeNull();
  expect(picture!.querySelector('.waka-week-being canvas, .waka-week-being .waka-companion'), 'the creature is not in the picture').not.toBeNull();
  expect(document.querySelector('.waka-week')?.textContent, 'a save\'s words came with the card').not.toContain('Walked home the long way.');
  /* Share is the one word under it, and it sends that image. With no share
     sheet and no clipboard here, the image is saved instead, and it says so. */
  const share = document.querySelector<HTMLButtonElement>('.waka-week-share')!;
  expect(share.disabled).toBe(false);
  await act(async () => share.click()); await settle();
  expect(document.querySelector('.waka-week-notice')?.textContent).toBeTruthy();
  /* Escape puts it down. */
  await act(async () => document.querySelector('.waka-week')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.querySelector('.waka-week')).toBeNull();
  world.unmount();
  /* Once a week: the same week, mounted again, offers nothing. */
  world = await mountWorld(FACTS); await settle();
  expect(bubbles().some(text => text.includes('Your week, in one line.')), 'the week was offered twice').toBe(false);
});

it('offers nothing when the week has nothing true to say', async () => {
  world = await mountWorld(FACTS); await settle();
  expect(vi.mocked(fetchWeeklyLine)).toHaveBeenCalled();
  expect(bubbles().some(text => text.includes('Your week, in one line.'))).toBe(false);
});

it('says a week across a month, and in Korean its own way', () => {
  expect(weekRange('2026-11-20T12:00:00Z', '2026-11-26T12:00:00Z', 'en-US')).toBe('Nov 20 to 26');
  expect(weekRange('2026-11-28T12:00:00Z', '2026-12-04T12:00:00Z', 'en-US')).toBe('Nov 28 to Dec 4');
  expect(weekRange('2026-11-20T12:00:00Z', '2026-11-26T12:00:00Z', 'ko-KR')).toBe('11월 20일부터 26일까지');
  expect(weekRange('2026-11-20T12:00:00Z', '2026-11-26T12:00:00Z', 'en-US', 'long')).toBe('November 20 to 26');
});
