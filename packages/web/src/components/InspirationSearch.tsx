import { useEffect, useRef, useState } from 'react';
import { fetchInspirationPage, type ApiInspirationSummary } from '../lib/api';
import { t, type SupportedLocale } from '../lib/locales';
import { DialogSurface } from './DialogSurface';

interface SearchRead {
  profileId: string; query: string; phase: 'loading' | 'ready' | 'failed';
  rows: ApiInspirationSummary[]; cursor?: string; total?: number;
}
export interface InspirationSearchProps {
  profileId: string;
  query: string;
  locale: SupportedLocale;
  label?: string;
  onQuery: (query: string) => void;
  onPick: (inspiration: ApiInspirationSummary) => void;
  onClose: () => void;
}

export function InspirationSearch(props: InspirationSearchProps) {
  const query = props.query.trim();
  const label = props.label ?? t(props.locale, 'worldFindInspiration');
  const [read, setRead] = useState<SearchRead | null>(null), [pageBusy, setPageBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const latest = useRef({ profileId: props.profileId, query }); latest.current = { profileId: props.profileId, query };
  const sequence = useRef(0), request = useRef<AbortController | null>(null);
  const morePending = useRef(false);
  useEffect(() => {
    const serial = ++sequence.current, controller = new AbortController();
    request.current?.abort(); request.current = controller; morePending.current = false; setPageBusy(false);
    if (query.length < 2) { setRead(null); return () => controller.abort(); }
    setRead({ profileId: props.profileId, query, phase: 'loading', rows: [] });
    const timer = window.setTimeout(() => {
      fetchInspirationPage({ profile: props.profileId, q: query, limit: 50 }, controller.signal).then((page) => {
        if (controller.signal.aborted || sequence.current !== serial || latest.current.profileId !== props.profileId || latest.current.query !== query) return;
        setRead({ profileId: props.profileId, query, phase: 'ready', rows: page.inspirations, cursor: page.nextCursor, total: page.total });
      }).catch(() => {
        if (!controller.signal.aborted && sequence.current === serial) setRead({ profileId: props.profileId, query, phase: 'failed', rows: [] });
      });
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [props.profileId, query, retry]);
  const current = read?.profileId === props.profileId && read.query === query ? read : null;
  const more = async () => {
    if (!current?.cursor || morePending.current) return;
    morePending.current = true; setPageBusy(true);
    const serial = sequence.current, controller = request.current;
    try {
      const page = await fetchInspirationPage({ profile: props.profileId, q: query, limit: 50, cursor: current.cursor }, controller?.signal);
      if (controller?.signal.aborted || sequence.current !== serial || latest.current.profileId !== props.profileId || latest.current.query !== query) return;
      const rows = new Map(current.rows.map((row) => [row.id, row]));
      for (const row of page.inspirations) rows.set(row.id, row);
      setRead({ ...current, phase: 'ready', rows: [...rows.values()], cursor: page.nextCursor === current.cursor ? undefined : page.nextCursor, total: page.total ?? current.total });
    } catch { if (!controller?.signal.aborted && sequence.current === serial) setRead({ ...current, phase: 'failed' }); }
    finally { if (sequence.current === serial) { morePending.current = false; setPageBusy(false); } }
  };
  return <DialogSurface className="jar-seek jar-inspiration-search" aria-label={label} onClose={props.onClose}>
    <div className="jar-search-heading"><p>{label}</p><button type="button" onClick={props.onClose}>{t(props.locale, 'worldClose')}</button></div>
    <input autoFocus className="jar-roomform-box" aria-label={label} value={props.query}
      placeholder={t(props.locale, 'worldSeekPlaceholder')} onChange={(event) => props.onQuery(event.target.value)} />
    {query.length >= 2 && (!current || current.phase === 'loading') ? <p role="status">{t(props.locale, 'worldSearchingInspirations')}</p> : null}
    {current?.phase === 'failed' ? <p role="alert">{t(props.locale, 'worldSearchFailed')} <button type="button" onClick={() => current.rows.length && current.cursor ? void more() : setRetry((value) => value + 1)}>{t(props.locale, 'worldRoomHistoryRetry')}</button></p> : null}
    {current?.phase === 'ready' && !current.rows.length ? <p role="status">{t(props.locale, 'worldNothingSaysThat')}</p> : null}
    {current && current.rows.length ? <ul className="jar-search-results">
      {current.rows.map((row) => <li key={row.id}><button type="button" onClick={() => props.onPick(row)}>
        <span>{row.textPreview || row.attachmentSummary?.[0]?.label || t(props.locale, 'worldASavedInspiration')}</span>
        <small>{Number.isFinite(Date.parse(row.createdAt)) ? new Intl.DateTimeFormat(props.locale, { dateStyle: 'medium' }).format(new Date(row.createdAt)) : ''}
          {row.reflectionCount > 0 ? ` · ${t(props.locale, 'worldReflected')}` : ''}</small>
      </button></li>)}
    </ul> : null}
    {current?.cursor && current.phase === 'ready' ? <button type="button" aria-disabled={pageBusy || undefined} onClick={() => void more()}>{t(props.locale, 'worldMoreResults')}</button> : null}
  </DialogSurface>;
}
