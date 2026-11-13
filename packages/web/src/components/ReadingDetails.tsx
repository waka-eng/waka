import { useEffect, useRef, useState } from 'react';
import { fetchTopOfMind, updateTopOfMindEntry, type ApiTopOfMindEntry } from '../lib/api/top-of-mind';
import { t, type SupportedLocale } from '../lib/locales';

export interface ReadingDetailActions {
  profileId: string;
  onUpdated: () => void;
  onMutation?: () => () => void;
}
/** Loaded only when a reading is expanded. Its evidence and edits stay bound
 * to the displayed wording/profile even if Home refreshes behind the dialog. */
export default function ReadingDetails({ text, locale, actions, onClose, onEditState, startEditing = false }: {
  text: string; locale: SupportedLocale; actions: ReadingDetailActions; onClose: () => void; onEditState?: (state: { dirty: boolean; busy: boolean }) => void;
  /** Opened from the bubble's Edit: the words are already in the field. */
  startEditing?: boolean;
}) {
  const [entry, setEntry] = useState<ApiTopOfMindEntry | null>(null);
  const [loading, setLoading] = useState(true), [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  const [mode, setMode] = useState<'edit' | null>(startEditing ? 'edit' : null), [words, setWords] = useState(text);
  const [busy, setBusy] = useState(false);
  useEffect(() => { onEditState?.({ dirty: mode === 'edit' && words !== text, busy }); }, [mode, words, text, busy, onEditState]);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setFailed(false);
    fetchTopOfMind({ profile: actions.profileId }, abort.signal).then(next => {
      if (abort.signal.aborted) return;
      setEntry(next?.entries.find(item => !item.dismissed && item.body === text) ?? null);
    }).catch(() => { if (!abort.signal.aborted) setFailed(true); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [actions.profileId, text, retry]);
  /* ONE ACT HERE: EDIT. A second answer row ("Give feedback": True,
     Partly true, Not true) sat under a sentence whose answers the creature
     already asks for (Law 11: a page gets one ask). */
  const write = async () => {
    if (!entry || busy || !words.trim()) return;
    setBusy(true); setFailed(false); const finish = actions.onMutation?.();
    try {
      await updateTopOfMindEntry(entry.id, { body: words.trim() }, { profile: actions.profileId });
      finish?.();
      if (!alive.current) return;
      actions.onUpdated();
      onClose();
    } catch { if (alive.current) setFailed(true); }
    finally { finish?.(); if (alive.current) setBusy(false); }
  };
  if (loading) return <p role="status">{t(locale, 'worldSourceChecking')}</p>;
  if (!entry) return <p role={failed ? 'alert' : 'status'}>{t(locale, failed ? 'worldReadingDetailsFailed' : 'worldReadingDetailsChanged')}
    {failed ? <button onClick={() => setRetry(n => n + 1)}>{t(locale, 'worldRetry')}</button> : null}</p>;
  return <div className="waka-reading-details">
    {/* THE READ AND ITS ONE ACT, NOTHING AROUND IT (founder, 2026-11-12, of
        this page: "sooo big and ugly", and "strip all unnecessary
        descriptive text"): no "Last updated", no locked hint, no "See all"
        disclosure; where a read came from is Why?'s chat now. */}
    {mode !== 'edit' ? <button disabled={busy} onClick={() => setMode('edit')}>{t(locale, 'worldEditWording')}</button> : null}
    {mode === 'edit' ? <div>
      <textarea aria-label={t(locale, 'worldEditWording')} autoFocus value={words} maxLength={2000} disabled={busy} onChange={event => setWords(event.currentTarget.value)} />
      <button disabled={busy} onClick={() => { setWords(text); if (startEditing) onClose(); else setMode(null); }}>{t(locale, 'worldCancel')}</button>
      <button disabled={busy || !words.trim()} onClick={() => void write()}>{t(locale, 'worldSave')}</button>
    </div> : null}
    {failed ? <p role="alert">{t(locale, 'worldReadingDetailsFailed')}</p> : null}
  </div>;
}
