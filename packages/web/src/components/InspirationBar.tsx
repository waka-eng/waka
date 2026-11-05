/**
 * ═══ THE HOME BAR — THE ONE PRIMARY CONTROL (waka-design-brief.md §3c) ═══
 *
 * "Saving is the only action on the screen, and the reward is always
 * visible." The home had two stacked primary controls — a "+ New
 * inspiration" pill that opened a full-page notepad, and a three-tab bar
 * under it — and saving felt like a decision. This replaces both with one
 * docked field, like a messaging app's: type or paste, press Enter, it is
 * kept. No title, no tags, no question at save time, no page change.
 *
 * IT IS A SECOND FACE ON THE NOTEPAD'S DRAFT, NOT A SECOND SAVE PATH. The
 * text, the files, the idempotent save request, the recovery after a reload,
 * the conflict with another tab — all of that lives in `Home.tsx` around
 * `keepIt` and `composerDraft`, and this component only draws it. A second
 * pipeline for the same act is how two saves that disagree get built, so
 * the bar takes the draft's state as props and hands every act back up.
 *
 * WHAT IT SHOWS, AND ONLY THAT:
 *   ＋ (photo · file · voice) · the field · → (only while there is something
 *   to keep). "Saved" rises above it for 1.5s after a save; a failure is said
 *   under the field, and the words stay in it.
 *
 * `data-primary="true"` is the brief's automated check (§9.2): the home
 * renders exactly one element that carries it, and this is that element.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';

import { attachmentLabel } from '../lib/attachment-label';
import type { InspirationDraftMedia } from '../lib/inspiration-draft-store';
import { t, type SupportedLocale } from '../lib/locales';
import { AddMenu } from './AddMenu';
import { HomeActionIcon } from './HomeActionIcon';

/** How long "Saved" stands above the bar (brief §3c: "a 1.5s inline confirmation"). */
export const SAVED_NOTICE_MS = 1500;

export function InspirationBar(props: {
  locale: SupportedLocale;
  text: string;
  onText: (text: string, caret: number) => void;
  media: InspirationDraftMedia[];
  onRemoveMedia: (id: string) => void;
  onFiles: (files: File[], door: 'photo' | 'file') => void;
  onSubmit: () => void;
  /** Something is being uploaded or saved; the arrow waits. */
  busy: boolean;
  /** A save that failed, or a file that cannot be kept — said under the field. */
  error: string;
  /** Bumped once per completed save; each bump raises "Saved" again. */
  savedAt: number;
  /** Set when the save is queued here rather than sent (no connection). */
  savedLater?: boolean;
  inputRef: RefObject<HTMLTextAreaElement>;
  voice?: { listening: boolean; onHoldStart: () => void; onHoldEnd: () => void };
}): JSX.Element {
  const say = (key: Parameters<typeof t>[1]) => t(props.locale, key);
  const hasSomething = Boolean(props.text.trim() || props.media.length);

  /* "SAVED" IS A MOMENT, NOT A STATE. It shows for 1.5s from the save that
     raised it and then leaves; a second save inside that window restarts it
     rather than stacking. Keyed on `savedAt`, so a re-render alone cannot
     bring it back. */
  const [notice, setNotice] = useState(false);
  const seen = useRef(props.savedAt);
  useEffect(() => {
    if (props.savedAt === seen.current) return;
    seen.current = props.savedAt;
    setNotice(true);
    const timer = window.setTimeout(() => setNotice(false), SAVED_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [props.savedAt]);

  /* THE FIELD GROWS WITH WHAT IS IN IT, up to a ceiling, measured on every
     change of the text it measures rather than once. */
  useEffect(() => {
    const field = props.inputRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight}px`;
  }, [props.text, props.inputRef]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    /* The first Enter of a Korean sentence belongs to the IME, not to us. */
    if (event.nativeEvent.isComposing || event.key !== 'Enter') {
      if (event.key === 'Escape') event.currentTarget.blur();
      return;
    }
    /* Enter saves; ⌘/Ctrl+Enter saves too (brief §7); Shift+Enter is a new
       line, which is what every messaging field taught people. */
    if (event.shiftKey && !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    if (hasSomething && !props.busy) props.onSubmit();
  };

  return (
    <form className="waka-bar" data-primary="true" data-jar-chrome="1" data-jar-interactive="1"
      aria-label={say('worldBarLabel')}
      onSubmit={(event) => { event.preventDefault(); if (hasSomething && !props.busy) props.onSubmit(); }}>
      <p className="waka-bar-notice" role="status" data-shown={notice ? '1' : undefined}>
        {notice ? say(props.savedLater ? 'worldBarSavedLater' : 'worldSavedWord') : ''}
      </p>
      {props.media.length ? (
        <ul className="waka-bar-media" aria-label={say('worldBarAttached')}>
          {props.media.map((item) => (
            <li key={item.id} className="waka-bar-chip" data-problem={item.validationError || item.uploadError ? '1' : undefined}>
              <span>{attachmentLabel(props.locale, item.type, item.name)}</span>
              <button type="button" className="waka-bar-chip-remove" disabled={props.busy}
                aria-label={`${say('worldBarRemove')} ${attachmentLabel(props.locale, item.type, item.name)}`}
                onClick={() => props.onRemoveMedia(item.id)}>×</button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="waka-bar-row">
        <AddMenu buttonClassName="waka-bar-tool" label={say('worldBarAdd')}
          photoLabel={say('worldAddPhoto')} fileLabel={say('worldAddFile')} multiple
          disabled={props.busy}
          onPhotos={(files) => props.onFiles(files, 'photo')}
          onFiles={(files) => props.onFiles(files, 'file')}
          voice={props.voice ? { label: say('worldBarVoice'), ...props.voice } : undefined} />
        <textarea ref={props.inputRef} className="waka-bar-field" rows={1} value={props.text}
          aria-label={say('worldBarPlaceholder')} placeholder={say('worldBarPlaceholder')}
          aria-describedby={props.error ? 'waka-bar-error' : undefined}
          aria-invalid={props.error ? true : undefined}
          enterKeyHint="send"
          onChange={(event) => props.onText(event.target.value, event.target.selectionStart ?? event.target.value.length)}
          onKeyDown={onKeyDown}
          onPaste={(event) => {
            /* A pasted picture is a file; pasted words, a URL included, are
               just words until Enter — the brief says no preview first. */
            if (!event.clipboardData.files.length) return;
            event.preventDefault();
            props.onFiles([...event.clipboardData.files], 'photo');
          }} />
        {hasSomething ? (
          <button type="submit" className="waka-bar-send" disabled={props.busy} aria-label={say('worldBarSave')}>
            <HomeActionIcon kind="send" />
          </button>
        ) : null}
      </div>
      {props.voice?.listening ? <p className="waka-bar-hint" role="status">{say('worldBarListening')}</p> : null}
      {props.error ? <p id="waka-bar-error" className="waka-bar-error" role="alert">{props.error}</p> : null}
    </form>
  );
}
