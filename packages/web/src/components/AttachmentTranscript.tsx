import { useEffect, useRef, useState } from 'react';
import { ApiError, correctAttachmentTranscript, fetchAttachmentTranscript, retryAttachmentTranscript, type ApiAttachmentTranscript } from '../lib/api';

function pendingText(row: ApiAttachmentTranscript) {
  if (row.status === 'pending') return 'Transcribing your recording…';
  if (row.reason === 'audio_no_speech') return 'No clear speech was found. You can still listen to the recording.';
  if (row.reason === 'audio_too_long') return 'This recording is too long to transcribe. The original is kept.';
  if (row.reason === 'audio_too_large_to_transcribe') return 'This recording is too large to transcribe. The original is kept.';
  if (row.status === 'failed' || row.status === 'unavailable') return 'The transcript isn’t ready. Your recording is kept.';
  return '';
}

/** The audio player remains independent of transcription and correction. */
export function AttachmentTranscript({ id, readOnly=false }: { id: string; readOnly?:boolean }) {
  const [row, setRow] = useState<ApiAttachmentTranscript | null>(null);
  const [error, setError] = useState(''), [refresh, setRefresh] = useState(0), [waiting, setWaiting] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(''), [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<ApiAttachmentTranscript | null>(null);
  const base = useRef(''), mutation = useRef<AbortController | null>(null);
  useEffect(() => () => mutation.current?.abort(), [id]);
  useEffect(() => {
    if (editing || busy) return;
    const controller = new AbortController(); let timer = 0, checks = 0;
    setWaiting(false);
    const read = async () => {
      try {
        const value = await fetchAttachmentTranscript(id, controller.signal);
        if (controller.signal.aborted) return;
        setRow(value); setLoadError('');
        if (value.status === 'pending') {
          if (++checks < 20) timer = window.setTimeout(() => { if (!document.hidden) void read(); else setWaiting(true); }, 3000);
          else setWaiting(true);
        }
      } catch { if (!controller.signal.aborted) setLoadError('Couldn’t load the transcript.'); }
    };
    void read();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [id, refresh, editing, busy]);
  const change = async (correction: string | null, revision = base.current) => {
    const controller = new AbortController(); mutation.current?.abort(); mutation.current = controller;
    setBusy(true); setError('');
    try {
      const saved = await correctAttachmentTranscript(id, { revision, correction }, controller.signal);
      if (controller.signal.aborted) return;
      setRow(saved); setEditing(false); setConflict(null);
    } catch (reason) {
      if (controller.signal.aborted) return;
      if (reason instanceof ApiError && reason.status === 409) {
        try { const latest = await fetchAttachmentTranscript(id, controller.signal); if (!controller.signal.aborted) setConflict(latest); }
        catch { /* keep the user's edit even if comparison cannot be loaded */ }
        if (!controller.signal.aborted) setError('This transcript changed elsewhere. Your edit is kept.');
      } else setError('Couldn’t save. Your edit is still here.');
    } finally { if (!controller.signal.aborted) setBusy(false); }
  };
  const retry = async () => {
    if (!row) return;
    const controller = new AbortController(); mutation.current?.abort(); mutation.current = controller;
    setBusy(true); setError('');
    try { const value = await retryAttachmentTranscript(id, row.revision, controller.signal); if (!controller.signal.aborted) setRow(value); }
    catch { if (!controller.signal.aborted) setError('Couldn’t retry yet. Your recording is kept.'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  return <section className="jar-attachment-transcript" aria-label="Transcript">
    <header><h3>Transcript</h3>{row?.correction !== null && row?.correction !== undefined ? <small>Your wording</small> : null}</header>
    {!row && !loadError ? <p role="status">Loading transcript…</p> : null}
    {row && !editing ? <>
      {row.effectiveText !== null ? <p className="jar-transcript-text">{row.effectiveText || 'No spoken words kept.'}</p> : null}
      {pendingText(row) ? <p role="status">{pendingText(row)}</p> : null}
      {row.retryAfter ? <p>You can retry after {new Date(row.retryAfter).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.</p> : null}
      <div className="jar-transcript-actions">
        {row.canEdit && !readOnly && row.effectiveText !== null ? <button type="button" disabled={busy} onClick={() => {
          base.current = row.revision; setDraft(row.effectiveText ?? ''); setEditing(true); setConflict(null); setError('');
        }}>Edit transcript</button> : null}
        {row.canRetry && !readOnly ? <button type="button" disabled={busy} onClick={() => void retry()}>Retry transcription</button> : null}
      </div>
      {row.correction !== null && row.transcript !== null ? <details><summary>Original transcript</summary><p className="jar-transcript-text">{row.transcript}</p>
        {row.canEdit && !readOnly ? <button type="button" disabled={busy} onClick={() => void change(null, row.revision)}>Use original wording</button> : null}
      </details> : null}
    </> : null}
    {editing ? <>
      <textarea aria-label="Edit transcript" value={draft} maxLength={16000} disabled={busy} onChange={event => setDraft(event.target.value)} />
      {conflict ? <div><p>Latest saved wording</p><p className="jar-transcript-text">{conflict.effectiveText || 'No spoken words kept.'}</p></div> : null}
      <div className="jar-transcript-actions"><button type="button" disabled={busy} onClick={() => void change(draft, conflict?.revision ?? base.current)}>{busy ? 'Saving…' : conflict ? 'Use my edit' : 'Save changes'}</button>
        <button type="button" disabled={busy} onClick={() => { setEditing(false); setConflict(null); setError(''); }}>Cancel</button></div>
    </> : null}
    {error ? <p role="alert">{error}</p> : null}
    {loadError ? <p role="alert">{loadError}</p> : null}
    {!editing && (loadError || waiting || row?.retryAfter) ? <button type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>Check transcript</button> : null}
  </section>;
}
