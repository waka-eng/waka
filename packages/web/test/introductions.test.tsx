// @vitest-environment jsdom
/**
 * INTRODUCTIONS ON HOME (design "Agent introductions", approved 2026-11-27).
 *
 * The three states on the board: the ask (what is compared and what stays
 * private, right under the question), the introduction (their creature
 * beside yours, "You both hold" and the principle) and saying no ("Nothing
 * was shared", with Turn off introductions one press away). Plus the first
 * ask that turns introductions on, since they are off until a person says
 * Introduce us.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): through `helpers/render-home`,
 * `lib/data`, `lib/api` (the boot verbs, and the four introduction verbs:
 * the read and its three writes), `lib/auth-context` (a signed-in owner) and
 * the canvas (`helpers/canvas-stub`). The page, the bubble and the visiting
 * creature (`Companion`) are the shipped ones.
 */
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { installCanvasStub, setViewport } from './helpers/canvas-stub';
import { mountWorld, dataMockFrom, apiMockFrom, VIEWER_ID, type MountedWorld } from './helpers/render-home';
import { answerIntroduction, fetchIntroductions, markIntroductionSeen, setIntroductionConsent, type ApiIntroductionState } from '../src/lib/api';
import { INTRODUCTIONS_CHANGED } from '../src/lib/introductions';

const FACTS = vi.hoisted(() => ({ inspirations: [
  { id: 'river', text: 'Walked home the long way to hear the river.', daysAgo: 1 },
  { id: 'quit', text: 'I want to quit my job and build something of my own.', daysAgo: 2 },
] }));
const STATE = vi.hoisted(() => ({ now: null as unknown as ApiIntroductionState }));
vi.mock('../src/lib/data', async (original) => ({ ...await original<typeof import('../src/lib/data')>(), ...dataMockFrom(FACTS) }));
vi.mock('../src/lib/api', async (original) => ({ ...await original<typeof import('../src/lib/api')>(), ...apiMockFrom(FACTS),
  fetchHunch: vi.fn(async () => null),
  fetchIntroductions: vi.fn(async () => STATE.now),
  setIntroductionConsent: vi.fn(async () => undefined),
  answerIntroduction: vi.fn(async () => ({ stage: 'waiting' })),
  markIntroductionSeen: vi.fn(async () => undefined) }));
vi.mock('../src/lib/auth-context', async (original) => {
  const session = { status: 'authenticated', account: { id: 'account-1', email: 'you@example.test' },
    profile: { id: VIEWER_ID, name: 'You', type: 'human' }, profiles: [], refresh: async () => undefined, signOut: async () => undefined };
  return { ...await original<typeof import('../src/lib/auth-context')>(), useOptionalAuth: () => session, useAuth: () => session };
});

const PRINCIPLE = 'I would rather finish something small than plan something big.';
const base = (over: Partial<ApiIntroductionState>): ApiIntroductionState =>
  ({ available: true, consent: { enabled: true, answered: true }, offerConsent: false, introduction: null, ...over });

let world: MountedWorld | undefined;
beforeAll(() => { installCanvasStub(); setViewport(390, 844); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  localStorage.clear();
  for (const fn of [answerIntroduction, fetchIntroductions, markIntroductionSeen, setIntroductionConsent]) vi.mocked(fn).mockClear();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => { world?.unmount(); world = undefined; vi.useRealTimers(); });
async function settle(ms = 100) { for (let turn = 0; turn < 6; turn += 1) { await world!.step(100); await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); } }
const bubble = () => world!.container.querySelector('.waka-intro-bubble')?.textContent ?? '';
const press = async (label: string) => {
  const button = [...world!.container.querySelectorAll<HTMLButtonElement>('.waka-intro-bubble .jar-char-bubble-act')].find(b => b.textContent === label);
  expect(button, `no "${label}" in the bubble`).toBeTruthy();
  await act(async () => button!.click()); await settle();
};

it('asks first, says what is compared under the question, and Introduce us turns introductions on', async () => {
  STATE.now = base({ consent: { enabled: false, answered: false }, offerConsent: true });
  world = await mountWorld(FACTS); await settle();
  expect(bubble()).toContain('Want an introduction when someone else holds one of your principles?');
  expect(bubble()).toContain('Only principles are compared, never your saves.');
  expect(world.container.querySelector('.waka-intro-edge'), 'no match yet, so no light waits').toBeNull();
  STATE.now = base({});
  await press('Introduce us');
  expect(vi.mocked(setIntroductionConsent)).toHaveBeenCalledWith(true);
  expect(bubble()).toContain('Introductions are on.');
  await press('Done');
  expect(world.container.querySelector('.waka-intro-bubble')).toBeNull();
});

it('Not now on the first ask leaves introductions off and says nothing more', async () => {
  STATE.now = base({ consent: { enabled: false, answered: false }, offerConsent: true });
  world = await mountWorld(FACTS); await settle();
  await press('Not now');
  expect(vi.mocked(setIntroductionConsent)).toHaveBeenCalledWith(false);
  expect(world.container.querySelector('.waka-intro-bubble')).toBeNull();
});

it('the ask: a match, anonymous, with their light waiting at the edge', async () => {
  STATE.now = base({ introduction: { id: 'i1', stage: 'ask' } });
  world = await mountWorld(FACTS); await settle();
  expect(bubble()).toContain('Someone else holds one of your principles. Want an introduction?');
  expect(bubble()).toContain('Names are shared only if you both say yes.');
  expect(world.container.querySelector('.waka-intro-edge')).not.toBeNull();
  expect(world.container.querySelector('.waka-intro-guest'), 'nobody visits before both say yes').toBeNull();
  vi.mocked(answerIntroduction).mockResolvedValueOnce({ stage: 'waiting' });
  STATE.now = base({});
  await press('Introduce us');
  expect(vi.mocked(answerIntroduction)).toHaveBeenCalledWith('i1', 'yes');
  expect(bubble()).toContain('If they say yes too');
});

it('the introduction: their creature, the real one in cooler light and with no name, beside yours under "You both hold"', async () => {
  STATE.now = base({ introduction: { id: 'i1', stage: 'introduced', principle: PRINCIPLE } });
  world = await mountWorld(FACTS); await settle();
  expect(bubble()).toContain('You both hold');
  expect(bubble()).toContain(PRINCIPLE);
  const guest = world.container.querySelector('.waka-intro-guest');
  expect(guest?.querySelector('canvas.waka-companion-body'), 'the guest is not the real Companion').not.toBeNull();
  expect(guest?.querySelector('[role="img"]')?.getAttribute('aria-label'), 'the guest is named').toBe('Someone');
  expect(world.container.querySelector('.waka-intro-bridge')).not.toBeNull();
  expect(world.container.querySelector('.waka-intro-scene')?.textContent, 'the guest carries a label').toBe('');
  expect(world.container.querySelector('.waka-principles-spark'), 'the spark steps aside for the guest').toBeNull();
  STATE.now = base({});
  await press('Done');
  expect(vi.mocked(markIntroductionSeen)).toHaveBeenCalledWith('i1');
  expect(world.container.querySelector('.waka-intro-guest')).toBeNull();
});

it('saying no: their light leaves, nothing was shared, and turning introductions off is one press', async () => {
  STATE.now = base({ introduction: { id: 'i1', stage: 'ask' } });
  world = await mountWorld(FACTS); await settle();
  vi.mocked(answerIntroduction).mockResolvedValueOnce({ stage: 'declined' });
  STATE.now = base({});
  await press('Not now');
  expect(vi.mocked(answerIntroduction)).toHaveBeenCalledWith('i1', 'no');
  expect(bubble()).toContain('Nothing was shared, and they won’t know you were asked.');
  expect(world.container.querySelector('.waka-intro-edge--leaving')).not.toBeNull();
  await press('Turn off introductions');
  expect(vi.mocked(setIntroductionConsent)).toHaveBeenCalledWith(false);
  expect(bubble()).toContain('Introductions are off.');
});

it('says nothing where introductions are not offered', async () => {
  STATE.now = base({ available: false, introduction: { id: 'i1', stage: 'ask' }, offerConsent: true });
  world = await mountWorld(FACTS); await settle();
  expect(world.container.querySelector('.waka-intro-bubble')).toBeNull();
  expect(world.container.querySelector('.waka-intro-edge')).toBeNull();
});

it('after Introduce us, keeps asking for a minute, so the first match shows without a reload', async () => {
  STATE.now = base({ consent: { enabled: false, answered: false }, offerConsent: true });
  world = await mountWorld(FACTS); await settle();
  await press('Introduce us');
  const asked = vi.mocked(fetchIntroductions).mock.calls.length;
  STATE.now = base({ introduction: { id: 'i9', stage: 'ask' } });
  await settle(1000);
  expect(vi.mocked(fetchIntroductions).mock.calls.length, 'nothing asked again after turning on').toBeGreaterThan(asked);
  expect(bubble(), 'the match the server made did not show').toContain('Someone else holds one of your principles.');
});

it('a line answering the last act never hides an ask the server has', async () => {
  STATE.now = base({ introduction: { id: 'i1', stage: 'ask' } });
  world = await mountWorld(FACTS); await settle();
  vi.mocked(answerIntroduction).mockResolvedValueOnce({ stage: 'declined' });
  STATE.now = base({ introduction: { id: 'i2', stage: 'ask' } });
  await press('Not now');
  expect(bubble()).toContain('Someone else holds one of your principles.');
  expect(world.container.querySelector('.waka-intro-bubble .jar-char-bubble-act')?.textContent).toBe('Introduce us');
});

it('hears Settings turn introductions off, and drops what it was saying', async () => {
  STATE.now = base({ introduction: { id: 'i1', stage: 'ask' } });
  world = await mountWorld(FACTS); await settle();
  expect(bubble()).toContain('Someone else holds');
  STATE.now = base({ consent: { enabled: false, answered: true } });
  await act(async () => { window.dispatchEvent(new CustomEvent(INTRODUCTIONS_CHANGED, { detail: { enabled: false } })); });
  await settle();
  expect(world.container.querySelector('.waka-intro-bubble')).toBeNull();
});
