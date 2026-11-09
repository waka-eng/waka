/**
 * ═══ LISTENING — NOT THE SAME AS TYPING (founder, 2026-11-08) ═══════════════
 *
 * "when saving via speech, i want the UI to feel very clearly it's listening
 * and the text shows up subtly (not the same design as typing)". So while
 * the microphone is open the note bar gives way to this: the creature, a
 * soft light breathing around it (the one motion here, and it explains: the
 * microphone is open), a small "Listening…", and the words arriving beneath
 * in lighter ink — centred, no box, no caret. "Done" is a word, never filled.
 * The tools step aside; the line about where speech goes stands under the
 * words in full. On Done the words drop into the note as ordinary text.
 *
 * Shared by the notepad and a chat. Under reduced motion the light holds
 * still. (A live level from the microphone is not drawn: speech
 * recognition does not hand the page the audio, and opening the microphone
 * a second time to measure it would ask for it twice.)
 */
import { t, type SupportedLocale } from '../lib/locales';
import { Companion } from './Companion';

export function ListeningView(props: {
  locale: SupportedLocale;
  /** The words heard so far — the draft as dictation writes it. */
  words: string;
  /** Where speech goes, said once in full (the browser's own service). */
  notice?: string;
  onDone: () => void;
}): JSX.Element {
  const say = (key: Parameters<typeof t>[1]) => t(props.locale, key);
  return (
    <div className="waka-listening" role="group" aria-label={say('worldListening')}>
      <span className="waka-listening-being" aria-hidden="true">
        <span className="waka-listening-light" />
        <Companion size={72} label="" pressable={false} />
      </span>
      <p className="waka-listening-label" role="status">{say('worldListening')}</p>
      <p className="waka-listening-words" aria-live="polite">{props.words}</p>
      {props.notice ? <p className="waka-listening-notice">{props.notice}</p> : null}
      <button type="button" className="waka-listening-done" onClick={props.onDone}>{say('worldComposerDictateStop')}</button>
    </div>
  );
}
