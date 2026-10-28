import { useEffect, useRef, useState } from 'react';
import { fetchTopOfMind, updateTopOfMindEntry, type ApiTopOfMind, type ApiTopOfMindEntry } from '../lib/api/top-of-mind';
import { fetchSignal, type ApiSignalDetail } from '../lib/api/signals';
import { createFeedback, type ApiFeedbackValue } from '../lib/api/feedback';
import { t, type SupportedLocale } from '../lib/locales';

export interface ReadingDetailActions {
  profileId: string;
  onUpdated: () => void;
  onOpenInspiration: (id: string) => void;
  onMutation?: () => () => void;
}
function SignalSources({ id, profileId, locale, onOpen }: {
  id: string; profileId: string; locale: SupportedLocale; onOpen: (id: string) => void;
}) {
  const [data, setData] = useState<ApiSignalDetail | null>(null);
  const [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); setFailed(false);
    fetchSignal(id, abort.signal, { profile: profileId }).then(row => {
      if (!abort.signal.aborted) { if (row.id === id) setData(row); else setFailed(true); }
    }).catch(() => { if (!abort.signal.aborted) setFailed(true); });
    return () => abort.abort();
  }, [id, profileId, retry]);
  if (failed) return <p role="alert">{t(locale, 'worldReadingDetailsFailed')} <button onClick={() => setRetry(n => n + 1)}>{t(locale, 'worldRetry')}</button></p>;
  if (!data) return <p role="status">{t(locale, 'worldSourceChecking')}</p>;
  return <ul className="waka-reading-sources">{data.evidence.map(item => <li key={item.inspirationId}>
    <button onClick={() => onOpen(item.inspirationId)}>{item.preview || t(locale, 'worldReadingOpenSource')}</button>
  </li>)}</ul>;
}

/** Loaded only when a reading is expanded. Its evidence and edits stay bound
 * to the displayed wording/profile even if Home refreshes behind the dialog. */
export default function ReadingDetails({ text, locale, actions, onClose, onEditState }: {
  text: string; locale: SupportedLocale; actions: ReadingDetailActions; onClose: () => void; onEditState?: (state: { dirty: boolean; busy: boolean }) => void;
}) {
  const [board, setBoard] = useState<ApiTopOfMind | null>(null), [entry, setEntry] = useState<ApiTopOfMindEntry | null>(null);
  const [loading, setLoading] = useState(true), [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  const [source, setSource] = useState<string | null>(null);
  const [mode, setMode] = useState<'edit' | 'feedback' | null>(null), [words, setWords] = useState(text);
  const [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  useEffect(() => { onEditState?.({ dirty: mode === 'edit' && words !== text, busy }); }, [mode, words, text, busy, onEditState]);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setFailed(false);
    fetchTopOfMind({ profile: actions.profileId }, abort.signal).then(next => {
      if (abort.signal.aborted) return;
      setBoard(next); setEntry(next?.entries.find(item => !item.dismissed && item.body === text) ?? null);
    }).catch(() => { if (!abort.signal.aborted) setFailed(true); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [actions.profileId, text, retry]);
  const write = async (verdict?: ApiFeedbackValue) => {
    if (!entry || busy || (!verdict && !words.trim())) return;
    setBusy(true); setFailed(false); const finish = actions.onMutation?.();
    try {
      if (verdict) await createFeedback({ targetType: 'top_of_mind_entry', targetId: entry.id, profile: actions.profileId, value: verdict });
      else await updateTopOfMindEntry(entry.id, { body: words.trim() }, { profile: actions.profileId });
      finish?.();
      if (!alive.current) return;
      actions.onUpdated();
      if (verdict) { setSaved(true); setMode(null); } else onClose();
    } catch { if (alive.current) setFailed(true); }
    finally { finish?.(); if (alive.current) setBusy(false); }
  };
  if (loading) return <p role="status">{t(locale, 'worldSourceChecking')}</p>;
  if (!entry) return <p role={failed ? 'alert' : 'status'}>{t(locale, failed ? 'worldReadingDetailsFailed' : 'worldReadingDetailsChanged')}
    {failed ? <button onClick={() => setRetry(n => n + 1)}>{t(locale, 'worldRetry')}</button> : null}</p>;
  return <div className="waka-reading-details">
    {board ? <p className="waka-reading-meta">{t(locale, 'worldReadingUpdatedAt')} {new Date(board.contentUpdatedAt ?? board.createdAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}</p> : null}
    {entry.locked ? <p className="waka-reading-meta">{t(locale, 'worldReadingLockedHint')}</p> : null}
    <details hidden={mode === 'edit'}><summary>{t(locale, 'worldBuiltFrom')}</summary>
      {entry.citedSignals?.length ? entry.citedSignals.map(signal => <details key={signal.id} open={source === signal.id}
        onToggle={event => { if (event.currentTarget.open) setSource(signal.id); else setSource(current => current === signal.id ? null : current); }}>
        <summary>{signal.statement}</summary>
        {source === signal.id ? <SignalSources id={signal.id} profileId={actions.profileId} locale={locale}
          onOpen={id => { onClose(); actions.onOpenInspiration(id); }} /> : null}
      </details>) : <p>{t(locale, 'worldReadingNoSources')}</p>}
    </details>
    <details hidden={mode === 'edit'}><summary>{t(locale, 'worldReadingActions')}</summary>
      <button disabled={busy} onClick={() => { setMode('edit'); setSaved(false); }}>{t(locale, 'worldEditWording')}</button>
      <button disabled={busy} onClick={() => { setMode('feedback'); setSaved(false); }}>{t(locale, 'worldReadingFeedback')}</button>
    </details>
    {mode === 'edit' ? <div>
      <label>{t(locale, 'worldEditWording')}<textarea autoFocus value={words} maxLength={2000} disabled={busy} onChange={event => setWords(event.currentTarget.value)} /></label>
      <p className="waka-reading-meta">{t(locale, 'worldReadingLockedHint')}</p>
      <button disabled={busy || !words.trim()} onClick={() => void write()}>{t(locale, 'worldSave')}</button>
      <button disabled={busy} onClick={() => { setWords(text); setMode(null); }}>{t(locale, 'worldCancelEdit')}</button>
    </div> : mode === 'feedback' ? <div>{(['true', 'partly', 'not_true'] as const).map(value => <button key={value} disabled={busy} onClick={() => void write(value)}>
      {t(locale, value === 'true' ? 'worldClaimTrue' : value === 'partly' ? 'worldReadingPartly' : 'worldNotTrue')}
    </button>)}</div> : null}
    {saved ? <p role="status">{t(locale, 'worldReadingFeedbackSaved')}</p> : null}
    {failed ? <p role="alert">{t(locale, 'worldReadingDetailsFailed')}</p> : null}
  </div>;
}
