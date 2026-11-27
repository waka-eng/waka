// @vitest-environment jsdom
/**
 * A READING SHOWS THE SAVES IT CAME FROM (insight goal, phase 1, 2026-11-26).
 *
 * A read you can trace is a read you believe. Under the home reading stand the
 * saves it rests on: "From 2 inspirations" opens exactly those, in the sheet.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): through `helpers/render-home`, `lib/data`
 * (the three layers the world reads: two saves, one signal citing both, one reading citing the signal),
 * `lib/api` (the verbs a mounted world asks for on boot), `lib/auth-context`
 * (a signed-in owner) and the canvas (`helpers/canvas-stub`). The page, the
 * walk from the reading to its saves and the navigation are the shipped ones.
 */
import { act } from 'react';
import { useLocation } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { installCanvasStub, setViewport } from './helpers/canvas-stub';
import { mountWorld, dataMockFrom, apiMockFrom, VIEWER_ID, type MountedWorld } from './helpers/render-home';

const FACTS = vi.hoisted(() => ({ inspirations: [
  { id: 'river', text: 'Walked home the long way to hear the river.', daysAgo: 1 },
  { id: 'quit', text: 'I want to quit my job and build something of my own.', daysAgo: 2 },
  { id: 'other', text: 'Something unrelated.', daysAgo: 3 },
] }));
vi.mock('../src/lib/data', async (original) => ({ ...await original<typeof import('../src/lib/data')>(), ...dataMockFrom(FACTS),
  loadSignals: async () => [{ id: 'sig', inspirationIds: ['river', 'quit'], statement: 'Choosing your own path', status: 'active',
    confidence: 60, evidenceCount: 2, lastEvidenceMs: Date.now(), createdMs: Date.now(), locked: false, unsupported: false }],
  loadTopOfMind: async () => ({ id: 'reading', version: 1, reason: 'initial', createdMs: Date.now(), entries: [{
    id: 'entry', type: 'pattern', body: 'You keep choosing places over plans.', belief: null, prompt: null, locked: false, pinned: false,
    dismissed: false, sortOrder: 0, citedSignals: [{ id: 'sig', statement: 'Choosing your own path' }], createdMs: Date.now() }] }),
}));
vi.mock('../src/lib/api', async (original) => ({ ...await original<typeof import('../src/lib/api')>(), ...apiMockFrom(FACTS) }));
vi.mock('../src/lib/auth-context', async (original) => {
  const session = { status: 'authenticated', account: { id: 'account-1', email: 'you@example.test' },
    profile: { id: VIEWER_ID, name: 'You', type: 'human' }, profiles: [], refresh: async () => undefined, signOut: async () => undefined };
  return { ...await original<typeof import('../src/lib/auth-context')>(), useOptionalAuth: () => session, useAuth: () => session };
});

let world: MountedWorld | undefined, location: ReturnType<typeof useLocation>;
function Where() { location = useLocation(); return null; }
beforeAll(() => { installCanvasStub(); setViewport(390, 844); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { localStorage.clear(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
afterEach(() => { world?.unmount(); world = undefined; vi.useRealTimers(); });
async function settle() { for (let turn = 0; turn < 8; turn += 1) { await world!.step(100); await act(async () => { await vi.advanceTimersByTimeAsync(100); }); } }

it('says how many saves a reading rests on, and opens exactly those', async () => {
  world = await mountWorld(FACTS, { routerTools: <Where /> }); await settle();
  expect(world.container.querySelector('.waka-reading-from'), 'the saves came back as chips').toBeNull();
  const from = [...world.container.querySelectorAll<HTMLButtonElement>('.jar-char-bubble-act')].find(b => b.textContent === 'From 2 inspirations');
  expect(from, 'the reading does not say what it came from').toBeTruthy();
  await act(async () => from!.click()); await settle();
  expect(new URLSearchParams(location.search).get('open')).toBe('saves');
  const rows = [...world.container.querySelectorAll('.waka-page--sheet .waka-list-lead')].map(row => row.textContent);
  expect(rows, 'the sheet did not show exactly the saves the reading rests on').toEqual([
    'I want to quit my job and build something of my own.', 'Walked home the long way to hear the river.']);
});
