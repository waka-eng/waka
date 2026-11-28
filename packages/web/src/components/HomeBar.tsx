/**
 * ═══ THE HOME BAR — WHERE YOU START (design E1, F1, F3) ═══════════════════
 *
 * One 64px pill (Keep a thought…, then a picture and a mic), and a
 * round Chat beside it. It replaces "Inspiration · Chat" and the capture pill
 * that used to stand over it: saving was a door to a door, and the pill IS
 * the start now. Write opens the notepad (founder, on #463: "i want save to
 * open up a notepad"), Photo opens the picker with no ＋ menu in between,
 * Say it opens the notepad already listening.
 *
 * NOTHING HERE FILLS. Founder, 2026-11-05: "the button should never fill up
 * like this … it's either the save button is disabled or the text is fully
 * white." A door that cannot be used right now is dim; every other one is
 * full ink. The Chat circle is the same raised ground as the pill, not a
 * brighter one.
 *
 * ABOVE THE BAR, ONE THING AT A TIME: "{n} inspirations ⌃", the handle
 * that opens Inspirations (absent at none), or, for a moment after a save lands,
 * "Saved" in its place (F3). The confirmation takes the pull's spot so the
 * screen never stacks two lines over the bar.
 *
 * "KEEP A THOUGHT…", PICTURE, MIC (2026-11-09). Founder, on the earlier "Keep · a
 * thought · a screenshot · your voice": "sooo ugly". The pill now reads like
 * a field you are about to write in: the words "Keep a thought…" at its left,
 * dim like a placeholder, open the notepad; a picture and a microphone at its
 * right, glyphs alone, keep a screenshot and your voice. Each is named by the
 * whole act ("Keep a thought", "Keep a screenshot", "Keep your voice") for a
 * screen reader and, on the glyphs, a pointer's tooltip.
 *
 * "{n} INSPIRATIONS" ABOVE IT, under a lit grabber. The pull says how many
 * you have kept once that is known; before then, just the word.
 *
 * Past chats and Search are not here. Search is the field at the top of
 * Inspirations; past chats are reached from the chat page, through Chat.
 */
import { useRef, useState } from 'react';

import { PHOTO_ACCEPT } from '../lib/inspiration-photo';
import { formatMessage } from '../lib/i18n';
import { t, type SupportedLocale } from '../lib/locales';
import { HomeActionIcon } from './HomeActionIcon';

/** How far up the handle is dragged before it opens the inspirations. */
const PULL_OPEN_PX = 24;

export function HomeBar(props: {
  locale: SupportedLocale;
  /** Absent on a wall nobody may write to (an agent's): the pill is not drawn. */
  save?: {
    onWrite: () => void;
    onPhotos: (files: File[]) => void;
    onSay: () => void;
    /** False when this browser can neither transcribe nor record. */
    canSay: boolean;
    /** True while the notepad's draft cannot take a file yet. */
    photoDisabled?: boolean;
    /** True while the creature asks a new person for their photos (day one
        import): the photo button is the same door, so it is lit. */
    photoLit?: boolean;
  };
  onChat: () => void;
  chatDisabled?: boolean;
  /** "Saved", for a moment after a save lands; it takes the pull's place. */
  saved?: boolean;
  /** A line that must outlast the bubble (day one import: what did not come
      in). It takes the pull's place, before "Saved"; a press puts it away. */
  notice?: { text: string; onDismiss: () => void };
  /** "{n} kept ⌃": opens the saves, patterns and principles. `kept` is how
      many you have kept, absent while unknown; at none or unknown it reads "Kept". */
  pull?: { onOpen: () => void; kept?: number };
  /** A tap on the creature lit what its line points to: the Save pill or
      Chat. Each new `n` plays the light once. */
  beckon?: { n: number; to: 'save' | 'chat' };
  /** The creature asked something (a reading's "What's closer?"): the bar is
      where the answer is typed, never a new box. Escape or an empty Send
      puts it back. */
  answer?: { placeholder: string; onSend: (text: string) => void; onCancel: () => void };
}): JSX.Element {
  const say = (key: Parameters<typeof t>[1]) => t(props.locale, key);
  const photos = useRef<HTMLInputElement>(null);
  const dragFrom = useRef<number | null>(null);
  const dragged = useRef(false);
  const save = props.save;
  return (
    <div className="waka-home-bar" data-jar-chrome="1" data-jar-interactive="1">
      {props.notice ? (
        <button type="button" className="waka-home-bar-notice" role="status" onClick={props.notice.onDismiss}>{props.notice.text}</button>
      ) : props.saved ? (
        <p className="waka-home-bar-saved" role="status">{say('worldBubbleKept')}</p>
      ) : props.pull ? (
        /* A LIT GRABBER, TAPPED OR DRAGGED UP (founder meeting, 2026-11-20:
           the chevron read as decoration and the inspirations went unfound).
           A drag of a few px upward opens it as a tap does; the click that
           follows that drag is then swallowed so it does not open twice. */
        <button type="button" className="waka-home-bar-pull" aria-haspopup="dialog"
          onClick={() => { if (dragged.current) { dragged.current = false; return; } props.pull?.onOpen(); }}
          onPointerDown={e => { dragFrom.current = e.clientY; dragged.current = false; e.currentTarget.setPointerCapture?.(e.pointerId); }}
          onPointerMove={e => {
            if (dragFrom.current === null || dragFrom.current - e.clientY < PULL_OPEN_PX) return;
            dragFrom.current = null; dragged.current = true; props.pull?.onOpen();
          }}
          onPointerUp={() => { dragFrom.current = null; }} onPointerCancel={() => { dragFrom.current = null; }}>
          <span className="waka-home-bar-grab" aria-hidden="true" />
          <span>{props.pull.kept ? formatMessage(props.locale, 'worldBarKeptCount', { count: props.pull.kept }) : say('worldBarSaves')}</span>
        </button>
      ) : null}
      <div className="waka-home-bar-row">
        {props.answer ? <AnswerPill locale={props.locale} {...props.answer} /> : save ? (
          <nav className="waka-home-bar-pill" aria-label={say('worldBarLabel')}>
            {/* THE BAR ANSWERS THE CREATURE. Founder meeting, 2026-11-20:
                people tapped the creature to save and never found the bar,
                and the bar stays where the thumb is, so "when you click on
                the character make the bottom bar also illuminate to
                respond". Keyed by the tap count so every tap replays it. */}
            {props.beckon?.to === 'save' ? <span key={props.beckon.n} className="waka-home-bar-beckon" aria-hidden="true" /> : null}
            <button type="button" className="waka-home-bar-door waka-home-bar-field" aria-label={say('worldBarKeepThought')} onClick={save.onWrite}>
              <span>{say('worldBarThoughtPrompt')}</span>
            </button>
            {/* THE PICKER OPENS INSIDE THE PRESS: a file input may only be
                clicked from a person's own gesture. */}
            <button type="button" className={`waka-home-bar-door waka-home-bar-glyph${save.photoLit ? ' waka-home-bar-glyph--lit' : ''}`} aria-label={say('worldBarKeepScreenshot')} title={say('worldBarKeepScreenshot')} disabled={save.photoDisabled} onClick={() => photos.current?.click()}>
              <HomeActionIcon kind="photo" />
            </button>
            <button type="button" className="waka-home-bar-door waka-home-bar-glyph" aria-label={say('worldBarKeepVoice')} title={say('worldBarKeepVoice')} disabled={!save.canSay} onClick={save.onSay}>
              <HomeActionIcon kind="record" />
            </button>
            <input ref={photos} type="file" hidden multiple accept={PHOTO_ACCEPT}
              onChange={(event) => { const picked = [...event.target.files ?? []]; event.target.value = '';
                if (picked.length) save.onPhotos(picked); }} />
          </nav>
        ) : null}
        <button type="button" className="waka-home-bar-chat" aria-label={say('worldBarChat')}
          disabled={props.chatDisabled} onClick={props.onChat}>
          {props.beckon?.to === 'chat' ? <span key={props.beckon.n} className="waka-home-bar-beckon" aria-hidden="true" /> : null}
          <HomeActionIcon kind="bubble" />
        </button>
      </div>
    </div>
  );
}

/* THE BAR TAKES THE ANSWER (insight goal, phase 4; canvas "Not quite"):
   the same 64px pill, its words and one Send word at its end. Light only:
   Send is a word, never filled. */
function AnswerPill({ locale, placeholder, onSend, onCancel }: { locale: SupportedLocale; placeholder: string;
  onSend: (text: string) => void; onCancel: () => void }): JSX.Element {
  const [text, setText] = useState('');
  const send = () => { const said = text.trim(); if (said) onSend(said); else onCancel(); };
  return (
    <form className="waka-home-bar-pill waka-home-bar-answer" onSubmit={event => { event.preventDefault(); send(); }}>
      <input className="waka-home-bar-answer-field" autoFocus value={text} placeholder={placeholder} aria-label={placeholder}
        enterKeyHint="send" maxLength={500} onChange={event => setText(event.target.value)}
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); } }} />
      <button type="submit" className="waka-home-bar-answer-send">{t(locale, 'worldConversationSend')}</button>
    </form>
  );
}
