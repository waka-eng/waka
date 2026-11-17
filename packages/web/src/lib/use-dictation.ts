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
 * IT IS NOT LOCAL IN CHROME: Chrome streams audio to Google's servers to
 * transcribe it. The line that said so on the listening view went at the
 * founder's word (2026-11-10, "remove"), and with it this hook's
 * `firstTime`, which only that line read.
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
  error: string;
  start: () => void;
  stop: () => void;
  /** Ends the session and drops whatever it still sends (a note closing). */
  abort: () => void;
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
  const [error, setError] = useState("");
  const session = useRef<Recognition | null>(null);
  /** The words that were in the note when the microphone opened. */
  const base = useRef("");
  /** Everything the engine has marked final this session. */
  const settled = useRef("");
  /** Which session is the current one. `start()` and `abort()` bump it;
      see the header for why `stop()` deliberately does not. */
  const run = useRef(0);
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

  /* A NOTE THAT CLOSES ABORTS (review, 2026-11-09). `stop` asks for one
     more final, which would land in the next note opened. Bumping `run`
     makes this session stale, so anything it still sends is dropped; the
     words it already wrote are in the note and stay there. */
  const abort = useCallback(() => {
    run.current += 1;
    session.current?.abort();
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

  return { listening, error, start, stop, abort };
}
