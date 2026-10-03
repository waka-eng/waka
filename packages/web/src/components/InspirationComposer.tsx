import { useEffect, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { DialogSurface } from './DialogSurface';
import { AuthoredSaveNotice } from './AuthoredSaveNotice';
import { t, type SupportedLocale } from '../lib/locales';
import type { InspirationDraftMedia } from '../lib/inspiration-draft-store';
import type { useAuthoredSave } from '../lib/use-authored-save';
import type { useAudioRecording } from '../lib/use-audio-recording';

function MediaPreview({ item, recording = false, label }: { item: InspirationDraftMedia; recording?: boolean; label?: string }) {
  const [url, setUrl] = useState('');
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => { if (recording) audio.current?.pause(); }, [recording]);
  useEffect(() => {
    if (!item.blob) return;
    const value = URL.createObjectURL(item.blob); setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [item.blob]);
  if (item.type === 'image' && url) return <img src={url} alt={item.name} />;
  if (item.type === 'audio' && url) return <audio ref={audio} controls={!recording} src={url} preload="metadata" aria-label={label ?? item.name} />;
  return null;
}
export function InspirationComposer(props: {
  text: string; media: InspirationDraftMedia[]; locale: SupportedLocale; public: boolean;
  ready: boolean; fileDraftsAvailable: boolean; busy: boolean; error: string; uploadingId: string | null;
  save: ReturnType<typeof useAuthoredSave>; recording: ReturnType<typeof useAudioRecording>;
  inputRef: Ref<HTMLTextAreaElement>;
  recordingCandidate?: InspirationDraftMedia | null; onChooseRecording: (useNew: boolean) => void;
  onText: (text: string, caret: number) => void; onFiles: (files: File[]) => void;
  onRemove: (id: string) => void; onVisibility: (value: boolean) => void;
  onClose: () => void; onSubmit: (reflect: boolean) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void; onForkDraft: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null), linkInput = useRef<HTMLInputElement>(null);
  const [addingLink, setAddingLink] = useState(false), [link, setLink] = useState('');
  const blocked = props.busy || Boolean(props.save.pending) || !props.ready || props.recording.phase !== 'idle';
  const say = (key: Parameters<typeof t>[1]) => t(props.locale, key);
  const addLink = () => {
    try {
      const value = new URL(link.trim());
      if (!['http:', 'https:'].includes(value.protocol) || value.toString().length > 2048) {
        linkInput.current?.setCustomValidity('Use an HTTP or HTTPS link up to 2,048 characters.'); linkInput.current?.reportValidity(); return;
      }
      const text = [props.text.trim(), value.toString()].filter(Boolean).join('\n');
      props.onText(text, text.length); setAddingLink(false); setLink('');
    } catch { linkInput.current?.reportValidity(); }
  };
  return <DialogSurface className="jar-seek jar-inspiration-composer" aria-label={say('worldCaptureInspiration')} onClose={props.onClose} data-jar-chrome="1"
    onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
    onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); if (!blocked) props.onFiles([...event.dataTransfer.files]); } }}>
    <div className="jar-composer-heading"><h2>{say('worldCaptureInspiration')}</h2><button type="button" onClick={props.onClose}>{say('worldClose')}</button></div>
    <div className="jar-composer-body">
    <textarea ref={props.inputRef} className="jar-mouth-field jar-composer-text" autoFocus rows={4} value={props.text} readOnly={props.busy || !props.ready || props.recording.phase !== 'idle'}
      aria-label={say('worldCaptureInspiration')} placeholder={say('worldCapturePrompt')}
      onChange={event => props.onText(event.target.value, event.target.selectionStart ?? event.target.value.length)} onKeyDown={props.onKeyDown}
      onPaste={event => { if (event.clipboardData.files.length) { event.preventDefault(); if (!blocked) props.onFiles([...event.clipboardData.files]); } }} />
    <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={event => {
      const files = [...event.target.files ?? []]; if (files.length) props.onFiles(files); event.target.value = '';
    }} />
    <div className="jar-composer-tools">
      <button type="button" disabled={blocked || !props.fileDraftsAvailable} onClick={() => fileInput.current?.click()}>{say('worldComposerPhoto')}</button>
      <button type="button" disabled={blocked} onClick={() => setAddingLink(value => !value)}>{say('worldComposerLink')}</button>
      {props.recording.phase === 'idle' ? <button type="button" disabled={blocked || !props.fileDraftsAvailable || Boolean(props.recordingCandidate)} onClick={() => void props.recording.start()}>{props.media.some(item => item.type === 'audio') ? 'Record again' : say('worldComposerRecord')}</button>
        : <button type="button" onClick={() => void props.recording.stop()} disabled={props.recording.phase === 'finishing'}>{say('worldComposerStop')} {Math.floor(props.recording.seconds / 60)}:{String(props.recording.seconds % 60).padStart(2, '0')}</button>}
      {props.recording.phase === 'recording' || props.recording.phase === 'requesting' ? <button type="button" onClick={() => void props.recording.cancel()}>Cancel recording</button> : null}
    </div>
    {props.ready && !props.fileDraftsAvailable ? <p className="jar-composer-storage-note">{say('worldComposerFilesUnavailable')}</p> : null}
    {addingLink ? <form className="jar-composer-link" onSubmit={event => { event.preventDefault(); addLink(); }}>
      <input ref={linkInput} type="url" required value={link} aria-label={say('worldPasteTheLink')} placeholder="https://" onChange={event => { event.target.setCustomValidity(''); setLink(event.target.value); }} />
      <button type="submit">{say('worldComposerAdd')}</button>
    </form> : null}
    {props.media.length ? <ul className="jar-composer-media">{props.media.map(item => <li key={item.id}>
      <MediaPreview item={item} recording={props.recording.phase !== 'idle'} label={item.type === 'audio' && props.recordingCandidate ? 'Previous recording' : undefined} /><div className="jar-composer-media-name">{item.type === 'link' ? <a href={item.url} target="_blank" rel="noreferrer">{item.name}</a> : item.type === 'audio' && props.recordingCandidate ? 'Previous recording' : item.name}
        {item.type === 'audio' ? <small>In this draft — not saved yet.</small> : null}
        {props.uploadingId === item.id ? <small role="status">{say('worldComposerUploading')}</small> : null}</div>
      <button type="button" disabled={blocked} aria-label={`${say('worldRemoveLower')} ${item.name}`} onClick={() => props.onRemove(item.id)}>×</button>
    </li>)}</ul> : null}
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
    <div className="jar-composer-footer"><div className="jar-composer-visibility" aria-label={say('worldPrivateTooltip')}>
      <button type="button" disabled={blocked} aria-pressed={!props.public} onClick={() => props.onVisibility(false)}>{say('worldPrivate')}</button>
      <button type="button" disabled={blocked} aria-pressed={props.public} onClick={() => props.onVisibility(true)}>{say('worldPublic')}</button>
    </div><div className="jar-composer-actions">
      <button type="button" aria-label={say('worldSaveInspiration')} disabled={blocked || Boolean(props.recordingCandidate) || (!props.text.trim() && !props.media.length)} onClick={() => props.onSubmit(false)}>{say('worldSave')}</button>
      <button type="button" aria-label={say('worldSaveAndReflect')} disabled={blocked || Boolean(props.recordingCandidate) || (!props.text.trim() && !props.media.length)} onClick={() => props.onSubmit(true)}>{say('worldComposerThink')}</button>
    </div></div>
    <AuthoredSaveNotice save={props.save} locale={props.locale} />
  </DialogSurface>;
}
