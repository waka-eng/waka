/**
 * ═══ THE NOTEPAD ══════════════════════════════════════════════════════════
 *
 * Founder, with Apple Notes open on a blank note: "copy this apple note
 * experience." The annotations on that screenshot are the whole specification:
 * a chevron top-left — "go back to list of past inspirations" — the moment the
 * note was begun printed in grey beside it, an empty page, and one floating
 * pill in the bottom-left corner holding "2 icons: 1. record 2. image".
 *
 * WHAT LEFT, AND WHY IT WAS NOT A TRIM. Founder on the block that used to sit
 * under the field — Photo, Link and Record as three outlined buttons, then the
 * audience pair, then Save, then a line explaining the audience: "remove all."
 *
 * Five controls stacked under a blank page is a form, and a form is the one
 * thing this surface must not be. Everything that survives is either a) the
 * words, or b) in a corner:
 *
 *   the way back, top-left, where a phone puts it
 *   when this note is, top-middle, because on an empty page that is the only
 *     fact that exists yet
 *   who may read it, top-right, where the reference keeps its "⋯"
 *   attaching, bottom-left, two glyphs in one pill
 *   keeping it, bottom-right, opposite the pill
 *
 * The middle of the screen is yours. Nothing is in it.
 *
 * LINK LOST ITS BUTTON AND NOT ITS SUPPORT. A url pasted into the words is
 * already read as one by `inspirationWithPendingLink`; the field below only
 * still renders for a draft that was restored carrying one, so nothing a
 * person already typed is stranded by a button going away.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { DialogSurface } from './DialogSurface';
import { AuthoredSaveNotice } from './AuthoredSaveNotice';
import { HomeActionIcon } from './HomeActionIcon';
import {inspirationWithPendingLink} from '../lib/inspiration-input';
import { t, type SupportedLocale } from '../lib/locales';
import { momentStamp } from '../lib/words';
import type { InspirationDraftMedia } from '../lib/inspiration-draft-store';
import type { useAuthoredSave } from '../lib/use-authored-save';
import type { useAudioRecording } from '../lib/use-audio-recording';

function fileSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function MediaPreview({ item, recording = false, label }: { item: InspirationDraftMedia; recording?: boolean; label?: string }) {
  const [url, setUrl] = useState('');
  const [imageFailed, setImageFailed] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => { if (recording) audio.current?.pause(); }, [recording]);
  useEffect(() => {
    if (!item.blob || item.validationError) return;
    const value = URL.createObjectURL(item.blob); setUrl(value); setImageFailed(false);
    return () => URL.revokeObjectURL(value);
  }, [item.blob, item.validationError]);
  if (item.validationError) return null;
  if (item.type === 'image' && url) return imageFailed
    ? <p className="jar-composer-storage-note">This browser can’t preview this photo. The original can still be saved.</p>
    : <img src={url} alt={item.name} onError={() => setImageFailed(true)} />;
  if (item.type === 'audio' && url) return <audio ref={audio} controls={!recording} src={url} preload="metadata" aria-label={label ?? item.name} />;
  return null;
}
export function InspirationComposer(props: {
  text: string; media: InspirationDraftMedia[]; locale: SupportedLocale; public: boolean;
  linkText: string; onLinkText: (value:string)=>void;
  ready: boolean; fileDraftsAvailable: boolean; busy: boolean; error: string; uploadingId: string | null;
  save: ReturnType<typeof useAuthoredSave>; recording: ReturnType<typeof useAudioRecording>;
  inputRef: Ref<HTMLTextAreaElement>;
  /** When the draft under this page was last touched, so a note restored
      tomorrow is not stamped with tomorrow. Absent for a blank one. */
  draftUpdatedMs?: number;
  recordingCandidate?: InspirationDraftMedia | null; onChooseRecording: (useNew: boolean) => void;
  onText: (text: string, caret: number) => void; onFiles: (files: File[]) => void;
  onRetryFile: (id: string) => void;
  onRemove: (id: string) => void; onVisibility: (value: boolean) => void;
  /** The chevron: the archive this note is about to join. */
  onPast: () => void;
  onClose: () => void; onSubmit: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void; onForkDraft: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null), linkInput = useRef<HTMLInputElement>(null);
  const [addingLink, setAddingLink] = useState(Boolean(props.linkText));
  const link = props.linkText;
  /* WHEN THIS NOTE IS, read once. Taking it from the draft's own `updatedAt`
     live would reprint the minute under somebody's hand on every keystroke,
     which is the world moving without them moving it. */
  const when = useRef<number | null>(null);
  if (when.current === null) when.current = (props.text.trim() && props.draftUpdatedMs) ? props.draftUpdatedMs : Date.now();
  useEffect(()=>{if (props.linkText) setAddingLink(true);},[props.linkText]);
  const blocked = props.busy || Boolean(props.save.pending) || !props.ready || props.recording.phase !== 'idle';
  const invalidFiles = props.media.some(item => item.validationError) || props.media.length > 5;
  const say = (key: Parameters<typeof t>[1]) => t(props.locale, key);
  const empty = !props.text.trim() && !props.media.length && !link.trim();
  const submit = () => {
    try {
      inspirationWithPendingLink(props.text,link);props.onSubmit();
    } catch {linkInput.current?.setCustomValidity(say('worldComposerInvalidLink'));linkInput.current?.reportValidity();}
  };
  useEffect(()=>{if(addingLink)linkInput.current?.focus();},[addingLink]);
  return <DialogSurface className="jar-seek jar-inspiration-composer" aria-label={say('worldCaptureInspiration')} onClose={props.onClose} data-jar-chrome="1"
    onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
    onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); if (!blocked) props.onFiles([...event.dataTransfer.files]); } }}>
    {/* THE THREE CORNERS OF THE TOP, and the heading row they replaced. That
        row was a title and a Close — a dialog announcing itself in a bar,
        which is the one thing the reference's note page does not do. */}
    <div className="jar-note-top">
      {/* NAMED, LIKE EVERY OTHER WAY BACK IN THE PRODUCT. A bare chevron in
          a box said nothing about where it went — founder, pointing at it:
          "why is this still here?" — while the archive, the chats and an
          open note all return with a chevron and the name of the place.
          `worldBackToAll` is the archive's own words, which is exactly
          where this goes. */}
      <button type="button" className="jar-note-back" onClick={props.onPast}>
        <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true" focusable="false">
          <path d="M6.5 1.5 2.5 5.5l4 4" fill="none" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        {say('worldBackToAll')}
      </button>
      <span className="jar-note-when">{momentStamp(when.current, props.locale)}</span>
      {/* THE AUDIENCE PAIR IS GONE, AND SO IS WHAT IT CHOSE BETWEEN.
          Founder: "I told you we got rid of the concept for room so there
          shouldn't be only me and share with rooms."
          A control offering two destinations when the product has one is
          worse than clutter — it teaches a model of the thing that is no
          longer true, and every person who presses it learns something they
          will have to unlearn. `onVisibility` stays on the props so the
          world keeps deciding what a save is; nothing on this page asks. */}
    </div>
    <div className="jar-composer-body">
    <textarea ref={props.inputRef} className="jar-mouth-field jar-composer-text" autoFocus rows={4} value={props.text} readOnly={props.busy || !props.ready || props.recording.phase !== 'idle'}
      aria-label={say('worldCaptureInspiration')} placeholder={say('worldCapturePrompt')}
      onChange={event => props.onText(event.target.value, event.target.selectionStart ?? event.target.value.length)} onKeyDown={props.onKeyDown}
      onPaste={event => { if (event.clipboardData.files.length) { event.preventDefault(); if (!blocked) props.onFiles([...event.clipboardData.files]); } }} />
    <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif,.heic,.heif" multiple hidden onChange={event => {
      const files = [...event.target.files ?? []]; if (files.length) props.onFiles(files); event.target.value = '';
    }} />
    {props.ready && !props.fileDraftsAvailable ? <p className="jar-composer-storage-note">{say('worldComposerFilesUnavailable')}</p> : null}
    {addingLink ? <div className="jar-composer-link">
      <input ref={linkInput} type="url" value={link} disabled={blocked} aria-label={say('worldPasteTheLink')} placeholder="https://" onChange={event => { event.target.setCustomValidity(''); props.onLinkText(event.target.value); }}
        onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing&&!event.repeat){event.preventDefault();event.stopPropagation();if(!blocked)submit();}}} />
      <button type="button" disabled={blocked} onClick={()=>{props.onLinkText('');setAddingLink(false);}}>{say('worldComposerCancelLink')}</button>
    </div> : null}
    {link.trim() ? <p className="jar-composer-storage-note">{say('worldComposerLinkReady')}</p> : null}
    {props.media.length ? <ul className="jar-composer-media">{props.media.map(item => <li key={item.id}>
      <MediaPreview item={item} recording={props.recording.phase !== 'idle'} label={item.type === 'audio' && props.recordingCandidate ? 'Previous recording' : undefined} /><div className="jar-composer-media-name">{item.type === 'link' ? <a href={item.url} target="_blank" rel="noreferrer">{item.name}</a> : item.type === 'audio' && props.recordingCandidate ? 'Previous recording' : item.name}
        {item.blob ? <small>{fileSize(item.blob.size)} · {item.uploaded ? 'Uploaded — save to keep.' : 'In this draft — not saved yet.'}</small> : null}
        {item.validationError ? <small role="alert">{item.validationError} Remove this file to save the others.</small> : null}
        {props.uploadingId === item.id ? <small role="status">{say('worldComposerUploading')}</small> : null}
        {item.uploadError && props.uploadingId !== item.id ? <><small role="alert">{item.uploadError}</small><button type="button" disabled={blocked} onClick={() => props.onRetryFile(item.id)} aria-label={`Retry upload for ${item.name}`}>Retry upload</button></> : null}</div>
      <button type="button" disabled={blocked} aria-label={`${say('worldRemoveLower')} ${item.name}`} onClick={() => props.onRemove(item.id)}>×</button>
    </li>)}</ul> : null}
    {props.media.length > 5 ? <p role="alert">Keep up to five attachments. Remove the extras when you’re ready — your selections are still here.</p> : null}
    {props.uploadingId ? <p role="status">Uploading file {props.media.filter(item => item.blob).findIndex(item => item.id === props.uploadingId) + 1} of {props.media.filter(item => item.blob).length}… Keep this window open.</p> : null}
    {props.recording.phase !== 'idle' && props.media.some(item => item.type === 'audio') ? <p className="jar-composer-storage-note">Your earlier recording stays until you choose.</p> : null}
    {props.recordingCandidate ? <section className="jar-recording-choice" aria-label="Choose a recording">
      <p>New recording</p><MediaPreview item={props.recordingCandidate} label="New recording" />
      <div className="jar-composer-actions"><button type="button" disabled={blocked} onClick={() => props.onChooseRecording(true)}>Use new recording</button>
        <button type="button" disabled={blocked} onClick={() => props.onChooseRecording(false)}>{props.media.some(item => item.type === 'audio') ? 'Keep previous recording' : 'Discard recording'}</button></div>
    </section> : null}
    {props.recording.notice && !props.recording.error && !props.error ? <p role="status" className="jar-composer-storage-note">{props.recording.notice}</p> : null}
    {props.error || props.recording.error ? <p className="jar-settings-warn" role="alert">{props.error || props.recording.error}</p> : null}
    {props.error.includes('another tab') ? <button type="button" onClick={props.onForkDraft}>{say('worldComposerSeparateDraft')}</button> : null}
    {!props.ready ? <p role="status">{say('worldComposerOpening')}</p> : null}
    </div>
    {/* THE PILL, BOTTOM-LEFT. Two glyphs and no words: founder, pointing at
        the reference's toolbar, "2 icons: 1. record 2. image". While a
        recording runs the pill says so in words and seconds, because a red
        dot alone cannot tell you how long you have been talking. */}
    <div className="jar-note-tools">
      {props.recording.phase === 'idle' ? <button type="button" className="jar-note-tool"
          aria-label={props.media.some(item => item.type === 'audio') ? say('worldComposerRecordAgain') : say('worldComposerRecord')}
          disabled={blocked || !props.fileDraftsAvailable || Boolean(props.recordingCandidate)}
          onClick={() => void props.recording.start()}><HomeActionIcon kind="record"/></button>
        : <button type="button" className="jar-note-tool jar-note-tool--wide" onClick={() => void props.recording.stop()} disabled={props.recording.phase === 'finishing'}>
            {say('worldComposerStop')} {Math.floor(props.recording.seconds / 60)}:{String(props.recording.seconds % 60).padStart(2, '0')}</button>}
      {props.recording.phase === 'recording' || props.recording.phase === 'requesting'
        ? <button type="button" className="jar-note-tool jar-note-tool--wide" onClick={() => void props.recording.cancel()}>{say('worldComposerCancelRecording')}</button>
        : <button type="button" className="jar-note-tool" aria-label={say('worldComposerPhoto')}
            disabled={blocked || !props.fileDraftsAvailable} onClick={() => fileInput.current?.click()}><HomeActionIcon kind="photo"/></button>}
    </div>
    {/* KEEPING IT, BOTTOM-RIGHT, and only once there is something to keep.
        An always-present Save on a blank page is a button for a thing that
        does not exist. */}
    {empty ? null : <button type="button" className="jar-note-save" aria-label={say('worldSaveInspiration')}
      disabled={blocked || invalidFiles || Boolean(props.recordingCandidate)} onClick={submit}>{say('worldSave')}</button>}
    <AuthoredSaveNotice save={props.save} locale={props.locale} />
  </DialogSurface>;
}
