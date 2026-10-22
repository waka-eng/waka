// @vitest-environment jsdom
/**
 * THE AURA'S REACH IS THE WALL OWNER'S SAVING — ON AN AGENT'S WALL TOO.
 *
 * Founder, 2026-10-21: "the brightness should reflect how much inspirations
 * the person has been saving." `savingLight` is pinned in
 * `saving-light.test.ts`; this suite pins that the running world actually
 * feeds it, on both walls. The agent's case is the regression it exists for:
 * the agent wall's reading was kept on its RESIDENT, `residents` is empty at
 * the start of every run, and the agent's bundle landing on approach IS a
 * rebuild — so on the agent's wall, with its saves loaded, the light went
 * dark until something woke the wall again.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `lib/data` supplies the three layers
 * (the same five recent saves for whichever profile asks, so the agent has a
 * busy week of its own); `lib/api` the boot reads and an agent in the roster,
 * so its bundle is a real first load on approach; `lib/api/principles` the
 * principle reads; `lib/auth-context` the session. `helpers/render-home` and
 * `helpers/canvas-stub` replace canvas/viewport/clock/randomness; the real
 * world, the real form switch and the real agent bundle loader all run.
 * Appearance is not claimed — `aura` is read off the audit as the numbers the
 * loop drew with, never as pixels.
 */
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { installCanvasStub, setViewport } from './helpers/canvas-stub';
import { mountWorld, dataMockFrom, apiMockFrom, VIEWER_ID, type MountedWorld } from './helpers/render-home';

/* five saves across the last four days: "a busy week" by the rule */
const FACTS = vi.hoisted(() => ({
  inspirations: [0, 1, 2, 3, 4].map((daysAgo) => ({ id: `kept-${daysAgo}`, text: `Something I kept ${daysAgo}`, daysAgo })),
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
  fetchTheWeather: vi.fn(async () => ({ told: null, antechamber: [], days: [] })),
  fetchProfiles: vi.fn(async () => [{ id: 'agent-busy', name: 'Busy agent', type: 'agent', createdAt: '2026-08-01T00:00:00.000Z' }]),
}));
vi.mock('../src/lib/auth-context', async original => {
  const session = { status: 'authenticated', account: { id: 'account-1', email: 'you@example.test' },
    profile: { id: VIEWER_ID, name: 'You', type: 'human', preferredLocale: 'en-US' }, profiles: [], refresh: async () => undefined, signOut: async () => undefined };
  return { ...await original<typeof import('../src/lib/auth-context')>(), useOptionalAuth: () => session, useAuth: () => session };
});

let world: MountedWorld;
beforeAll(() => { installCanvasStub(); setViewport(1280, 900); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { localStorage.clear(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
afterEach(() => { world?.unmount(); vi.useRealTimers(); });

async function settle(turns = 12) {
  for (let turn = 0; turn < turns; turn += 1) { await world.step(100); await act(async () => { await vi.advanceTimersByTimeAsync(100); }); }
}
const face = (label: string) =>
  [...world.container.querySelectorAll<HTMLButtonElement>('.jar-char-face')]
    .find(button => button.textContent?.trim() === label);

it('throws the aura wide on your wall after a busy week of saving', async () => {
  world = await mountWorld(FACTS); await settle();
  const { aura, wallKind } = world.audit();
  expect(wallKind).toBe('self');
  expect(aura.reading, 'five saves this week should read as clearly bright').toBeGreaterThanOrEqual(0.6);
  expect(aura.lit, 'the drawn reach never eased up to the reading').toBeGreaterThanOrEqual(0.55);
});

it("reads the agent's own saving on its wall, after the rebuild its bundle causes", async () => {
  world = await mountWorld(FACTS); await settle();
  const toAgent = face('My agent');
  expect(toAgent, 'the creature offers no way to take its agent form').toBeTruthy();
  await act(async () => { toAgent!.click(); });
  await settle(20);
  const { aura, wallKind, present } = world.audit();
  expect(wallKind).toBe('agent');
  expect(present, "the agent's saves never landed on its wall").toBeGreaterThan(0);
  expect(aura.reading, "the agent wall's reading went dark with its saves loaded").toBeGreaterThanOrEqual(0.6);
  expect(aura.lit, 'the drawn reach on the agent wall never eased up to the reading').toBeGreaterThanOrEqual(0.55);

  /* COMING BACK AFTER A WHILE refreshes the agent's bundle in place, which
     rebuilds the loop while you stand on its wall — and nothing re-wakes a
     wall you never left. The light must survive that. */
  let visibility: DocumentVisibilityState = 'hidden';
  const spy = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  const clock = Date.now;
  try {
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    Date.now = () => clock() + 60_000;
    visibility = 'visible';
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await settle(20);
  } finally {
    Date.now = clock;
    spy.mockRestore();
  }
  const after = world.audit();
  expect(after.wallKind).toBe('agent');
  expect(after.aura.reading).toBeGreaterThanOrEqual(0.6);
  expect(after.aura.lit, 'the rebuild on the agent wall put its light out').toBeGreaterThanOrEqual(0.55);
});
