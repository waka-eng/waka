/**
 * ═══ THE CREATURE ASKS, ONCE (founder, 2026-11-27, "Day 1 import", flow A) ═══
 *
 * Inside the creature's own bubble, never a new corner or screen (one
 * navigation system): a line asking for what is already saved elsewhere, and
 * the bubble's usual foot row with three acts. Photos opens the picker the
 * bar's photo button opens, many at once (on the iOS build the web view hands
 * the same input to the system's photo picker); Files opens the file chooser
 * on the kinds a save already takes. Not now is remembered by the caller.
 *
 * THE PICKER OPENS INSIDE THE PRESS, as on the bar: a file input may only be
 * clicked from a person's own gesture.
 */
import { useRef, type ChangeEvent } from 'react';

import { FILE_ACCEPT } from '../lib/api/file-accept';
import { PHOTO_ACCEPT } from '../lib/inspiration-photo';
import type { ImportDoor } from '../lib/day-one-import';
import { t, type SupportedLocale } from '../lib/locales';

export function ImportAsk(props: {
  locale: SupportedLocale;
  onPick: (files: File[], door: ImportDoor) => void;
  onNotNow: () => void;
}): JSX.Element {
  const say = (key: Parameters<typeof t>[1]) => t(props.locale, key);
  const photos = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const picked = (door: ImportDoor) => (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = [...event.target.files ?? []]; event.target.value = '';
    if (chosen.length) props.onPick(chosen, door);
  };
  return (
    <>
      <span className="jar-char-bubble-reading">{say('worldImportAsk')}</span>
      <span className="jar-char-bubble-of">{say('worldImportKinds')}</span>
      <span className="jar-char-bubble-acts">
        <button type="button" className="jar-char-bubble-act" onClick={() => photos.current?.click()}>{say('worldImportPhotos')}</button>
        <button type="button" className="jar-char-bubble-act" onClick={() => files.current?.click()}>{say('worldImportFiles')}</button>
        <button type="button" className="jar-char-bubble-act" onClick={props.onNotNow}>{say('worldNotNow')}</button>
      </span>
      <input ref={photos} type="file" hidden multiple accept={PHOTO_ACCEPT} data-import-door="photos" onChange={picked('photos')} />
      <input ref={files} type="file" hidden multiple accept={FILE_ACCEPT} data-import-door="files" onChange={picked('files')} />
    </>
  );
}
