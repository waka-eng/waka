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
  fetchProfiles: vi.fn(async () => [{ id: 'ouroboros-maintainer', type: 'agent', name: 'Ouroboros maintainer', createdAt: '2026-08-01T00:00:00Z' }]),
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
   switch. Presence of the bubble itself is asserted separately below.
   Found by its `role="status"` line: the `--aside` class that marked this
   bubble went when every bubble took the top of mind's white (2026-10-15).
   The review invitation (`--review`) also speaks in a status line and sits
   EARLIER in the tree, so it is excluded by name: a count of cards to review
   is not the sentence a wall switch might leave behind. */
const speech = () => world.container
  .querySelector('.jar-char-bubble:not(.jar-char-bubble--review) .jar-char-bubble-reading[role="status"]')?.textContent?.trim() ?? null;
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
  const toAgent = face('Ouroboros maintainer');
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

  await act(async () => { face('Ouroboros maintainer')!.click(); });
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

  await act(async () => { face('Ouroboros maintainer')!.click(); });
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

/**
 * ═══ AND THE THIRD SPEAKER, WHICH NEITHER GUARD WAS WIRED TO ══════════════
 *
 * Founder, for the second time, after both cases above were shipped green:
 * "sometimes the speech bubble stays on." Still true, and this is why.
 *
 * `charSay` has THREE writers that arrive late, not two. The press path
 * (`sayTheWeather`) takes a `speechEpoch` number and drops a superseded
 * answer. The already-landed sentence is cleared by the wall effect. The
 * third is the ARRIVAL GREETING: it fetches the away-window line at mount,
 * holds it in a ref, and speaks it from a `setTimeout` — 1400ms after the
 * world is drawn, or 4000ms when there is something new to glide to. It
 * captured no epoch at all, so it was the one writer the press's guard could
 * not see.
 *
 * AND THE SEAL CANNOT COVER IT, which is the whole reason this needs the
 * epoch rather than a longer hush. `speechSealed` lifts with the turn —
 * `FORM_HUSH_MS`, 650ms — because words over the back of a turning creature
 * is what the seal is for. The greeting speaks at 1400ms at the earliest, so
 * it lands after every seal has already lifted, every time. Widening the
 * hush to four seconds was the obvious alternative and is wrong twice: it
 * would hold a sentence somebody ASKED for off the screen for four seconds,
 * and it would still be a race rather than an answer to one.
 *
 * WHY THIS DOES NOT REPRODUCE BY HAND IN `pnpm dev`. StrictMode mounts
 * `Home` twice; the first mount's cleanup clears the greeting's timers and
 * `greetedRef` has already been set, so the greeting never speaks at all in
 * development. The founder's build has no StrictMode, which is exactly why
 * they are the only one who has seen it.
 */
/** An away-window line, which is the `told` field rather than a day clause. */
const TOLD: ApiWeather = { told: 'you kept a memory while you were gone', antechamber: [], days: [] };
/** The helper's own midday, which every fixture moment is measured off. */
const BASE = Date.UTC(2026, 7, 16, 12);
/** A previous visit an hour ago: there IS an away window, and nothing new in
    it — so the greeting has nothing to glide to and only a line to say. */
const camePastAnHourAgo = () => window.localStorage.setItem('waka.seen', String(BASE - 3_600_000));
/** Long enough for the seal to lift (650ms) AND the greeting to speak. */
async function pastTheGreeting() {
  for (let turn = 0; turn < 20; turn += 1) {
    await world.step(10);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  }
}

it('speaks the away-window line on the wall you arrived at', async () => {
  camePastAnHourAgo();
  vi.mocked(fetchTheWeather).mockResolvedValue(TOLD);
  world = await mountWorld(FACTS);
  await pastTheGreeting();
  /* THE COUNTERWEIGHT FIRST, for the same reason the press case has one: a
     fix that simply stopped the greeting speaking would pass the next case
     and silently delete the feature. */
  expect(speech()).toBe('You kept a memory while you were gone');
});

it('drops the away-window line when the form changed before it spoke', async () => {
  camePastAnHourAgo();
  vi.mocked(fetchTheWeather).mockResolvedValue(TOLD);
  world = await mountWorld(FACTS);

  /* SWITCH FORM INSIDE THE GREETING'S OWN BEAT. No held promise is needed
     here, which is the difference from the press race above: the delay is a
     timer this product set itself, so the window is open on every run. */
  const toAgent = face('Ouroboros maintainer');
  expect(toAgent, 'the creature offers no way to take its agent form').toBeTruthy();
  await act(async () => { toAgent!.click(); });
  await world.step(0);
  expect(world.audit().wallKind).toBe('agent');

  await pastTheGreeting();
  expect(speech(), 'a sentence about YOUR day is being said on your agent\'s wall').toBeNull();
});

/**
 * ═══ A PRESS THAT IS NEVER ANSWERED STILL SAYS SOMETHING ══════════════════
 *
 * Founder: "sometimes clicking on the character doesn't do anything for a
 * while. It feels stuck."
 *
 * It was stuck. The spoken sentence came only from `/weather`, so between
 * the press and the response the creature said nothing but glow — and
 * pressing again, which is what a person does when nothing happens, bumped
 * `speechEpoch` and made the first answer fail `mine()` and be DROPPED.
 * Every impatient tap cancelled the reply it was impatient for.
 *
 * HELD OPEN RATHER THAN MADE SLOW, the same trick the race cases above use:
 * a deferred promise turns "sometimes, on a bad connection" into "every
 * run". The weather here never resolves at all, and that is a real shape
 * rather than a convenient one: THIS FETCH HAS NO TIMEOUT AND NO
 * `AbortController`, so a hung connection never resolves OR rejects, and
 * nothing else would ever write the bubble.
 *
 * A FAILING REQUEST WAS NEVER THE CAUSE, and an earlier draft of this note
 * said it was — it blamed a generation queue returning 402. Two things are
 * wrong with that. `/api/weather` calls no model at all (`the-weather.ts`:
 * "nothing is written to tell the weather, no model is called"), so that
 * queue cannot reach it; and a request that FAILS rejects, which the
 * `.catch` has always answered with the same local line. Only a request
 * that neither answers nor fails produces the silence the founder saw.
 *
 * WHAT IT MUST NOT BECOME: a test that passes because the creature says the
 * weather quickly. The promise is never resolved, so the only thing that can
 * fill the bubble is the local line.
 */
it('speaks its own line when the weather does not come back', async () => {
  vi.mocked(fetchTheWeather).mockImplementation(() => new Promise<ApiWeather>(() => {}));

  world = await mountWorld(FACTS); await settle();
  expect(press(), 'the creature has nothing to press').toBeTruthy();

  await act(async () => { press()!.click(); });
  await world.step(0);
  /* Before the grace period, nothing — the product still prefers the real
     answer and will wait a moment for it. */
  expect(speech(), 'it spoke before giving the weather a chance').toBeNull();

  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  await settle();
  expect(speech(), 'the press went unanswered').toBeTruthy();
});
