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
/* when set, the agent has kept nothing — a dim wall to walk onto */
const AGENT = vi.hoisted(() => ({ empty: false }));
vi.mock('../src/lib/data', async original => {
  const facts = dataMockFrom(FACTS);
  return {
    ...await original<typeof import('../src/lib/data')>(), ...facts,
    loadInspirations: async (profile?: string) =>
      AGENT.empty && profile === 'agent-busy' ? { inspirations: [], total: 0, short: false } : facts.loadInspirations(),
  };
});
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
const BUSY_WEEK = FACTS.inspirations.slice();
afterEach(() => { world?.unmount(); vi.useRealTimers(); FACTS.inspirations = BUSY_WEEK.slice(); AGENT.empty = false; });

async function settle(turns = 12) {
  for (let turn = 0; turn < turns; turn += 1) { await world.step(100); await act(async () => { await vi.advanceTimersByTimeAsync(100); }); }
}
/* the creature's own sentence, as `speech-on-switch` reads it */
const speech = () => world.container
  .querySelector('.jar-char-bubble:not(.jar-char-bubble--review) .jar-char-bubble-reading[role="status"]')?.textContent?.trim() ?? null;
const press = () => world.container.querySelector<HTMLButtonElement>('.jar-char-press');
const QUIET = ['Quiet lately', 'It has been quiet', 'Nothing new in a while'];
const WARM = ['Something is still warm from last week', 'Last week is still holding on'];
const FRONTIER = ['Some of these still hold nothing up', 'There are memories here nothing rests on'];
async function ask(): Promise<string | null> {
  expect(press(), 'the creature has nothing to press').toBeTruthy();
  await act(async () => { press()!.click(); });
  await settle(4);
  return speech();
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

it('sends motes up off a bright aura, on the same reach that draws them', async () => {
  /* Emission read the field's aliveness while drawing read the saving reach,
     so a busy saver whose notes are not yet "alive" emitted nothing at all. */
  world = await mountWorld(FACTS); await settle();
  expect(world.audit().aura.lit).toBeGreaterThan(0.55);
  let rising = 0;
  for (let turn = 0; turn < 20 && rising === 0; turn += 1) {
    await world.step(30);
    rising = world.audit().aura.rising;
  }
  expect(rising, 'a bright aura sent nothing up').toBeGreaterThan(0);
});

it("reads the agent's own saving on its wall, after the rebuild its bundle causes", async () => {
  world = await mountWorld(FACTS); await settle();
  const toAgent = face('Busy agent');
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

it('never calls a bright companion quiet: its words read the same light as its glow', async () => {
  world = await mountWorld(FACTS); await settle();
  expect(world.audit().aura.lit).toBeGreaterThan(0.55);
  const said = await ask();
  expect(QUIET, `a bright aura said "${said}"`).not.toContain(said);
  expect(WARM, `a bright aura said "${said}"`).not.toContain(said);
});

it('says it has been quiet when nothing has been saved in weeks', async () => {
  FACTS.inspirations = [30, 31, 32, 33, 34].map((daysAgo) => ({ id: `old-${daysAgo}`, text: `Something old ${daysAgo}`, daysAgo }));
  /* "now" is the newest save, so the quiet stretch is the time since it:
     one save today keeps the dial on today while the rest are weeks old */
  FACTS.inspirations.push({ id: 'today-but-alone', text: 'One today', daysAgo: 0 });
  world = await mountWorld(FACTS); await settle();
  expect(world.audit().aura.lit).toBeLessThanOrEqual(0.55);
  const said = await ask();
  expect([...QUIET, ...WARM, ...FRONTIER], `a dim aura said "${said}"`).toContain(said);
});

it('lets motes already in the air finish their rise when the reach drops', async () => {
  /* Drawing was gated on the reach too, so the frame the aura dipped under
     the threshold every mote in flight vanished at once. */
  AGENT.empty = true;
  world = await mountWorld(FACTS); await settle();
  let rising = 0;
  for (let turn = 0; turn < 40 && rising < 2; turn += 1) {
    await world.step(10);
    rising = world.audit().aura.rising;
  }
  expect(rising, 'a bright aura sent nothing up').toBeGreaterThan(0);
  await act(async () => { face('Busy agent')!.click(); });
  /* frame by frame until the reach is under the line, then look */
  let dipped: ReturnType<MountedWorld['audit']>['aura'] | null = null;
  for (let frame = 0; frame < 400 && !dipped; frame += 1) {
    await world.step(1);
    const { aura } = world.audit();
    if (aura.lit <= 0.55) dipped = aura;
  }
  expect(dipped, 'the reach never dropped on an empty wall').not.toBeNull();
  expect(dipped!.rising, 'every mote had already gone before the reach dropped').toBeGreaterThan(0);
  expect(dipped!.risingDrawn, 'motes in flight vanished the frame the reach dropped').toBe(dipped!.rising);
  /* and they do go: nothing new leaves under a dim aura */
  await settle(10);
  expect(world.audit().aura.rising).toBe(0);
});

it("already knows the agent wall's reading before you walk onto it", async () => {
  /* Its memories are only switched on once you arrive, and the reading used
     to count only switched-on ones — so every wall but yours read dark until
     the crossing ended, and the light eased up from nothing each time. */
  world = await mountWorld(FACTS); await settle();
  const toAgent = face('Busy agent');
  await act(async () => { toAgent!.click(); });
  await settle(20);
  const back = face('Me');
  expect(back, 'the creature offers no way back to your form').toBeTruthy();
  await act(async () => { back!.click(); });
  await settle(20);
  const { wallKind, aura } = world.audit();
  expect(wallKind).toBe('self');
  expect(aura.byWall['agent-busy'], "the agent wall read dark while you stood on your own").toBeGreaterThanOrEqual(0.6);
});

/* ═══ A PRESS ON THE CREATURE LIGHTS THE CREATURE ═══════════════════════════
   Founder: "debug why no light when clicking on the character." The canvas
   tap raised the loop's flare, but `.jar-char-press` sits over the creature on
   your own wall and takes the click first, so the body never brightened —
   only a faint CSS gradient faded in over it. These read the loop's own
   numbers: the reach it drew with, before and after the press. */
const OLD_WEEKS = () => {
  FACTS.inspirations = [30, 31, 32, 33, 34].map((daysAgo) => ({ id: `old-${daysAgo}`, text: `Something old ${daysAgo}`, daysAgo }));
  FACTS.inspirations.push({ id: 'today-but-alone', text: 'One today', daysAgo: 0 });
};

it('brightens the creature itself when its press button is clicked, then lets it settle', async () => {
  OLD_WEEKS();
  world = await mountWorld(FACTS); await settle();
  const before = world.audit().aura.lit;
  expect(before, 'the wall should start dim enough for a flare to show').toBeLessThanOrEqual(0.55);
  expect(press(), 'the creature has nothing to press').toBeTruthy();
  await act(async () => { press()!.click(); });
  await world.step(1);
  const lit = world.audit().aura.lit;
  expect(lit - before, `a press moved the reach from ${before} to ${lit}`).toBeGreaterThanOrEqual(0.4);
  /* the flare is an event: 0.7s later it is gone and the reading is back */
  await world.step(60);
  expect(Math.abs(world.audit().aura.lit - before), 'the press left the creature lit').toBeLessThan(0.05);
});

it('a drag to Principles does not light the creature on the swallowed click', async () => {
  OLD_WEEKS();
  world = await mountWorld(FACTS); await settle();
  const before = world.audit().aura.lit;
  const button = press()!;
  await act(async () => {
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, clientX: 100, clientY: 100 }));
    button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7, clientX: 400, clientY: 102 }));
    button.click();
  });
  await world.step(1);
  expect(world.audit().aura.lit - before, 'the click a drag swallows still flared').toBeLessThan(0.1);
});

it("still speaks on a dim wall while the press's own flare is up", async () => {
  /* `sayLine` read the drawn reach, flare included — so the press that asked
     for a sentence pushed a quiet wall over the silence line and came out
     mute. Timers only, no frames: the flare is still at full when the grace
     timer reaches for the loop's line. */
  OLD_WEEKS();
  world = await mountWorld(FACTS); await settle();
  await act(async () => { press()!.click(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  expect(world.audit().aura.lit, 'the flare had already decayed; this test is not testing it').toBeGreaterThan(0.55);
  const said = speech();
  expect([...QUIET, ...WARM, ...FRONTIER], `a dim wall pressed said "${said}"`).toContain(said);
});
