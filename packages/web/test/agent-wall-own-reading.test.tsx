// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/data` supplies the three layers,
 * and `loadTopOfMind` answers by PROFILE — the owner has one top of mind and
 * their agent another, which is the whole point: the bug only shows when both
 * exist and differ. `lib/api` supplies the boot reads, `lib/api/principles`
 * principle reads, `lib/auth-context` the session. `helpers/render-home` and
 * `helpers/canvas-stub` replace canvas/viewport/clock/randomness; the real
 * world, the real form switch and the real agent bundle loader all run.
 * Appearance/SQL are not claimed.
 *
 * ═══ AN AGENT'S WALL SAYS ITS OWN TOP OF MIND ═══════════════════════════════
 *
 * Screenshot check, 2026-10-16: on "My agent" the bubble said "I haven't
 * formed anything yet" over a reading the server had returned. The bubble only
 * ever held YOUR reading — rightly scoped off the agent's wall — and nothing
 * took its place. It now holds the agent's own, in the agent's first person.
 */
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { installCanvasStub, setViewport } from './helpers/canvas-stub';
import { mountWorld, dataMockFrom, apiMockFrom, VIEWER_ID, type MountedWorld } from './helpers/render-home';

const FACTS = vi.hoisted(() => ({
  inspirations: [{ id: 'kept', text: 'Something I kept', daysAgo: 1 }],
  groups: [] as never[],
}));
const OWNER_SAYS = vi.hoisted(() => 'The owner keeps returning to slow mornings.');
const AGENT_SAYS = vi.hoisted(() => 'I keep the version that survives the runtime.');
/* NEWER, UNPINNED, AND FIRST IN THE LIST — the entry a "newest by date" or
   "first served" reading would pick. The agent's lead is the PINNED one, by
   the same rule as your own bubble's `lead`. */
const AGENT_NEWER = vi.hoisted(() => 'A later thought the agent has not pinned.');
/* A REAL AGENT ('agent-held') for the cases that need its reading to be
   pending, to fail, or to be honestly empty — and the reader's language. */
const HOLD = vi.hoisted(() => ({
  on: false, reading: 'hang' as 'hang' | 'fail' | 'empty' | 'board' | 'defer', locale: 'en-US' as 'en-US' | 'ko-KR',
  /* 'defer': the reading waits until the test says so, through this */
  release: null as null | (() => void),
}));

vi.mock('../src/lib/api/principles', async original => ({
  ...await original<typeof import('../src/lib/api/principles')>(),
  fetchPrincipleRead: vi.fn(async () => ({ principles: [], status: { phase: 'ready', eligible: false } })),
}));
vi.mock('../src/lib/data', async original => {
  const entry = (id: string, body: string, pinned: boolean, daysAgo: number) => ({
    id, type: 'hypothesis' as const, body, belief: null, prompt: null,
    locked: false, pinned, dismissed: false, sortOrder: 0, citedSignals: [],
    createdMs: Date.UTC(2026, 7, 16, 12) - daysAgo * 86_400_000,
  });
  const board = (entries: ReturnType<typeof entry>[]) => ({
    id: `tom-${entries[0]!.id}`, version: 1, reason: 'initial' as const, createdMs: Date.UTC(2026, 7, 14, 12), entries,
  });
  return {
    ...await original<typeof import('../src/lib/data')>(), ...dataMockFrom(FACTS),
    /* yours when no profile (or yours) is named; the agent's otherwise */
    loadTopOfMind: async (profile?: string) =>
      HOLD.on && profile === 'agent-held'
        ? HOLD.reading === 'hang' ? new Promise<never>(() => {})
          : HOLD.reading === 'defer'
            ? new Promise<ReturnType<typeof board>>((resolve) => {
                HOLD.release = () => resolve(board([entry('agent-newer', AGENT_NEWER, false, 1), entry('agent-lead', AGENT_SAYS, true, 3)]));
              })
          : HOLD.reading === 'fail' ? Promise.reject(new Error('reading unavailable'))
          : HOLD.reading === 'empty' ? null
          : board([entry('agent-newer', AGENT_NEWER, false, 1), entry('agent-lead', AGENT_SAYS, true, 3)])
      : profile && profile !== VIEWER_ID
        ? board([entry('agent-newer', AGENT_NEWER, false, 1), entry('agent-lead', AGENT_SAYS, true, 3)])
        : board([entry('owner-lead', OWNER_SAYS, false, 2)]),
  };
});
vi.mock('../src/lib/api', async original => ({
  ...await original<typeof import('../src/lib/api')>(), ...apiMockFrom(FACTS),
  fetchPrinciples: vi.fn(async () => []),
  fetchTheWeather: vi.fn(async () => ({ told: null, antechamber: [], days: [] })),
  fetchProfiles: vi.fn(async () => HOLD.on
    ? [{ id: 'agent-held', name: 'Held agent', type: 'agent', createdAt: '2026-08-01T00:00:00.000Z' }]
    : []),
}));
vi.mock('../src/lib/auth-context', async original => {
  const session = { status: 'authenticated', account: { id: 'account-1', email: 'you@example.test' },
    profile: { id: VIEWER_ID, name: 'You', type: 'human', get preferredLocale() { return HOLD.locale; } }, profiles: [], refresh: async () => undefined, signOut: async () => undefined };
  return { ...await original<typeof import('../src/lib/auth-context')>(), useOptionalAuth: () => session, useAuth: () => session };
});

let world: MountedWorld;
beforeAll(() => { installCanvasStub(); setViewport(1280, 900); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { localStorage.clear(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
afterEach(() => { world?.unmount(); vi.useRealTimers(); Object.assign(HOLD, { on: false, reading: 'hang', locale: 'en-US', release: null }); });

async function settle() {
  for (let turn = 0; turn < 12; turn += 1) { await world.step(100); await act(async () => { await vi.advanceTimersByTimeAsync(100); }); }
}
const face = (label: string) =>
  [...world.container.querySelectorAll<HTMLButtonElement>('.jar-char-face')]
    .find(button => button.textContent?.trim() === label);
const bubble = () => world.container.querySelector('.jar-char-bubble:not(.jar-char-bubble--review)');

it("holds up the agent's own reading on its wall, never the owner's", async () => {
  /* a REAL agent, so its bundle is a first load from these mocks — the dev
     fixture's agents arrive preloaded, and a refresh lands only at arrival */
  Object.assign(HOLD, { on: true, reading: 'board' });
  world = await mountWorld(FACTS); await settle();
  expect(bubble()?.textContent, 'the owner wall should say the owner\'s top of mind').toContain(OWNER_SAYS);

  const toAgent = face('My agent');
  expect(toAgent, 'the creature offers no way to take its agent form').toBeTruthy();
  /* NO RENDER IN BETWEEN MAY PUT YOUR SENTENCE IN ITS FRAME. `chrome` is
     written in an effect after the wall changes, so a bubble that read it
     showed the owner's line under the agent's "on my mind" for a frame. The
     switch is watched in small steps, and every one of them is checked.
     A LIMIT, MEASURED: `act` flushes the effect in the same turn as the
     render it follows, so that one stale commit never reaches the DOM here —
     pointing `agentSays` back at `chrome` still passes. The guard against it
     is structural (`agentSays` reads the agent bundle's `direction.current` in render);
     these checks hold the observable half: no settled step mislabels. */
  const mislabelled = () => {
    const b = bubble();
    return b?.querySelector('.jar-char-bubble-of')?.textContent?.trim() === 'This is what’s on my mind right now.'
      && (b.textContent ?? '').includes(OWNER_SAYS);
  };
  await act(async () => { toAgent!.click(); });
  expect(mislabelled(), 'the switch rendered the owner\'s sentence in the agent\'s frame').toBe(false);
  for (let turn = 0; turn < 60; turn += 1) {
    await world.step(5); await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    expect(mislabelled(), `the owner's sentence sat in the agent's frame at step ${turn}`).toBe(false);
  }
  await settle();
  expect(world.audit().wallKind).toBe('agent');

  const said = bubble();
  expect(said?.textContent ?? '', 'the owner\'s sentence leaked onto the agent\'s wall').not.toContain(OWNER_SAYS);
  expect(said?.querySelector('.jar-char-bubble-reading')?.textContent?.trim(),
    'the agent wall fell through to the resting line over a reading it holds').toBe(AGENT_SAYS);
  expect(said?.querySelector('.jar-char-bubble-of')?.textContent?.trim()).toBe('This is what’s on my mind right now.');
  expect(said?.textContent ?? '', 'the bubble held the newest entry rather than the pinned lead').not.toContain(AGENT_NEWER);
});

/* ═══ NO BUBBLE WHILE THE AGENT'S BUNDLE HAS NOT ARRIVED ═══════════════════
   Its first load is still out, so the app does not know whether the agent
   has formed anything; "nothing adopted yet" there would be a claim about it.
   Founder: "no bubble at all while there is nothing true to put in it"
   (code review round 3, 2026-10-16). */
it("says nothing on an agent's wall whose first load is still pending", async () => {
  HOLD.on = true;
  world = await mountWorld(FACTS); await settle();
  const toAgent = face('My agent');
  expect(toAgent, 'the creature offers no way to take its agent form').toBeTruthy();
  await act(async () => { toAgent!.click(); });
  await settle();
  expect(world.audit().wallKind).toBe('agent');
  expect(bubble(), 'a bubble spoke for an agent whose bundle has not arrived').toBeNull();
});

/* ═══ A READING THAT COULD NOT BE READ IS NOT "NOTHING FORMED" ═════════════
   The first load forgives a failed top-of-mind read as an empty board, so
   the wall would say "I haven't formed anything yet" over a reading that
   exists. It says nothing instead (final review, 2026-10-16). */
it("says nothing on an agent's wall whose reading failed to load", async () => {
  Object.assign(HOLD, { on: true, reading: 'fail' });
  world = await mountWorld(FACTS); await settle();
  await act(async () => { face('My agent')!.click(); });
  await settle();
  expect(world.audit().wallKind).toBe('agent');
  expect(bubble(), 'a failed read was told as "nothing formed"').toBeNull();
});

/* ═══ AND THE RESTING LINE IS IN THE READER'S LANGUAGE ═════════════════════
   `wallChromeNow` derived the agent's chrome without a locale, so a Korean
   reader's agent said its resting line in English (final review,
   2026-10-16). */
it("says an empty agent's resting line in Korean to a Korean reader", async () => {
  Object.assign(HOLD, { on: true, reading: 'empty', locale: 'ko-KR' });
  world = await mountWorld(FACTS); await settle();
  const toAgent = face('내 에이전트');
  expect(toAgent, 'the creature offers no way to take its agent form').toBeTruthy();
  await act(async () => { toAgent!.click(); });
  await settle();
  expect(world.audit().wallKind).toBe('agent');
  expect(bubble()?.querySelector('.jar-char-bubble-reading')?.textContent?.trim()).toBe('아직 아무것도 만들어 내지 못했어요');
});

/* ═══ A FIRST LOAD THAT FINISHES MID-AIM LANDS WHEN THE AIM ENDS ═══════════
   Landing waits for rest, and the only rest it used to hear about was an
   ARRIVAL. Aiming down to the ground and back up stops on the same wall, so
   `atWall` never changes: the reading that came back mid-aim sat pending and
   the wall stayed silent over it (retro review of #436, 2026-10-17). */
type Sim = { toGround(): void; toTop(): void; isResting(): boolean };
const simNow = () => (window as unknown as { wakaSim: () => Sim | null }).wakaSim()!;
/** Let every promise the release set off run to the end, WITHOUT a frame:
    frames only advance through `world.step`, so the camera holds still. */
const flushFetch = async () => {
  await act(async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); await vi.advanceTimersByTimeAsync(0); });
};
const reading = () => bubble()?.querySelector('.jar-char-bubble-reading')?.textContent?.trim();
async function standOnHeldAgent() {
  Object.assign(HOLD, { on: true, reading: 'defer' });
  world = await mountWorld(FACTS); await settle();
  await act(async () => { face('My agent')!.click(); });
  await settle();
  expect(world.audit().wallKind).toBe('agent');
  expect(bubble(), 'the reading was released before the test released it').toBeNull();
  expect(HOLD.release, 'the agent\'s reading was never asked for').toBeTruthy();
}

it("lands an agent's first load that finished while the camera was aiming", async () => {
  await standOnHeldAgent();
  const sim = simNow();
  await act(async () => { sim.toGround(); });
  await world.step(2);
  expect(sim.isResting(), 'the aim had already ended — this would test arrival, not rest').toBe(false);
  /* THE FETCH FINISHES MID-AIM, and is seen to: everything it set off has
     run, the camera is still aiming, and the reading is NOT on the wall —
     so what lands it below can only be the aim ending, never the
     fetch-completion path. */
  HOLD.release!();
  await flushFetch();
  expect(sim.isResting(), 'the aim ended while the fetch was settling').toBe(false);
  expect(reading(), 'the bundle landed mid-aim, rebuilding a moving world').toBeUndefined();
  await settle();
  await act(async () => { sim.toTop(); });
  await settle();
  expect(world.audit().wallKind, 'the aim crossed walls — this would test arrival, not rest').toBe('agent');
  expect(reading(), 'a first load that finished mid-aim never landed on the wall it was standing on').toBe(AGENT_SAYS);
});

/* ═══ AND A ONE-MILLISECOND AIM STILL ENDS IN A REST ═══════════════════════
   Under reduced motion an aim lasts 1ms: it starts and commits between two
   frames, so a frame-to-frame "was moving, now still" comparison never saw
   it move — and never said it stopped. The latch does. */
it("lands a first load released inside a reduced-motion aim", async () => {
  const original = window.matchMedia;
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: (query: string) => ({
    ...original(query), matches: /prefers-reduced-motion:\s*reduce/.test(query),
  }) });
  try {
    await standOnHeldAgent();
    const sim = simNow();
    await act(async () => { sim.toGround(); });
    expect(sim.isResting(), 'toGround did not start an aim').toBe(false);
    HOLD.release!();
    await flushFetch();
    expect(reading(), 'the bundle landed before the aim ended').toBeUndefined();
    await world.step(1);
    expect(sim.isResting(), 'a reduced-motion aim outlived one frame').toBe(true);
    await settle();
    await act(async () => { sim.toTop(); });
    await world.step(3);
    expect(reading(), 'a 1ms aim never reported its rest').toBe(AGENT_SAYS);
  } finally {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: original });
  }
});
