// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/data` supplies the three layers,
 * `lib/api` supplies the group reads AND `fetchTheWeather` — the weather is the
 * seam this suite is actually about, because the bug is a weather fetch
 * resolving on the wrong wall, and a deferred promise is the only way to put a
 * wall change INSIDE a request. `lib/api/principles` supplies principle reads,
 * `lib/auth-context` supplies the session. `helpers/render-home` and
 * `helpers/canvas-stub` replace canvas/viewport/clock/randomness; the real
 * world simulation, the real form switch and the real speech state all run.
 * Appearance/SQL are not claimed. */
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { installCanvasStub, setViewport } from './helpers/canvas-stub';
import { mountWorld, dataMockFrom, apiMockFrom, VIEWER_ID, type MountedWorld } from './helpers/render-home';
import { fetchTheWeather, type ApiWeather } from '../src/lib/api';

const FACTS = vi.hoisted(() => ({
  inspirations: [{ id: 'kept', text: 'Something I kept', daysAgo: 1 }],
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
  fetchTheWeather: vi.fn(),
}));
vi.mock('../src/lib/auth-context', async original => {
  const session = { status: 'authenticated', account: { id: 'account-1', email: 'you@example.test' },
    profile: { id: VIEWER_ID, name: 'You', type: 'human' }, profiles: [], refresh: async () => undefined, signOut: async () => undefined };
  return { ...await original<typeof import('../src/lib/auth-context')>(), useOptionalAuth: () => session, useAuth: () => session };
});

/** One day with one speakable clause, which is all the bubble needs to talk. */
const WEATHER: ApiWeather = { told: null, antechamber: [],
  days: [{ daysAgo: 0, label: 'today', sentences: [{ text: 'you kept one memory', backing: 'inspirations' }] }] };

let world: MountedWorld;
beforeAll(() => { installCanvasStub(); setViewport(1280, 900); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { localStorage.clear(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); vi.mocked(fetchTheWeather).mockReset(); });
afterEach(() => { world?.unmount(); vi.useRealTimers(); });

async function settle() {
  for (let turn = 0; turn < 8; turn += 1) { await world.step(100); await act(async () => { await vi.advanceTimersByTimeAsync(100); }); }
}
const face = (label: string) =>
  [...world.container.querySelectorAll<HTMLButtonElement>('.jar-char-face')]
    .find(button => button.textContent?.trim() === label);
/** The creature's own speech, which is the `--aside` weight and only that. */
/* THE SENTENCE, NOT THE WHOLE BUBBLE. Every bubble ends in a named act
   now — founder: "all speech bubbles should have an action at the end" —
   so the bubble's `textContent` is the sentence with "Let's talk about it"
   welded to it. `.jar-char-bubble-reading` is the said thing, which is
   what this suite is about: whether a stale sentence survives a wall
   switch. Presence of the bubble itself is asserted separately below. */
const speech = () => world.container
  .querySelector('.jar-char-bubble--aside .jar-char-bubble-reading')?.textContent?.trim() ?? null;
const press = () => world.container.querySelector<HTMLButtonElement>('.jar-char-press');

/**
 * ═══ SWITCHING FORM TAKES THE SPEECH BUBBLE WITH IT ═══════════════════════
 *
 * Founder, reporting this against a ruling they had already given and seen
 * shipped: "did I not tell you that when I'm switching between me and my
 * agent the speech bubble should be gone? Sometimes it's not gone. So most
 * times it works properly, but sometimes the speech bubble stays on so maybe
 * it's a bug."
 *
 * "Most times it works properly" is the diagnosis. The ruling WAS implemented
 * for the top-of-mind bubble — `turning` holds it down for `FORM_HUSH_MS` —
 * and that half never broke. The half that broke is `charSay`, which arrives
 * from a fetch: `sayTheWeather` asks `/weather` for whichever profile
 * `atWallRef.current` names, and if the wall changes while that request is
 * open, the answer about YOUR day lands on your AGENT'S wall. The turn is
 * 650ms and a request is longer than that roughly as often as it is shorter,
 * which is precisely how a deterministic ordering bug presents as "sometimes".
 *
 * THIS IS THE SECOND RACE IN THIS MACHINERY, and the test is written to keep
 * the two apart. The first was press-vs-press — "there are like glitches
 * sometimes in the speech bubble when I click on it too fast" — where press
 * N's sentence lands after press N+1 and the bubble swaps under the hand;
 * `speechEpoch` numbers presses and drops superseded answers. That guard was
 * not enough here because NOTHING WAS SUPERSEDED: one press, one request, the
 * epoch still matched. What changed was the subject, not the question.
 *
 * WHY A DEFERRED PROMISE AND NOT A TIMER. The race is only observable while
 * the request is open, so the test holds the request open explicitly and
 * switches walls inside it. Fake timers cannot do that — the fetch would have
 * to be slow in wall-clock terms — and a real slow fetch is the flake this
 * suite would otherwise become. Holding the promise makes "sometimes" into
 * "every run", which is the same trick the browser reproduction used with
 * `page.route`.
 */
it('drops a weather answer that was asked for on the wall you just left', async () => {
  let answer!: (w: ApiWeather) => void;
  vi.mocked(fetchTheWeather).mockImplementation(() => new Promise<ApiWeather>(resolve => { answer = resolve; }));

  world = await mountWorld(FACTS); await settle();
  expect(world.audit().wallKind).toBe('self');

  /* ASK, ON YOUR OWN WALL. The press target is only rendered while nothing
     is being said, so its presence is also the assertion that the creature
     starts quiet. */
  expect(press(), 'the creature has nothing to press').toBeTruthy();
  await act(async () => { press()!.click(); });
  await world.step(0);
  expect(speech(), 'the answer cannot have arrived yet — it is still held').toBeNull();

  /* SWITCH FORM WHILE THE ANSWER IS STILL IN FLIGHT. */
  const toAgent = face('My agent');
  expect(toAgent, 'the creature offers no way to take its agent form').toBeTruthy();
  await act(async () => { toAgent!.click(); });
  await world.step(0);
  expect(world.audit().wallKind).toBe('agent');

  /* NOW LET THE STALE ANSWER LAND. Before the fix this wrote straight into
     the bubble and the founder's sentence about their own day appeared over
     their agent — on the one wall where the companion is not even allowed to
     offer a save. */
  await act(async () => { answer(WEATHER); });
  await settle();
  expect(speech(), 'the wall you left is still talking on the wall you arrived at').toBeNull();
});

/**
 * THE OTHER HALF, AND IT NEEDS NO RACE AT ALL.
 *
 * A sentence that had already landed before the switch stayed up for the rest
 * of its four-second whisper, hanging over a creature that was now somebody
 * else. The founder's words are unqualified — "the speech bubble should be
 * gone" — so this is checked separately from the race: a fix that only bumped
 * the epoch would invalidate the NEXT write and leave this one on screen.
 */
it('clears a sentence already on screen when the form changes', async () => {
  vi.mocked(fetchTheWeather).mockResolvedValue(WEATHER);
  world = await mountWorld(FACTS); await settle();

  await act(async () => { press()!.click(); });
  await settle();
  expect(speech(), 'the creature never spoke, so there is nothing to clear').toBeTruthy();

  await act(async () => { face('My agent')!.click(); });
  await world.step(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(speech(), 'the bubble stayed on through the turn').toBeNull();
});

/**
 * AND THE CREATURE STILL TALKS AFTERWARDS.
 *
 * The cheap fix for both tests above is to stop the bubble ever speaking
 * again, so this is the counterweight: come back to your own form, press, and
 * the answer must arrive as normal. The seal a switch puts on speech is for
 * sentences asked for BEFORE it; a press is a question asked here and now.
 */
it('still answers a press made after the switch', async () => {
  vi.mocked(fetchTheWeather).mockResolvedValue(WEATHER);
  world = await mountWorld(FACTS); await settle();

  await act(async () => { face('My agent')!.click(); });
  await world.step(0);
  await settle();
  /* BACK TO YOUR OWN FORM, because the press target is deliberately absent on
     an agent's wall ("I shouldn't be saving it for my agent"). */
  await act(async () => { face('Me')!.click(); });
  await world.step(0);
  await settle();
  expect(world.audit().wallKind).toBe('self');

  expect(press(), 'the creature has nothing to press after the switch').toBeTruthy();
  await act(async () => { press()!.click(); });
  await settle();
  /* `asSentence` capitalises a clause the creature says alone — see
     `capitalized.test.ts` — so the assertion is on the words, not the case. */
  expect(speech()).toBe('You kept one memory today.');
});
