/**
 * WHAT A RECORDING SAYS IT SAID — in the reader's language.
 *
 * Twenty-five English sentences, rendered to every reader in both languages
 * from the day this was written until 2026-10-11, for the same reason as
 * `AttachmentPreview.tsx`: the file imported nothing from `lib/i18n`, so no
 * catalogue row was missing and no gate could see a gap. Both gates ask
 * questions ABOUT the catalogue — parity between the two files, and whether
 * every key is rendered somewhere — and a sentence that was never in either
 * file answers neither question.
 *
 * `worldShareOriginal` IS REUSED FOR "Use original wording" rather than
 * copied, and that is a decision rather than a shortcut: the principle card's
 * editor already says exactly this, about exactly this act — revert to what
 * the machine wrote and drop my correction. One concept, one user-facing
 * name, in both languages, is the rule `i18n.test.ts` spends its longest case
 * on.
 *
 * THE LOCALE IS A REQUIRED PROP. See `AttachmentPreview.tsx`'s header and
 * `lib/why-failed.ts`: a parameter defaulting to `en-US` makes the omission
 * compile, and the omission is the whole of the bug.
 */
import { useEffect, useRef, useState } from 'react';
import { ApiError, correctAttachmentTranscript, fetchAttachmentTranscript, retryAttachmentTranscript, type ApiAttachmentTranscript } from '../lib/api';
import { formatMessage, t, type MessageKey, type SupportedLocale } from '../lib/locales';
import { timeOf } from '../lib/words';

/** Which line this row's state speaks, as a key — never as a finished
    sentence. The words are chosen where they are rendered, so a locale
    change re-renders them; a function returning English could not. */
function pendingLine(row: ApiAttachmentTranscript): MessageKey | null {
  if (row.status === 'pending') return 'worldTranscriptTranscribing';
  if (row.reason === 'audio_no_speech') return 'worldTranscriptNoSpeech';
  if (row.reason === 'audio_too_long') return 'worldTranscriptTooLong';
  if (row.reason === 'audio_too_large_to_transcribe') return 'worldTranscriptTooLarge';
  if (row.status === 'failed' || row.status === 'unavailable') return 'worldTranscriptNotReady';
  return null;
}

/** The audio player remains independent of transcription and correction. */
export function AttachmentTranscript({ id, locale, readOnly=false }: { id: string; locale: SupportedLocale; readOnly?:boolean }) {
  const [row, setRow] = useState<ApiAttachmentTranscript | null>(null);
  /* ERRORS ARE NAMED STATES, NOT STORED SENTENCES. The three error strings
     were composed inside `catch` blocks, which decided the words at failure
     time instead of at render time — so the language was fixed by whatever
     the locale happened to be when the request failed, and a `catch` block is
     a poor place to hand a translator. A key re-renders; a sentence does not. */
  const [error, setError] = useState<MessageKey | null>(null), [refresh, setRefresh] = useState(0), [waiting, setWaiting] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(''), [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<ApiAttachmentTranscript | null>(null);
  const base = useRef(''), mutation = useRef<AbortController | null>(null);
  const say = (key: MessageKey) => t(locale, key);
  useEffect(() => () => mutation.current?.abort(), [id]);
  useEffect(() => {
    if (editing || busy) return;
    const controller = new AbortController(); let timer = 0, checks = 0;
    setWaiting(false);
    const read = async () => {
      try {
        const value = await fetchAttachmentTranscript(id, controller.signal);
        if (controller.signal.aborted) return;
        setRow(value); setLoadFailed(false);
        if (value.status === 'pending') {
          if (++checks < 20) timer = window.setTimeout(() => { if (!document.hidden) void read(); else setWaiting(true); }, 3000);
          else setWaiting(true);
        }
      } catch { if (!controller.signal.aborted) setLoadFailed(true); }
    };
    void read();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [id, refresh, editing, busy]);
  const change = async (correction: string | null, revision = base.current) => {
    const controller = new AbortController(); mutation.current?.abort(); mutation.current = controller;
    setBusy(true); setError(null);
    try {
      const saved = await correctAttachmentTranscript(id, { revision, correction }, controller.signal);
      if (controller.signal.aborted) return;
      setRow(saved); setEditing(false); setConflict(null);
    } catch (reason) {
      if (controller.signal.aborted) return;
      if (reason instanceof ApiError && reason.status === 409) {
        try { const latest = await fetchAttachmentTranscript(id, controller.signal); if (!controller.signal.aborted) setConflict(latest); }
        catch { /* keep the user's edit even if comparison cannot be loaded */ }
        if (!controller.signal.aborted) setError('worldTranscriptChangedElsewhere');
      } else setError('worldTranscriptSaveFailed');
    } finally { if (!controller.signal.aborted) setBusy(false); }
  };
  const retry = async () => {
    if (!row) return;
    const controller = new AbortController(); mutation.current?.abort(); mutation.current = controller;
    setBusy(true); setError(null);
    try { const value = await retryAttachmentTranscript(id, row.revision, controller.signal); if (!controller.signal.aborted) setRow(value); }
    catch { if (!controller.signal.aborted) setError('worldTranscriptRetryFailed'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  const pending = row ? pendingLine(row) : null;
  return <section className="jar-attachment-transcript" aria-label={say('worldTranscript')}>
    <header><h3>{say('worldTranscript')}</h3>{row?.correction !== null && row?.correction !== undefined ? <small>{say('worldTranscriptYourWording')}</small> : null}</header>
    {!row && !loadFailed ? <p role="status">{say('worldTranscriptLoading')}</p> : null}
    {row && !editing ? <>
      {row.effectiveText !== null ? <p className="jar-transcript-text">{row.effectiveText || say('worldTranscriptNoWords')}</p> : null}
      {pending ? <p role="status">{say(pending)}</p> : null}
      {/* The clock reads in the chosen locale and comes out of `timeOf` —
          see the same note in `AttachmentPreview.tsx`, which carried the
          identical option bag. Two retry clocks on two surfaces about the
          same upload, hand-formatted twice, is precisely the pair a reader
          would never think to compare. */}
      {row.retryAfter ? <p>{formatMessage(locale, 'worldAttachmentRetryAfter', { time: timeOf(new Date(row.retryAfter).getTime(), locale) })}</p> : null}
      <div className="jar-transcript-actions">
        {row.canEdit && !readOnly && row.effectiveText !== null ? <button type="button" disabled={busy} onClick={() => {
          base.current = row.revision; setDraft(row.effectiveText ?? ''); setEditing(true); setConflict(null); setError(null);
        }}>{say('worldTranscriptEdit')}</button> : null}
        {row.canRetry && !readOnly ? <button type="button" disabled={busy} onClick={() => void retry()}>{say('worldTranscriptRetry')}</button> : null}
      </div>
      {row.correction !== null && row.transcript !== null ? <details><summary>{say('worldTranscriptOriginal')}</summary><p className="jar-transcript-text">{row.transcript}</p>
        {row.canEdit && !readOnly ? <button type="button" disabled={busy} onClick={() => void change(null, row.revision)}>{say('worldShareOriginal')}</button> : null}
      </details> : null}
    </> : null}
    {editing ? <>
      <textarea aria-label={say('worldTranscriptEdit')} value={draft} maxLength={16000} disabled={busy} onChange={event => setDraft(event.target.value)} />
      {conflict ? <div><p>{say('worldTranscriptLatestSaved')}</p><p className="jar-transcript-text">{conflict.effectiveText || say('worldTranscriptNoWords')}</p></div> : null}
      <div className="jar-transcript-actions"><button type="button" disabled={busy} onClick={() => void change(draft, conflict?.revision ?? base.current)}>{say(busy ? 'worldSaving' : conflict ? 'worldTranscriptUseMyEdit' : 'worldTranscriptSaveChanges')}</button>
        <button type="button" disabled={busy} onClick={() => { setEditing(false); setConflict(null); setError(null); }}>{say('worldCancelEdit')}</button></div>
    </> : null}
    {error ? <p role="alert">{say(error)}</p> : null}
    {loadFailed ? <p role="alert">{say('worldTranscriptLoadFailed')}</p> : null}
    {!editing && (loadFailed || waiting || row?.retryAfter) ? <button type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>{say('worldTranscriptCheck')}</button> : null}
  </section>;
}
