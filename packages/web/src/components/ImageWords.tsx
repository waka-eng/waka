/**
 * ═══ "THE WORDS I READ" (design E3, E3′) ═══════════════════════════════════
 *
 * The words the server read off a screenshot, quoted under it with a Fix, so
 * a person can see it understood — and, when it could not read them, the
 * question the design asks instead: "Which line stuck?", answered in the same
 * field a Fix uses (an answer IS a fix: it becomes the words).
 *
 *   reading     — a quiet "Reading the words…".
 *   ready       — the words, quoted, with Fix when they may be edited.
 *   unreadable  — nothing will retry: the question, and a way to type it.
 *   retrying    — the same, plus "I'll try reading it again in a bit…".
 *
 * Shared by the notepad (where a dev build can preview it) and a saved note,
 * which is where the words actually arrive — they are read after the save.
 */
import { useState } from 'react';

import { t, type SupportedLocale } from '../lib/locales';
import type { ApiImageWordsSummary, ImageWordsStatus } from '../lib/api/attachments';
import { useImageWords, type FixOutcome } from '../lib/use-image-words';

export interface ReadWords { status: ImageWordsStatus; text?: string }

export function ReadWordsQuote({ words, locale, onFix, disabled, asks = false }: {
  words: ReadWords; locale: SupportedLocale;
  /** Absent: Fix is not offered (another account's view, a read-only session). */
  onFix?: (text: string) => Promise<FixOutcome>;
  disabled: boolean;
  /** Say "Which line stuck?" here, because no creature above is asking it. */
  asks?: boolean;
}) {
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);
  const [fixing, setFixing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const missed = words.status === 'unreadable' || words.status === 'retrying';
  if (words.status === 'unknown') return null;
  const send = async () => {
    if (!onFix || fixing === null || !fixing.trim()) return;
    setBusy(true); setNote('');
    const outcome = await onFix(fixing.trim());
    setBusy(false);
    if (outcome === 'saved') setFixing(null);
    else setNote(say(outcome === 'changed' ? 'worldReadWordsChanged' : 'worldReadWordsFixFailed'));
  };
  const field = fixing !== null ? <textarea className="waka-note-read-fix" aria-label={say(missed ? 'worldReadWordsLine' : 'worldReadWordsLabel')} value={fixing} autoFocus
    disabled={busy} onChange={event => setFixing(event.target.value)} /> : null;
  const act = onFix ? (fixing === null
    ? <button type="button" className="waka-note-read-act" disabled={disabled} onClick={() => { setNote(''); setFixing(missed ? '' : words.text ?? ''); }}>{say(missed ? 'worldReadWordsTypeLine' : 'worldReadWordsFix')}</button>
    : <button type="button" className="waka-note-read-act" disabled={disabled || busy || !fixing.trim()} onClick={() => { void send(); }}>{say('worldReadWordsFixDone')}</button>) : null;
  if (missed) return <div className="waka-note-read" data-missed="1">
    <div className="waka-note-read-body">
      {asks ? <p className="waka-note-read-ask">{say('worldNoteAskUnreadable')}</p> : null}
      {words.status === 'retrying' ? <p className="waka-note-retry">{say('worldReadWordsRetry')}</p> : null}
      {field}
      {note ? <p className="waka-note-read-quiet" role="alert">{note}</p> : null}
    </div>
    {act}
  </div>;
  return <div className="waka-note-read">
    <div className="waka-note-read-body">
      <p className="waka-note-read-label">{say('worldReadWordsLabel')}</p>
      {words.status === 'reading' ? <p className="waka-note-read-quiet" role="status">{say('worldReadWordsReading')}</p>
        : field ?? <p className="waka-note-read-text">“{words.text}”</p>}
      {note ? <p className="waka-note-read-quiet" role="alert">{note}</p> : null}
    </div>
    {words.status === 'ready' ? act : null}
  </div>;
}

/** A saved image's words, read from the server and kept current. */
export function SavedImageWords({ attachmentId, locale, readOnly = false, inline }: { attachmentId: string; locale: SupportedLocale; readOnly?: boolean;
  /** The words the inspiration's detail already carried, when it did. */
  inline?: ApiImageWordsSummary | null }) {
  const { words, fix } = useImageWords(attachmentId, inline);
  /* Unknown: a reading too old to say which part is words. Nothing to show. */
  if (!words || words.status === 'unknown') return null;
  return <ReadWordsQuote words={{ status: words.status, text: words.text ?? undefined }} locale={locale} asks
    onFix={!readOnly && words.canEdit ? fix : undefined} disabled={false} />;
}
