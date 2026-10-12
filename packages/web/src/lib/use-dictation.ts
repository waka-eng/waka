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
  /** Said once per session, the first time somebody dictates. */
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
    live.lang = locale;
    /* CONTINUOUS, because a thought is longer than a sentence and the
       default stops at the first pause. INTERIM, because watching the words
       appear is the whole difference between dictating and waiting. */
    live.continuous = true;
    live.interimResults = true;
    base.current = read.current();
    settled.current = "";
    setError("");
    if (!told.current) { told.current = true; setFirstTime(true); }

    live.onresult = (event) => {
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
