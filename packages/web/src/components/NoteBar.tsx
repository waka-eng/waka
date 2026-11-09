/**
 * ═══ THE NOTE BAR — ONE COMPONENT FOR EVERY PLACE YOU WRITE ════════════════
 *
 * The notepad (a new save, with or without a picture) and a chat write into
 * the same bar. Founder, of the chat's box beside the notepad's: "make this
 * bottom for chatting feel EXACTLY like [the notepad's note bar]. use the
 * same code so it looks identical." So both render this, and no stylesheet
 * keeps a second copy of it.
 *
 * ITS ANATOMY (founder, 2026-11-09: "notepad feels so 답답해"): ONE PILL,
 * the home bar's shape. The tools at its start (mic, photo, file), the act at
 * its end (Keep, Send) as a quiet word: dim when there is nothing to act on,
 * full ink when there is, never filled or boxed. Between them, either the one
 * transient state line or, for a caller whose words live IN the bar (a
 * chat), the field itself, one line at rest and growing as it is typed into.
 *
 * The notepad's words are not in it any more: they are written straight on
 * the page, and this pill floats under them, small and centred. So
 * `children` (the field) is optional, and a bar without one is tools only.
 *
 * `above` is for what belongs to the words but is not them (a chat's chips).
 * The field is the caller's own element, so each keeps its keys and handlers.
 */
import { useRef, type ReactNode } from 'react';

import { FILE_ACCEPT } from '../lib/api/file-accept';
import { PHOTO_ACCEPT } from '../lib/inspiration-photo';
import { HomeActionIcon } from './HomeActionIcon';

export function NoteBar(props: {
  /** The field, when the words are typed inside the bar (a chat). */
  children?: ReactNode;
  tools?: ReactNode;
  state?: ReactNode;
  action?: ReactNode;
  above?: ReactNode;
  /** An extra class for a caller's own selectors (never its own look). */
  className?: string;
}): JSX.Element {
  const field = props.children !== undefined && props.children !== null && props.children !== false;
  return (
    <div className={`waka-note-bar${props.className ? ` ${props.className}` : ''}`} data-note-bar="1" data-field={field ? '1' : undefined}>
      {props.above}
      {field && props.state ? <span className="waka-note-bar-state">{props.state}</span> : null}
      <div className="waka-note-bar-row">
        <span className="waka-note-bar-tools">{props.tools}</span>
        {field ? <span className="waka-note-bar-field">{props.children}</span> : <span className="waka-note-bar-state">{props.state}</span>}
        {props.action}
      </div>
    </div>
  );
}

/**
 * PHOTO AND FILE, STRAIGHT ON THE BAR — no ＋ menu (founder, 2026-11-05).
 * Each opens its own chooser inside the press (a file input may only be
 * clicked from a person's own gesture); what is chosen goes to the caller,
 * which owns the checks (`inspectInspirationPhoto`, `inspectAttachmentFile`).
 */
export function NoteBarAttach(props: {
  photoLabel: string;
  fileLabel: string;
  onPhotos: (files: File[]) => void;
  /** Absent: no file press (a surface that takes photos only). */
  onFiles?: (files: File[]) => void;
  disabled?: boolean;
  multiple?: boolean;
  title?: string;
}): JSX.Element {
  const photos = useRef<HTMLInputElement>(null), files = useRef<HTMLInputElement>(null);
  const take = (handle?: (picked: File[]) => void) => (event: { target: HTMLInputElement }) => {
    const picked = [...event.target.files ?? []]; event.target.value = '';
    if (picked.length) handle?.(picked);
  };
  return <>
    <button type="button" className="waka-dock-tool" aria-label={props.photoLabel} title={props.title} disabled={props.disabled}
      onClick={() => photos.current?.click()}><HomeActionIcon kind="photo" /></button>
    {props.onFiles ? <button type="button" className="waka-dock-tool" aria-label={props.fileLabel} title={props.title} disabled={props.disabled}
      onClick={() => files.current?.click()}><HomeActionIcon kind="file" /></button> : null}
    <input ref={photos} type="file" hidden multiple={props.multiple} accept={PHOTO_ACCEPT} onChange={take(props.onPhotos)} />
    {props.onFiles ? <input ref={files} type="file" hidden multiple={props.multiple} accept={FILE_ACCEPT} onChange={take(props.onFiles)} /> : null}
  </>;
}
