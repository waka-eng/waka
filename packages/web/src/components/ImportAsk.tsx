/**
 * ═══ THE CREATURE ASKS, ONCE (founder, 2026-11-27, "Day 1 import", flow A) ═══
 *
 * Inside the creature's own bubble, never a new corner or screen (one
 * navigation system): one line asking for what is already saved elsewhere, and
 * the bubble's usual foot row with three acts. Photos opens the picker the
 * bar's photo button opens, many at once (on the iOS build the web view hands
 * the same input to the system's photo picker); Files opens the file chooser
 * on the kinds a save already takes. Not now is remembered by the caller.
 *
 * THE PICKER OPENS INSIDE THE PRESS, as on the bar: a file input may only be
 * clicked from a person's own gesture.
 */
import type { ChangeEvent, RefObject } from 'react';

import { FILE_ACCEPT } from '../lib/api/file-accept';
import { PHOTO_ACCEPT } from '../lib/inspiration-photo';
import type { ImportDoor } from '../lib/day-one-import';
import { t, type SupportedLocale } from '../lib/locales';

export function ImportAsk(props: {
  locale: SupportedLocale;
  /** Clicks one of `ImportPickers`' inputs, inside this press. */
  onOpen: (door: ImportDoor) => void;
  onNotNow: () => void;
}): JSX.Element {
  const say = (key: Parameters<typeof t>[1]) => t(props.locale, key);
  return (
    <>
      <span className="jar-char-bubble-reading">{say('worldImportAsk')}</span>
      <span className="jar-char-bubble-acts">
        <button type="button" className="jar-char-bubble-act" onClick={() => props.onOpen('photos')}>{say('worldImportPhotos')}</button>
        <button type="button" className="jar-char-bubble-act" onClick={() => props.onOpen('files')}>{say('worldImportFiles')}</button>
        <button type="button" className="jar-char-bubble-act" onClick={props.onNotNow}>{say('worldNotNow')}</button>
      </span>
    </>
  );
}

/**
 * THE TWO INPUTS, APART FROM THE BUBBLE (code review, 2026-11-27). The bubble
 * can change while the system picker is open (a hunch lands), and an input
 * that unmounted with the ask would lose the pick, so `Home.tsx` keeps these
 * mounted with the page.
 */
export function ImportPickers(props: {
  photos: RefObject<HTMLInputElement>;
  files: RefObject<HTMLInputElement>;
  onPick: (files: File[], door: ImportDoor) => void;
}): JSX.Element {
  const picked = (door: ImportDoor) => (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = [...event.target.files ?? []]; event.target.value = '';
    if (chosen.length) props.onPick(chosen, door);
  };
  return (
    <>
      <input ref={props.photos} type="file" hidden multiple accept={PHOTO_ACCEPT} data-import-door="photos" onChange={picked('photos')} />
      <input ref={props.files} type="file" hidden multiple accept={FILE_ACCEPT} data-import-door="files" onChange={picked('files')} />
    </>
  );
}
