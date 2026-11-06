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
import { useEffect, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';

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
  /** When the last save completed (epoch ms; 0 for none). "Saved" stands
      for 1.5s from that moment — also when the bar only appears after it,
      as it does when the save came from the notepad. */
  savedAt: number;
  /** Set when the save is queued here rather than sent (no connection). */
  savedLater?: boolean;
  inputRef: RefObject<HTMLTextAreaElement>;
  voice?: { listening: boolean; onHoldStart: () => void; onHoldEnd: () => void };
  /**
   * SAVE OR ASK (brief §3c): "Chat is a mode of the same field, not a tab."
   * Absent, the bar only saves. In Ask the field asks about what was saved,
   * the ＋ steps aside, and `thread` — the conversation — grows above it.
   * The mode is said four ways so it survives the screen being desaturated
   * (§9.6): the pressed half of the toggle, the placeholder, the arrow's
   * name, and the thread itself; the accent border is the fifth, not the
   * only one.
   */
  ask?: { on: boolean; onMode: (ask: boolean) => void; thread?: ReactNode };
  /**
   * SAVE OPENS THE NOTEPAD (founder, 2026-11-05, with the notepad on screen:
   * "i want save to open up a notepad like [this]"). When given, the field
   * in Save mode is a door rather than a place to type: pressing it — or
   * reaching it with "/" — opens the full-page notepad, which keeps the
   * draft and has its own Save. This overrides the brief's "Enter saves
   * immediately" for Save mode; Ask mode still types in place.
   */
  onOpenNotepad?: () => void;
}): JSX.Element {
  const say = (key: Parameters<typeof t>[1]) => t(props.locale, key);
  const asking = Boolean(props.ask?.on);
  const notepadDoor = Boolean(props.onOpenNotepad) && !asking;
  const hasSomething = Boolean(props.text.trim() || (!asking && props.media.length));

  /* "SAVED" IS A MOMENT, NOT A STATE. It shows for 1.5s from the save that
     raised it and then leaves; a second save inside that window restarts it
     rather than stacking. Measured from the save's own time, not from when
     this bar mounted: a save made on the notepad lands while the bar is not
     on screen, and the bar that comes back must still say so. */
  const [notice, setNotice] = useState(false);
  useEffect(() => {
    const left = props.savedAt ? SAVED_NOTICE_MS - (Date.now() - props.savedAt) : 0;
    if (left <= 0) { setNotice(false); return; }
    setNotice(true);
    const timer = window.setTimeout(() => setNotice(false), left);
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
    if (notepadDoor) {
      if (event.key === 'Tab' || event.key === 'Escape' || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.length === 1 || event.key === 'Enter') { event.preventDefault(); props.onOpenNotepad!(); }
      return;
    }
    /* The first Enter of a Korean sentence belongs to the IME, not to us. */
    if (event.nativeEvent.isComposing || event.key !== 'Enter') {
      /* Esc leaves Ask (brief §7); in Save it lets go of the field. */
      if (event.key === 'Escape') { if (asking) { event.preventDefault(); props.ask!.onMode(false); } else event.currentTarget.blur(); }
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
      data-mode={asking ? 'ask' : 'save'}
      aria-label={say(asking ? 'worldBarAskLabel' : 'worldBarLabel')}
      onSubmit={(event) => { event.preventDefault(); if (hasSomething && !props.busy) props.onSubmit(); }}>
      <p className="waka-bar-notice" role="status" data-shown={notice ? '1' : undefined}>
        {notice ? say(props.savedLater ? 'worldBarSavedLater' : 'worldSavedWord') : ''}
      </p>
      {asking && props.ask?.thread ? <div className="waka-ask-thread">{props.ask.thread}</div> : null}
      {!asking && props.media.length ? (
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
        {props.ask ? (
          <span className="waka-bar-mode" role="group" aria-label={say('worldBarMode')}>
            <button type="button" aria-pressed={!asking} onClick={() => props.ask!.onMode(false)}>{say('worldBarModeSave')}</button>
            <button type="button" aria-pressed={asking} onClick={() => props.ask!.onMode(true)}>{say('worldBarModeAsk')}</button>
          </span>
        ) : null}
        {asking ? null : <AddMenu buttonClassName="waka-bar-tool" label={say('worldBarAdd')}
          photoLabel={say('worldAddPhoto')} fileLabel={say('worldAddFile')} multiple
          disabled={props.busy}
          onPhotos={(files) => props.onFiles(files, 'photo')}
          onFiles={(files) => props.onFiles(files, 'file')}
          voice={props.voice ? { label: say('worldBarVoice'), ...props.voice } : undefined} />}
        <textarea ref={props.inputRef} className="waka-bar-field" rows={1} value={props.text}
          readOnly={notepadDoor}
          aria-haspopup={notepadDoor ? 'dialog' : undefined}
          /* Pressed or typed into — never merely focused: focus comes back
             here when the notepad closes, and a door that opened on focus
             would open again the moment you left it. */
          onClick={notepadDoor ? () => props.onOpenNotepad!() : undefined}
          aria-label={say(asking ? 'worldBarAskPlaceholder' : 'worldBarPlaceholder')} placeholder={say(asking ? 'worldBarAskPlaceholder' : 'worldBarPlaceholder')}
          aria-describedby={props.error ? 'waka-bar-error' : undefined}
          aria-invalid={props.error ? true : undefined}
          enterKeyHint="send"
          onChange={(event) => props.onText(event.target.value, event.target.selectionStart ?? event.target.value.length)}
          onKeyDown={onKeyDown}
          onPaste={(event) => {
            /* A pasted picture is a file; pasted words, a URL included, are
               just words until Enter — the brief says no preview first. */
            if (asking || !event.clipboardData.files.length) return;
            event.preventDefault();
            props.onFiles([...event.clipboardData.files], 'photo');
          }} />
        {hasSomething ? (
          <button type="submit" className="waka-bar-send" disabled={props.busy} aria-label={say(asking ? 'worldBarAsk' : 'worldBarSave')}>
            <HomeActionIcon kind="send" />
          </button>
        ) : null}
      </div>
      {!asking && props.voice?.listening ? <p className="waka-bar-hint" role="status">{say('worldBarListening')}</p> : null}
      {props.error ? <p id="waka-bar-error" className="waka-bar-error" role="alert">{props.error}</p> : null}
    </form>
  );
}
