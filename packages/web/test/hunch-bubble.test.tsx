// @vitest-environment jsdom
/**
 * A HUNCH FROM THE FIRST SAVES (insight goal, phase 3, 2026-11-26; canvas
 * board "A hunch").
 *
 * Before a reading exists the creature's main bubble guesses and asks "Am I
 * close?". Not quite asks "What's closer?", the answer is typed in the home
 * bar, the old line stands struck through while it rethinks, and the new
 * hunch takes its place. Yes thanks the person and asks for the reading.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): through `helpers/render-home`,
 * `lib/data` (two saves and no reading yet), `lib/api` (the verbs a mounted
 * world asks for on boot, and `fetchHunch` / `answerHunch`, the hunch's read
 * and its one write), `lib/auth-context` (a signed-in owner) and the canvas
 * (`helpers/canvas-stub`). The page, the bar and the bubble are the shipped ones.
 */
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { installCanvasStub, setViewport } from './helpers/canvas-stub';
import { mountWorld, dataMockFrom, apiMockFrom, pressHomeBar, VIEWER_ID, type MountedWorld } from './helpers/render-home';
import { answerHunch, fetchHunch } from '../src/lib/api';

const FACTS = vi.hoisted(() => ({ inspirations: [
  { id: 'river', text: 'Walked home the long way to hear the river.', daysAgo: 1 },
  { id: 'quit', text: 'I want to quit my job and build something of my own.', daysAgo: 2 },
] }));
const HUNCH = vi.hoisted(() => ({ now: { id: 'h1', body: 'Two of your saves are about leaving somewhere. Am I close?', inspirationIds: ['river', 'quit'], status: 'pending' as const } as { id: string; body: string; inspirationIds: string[]; status: 'pending' } | null }));
vi.mock('../src/lib/data', async (original) => ({ ...await original<typeof import('../src/lib/data')>(), ...dataMockFrom(FACTS) }));
vi.mock('../src/lib/api', async (original) => ({ ...await original<typeof import('../src/lib/api')>(), ...apiMockFrom(FACTS),
  fetchHunch: vi.fn(async () => HUNCH.now),
  fetchInspirationSaveRequest: vi.fn(async () => { const { ApiError: E } = await import('../src/lib/api/http'); throw new E({ status: 404, code: 'save_not_found', message: 'Not saved yet' }); }),
  createInspiration: vi.fn(async (input: { text: string }) => ({ id: 'new-save', profileId: 'profile-viewer', text: input.text, kind: 'note', source: 'app',
    visibility: 'private', attachments: [], reflections: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })),
  answerHunch: vi.fn(async () => undefined) }));
vi.mock('../src/lib/auth-context', async (original) => {
  const session = { status: 'authenticated', account: { id: 'account-1', email: 'you@example.test' },
    profile: { id: VIEWER_ID, name: 'You', type: 'human' }, profiles: [], refresh: async () => undefined, signOut: async () => undefined };
  return { ...await original<typeof import('../src/lib/auth-context')>(), useOptionalAuth: () => session, useAuth: () => session };
});

let world: MountedWorld | undefined;
beforeAll(() => { installCanvasStub(); setViewport(390, 844); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  localStorage.clear(); vi.mocked(answerHunch).mockClear();
  HUNCH.now = { id: 'h1', body: 'Two of your saves are about leaving somewhere. Am I close?', inspirationIds: ['river', 'quit'], status: 'pending' };
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => { world?.unmount(); world = undefined; vi.useRealTimers(); });
async function settle(ms = 100) { for (let turn = 0; turn < 8; turn += 1) { await world!.step(100); await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); } }
const bubble = () => world!.container.querySelector('.jar-char-bubble')?.textContent ?? '';
const act_ = (label: string) => [...world!.container.querySelectorAll<HTMLButtonElement>('.jar-char-bubble-act')].find(b => b.textContent === label);

it('says the hunch before any reading, and Not quite takes the answer in the bar, then shows the new hunch', async () => {
  world = await mountWorld(FACTS); await settle();
  expect(bubble()).toContain('Two of your saves are about leaving somewhere. Am I close?');
  expect(act_('Yes') && act_('Not quite'), 'the hunch has no Yes and Not quite').toBeTruthy();
  await act(async () => act_('Not quite')!.click()); await settle();
  expect(bubble()).toContain('What’s closer?');
  const field = world.container.querySelector<HTMLInputElement>('.waka-home-bar-answer-field');
  expect(field, 'the bar did not become the answer box').not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'It is about room to grow.');
    field!.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => world!.container.querySelector<HTMLFormElement>('.waka-home-bar-answer')!.requestSubmit());
  await settle();
  expect(vi.mocked(answerHunch)).toHaveBeenCalledWith('h1', { answer: 'not_quite', correction: 'It is about room to grow.' }, { profile: VIEWER_ID });
  expect(world.container.querySelector('.waka-reading-old')?.textContent).toBe('Two of your saves are about leaving somewhere. Am I close?');
  expect(bubble()).toContain('Rethinking');
  HUNCH.now = { id: 'h2', body: 'You keep saving places with room to grow. Am I close?', inspirationIds: ['quit'], status: 'pending' };
  await settle(1000);
  expect(bubble(), 'the new hunch did not take its place').toContain('You keep saving places with room to grow. Am I close?');
  expect(world.container.querySelector('.waka-reading-old')).toBeNull();
});

it('Yes thanks the person and answers the hunch', async () => {
  world = await mountWorld(FACTS); await settle();
  await act(async () => act_('Yes')!.click()); await settle();
  expect(vi.mocked(answerHunch)).toHaveBeenCalledWith('h1', { answer: 'yes' }, { profile: VIEWER_ID });
  expect(bubble()).toContain('Thanks. That helps.');
});

/* CODE REVIEW, 2026-11-26: the first save asked once, before the job had
   written anything, and the hunch never showed until another save or a
   reload. A save keeps asking while the job writes. */
it('shows the hunch that lands a few seconds after a save', async () => {
  HUNCH.now = null;
  world = await mountWorld(FACTS); await settle();
  expect(bubble()).not.toContain('Am I close?');
  await pressHomeBar(world.container, 'Save an inspiration'); await settle();
  const field = world.container.querySelector<HTMLTextAreaElement>('textarea.jar-composer-text')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'Glued the chair myself.');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
  await act(async () => world!.container.querySelector<HTMLButtonElement>('.waka-dock-save')!.click());
  await settle(200);
  HUNCH.now = { id: 'h3', body: 'You keep fixing things by hand. Am I close?', inspirationIds: ['new-save'], status: 'pending' };
  await settle(3000); // the job writes while "Saved" stands (its 20 seconds)
  expect(vi.mocked(fetchHunch).mock.calls.length, 'nothing asked again after the save').toBeGreaterThan(2);
  await settle(3000);
  expect(bubble(), 'the hunch written after the save never showed').toContain('You keep fixing things by hand. Am I close?');
});
