// @vitest-environment jsdom
/**
 * "NOT QUITE" REWRITES A READING IN FRONT OF YOU (insight goal, phase 4,
 * 2026-11-26; canvas board "Not quite").
 *
 * A long press on the reading offers Not quite; the creature asks "What's
 * closer?", the answer is typed in the home bar, the server hears it as
 * "partly" with those words, the old line stands struck through while it
 * rethinks, and the new reading takes its place when it lands.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): through `helpers/render-home`,
 * `lib/data` (the reading the world reads, which changes once the answer is
 * in), `lib/api` (the verbs a mounted world asks for on boot, and
 * `createFeedback`, the answer's one write), `lib/auth-context` (a signed-in
 * owner) and the canvas (`helpers/canvas-stub`). The page, the bar and the
 * bubble are the shipped ones.
 */
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { installCanvasStub, setViewport } from './helpers/canvas-stub';
import { mountWorld, dataMockFrom, apiMockFrom, VIEWER_ID, type MountedWorld } from './helpers/render-home';
import { createFeedback } from '../src/lib/api';

const FACTS = vi.hoisted(() => ({ inspirations: [
  { id: 'river', text: 'Walked home the long way to hear the river.', daysAgo: 1 },
  { id: 'quit', text: 'I want to quit my job and build something of my own.', daysAgo: 2 },
] }));
const READING = vi.hoisted(() => ({ body: 'You keep saving ways out.' }));
vi.mock('../src/lib/data', async (original) => ({ ...await original<typeof import('../src/lib/data')>(), ...dataMockFrom(FACTS),
  loadSignals: async () => [{ id: 'sig', inspirationIds: ['river', 'quit'], statement: 'Choosing your own path', status: 'active',
    confidence: 60, evidenceCount: 2, lastEvidenceMs: Date.now(), createdMs: Date.now(), locked: false, unsupported: false }],
  loadTopOfMind: async () => ({ id: 'reading', version: 1, reason: 'initial', createdMs: Date.now(), entries: [{
    id: 'entry', type: 'pattern', body: READING.body, belief: null, prompt: null, locked: false, pinned: false,
    dismissed: false, sortOrder: 0, citedSignals: [{ id: 'sig', statement: 'Choosing your own path' }], createdMs: Date.now() }] }),
}));
vi.mock('../src/lib/api', async (original) => ({ ...await original<typeof import('../src/lib/api')>(), ...apiMockFrom(FACTS),
  createFeedback: vi.fn(async () => ({ id: 'f', profileId: 'p', targetType: 'top_of_mind_entry', targetId: 'entry', value: 'partly', correctionText: 'x', createdAt: '' })) }));
vi.mock('../src/lib/auth-context', async (original) => {
  const session = { status: 'authenticated', account: { id: 'account-1', email: 'you@example.test' },
    profile: { id: VIEWER_ID, name: 'You', type: 'human' }, profiles: [], refresh: async () => undefined, signOut: async () => undefined };
  return { ...await original<typeof import('../src/lib/auth-context')>(), useOptionalAuth: () => session, useAuth: () => session };
});

let world: MountedWorld | undefined;
beforeAll(() => { installCanvasStub(); setViewport(390, 844); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { localStorage.clear(); READING.body = 'You keep saving ways out.'; vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
afterEach(() => { world?.unmount(); world = undefined; vi.useRealTimers(); });
async function settle(ms = 100) { for (let turn = 0; turn < 8; turn += 1) { await world!.step(100); await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); } }
const bubble = () => world!.container.querySelector('.jar-char-bubble')?.textContent ?? '';

it('asks what is closer, takes the answer in the bar, and shows the new reading when it lands', async () => {
  world = await mountWorld(FACTS); await settle();
  const words = world.container.querySelector<HTMLElement>('.jar-char-bubble-reading')!;
  await act(async () => { words.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); });
  const notQuite = [...document.querySelectorAll<HTMLButtonElement>('.waka-action-sheet button')].find(b => b.textContent === 'Not quite');
  expect(notQuite, 'the long press does not offer Not quite').toBeTruthy();
  await act(async () => notQuite!.click()); await settle();
  expect(bubble()).toContain('What’s closer?');
  const field = world.container.querySelector<HTMLInputElement>('.waka-home-bar-answer-field');
  expect(field, 'the bar did not become the answer box').not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'Room to grow, not a way out.');
    field!.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => world!.container.querySelector<HTMLFormElement>('.waka-home-bar-answer')!.requestSubmit());
  await settle();
  expect(vi.mocked(createFeedback)).toHaveBeenCalledWith({ targetType: 'top_of_mind_entry', targetId: 'entry', value: 'partly', correctionText: 'Room to grow, not a way out.' });
  expect(world.container.querySelector('.waka-reading-old')?.textContent, 'the answered line is not shown struck').toBe('You keep saving ways out.');
  expect(bubble()).toContain('Rethinking');
  READING.body = 'You keep saving places to grow, not ways out.';
  await settle(1000);
  expect(bubble(), 'the new reading did not take its place').toContain('You keep saving places to grow, not ways out.');
  expect(world.container.querySelector('.waka-reading-old')).toBeNull();
});
