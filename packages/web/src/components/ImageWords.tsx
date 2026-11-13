/**
 * ═══ "THE WORDS I READ" (design E3, E3′) ═══════════════════════════════════
 *
 * The words the server read off a screenshot, quoted under it with a Fix, so
 * a person can see it understood.
 *
 *   reading     — a quiet "Reading the words…".
 *   ready       — the words, quoted, with Fix when they may be edited.
 *   unreadable, retrying, failed — nothing (founder, 2026-11-12).
 *
 * Shared by the notepad (where a dev build can preview it) and a saved note,
 * which is where the words actually arrive — they are read after the save.
 */
import { useState } from 'react';

import { t, type SupportedLocale } from '../lib/locales';
import type { ApiImageWordsSummary, ImageWordsStatus } from '../lib/api/attachments';
import { useImageWords, type FixOutcome } from '../lib/use-image-words';

export interface ReadWords { status: ImageWordsStatus; text?: string }

export function ReadWordsQuote({ words, locale, onFix, disabled }: {
  words: ReadWords; locale: SupportedLocale;
  /** Absent: Fix is not offered (another account's view, a read-only session). */
  onFix?: (text: string) => Promise<FixOutcome>;
  disabled: boolean;
}) {
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);
  const [fixing, setFixing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  /* ═══ A PICTURE WHOSE WORDS COULD NOT BE READ SAYS NOTHING ABOUT IT
     (founder, 2026-11-12: of "I couldn't make out the words. Which line
     stuck?" under a photo saved with no words, "don't write this thing") ═══
     The photo stands on its own, large. Unreadable, failed or retrying, the
     words line is simply not drawn: no question, no field, no retry. */
  if (words.status === 'unknown' || words.status === 'unreadable' || words.status === 'retrying' || words.status === 'failed') return null;
  const send = async () => {
    if (!onFix || fixing === null || !fixing.trim()) return;
    setBusy(true); setNote('');
    const outcome = await onFix(fixing.trim());
    setBusy(false);
    if (outcome === 'saved') setFixing(null);
    else setNote(say(outcome === 'changed' ? 'worldReadWordsChanged' : 'worldReadWordsFixFailed'));
  };
  const field = fixing !== null ? <textarea className="waka-note-read-fix" aria-label={say('worldReadWordsLabel')} value={fixing} autoFocus
    disabled={busy} onChange={event => setFixing(event.target.value)} /> : null;
  const act = onFix ? (fixing === null
    ? <button type="button" className="waka-note-read-act" disabled={disabled} onClick={() => { setNote(''); setFixing(words.text ?? ''); }}>{say('worldReadWordsFix')}</button>
    : <button type="button" className="waka-note-read-act" disabled={disabled || busy || !fixing.trim()} onClick={() => { void send(); }}>{say('worldReadWordsFixDone')}</button>) : null;
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
  const mayWrite = !readOnly && words.canEdit;
  return <ReadWordsQuote words={{ status: words.status, text: words.text ?? undefined }} locale={locale}
    onFix={mayWrite ? fix : undefined} disabled={false} />;
}
