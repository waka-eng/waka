/**
 * ═══ SPEAKING INTO THE NOTE ═════════════════════════════════════════════
 *
 * Founder, looking at a recording sitting in a note as a `.webm` file:
 * "is it not possible to do speech to text easily, or is audio the only
 * easy way to record?"
 *
 * It is possible and it is easy, and it is also the BETTER default for this
 * product rather than a convenience on top of recording:
 *
 *   TEXT IS WHAT THE MACHINE READS. Signals are derived from the words of
 *   an inspiration. An audio blob is opaque to every layer above storage —
 *   it cannot be searched, it cannot be previewed as a lead line in the
 *   archive, and it contributes nothing to a top of mind. A spoken thought
 *   that arrives as text is a full citizen; the same thought as a file is a
 *   thing you have to go and listen to.
 *
 *   IT IS ALSO WHAT THE PERSON READS. The archive's rows are first lines.
 *   A recording's row says "Recording.webm".
 *
 * SO RECORDING DOES NOT GO AWAY, AND IS NOT THE DEFAULT EITHER. Dictation
 * is what the microphone does where the browser can do it; recording is
 * what it does where the browser cannot, and is also what you want when the
 * SOUND is the point — a voice memo of a melody, somebody else talking.
 * Both are kept; which one the button is wired to is `Home`'s decision, and
 * it prefers this one.
 *
 * ── WHAT THIS IS BUILT ON, AND WHAT THAT COSTS ───────────────────────────
 *
 * `SpeechRecognition` / `webkitSpeechRecognition`. No key, no account, no
 * dependency, interim results as you speak. Chrome and Safari have it;
 * Firefox does not, which is why `dictationAvailable()` exists and why the
 * caller must fall back rather than disable.
 *
 * IT IS NOT LOCAL IN CHROME. Chrome streams audio to Google's servers to
 * transcribe it. That is a real privacy fact about a product whose whole
 * promise is that your material is yours, and the honest handling of it is
 * not to hide it: `worldComposerDictateCloud` says so once, in the bar,
 * the first time somebody dictates. It is the same material a save sends to
 * this product's own server a moment later, so the exposure is a different
 * recipient rather than a new kind — but a different recipient is exactly
 * the thing a person is entitled to be told about.
 *
 * ONCE MEANS ONCE, AND FOR A WHILE IT DID NOT. `firstTime` latched: it went
 * true on the first dictation and was never written false, so the caller's
 * `firstTime && listening` was true for every dictation of the page and the
 * notice showed on all of them. See the flag's own doc comment for the fix
 * and for what was weighed — a sentence about audio leaving the device has a
 * real argument for repeating, and it loses to the founder's law that
 * nothing prints what the person already knows (`docs/six-laws.md`, Law 4:
 * *"remove things not 100% necessary"*). A notice on its fortieth showing is
 * furniture, and furniture is not a disclosure.
 *
 * ── THE TWO HARD PARTS, BOTH ABOUT NOT LOSING WORDS ──────────────────────
 *
 * INTERIM RESULTS ARE REPLACED, NOT APPENDED. The engine emits a growing
 * guess ("I think" → "I think we" → "I think we should") and then a final
 * for that utterance. Appending every event produces the famous stutter.
 * This tracks where the final text ends and rewrites only the tail.
 *
 * AND IT WRITES INTO WORDS THAT ALREADY EXIST. Somebody may have typed half
 * a sentence before pressing the microphone, and may type while speaking.
 * The anchor is captured at `start()` and the caller is handed `anchor +
 * spoken`, so typing during dictation is not clobbered by the next interim
 * event — the caller re-anchors on any change it did not cause.
 *
 * ── AND EVERY EVENT BELONGS TO THE SESSION THAT PRODUCED IT ──────────────
 *
 * `base` and `settled` are two refs that `start()` resets, and for a while
 * nothing tied an arriving event to the session whose words it carries. That
 * is a bug with the shape of every other late-answer bug in this product:
 * a browser does not promise to be finished with a session when `stop()`
 * returns — it promises the opposite, and this file says so two paragraphs
 * up, because asking for that one last final result is the whole reason
 * `stop` is used here rather than `abort`.
 *
 * So: speak, stop, press again, and the previous session's trailing final
 * arrives into the NEW session's accumulator and is written against the NEW
 * session's anchor. The anchor already contains those words — it was read off
 * a note they had just landed in — so they appear TWICE, after the words they
 * duplicate, in a note somebody is still dictating into. Worse, `settled` is
 * corrupted for the rest of that session, so every later interim carries them
 * too.
 *
 * `onerror` HAD THE SAME HOLE AND A WORSE CONSEQUENCE: it cleared `listening`
 * and dropped `session.current` without asking whose error it was, so a
 * `network` failure belonging to a session that had ENDED took the live one's
 * Stop control off the screen while its engine kept running. That is the
 * microphone-that-will-not-switch-off again, arriving from the one direction
 * `onend`'s identity check was already written to refuse.
 *
 * `run` IS A COUNTER AND NOT AN OBJECT IDENTITY, and the difference matters:
 * `stop()` deliberately clears `session.current` so the next `start()` is
 * allowed, which means the identity check `onend` uses cannot be reused for
 * `onresult` — it would throw away the very last result that `stop` asked
 * for. A counter that only `start()` bumps keeps that final (nothing has
 * superseded it) and drops it the moment a newer session exists.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/* The two spellings. Safari has only the prefixed one; the unprefixed name
   is the standard and is what Chrome ships. */
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionLikeEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};
interface SpeechRecognitionLikeEvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}
type RecognitionClass = new () => Recognition;

function engine(): RecognitionClass | null {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionClass;
    webkitSpeechRecognition?: RecognitionClass;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Whether this browser can turn speech into text at all. */
export function dictationAvailable(): boolean {
  return typeof window !== "undefined" && engine() !== null;
}

export interface Dictation {
  listening: boolean;
  /**
   * TRUE FOR THE FIRST DICTATION OF THIS PAGE AND FALSE FOR EVERY ONE AFTER
   * IT — which is what this flag was always documented to mean, and was not.
   *
   * It used to LATCH: `if (!told.current) { told.current = true;
   * setFirstTime(true); }` and nothing ever wrote `false` again, so a flag
   * named "first time" was true from the first dictation until the tab
   * closed. The caller shows the cloud disclosure while `firstTime &&
   * listening`, and `listening` is true on every dictation, so the sentence
   * about audio leaving the device appeared on all of them. Two comments in
   * `Home.tsx` said "said once, the first time"; one of them had even worked
   * out that the latch made that false and designed the bar's priority order
   * around it rather than fixing it here.
   *
   * THE CALLER STILL HAS TO GATE ON `listening`, and that is deliberate.
   * This says WHICH session is the first; the caller decides for how long a
   * line about it stays on screen, and the notepad's answer is "while the
   * microphone is open", so the disclosure is up for exactly as long as the
   * thing it discloses is happening.
   */
  firstTime: boolean;
  error: string;
  start: () => void;
  stop: () => void;
}

/**
 * @param anchor reads the words already in the note, at the moment of start
 * @param onText receives the whole note's new text on every result
 */
export function useDictation(
  anchor: () => string,
  onText: (text: string) => void,
  locale: string,
): Dictation {
  const [listening, setListening] = useState(false);
  const [firstTime, setFirstTime] = useState(false);
  const [error, setError] = useState("");
  const session = useRef<Recognition | null>(null);
  /** The words that were in the note when the microphone opened. */
  const base = useRef("");
  /** Everything the engine has marked final this session. */
  const settled = useRef("");
  /** Which session is the current one. Only `start()` bumps it; see the
      header for why `stop()` deliberately does not. */
  const run = useRef(0);
  const told = useRef(false);
  const write = useRef(onText);
  write.current = onText;
  const read = useRef(anchor);
  read.current = anchor;

  /* THE MICROPHONE IS RELEASED ON UNMOUNT, ALWAYS. `abort` rather than
     `stop`: stopping asks for one more final result, which would arrive
     after the component is gone and write into nothing. */
  useEffect(() => () => { session.current?.abort(); session.current = null; }, []);

  const stop = useCallback(() => {
    session.current?.stop();
    session.current = null;
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Engine = engine();
    if (!Engine || session.current) return;
    const live = new Engine();
    const mine = ++run.current;
    const current = () => run.current === mine;
    live.lang = locale;
    /* CONTINUOUS, because a thought is longer than a sentence and the
       default stops at the first pause. INTERIM, because watching the words
       appear is the whole difference between dictating and waiting. */
    live.continuous = true;
    live.interimResults = true;
    base.current = read.current();
    settled.current = "";
    setError("");
    /* ONLY THE FIRST SESSION IS THE FIRST SESSION. The `else` is the whole
       fix: this said `if (!told.current) { told.current = true;
       setFirstTime(true); }` and left the flag standing at `true` forever
       after, so a caller reading `firstTime && listening` — which is what
       `Home` does, because the line belongs on screen only while the
       microphone is open — showed the cloud disclosure on every dictation of
       the page. The `told` ref and not the state because `start` must read the
       answer in the same tick it writes it, and state is the render after.

       WHAT WAS REJECTED: remembering in `localStorage`, so the sentence is
       said once per person rather than once per page load. It is arguably the
       truer reading of "once" and it was turned down twice over. A disclosure
       is the one thing in this product that must not depend on storage that
       can be cleared, carried between accounts on a shared machine, or
       missing in a private window — and this hook holds no profile scope, so
       it would have had to invent a key the rest of the product scopes through
       `profileStorageKey`. A page load is also the unit a person experiences
       as "this sitting"; hearing it again tomorrow is not noise. */
    if (!told.current) { told.current = true; setFirstTime(true); }
    else setFirstTime(false);

    live.onresult = (event) => {
      /* A LATE FINAL FROM A SUPERSEDED SESSION IS NOT THIS SESSION'S WORDS.
         Dropped rather than appended: it would otherwise be added to this
         session's `settled` and written against this session's anchor, which
         already contains it. See the header. */
      if (!current()) return;
      let interim = "";
      for (let at = event.resultIndex; at < event.results.length; at += 1) {
        const result = event.results[at]!;
        const said = result[0]?.transcript ?? "";
        if (result.isFinal) settled.current += said;
        else interim += said;
      }
      /* ONE SPACE BETWEEN WHAT WAS THERE AND WHAT IS SAID, and none if the
         note was empty or already ends in whitespace. Dictating into the
         middle of a word is the one outcome nobody wants. */
      const existing = base.current;
      const joiner = !existing || /\s$/.test(existing) ? "" : " ";
      write.current(`${existing}${joiner}${settled.current}${interim}`.trimStart());
    };

    live.onerror = (event) => {
      /* AND NEITHER IS A SUPERSEDED SESSION'S FAILURE. Without this, an
         error belonging to a finished session cleared `listening` and
         dropped the handle on the running one — the Stop control gone, the
         engine still on. */
      if (!current()) return;
      const kind = event.error ?? "";
      /* `no-speech` AND `aborted` ARE NOT FAILURES. The first fires when
         somebody opens the microphone and thinks for a moment, the second
         when they stop it themselves. Reporting either as an error would
         put a red line under a note for doing nothing wrong. */
      if (kind === "no-speech" || kind === "aborted") return;
      setError(kind === "not-allowed" || kind === "service-not-allowed"
        ? "dictation-denied"
        : "dictation-failed");
      setListening(false);
      session.current = null;
    };

    live.onend = () => {
      /* THE ENGINE ENDS ON ITS OWN after a long silence, even in continuous
         mode. The note keeps every word; the button simply goes back to
         offering. Restarting automatically would be a microphone that will
         not switch off, which is worse than one that needs a second press. */
      if (session.current === live) { session.current = null; setListening(false); }
    };

    try {
      live.start();
      session.current = live;
      setListening(true);
    } catch {
      /* `start()` throws if one is already running in another component —
         rare, but it throws synchronously and would otherwise take the
         whole render down. */
      setError("dictation-failed");
    }
  }, [locale]);

  return { listening, firstTime, error, start, stop };
}
