/**
 * ═══ LISTENING — NOT THE SAME AS TYPING (founder, 2026-11-08) ═══════════════
 *
 * "when saving via speech, i want the UI to feel very clearly it's listening
 * and the text shows up subtly (not the same design as typing)". So while
 * the microphone is open the note gives way to this: the creature, a soft
 * light breathing around it (the one motion here, and it explains: the
 * microphone is open), a small "Listening…", and the words arriving in
 * lighter ink — no box, no caret. "Done" is a word, never filled. On Done
 * the words drop into the note as ordinary text.
 *
 * ═══ A ROOM TO TALK IN, NOT A LINE (founder, 2026-11-09) ════════════════════
 *
 * "space feels so limited i dont feel like i can talk for hours". The words
 * were one short centred line under a 120px creature, pinned to the bottom
 * of the note. Now the words ARE the view: the whole screen between a small
 * header (the creature, still breathing, and "Listening…") and Done at the
 * bottom, a left-aligned page at reading size on the product's 640px
 * measure, scrolling as long as you talk. Newest words at the bottom, kept
 * in view as they arrive, unless you have scrolled up to reread: then the
 * page holds still until you come back down. What you said a while ago
 * rests in dimmer ink; the last stretch is the brightest; the words the
 * engine is still guessing at (the tail that changed since the last result,
 * until it settles) arrive softly. The line about where speech goes is one
 * quiet line above Done.
 *
 * FOCUS FOLLOWS IT (review, 2026-11-09): the mic that opened it is gone from
 * the page, so focus moves to Done; when the view closes with focus still in
 * it (or lost to the page), focus goes back to the mic (`data-listen-mic`),
 * else to the note's field. Only "Listening…" is a live region: the words
 * are read on demand, never re-announced with every guess the engine makes.
 *
 * Shared by the notepad, a saved note and a chat. Under reduced motion the
 * light holds still and words appear without fading. (A live level from the
 * microphone is not drawn: speech recognition does not hand the page the
 * audio, and opening the microphone a second time to measure it would ask
 * for it twice.)
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { t, type SupportedLocale } from '../lib/locales';
import { Companion } from './Companion';

/** How long an unchanged tail waits before it reads as settled. */
const SETTLE_MS = 1400;
/** Roughly the last few sentences stay in full ink; earlier words rest dimmer. */
const RECENT_CHARS = 280;
/** Within this many pixels of the bottom counts as "following along". */
const FOLLOW_SLACK = 40;

/** Where the words stop being the same as last time, pulled back to a word's start. */
export function settledLength(before: string, after: string): number {
  let same = 0;
  const most = Math.min(before.length, after.length);
  while (same < most && before.charCodeAt(same) === after.charCodeAt(same)) same += 1;
  if (same === after.length || /\s/.test(after[same]!)) return same;
  while (same > 0 && !/\s/.test(after[same - 1]!)) same -= 1;
  return same;
}

/** Where the bright stretch begins: the last paragraph, or the last ~280 characters, at a sentence's or a word's start. */
function recentStart(words: string, settled: number): number {
  const paragraph = words.lastIndexOf('\n', settled - 1) + 1;
  let from = Math.max(paragraph, settled - RECENT_CHARS);
  if (from <= paragraph) return paragraph;
  /* Begin at a sentence when one starts close by, else at a word. */
  const sentence = words.slice(from, Math.min(settled, from + 160)).search(/[.!?]\s+\S/);
  if (sentence >= 0) return from + sentence + words.slice(from + sentence).search(/\s\S/) + 1;
  while (from < settled && !/\s/.test(words[from - 1]!)) from += 1;
  return from;
}

export function ListeningView(props: {
  locale: SupportedLocale;
  /** The words heard so far — the draft as dictation writes it. */
  words: string;
  /** Where speech goes, said once in full (the browser's own service). */
  notice?: string;
  onDone: () => void;
}): JSX.Element {
  const say = (key: Parameters<typeof t>[1]) => t(props.locale, key);
  const root = useRef<HTMLDivElement>(null), done = useRef<HTMLButtonElement>(null);
  const page = useRef<HTMLDivElement>(null), following = useRef(true);

  /* WHAT IS SETTLED. Whatever was on the page when the view opened is
     settled; each new result settles what it did not change, and a tail
     left alone for a moment settles too (a final that repeats its interim
     word for word does not re-render, so time has to say it). Derived in
     render from the previous words, the way React keeps state in step with
     a prop, so a double render in development cannot lose it. */
  const [seen, setSeen] = useState({ words: props.words, settled: props.words.length });
  let settled = seen.settled;
  if (seen.words !== props.words) {
    settled = settledLength(seen.words, props.words);
    setSeen({ words: props.words, settled });
  }
  useEffect(() => {
    if (seen.settled >= seen.words.length) return;
    const timer = setTimeout(() => setSeen(now => ({ words: now.words, settled: now.words.length })), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [seen]);

  const words = props.words, recent = recentStart(words, settled);

  useEffect(() => { done.current?.focus({ preventScroll: true }); }, []);
  useLayoutEffect(() => {
    const here = root.current, near = here?.parentElement ?? null;
    return () => {
      const held = document.activeElement;
      if (held && held !== document.body && !(here?.contains(held))) return;
      /* After the commit, when the bar (and its mic) is back on the page. */
      queueMicrotask(() => {
        const now = document.activeElement;
        if (now && now !== document.body && now.isConnected) return;
        const back = document.querySelector<HTMLElement>('[data-listen-mic]:not(:disabled)')
          ?? near?.querySelector<HTMLElement>('textarea:not(:disabled)');
        back?.focus({ preventScroll: true });
      });
    };
  }, []);

  /* THE NEWEST WORDS STAY IN VIEW, unless you went up to reread. */
  useLayoutEffect(() => {
    const here = page.current;
    if (here && following.current) here.scrollTop = here.scrollHeight;
  }, [words]);
  const onScroll = () => {
    const here = page.current;
    if (here) following.current = here.scrollHeight - here.scrollTop - here.clientHeight <= FOLLOW_SLACK;
  };

  return (
    <div ref={root} className="waka-listening" role="group" aria-label={say('worldListening')}>
      <div className="waka-listening-head">
        <span className="waka-listening-being" aria-hidden="true">
          <span className="waka-listening-light" />
          <Companion size={40} label="" pressable={false} />
        </span>
        <p className="waka-listening-label" role="status">{say('worldListening')}</p>
      </div>
      <div ref={page} className="waka-listening-page" onScroll={onScroll}>
        <p className="waka-listening-words">
          {recent > 0 ? <span className="waka-listening-earlier">{words.slice(0, recent)}</span> : null}
          {settled > recent ? <span className="waka-listening-recent">{words.slice(recent, settled)}</span> : null}
          {words.length > settled ? <span key={settled} className="waka-listening-arriving">{words.slice(settled)}</span> : null}
        </p>
      </div>
      <div className="waka-listening-foot">
        {props.notice ? <p className="waka-listening-notice">{props.notice}</p> : null}
        <button ref={done} type="button" className="waka-listening-done" onClick={props.onDone}>{say('worldComposerDictateStop')}</button>
      </div>
    </div>
  );
}
