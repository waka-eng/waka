import { useEffect, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { DialogSurface } from './DialogSurface';
import { AuthoredSaveNotice } from './AuthoredSaveNotice';
import { HomeActionIcon } from './HomeActionIcon';
import {inspirationWithPendingLink} from '../lib/inspiration-input';
import { t, type SupportedLocale } from '../lib/locales';
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
  recordingCandidate?: InspirationDraftMedia | null; onChooseRecording: (useNew: boolean) => void;
  onText: (text: string, caret: number) => void; onFiles: (files: File[]) => void;
  onRetryFile: (id: string) => void;
  onRemove: (id: string) => void; onVisibility: (value: boolean) => void;
  onClose: () => void; onSubmit: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void; onForkDraft: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null), linkInput = useRef<HTMLInputElement>(null);
  const [addingLink, setAddingLink] = useState(Boolean(props.linkText));
  const link = props.linkText;
  useEffect(()=>{if (props.linkText) setAddingLink(true);},[props.linkText]);
  const blocked = props.busy || Boolean(props.save.pending) || !props.ready || props.recording.phase !== 'idle';
  const invalidFiles = props.media.some(item => item.validationError) || props.media.length > 5;
  const say = (key: Parameters<typeof t>[1]) => t(props.locale, key);
  const submit = () => {
    try {
      inspirationWithPendingLink(props.text,link);props.onSubmit();
    } catch {linkInput.current?.setCustomValidity(say('worldComposerInvalidLink'));linkInput.current?.reportValidity();}
  };
  useEffect(()=>{if(addingLink)linkInput.current?.focus();},[addingLink]);
  return <DialogSurface className="jar-seek jar-inspiration-composer" aria-label={say('worldCaptureInspiration')} onClose={props.onClose} data-jar-chrome="1"
    onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
    onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); if (!blocked) props.onFiles([...event.dataTransfer.files]); } }}>
    <div className="jar-composer-heading"><h2><span className="jar-composer-spark" aria-hidden="true"><HomeActionIcon kind="capture"/></span>{say('worldCaptureInspiration')}</h2><button type="button" onClick={props.onClose}>{say('worldClose')}</button></div>
    <div className="jar-composer-body">
    <textarea ref={props.inputRef} className="jar-mouth-field jar-composer-text" autoFocus rows={4} value={props.text} readOnly={props.busy || !props.ready || props.recording.phase !== 'idle'}
      aria-label={say('worldCaptureInspiration')} placeholder={say('worldCapturePrompt')}
      onChange={event => props.onText(event.target.value, event.target.selectionStart ?? event.target.value.length)} onKeyDown={props.onKeyDown}
      onPaste={event => { if (event.clipboardData.files.length) { event.preventDefault(); if (!blocked) props.onFiles([...event.clipboardData.files]); } }} />
    <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif,.heic,.heif" multiple hidden onChange={event => {
      const files = [...event.target.files ?? []]; if (files.length) props.onFiles(files); event.target.value = '';
    }} />
    <div className="jar-composer-tools">
      <button type="button" disabled={blocked || !props.fileDraftsAvailable} onClick={() => fileInput.current?.click()}>{say('worldComposerPhoto')}</button>
      <button type="button" disabled={blocked} onClick={() => {setAddingLink(true);linkInput.current?.focus();}}>{say('worldComposerLink')}</button>
      {props.recording.phase === 'idle' ? <button type="button" disabled={blocked || !props.fileDraftsAvailable || Boolean(props.recordingCandidate)} onClick={() => void props.recording.start()}>{props.media.some(item => item.type === 'audio') ? 'Record again' : say('worldComposerRecord')}</button>
        : <button type="button" onClick={() => void props.recording.stop()} disabled={props.recording.phase === 'finishing'}>{say('worldComposerStop')} {Math.floor(props.recording.seconds / 60)}:{String(props.recording.seconds % 60).padStart(2, '0')}</button>}
      {props.recording.phase === 'recording' || props.recording.phase === 'requesting' ? <button type="button" onClick={() => void props.recording.cancel()}>Cancel recording</button> : null}
    </div>
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
    <div className="jar-composer-footer"><div className="jar-composer-visibility" role="group" aria-label={say('worldAudience')} aria-describedby="capture-audience">
      <button type="button" disabled={blocked} aria-pressed={!props.public} onClick={() => props.onVisibility(false)}>{say('worldAudienceOnlyMe')}</button>
      <button type="button" disabled={blocked} aria-pressed={props.public} onClick={() => props.onVisibility(true)}>{say('worldAudienceRooms')}</button>
    </div><div className="jar-composer-actions">
      <button type="button" className="jar-composer-save" aria-label={say('worldSaveInspiration')} disabled={blocked || invalidFiles || Boolean(props.recordingCandidate) || (!props.text.trim() && !props.media.length && !link.trim())} onClick={submit}>{say('worldSave')}</button>
    </div><p id="capture-audience" className="jar-audience-note">{say(props.public ? 'worldAudiencePublic' : 'worldAudiencePrivate')}</p></div>
    <AuthoredSaveNotice save={props.save} locale={props.locale} />
  </DialogSurface>;
}
