import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DialogSurface } from './DialogSurface';
import { fetchProfileProcessing, fetchInspirationProcessing, retryInspirationProcessing, type ApiProfileProcessing, type ApiInspirationProcessingStatus } from '../lib/api/inspiration-processing';
import { formatMessage, t, type SupportedLocale } from '../lib/locales';

/** Server-owned progress survives a new device/tab. Only the active profile is
 * read; failed/empty queues don't poll, and hidden tabs don't do work. */
export function ProfileProcessing({ profileId, locale, revision, onOpen }: {
  profileId: string; locale: SupportedLocale; revision: number; onOpen: (id: string) => void;
}) {
  const [summary, setSummary] = useState<ApiProfileProcessing | null>(null), [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false), [selected, setSelected] = useState<ApiInspirationProcessingStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true), request = useRef(0), timer = useRef<number>(), abort = useRef<AbortController>();
  const check = useCallback(async () => {
    if (document.hidden) return;
    const sequence = ++request.current; abort.current?.abort(); window.clearTimeout(timer.current);
    const controller = new AbortController(); abort.current = controller;
    try {
      const data = await fetchProfileProcessing(profileId, controller.signal);
      if (!alive.current || request.current !== sequence || data.profileId !== profileId) return;
      setSummary(data); setFailed(false);
      if (data.total > data.failed) {
        const dates = data.items.filter(row => row.phase === 'waiting' && row.runAfter).map(row => Date.parse(row.runAfter!));
        const allWaiting = data.items.every(row => row.phase === 'waiting' || row.phase === 'failed' || row.phase === 'unknown');
        const delay = allWaiting && dates.length ? Math.max(30_000, Math.min(...dates) - Date.now()) : 30_000;
        timer.current = window.setTimeout(() => void check(), Math.min(delay, 2_147_000_000));
      }
    } catch { if (alive.current && request.current === sequence && !controller.signal.aborted) setFailed(true); }
  }, [profileId]);
  useEffect(() => {
    alive.current = true; void check();
    const resume = () => { if (!document.hidden) void check(); };
    window.addEventListener('focus', resume); document.addEventListener('visibilitychange', resume);
    return () => { alive.current = false; request.current++; abort.current?.abort(); window.clearTimeout(timer.current);
      window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume); };
  }, [check, revision]);
  const inspect = async (id: string, retry = false) => {
    if (busy) return; setBusy(true); setFailed(false);
    try {
      const result = await (retry ? retryInspirationProcessing : fetchInspirationProcessing)(id, { profile: profileId });
      if (alive.current && result.profileId === profileId && result.inspirationId === id) { setSelected(result); void check(); }
    } catch { if (alive.current) setFailed(true); }
    finally { if (alive.current) setBusy(false); }
  };
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);
  return <>
    <button type="button" onClick={() => { setOpen(true); setSelected(null); void check(); }}>
      {say('worldProcessingTitle')}{summary?.total ? ` (${summary.total})` : ''}{failed ? ' · !' : ''}
    </button>
    {open ? createPortal(<div className="waka-reading-sheet"><DialogSurface className="waka-reading-full" aria-label={say('worldProcessingTitle')} onClose={() => setOpen(false)}>
      <header><h2>{say('worldProcessingTitle')}</h2><button onClick={() => setOpen(false)}>{say('worldClose')}</button></header>
      <div className="waka-reading-full-body waka-processing-body" tabIndex={0}>
        {failed ? <p role="alert">{say('worldSourceCheckFailed')} <button onClick={() => void check()}>{say('worldRetry')}</button></p> : null}
        {!summary ? !failed && <p role="status">{say('worldSourceChecking')}</p> : summary.total === 0 ? <p>{say('worldProcessingEmpty')}</p> : <>
          <p>{formatMessage(locale, 'worldProcessingCount', { count: String(summary.total), failed: String(summary.failed) })}</p>
          <ul className="waka-reading-sources">{summary.items.map(row => <li key={row.inspirationId}>
            <button disabled={busy} onClick={() => void inspect(row.inspirationId)}>
              {new Date(row.createdAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })} · {say(row.phase === 'failed' || row.phase === 'unknown' ? 'worldProcessingAttention' : row.phase === 'waiting' ? 'worldProcessingWaiting' : row.phase === 'queued' ? 'worldProcessingQueued' : 'worldProcessingWorking')}
            </button>
            <button onClick={() => { setOpen(false); onOpen(row.inspirationId); }}>{say('worldReadingOpenSource')}</button>
          </li>)}</ul>
          {summary.total > summary.items.length ? <p>{formatMessage(locale, 'worldProcessingMore', { count: String(summary.items.length) })}</p> : null}
        </>}
        {selected ? <div role="status"><p>{say(selected.phase === 'ready' ? 'worldProcessingComplete' : selected.phase === 'failed' || selected.phase === 'unknown' ? 'worldSourceFailed' : selected.phase === 'waiting' ? 'worldProcessingWaiting' : selected.phase === 'queued' ? 'worldProcessingQueued' : 'worldProcessingWorking')}
          {selected.phase === 'waiting' && selected.runAfter ? ` · ${new Date(selected.runAfter).toLocaleString(locale)}` : ''}</p>
          <button disabled={busy} onClick={() => void inspect(selected.inspirationId, selected.canRetry)}>{say(selected.canRetry ? 'worldSourceRetry' : 'worldSourceCheck')}</button>
        </div> : null}
      </div>
    </DialogSurface></div>, document.body) : null}
  </>;
}
