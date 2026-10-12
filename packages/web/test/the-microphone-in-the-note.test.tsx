// @vitest-environment jsdom
/**
 * ═══ THE MICROPHONE IN THE NOTE: THE RULE, THE RELEASE, THE DISCLOSURE ═════
 *
 * Three defects with one subject, found together because they are the same
 * omission seen from three sides: dictation was wired into the notepad as a
 * way of typing, and the notepad's other machinery was never told about it.
 *
 *   THE SAVE RULE DID NOT KNOW. `lib/keep-ready.ts` exists so the condition
 *   is written once — its header says so, at length, about the two copies
 *   that preceded it. `keepIt`'s own guard then omitted `dictation.listening`
 *   while the bar's Save included it, and `Cmd+Enter` reached `keepIt` from
 *   the notepad without consulting the rule at all. So the keyboard saved
 *   mid-utterance and dropped whatever the engine had not yet marked final,
 *   which is the exact loss the render-time comment says the rule is for.
 *
 *   THE WAY OUT DID NOT KNOW. `dictation.stop()` had one call site — the
 *   Stop control itself — and `saveAsDraft` stops the recorder and not the
 *   microphone. Leave the notepad while dictating and the Stop control goes
 *   with the page while the engine keeps transcribing into a draft nobody is
 *   looking at, on a feature whose own disclosure says the audio leaves the
 *   device.
 *
 *   AND THE BAR DID NOT KNOW. That disclosure is one slot in a first-non-
 *   empty chain, below three lines that outrank it. Any of them standing
 *   means the microphone opens, audio streams to a third party, and the
 *   sentence that says so is never shown — with no browser permission prompt
 *   either, on any visit after the first.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `lib/data` supplies the three layers,
 * so the world's archive arrives as a fixture rather than over HTTP.
 * `lib/api` supplies the group reads and `fetchInspirationSaveRequest`, which
 * is this suite's instrument for "did a save start": it is the FIRST network
 * act of an authored save, before any decision about creating or recovering,
 * so one call means a save began and none means the press was refused. It is
 * also what makes a refusal observable without asserting the absence of
 * something further down a chain that this harness cannot complete anyway.
 * `lib/api/principles` supplies principle reads, `lib/auth-context` supplies
 * the signed-in viewer — the world renders nothing without one.
 * `window.SpeechRecognition` is a hand-held engine: jsdom does not implement
 * it, and even where a browser does it needs a microphone and a person, so
 * the test plays the speech service. `indexedDB` is `fake-indexeddb` — the
 * draft store is the real one and it needs a database; without it
 * `composerDraft.available` is false and the notepad disables the microphone,
 * which would make every case here pass for the wrong reason.
 * `helpers/render-home` and `helpers/canvas-stub` replace canvas, viewport,
 * clock and randomness. The real world simulation, the real notepad, the real
 * `useDictation` and the real `whyNotKept` all run.
 */
import { act } from 'react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { installCanvasStub, setViewport } from './helpers/canvas-stub';
import { mountWorld, dataMockFrom, apiMockFrom, VIEWER_ID, type MountedWorld } from './helpers/render-home';
import { fetchInspirationSaveRequest } from '../src/lib/api';

const FACTS = vi.hoisted(() => ({
  inspirations: [{ id: 'kept', text: 'an older thought', daysAgo: 3 }],
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
  fetchInspirationSaveRequest: vi.fn(),
}));
vi.mock('../src/lib/auth-context', async original => {
  const session = { status: 'authenticated', account: { id: 'account-1', email: 'you@example.test' },
    profile: { id: VIEWER_ID, name: 'You', type: 'human' }, profiles: [], refresh: async () => undefined, signOut: async () => undefined };
  return { ...await original<typeof import('../src/lib/auth-context')>(), useOptionalAuth: () => session, useAuth: () => session };
});

/**
 * The engine a browser would supply, with the wires brought out.
 *
 * `all` RATHER THAN ONLY `live`, which `dictation.test.ts` can do without and
 * this cannot: the session-splice case needs to emit from the engine of a
 * session that has ENDED while a later one is running, and holding only the
 * newest makes that unsayable.
 */
class FakeEngine {
  static all: FakeEngine[] = [];
  lang = ''; continuous = false; interimResults = false; started = false; aborted = false;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  constructor() { FakeEngine.all.push(this); }
  start() { this.started = true; }
  stop() { this.started = false; this.onend?.(); }
  abort() { this.aborted = true; this.started = false; }
  /** Emit one utterance. `results` is cumulative and `resultIndex` is where
      the new entries begin — see `dictation.test.ts` for why faking that
      wrongly produces a test that fails against correct code. */
  say(parts: Array<{ text: string; final: boolean }>, resultIndex = 0) {
    const earlier = Array.from({ length: resultIndex }, () => Object.assign([{ transcript: '' }], { isFinal: true }));
    const fresh = parts.map(part => Object.assign([{ transcript: part.text }], { isFinal: part.final }));
    this.onresult?.({ resultIndex, results: [...earlier, ...fresh] });
  }
}

let world: MountedWorld;
beforeAll(() => { installCanvasStub(); setViewport(1280, 900); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  FakeEngine.all = [];
  (globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory();
  (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = FakeEngine;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.mocked(fetchInspirationSaveRequest).mockReset();
});
afterEach(() => {
  world?.unmount(); vi.useRealTimers();
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
});

async function settle() {
  for (let turn = 0; turn < 8; turn += 1) { await world.step(100); await act(async () => { await vi.advanceTimersByTimeAsync(100); }); }
}
const named = (name: string) => [...world.container.querySelectorAll<HTMLButtonElement>('button')]
  .find(button => (button.getAttribute('aria-label') ?? button.textContent ?? '').trim() === name);
/** The one transient line the bar shows while a note is open. */
const bar = () => world.container.querySelector('.waka-dock-state')?.textContent ?? '';
const field = () => world.container.querySelector<HTMLTextAreaElement>('textarea.jar-composer-text')!;
/** The notepad's own slot in the dock: the microphone, then Stop. */
const mic = () => world.container.querySelector<HTMLButtonElement>('.waka-dock-tool')!;
const engine = () => FakeEngine.all[FakeEngine.all.length - 1]!;
/** Whether an authored save began — one network act, before any decision. */
const savesStarted = () => vi.mocked(fetchInspirationSaveRequest).mock.calls.length;

/** The notepad, reached the way a person reaches it: the plus, then the row. */
async function openNotepad(words = ''): Promise<void> {
  world = await mountWorld(FACTS); await settle();
  await act(async () => named('Make something')!.click()); await settle();
  await act(async () => world.container.querySelector<HTMLButtonElement>('.waka-new-one')!.click()); await settle();
  expect(world.container.querySelector('.jar-inspiration-composer'), 'the notepad did not open').toBeTruthy();
  if (words) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field(), words);
      field().dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle();
  }
}
const pressMic = async () => { await act(async () => mic().click()); await settle(); };
const cmdEnter = async () => {
  await act(async () => { field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true })); });
  await settle();
};

/**
 * ═══ ONE — THE RULE, AND THE KEYBOARD CONSULTS IT ═════════════════════════
 *
 * `Cmd+Enter` went straight to `keepIt`, and `keepIt`'s guard was looser than
 * the button's in exactly the two places that matter here. Measured before
 * the fix: speak, press `Cmd+Enter`, and a save begins — the words the engine
 * has not yet marked final are simply not in it.
 */
it('refuses Cmd+Enter while the microphone is still listening, and says why', async () => {
  await openNotepad('dusk on the hill');
  await pressMic();
  expect(engine().started, 'the microphone never opened').toBe(true);

  await cmdEnter();
  expect(savesStarted(), 'a save began mid-utterance and dropped the unfinished words').toBe(0);
  /* AND IT IS NOT SILENT ABOUT IT. A refused press that does nothing visible
     is the "looks pressable, does nothing" failure `keep-ready.ts` was
     written for; the reason the rule returns is the reason the bar prints. */
  expect(bar()).toBe('Stop the recording first.');
});

/**
 * AND THE COUNTERWEIGHT, which is what stops the fix above from being "the
 * keyboard no longer saves". The same words, the same key, nothing listening.
 */
it('saves on Cmd+Enter when nothing is listening', async () => {
  await openNotepad('dusk on the hill');
  await cmdEnter();
  expect(savesStarted()).toBe(1);
});

/**
 * ═══ TWO — EVERY EXIT FROM THE NOTEPAD RELEASES THE MICROPHONE ════════════
 *
 * `dictation.stop()` had one call site and it was the Stop control itself, so
 * every other way out left the engine running: the page folds, the Stop
 * control goes with it, and the only remaining release was `Home` unmounting.
 * The recorder has had this for a while — `if (!mouthOpen && recording.phase
 * !== 'idle') void recording.stop()` — and the microphone is the one that
 * sends audio to somebody else.
 */
it('releases the microphone when the notepad closes', async () => {
  await openNotepad('dusk on the hill');
  await pressMic();
  const live = engine();
  expect(live.started).toBe(true);

  /* "NOW" IS THE WAY OUT OF THE NOTEPAD — the bar's first row, which keeps
     the words (`saveAsDraft`) and takes the page down. */
  await act(async () => [...world.container.querySelectorAll<HTMLButtonElement>('.waka-dock-item')][0]!.click());
  await settle();
  expect(world.container.querySelector('.jar-inspiration-composer'), 'the notepad is still open').toBeFalsy();
  expect(live.started, 'the engine is still transcribing into a page nobody is looking at').toBe(false);
});

/**
 * ═══ THREE — THE DISCLOSURE CANNOT BE PUSHED OFF THE BAR ══════════════════
 *
 * Chrome streams dictation audio to Google to transcribe it. That sentence is
 * the whole of what this product owes somebody who presses the microphone,
 * and it was one slot in a first-non-empty chain under three lines that
 * outrank it — so an earlier line standing meant the audio left the device
 * with the notice never shown. No permission prompt either, on any visit
 * after the first: the grant is already given.
 *
 * THE EARLIER LINE HERE IS REACHED THE WAY A PERSON REACHES IT. Drop a file
 * the page cannot read, press the keys, and the bar is holding "Remove the
 * files marked below." That is a true sentence about a thing still on screen,
 * which is why the fix does not clear it — it re-ranks.
 */
it('says the cloud disclosure even when the bar was already holding a line', async () => {
  await openNotepad('dusk on the hill');

  const unreadable = new File(['bytes'], 'notes.txt', { type: 'text/plain' });
  await act(async () => {
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [unreadable] } });
    world.container.querySelector('.jar-inspiration-composer')!.dispatchEvent(drop);
  });
  await settle();
  await cmdEnter();
  expect(bar(), 'the bar is not holding the line this case is about').toBe('Remove the files marked below.');
  expect(savesStarted(), 'a marked file did not stop the save').toBe(0);

  await pressMic();
  expect(engine().started, 'the microphone never opened, so nothing was disclosed either way').toBe(true);
  expect(bar()).toBe('Your browser sends speech to its own service to turn it into text.');
});

/**
 * ═══ AND A SESSION'S WORDS BELONG TO THAT SESSION ═════════════════════════
 *
 * `useDictation` kept `settled` and `base` in refs that `start()` reset, and
 * nothing tied an event to the session that produced it. A real engine emits
 * one more final result after `stop()` — the hook's own comment says so, and
 * keeping it is deliberate — but if a NEW session has begun by the time it
 * arrives, that final is appended to the new session's accumulator and
 * written against the new session's anchor. The previous session's last words
 * are spliced into the next note, duplicated, after the words they duplicate.
 *
 * `onerror` had the same hole and a worse consequence: an error belonging to
 * a finished session cleared `listening` and dropped the handle on the live
 * one, which is the Stop control disappearing while the engine runs.
 */
it('does not splice a finished session\'s last words into the next one', async () => {
  await openNotepad();
  await pressMic();
  await act(async () => engine().say([{ text: 'first thought', final: true }]));
  await settle();
  expect(field().value).toBe('first thought');

  /* Stop, which is the control the person presses. */
  await act(async () => world.container.querySelector<HTMLButtonElement>('.waka-dock-tool--wide')!.click());
  await settle();
  const finished = engine();

  await pressMic();
  expect(FakeEngine.all).toHaveLength(2);
  await act(async () => engine().say([{ text: 'second thought', final: true }]));
  await settle();
  expect(field().value).toBe('first thought second thought');

  /* THE LATE FINAL FROM THE SESSION THAT IS OVER. */
  await act(async () => finished.say([{ text: ' tail', final: true }]));
  await settle();
  expect(field().value, 'a finished session wrote into the live one').toBe('first thought second thought');

  /* AND ITS ERROR CANNOT TAKE THE LIVE SESSION DOWN WITH IT. */
  await act(async () => finished.onerror?.({ error: 'network' }));
  await settle();
  expect(world.container.querySelector('.waka-dock-tool--wide'), 'the Stop control went while the engine ran').toBeTruthy();
});
