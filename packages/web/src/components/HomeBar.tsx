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
 * "{n} KEPT ⌃" ABOVE IT (founder: "should be x kept"). The pull says how many
 * you have kept once that is known; before then, and at none, just "Kept".
 *
 * Past chats and Search are not here. Search is the field at the top of
 * Inspirations; past chats are reached from the chat page, through Chat.
 */
import { useRef } from 'react';

import { PHOTO_ACCEPT } from '../lib/inspiration-photo';
import { formatMessage } from '../lib/i18n';
import { t, type SupportedLocale } from '../lib/locales';
import { HomeActionIcon } from './HomeActionIcon';

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
  };
  onChat: () => void;
  chatDisabled?: boolean;
  /** "Saved", for a moment after a save lands; it takes the pull's place. */
  saved?: boolean;
  /** "{n} kept ⌃": opens the saves, patterns and principles. `kept` is how
      many you have kept, absent while unknown; at none or unknown it reads "Kept". */
  pull?: { onOpen: () => void; kept?: number };
}): JSX.Element {
  const say = (key: Parameters<typeof t>[1]) => t(props.locale, key);
  const photos = useRef<HTMLInputElement>(null);
  const save = props.save;
  return (
    <div className="waka-home-bar" data-jar-chrome="1" data-jar-interactive="1">
      {props.saved ? (
        <p className="waka-home-bar-saved" role="status">{say('worldBubbleKept')}</p>
      ) : props.pull ? (
        <button type="button" className="waka-home-bar-pull" aria-haspopup="dialog" onClick={props.pull.onOpen}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M6 15l6-6 6 6" /></svg>
          <span>{props.pull.kept ? formatMessage(props.locale, 'worldBarKeptCount', { count: props.pull.kept }) : say('worldBarSaves')}</span>
        </button>
      ) : null}
      <div className="waka-home-bar-row">
        {save ? (
          <nav className="waka-home-bar-pill" aria-label={say('worldBarLabel')}>
            <button type="button" className="waka-home-bar-door waka-home-bar-field" aria-label={say('worldBarKeepThought')} onClick={save.onWrite}>
              <span>{say('worldBarThoughtPrompt')}</span>
            </button>
            {/* THE PICKER OPENS INSIDE THE PRESS: a file input may only be
                clicked from a person's own gesture. */}
            <button type="button" className="waka-home-bar-door waka-home-bar-glyph" aria-label={say('worldBarKeepScreenshot')} title={say('worldBarKeepScreenshot')} disabled={save.photoDisabled} onClick={() => photos.current?.click()}>
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
          <HomeActionIcon kind="bubble" />
        </button>
      </div>
    </div>
  );
}
