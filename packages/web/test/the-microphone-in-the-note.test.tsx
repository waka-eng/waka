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
/** The one transient line the bar shows while a note is open. */
/** What the bar SHOWS — its screen-reader twin (`LiveWord`, sr-only) says the same words once. */
const bar = () => [...(world.container.querySelector('.waka-dock-state')?.childNodes ?? [])]
  .filter((node) => !(node instanceof HTMLElement && node.classList.contains('sr-only'))).map((node) => node.textContent).join('');
const field = () => world.container.querySelector<HTMLTextAreaElement>('textarea.jar-composer-text')!;
/** The notepad's own slot in the dock: the microphone, then Stop. */
const mic = () => world.container.querySelector<HTMLButtonElement>('.waka-dock-tool')!;
const engine = () => FakeEngine.all[FakeEngine.all.length - 1]!;
/** The listening view (founder, 2026-11-08): what stands while the microphone is open. */
const listening = () => world.container.querySelector<HTMLElement>('.waka-listening');
const done = () => world.container.querySelector<HTMLButtonElement>('.waka-listening-done')!;
/** Whether an authored save began — one network act, before any decision. */
const savesStarted = () => vi.mocked(fetchInspirationSaveRequest).mock.calls.length;

/** The notepad, reached the way a person reaches it: the bar's Inspiration,
    which since 2026-10-15 makes a new note in one press (the plus is gone). */
async function openNotepad(words = ''): Promise<void> {
  world = await mountWorld(FACTS); await settle();
  const inspiration = [...world.container.querySelectorAll<HTMLButtonElement>('.waka-home-bar-door')]
    .find(row => row.getAttribute('aria-label') === 'Keep a thought');
  expect(inspiration, 'the bar offers no Inspiration row').toBeTruthy();
  await act(async () => inspiration!.click()); await settle();
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
it('offers nothing to save mid-utterance: the bar gives way to the listening view until Done', async () => {
  await openNotepad('dusk on the hill');
  await pressMic();
  expect(engine().started, 'the microphone never opened').toBe(true);
  /* Founder, 2026-11-08: "i want the UI to feel very clearly it's
     listening". The field, the tools and Save step aside; nothing can save
     the words the engine has not yet marked final. */
  expect(listening(), 'the listening view did not take the bar\'s place').toBeTruthy();
  expect(world.container.querySelector('.jar-inspiration-composer [data-note-bar="1"]'), 'the note bar stayed up while listening').toBeNull();
  expect(world.container.querySelector('.waka-dock-save'), 'Save is offered mid-utterance').toBeNull();
  expect(savesStarted()).toBe(0);
  await act(async () => done().click()); await settle();
  expect(engine().started).toBe(false);
  expect(field().value, 'Done lost the words').toBe('dusk on the hill');
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
  await act(async () => world.container.querySelector<HTMLButtonElement>('.waka-surface-back')!.click());
  await settle();
  /* A note with words asks first (founder, 2026-11-09); Keep as draft is
     what "<" used to do on its own. */
  await act(async () => [...world.container.querySelectorAll<HTMLButtonElement>('.waka-note-ask .jar-char-bubble-act')].find(node => node.textContent === 'Keep as draft')!.click());
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
it('says the cloud disclosure in full under the words, even when the bar was already holding a line', async () => {
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
  /* One full line under the words now, never cut short in the bar. */
  expect(world.container.querySelector('.waka-listening-notice')?.textContent).toBe('Your browser sends speech to its own service to turn it into text.');
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
/* Audit f2afcbe2 (desk/106): pressing the microphone re-laid the centred bar
   — Stop landed where ＋ had been, and the disclosure was cut to "Your
   browser sends speech to its own …". jsdom has no layout, so what is held
   here is the cause: the row keeps the same controls in the same order and
   the live control is the microphone's own element. (Where the disclosure
   sits is a known issue: docs/known-issues.md.) */
it('shows the words arriving softly while listening, and Done drops them into the note', async () => {
  await openNotepad();
  await pressMic();
  expect(world.container.querySelector('.waka-listening-label')?.textContent).toBe('Listening…');
  await act(async () => engine().say([{ text: 'the guy at the coffee shop', final: false }]));
  await settle();
  expect(world.container.querySelector('.waka-listening-words')?.textContent, 'the words are not shown as they arrive').toBe('the guy at the coffee shop');
  expect(world.container.querySelector('.waka-listening textarea'), 'the words are in a text box while listening').toBeNull();
  expect(done().textContent).toBe('Done');
  await act(async () => done().click()); await settle();
  expect(engine().started).toBe(false);
  expect(listening(), 'the listening view outlived Done').toBeNull();
  expect(field().value, 'the words did not drop into the note').toBe('the guy at the coffee shop');
});


/* FOCUS FOLLOWS THE VIEW (review, 2026-11-09): pressing the mic unmounts
   it, so focus fell to the page. It moves to Done, and back to the mic on
   Done. The words are not a live region: an interim guess re-announced the
   whole note each time; "Listening…" is the one thing said. */
it('moves focus to Done while listening and back to the bar after, and does not read the words aloud as they arrive', async () => {
  await openNotepad();
  await act(async () => mic().focus());
  await pressMic();
  expect(document.activeElement, 'focus fell out of the listening view').toBe(done());
  const words = world.container.querySelector('.waka-listening-words')!;
  expect(words.closest('[aria-live], [role="status"], [role="log"]'), 'the transcript is a live region').toBeNull();
  expect(world.container.querySelector('.waka-listening-label')?.getAttribute('role')).toBe('status');
  await act(async () => engine().say([{ text: 'a thought', final: true }]));
  await act(async () => done().click()); await settle();
  /* The notepad's field takes focus when it returns (it always has: a new
     note opens ready to type); the mic is where focus goes otherwise. */
  expect([mic(), field()], 'focus did not come back to the bar').toContain(document.activeElement);
});

it('does not splice a finished session\'s last words into the next one', async () => {
  await openNotepad();
  await pressMic();
  await act(async () => engine().say([{ text: 'first thought', final: true }]));
  await settle();
  /* Done, which is the control the person presses. */
  await act(async () => done().click());
  await settle();
  expect(field().value).toBe('first thought');
  const finished = engine();

  await pressMic();
  expect(FakeEngine.all).toHaveLength(2);
  await act(async () => engine().say([{ text: 'second thought', final: true }]));
  await settle();
  expect(world.container.querySelector('.waka-listening-words')?.textContent).toBe('first thought second thought');

  /* THE LATE FINAL FROM THE SESSION THAT IS OVER. */
  await act(async () => finished.say([{ text: ' tail', final: true }]));
  await settle();
  expect(world.container.querySelector('.waka-listening-words')?.textContent, 'a finished session wrote into the live one').toBe('first thought second thought');

  /* AND ITS ERROR CANNOT TAKE THE LIVE SESSION DOWN WITH IT. */
  await act(async () => finished.onerror?.({ error: 'network' }));
  await settle();
  expect(world.container.querySelector('.waka-listening-done'), 'Done went while the engine ran').toBeTruthy();
});


/* CODE REVIEW, 2026-11-08: WebKit lets speech recognition start only inside
   a person's tap. At now, Say it opens the notepad and starts listening in
   the tap itself; when the world must wind back first, it never starts the
   microphone later (outside the gesture) — the notepad opens with the mic
   ready to tap. */
const sayIt = () => [...world.container.querySelectorAll<HTMLButtonElement>('.waka-home-bar-door')].find(row => row.getAttribute('aria-label') === 'Keep your voice')!;

it('starts listening inside the tap when the world is already at now', async () => {
  world = await mountWorld(FACTS); await settle();
  await act(async () => sayIt().click());
  expect(FakeEngine.all, 'Say it did not start the microphone in the tap').toHaveLength(1);
  expect(engine().started).toBe(true);
  await settle();
  expect(world.container.querySelector('.jar-inspiration-composer'), 'Say it never opened the notepad').toBeTruthy();
  expect(engine().started, 'the microphone stopped when the notepad opened').toBe(true);
});

it('opens the notepad with the mic ready to tap, and never listens outside the tap, when the world must wind back first', async () => {
  world = await mountWorld(FACTS); await settle();
  await world.toField();
  await act(async () => sayIt().click());
  await settle();
  expect(world.container.querySelector('.jar-inspiration-composer'), 'Say it never opened the notepad').toBeTruthy();
  expect(FakeEngine.all, 'the microphone started outside the tap').toHaveLength(0);
  const ready = world.container.querySelector<HTMLButtonElement>('.waka-note-bar .waka-dock-tool[aria-label="Your voice"]');
  expect(ready?.disabled, 'the mic is not ready to tap').toBe(false);
  await act(async () => ready!.click());
  expect(engine().started, 'the ready mic did not listen when tapped').toBe(true);
});

/* Code review, 2026-11-08: the notepad's mic is dim while its draft store
   cannot take words; the bar's Say it started dictation anyway. */
it('dims Say it, and starts nothing, where the notepad could not keep the words', async () => {
  (globalThis as { indexedDB?: IDBFactory }).indexedDB = undefined;
  world = await mountWorld(FACTS); await settle();
  expect(sayIt().disabled, 'Say it is offered where the notepad mic is not').toBe(true);
  await act(async () => sayIt().click());
  expect(FakeEngine.all, 'the microphone started anyway').toHaveLength(0);
});

/* ═══ YOUR VOICE FROM HOME IS A FRESH NOTE (founder, 2026-11-09) ═══════════
   "the photo is here when im trying to record fresh": the old draft's words
   were reopened and the dictation was written after them. From home, Your
   voice starts on a blank page; the draft stays stored (see
   `inspiration-draft-hook.test.tsx` for it coming back). */
it('starts Your voice from home on a blank page, not inside the kept draft', async () => {
  await openNotepad('xdfsdf');
  await act(async () => world.container.querySelector<HTMLButtonElement>('.waka-surface-back')!.click()); await settle();
  await act(async () => [...world.container.querySelectorAll<HTMLButtonElement>('.waka-note-ask .jar-char-bubble-act')].find(node => node.textContent === 'Keep as draft')!.click());
  await settle();
  expect(world.container.querySelector('.jar-inspiration-composer'), 'the notepad is still open').toBeFalsy();
  const voice = [...world.container.querySelectorAll<HTMLButtonElement>('.waka-home-bar-door')].find(row => row.getAttribute('aria-label') === 'Keep your voice');
  expect(voice, 'home offers no Your voice').toBeTruthy();
  await act(async () => voice!.click()); await settle();
  expect(world.container.querySelector('.jar-inspiration-composer'), 'Your voice did not open the notepad').toBeTruthy();
  expect(listening(), 'Your voice did not start listening').toBeTruthy();
  expect(listening()!.textContent, 'the old draft\'s words came into the fresh note').not.toContain('xdfsdf');
  await act(async () => done().click()); await settle();
  expect(field().value, 'the old draft\'s words came into the fresh note').toBe('');
});
