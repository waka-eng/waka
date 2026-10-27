import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchInspirationPage } from './api';
import { toInspiration, type Inspiration } from './data';
import { inspirationSourceRevision } from './inspiration-snapshots';
import type { ListViewState } from './list-view-state';

type SearchRead = { key: string; rows: Inspiration[]; total?: number; cursor?: string; pages: number; revision: number };
// The view object belongs to one mounted account/profile. Nothing is persisted,
// and a different account cannot reuse it. Bound both query count and row count.
const EMPTY_ROWS: Inspiration[] = [];
const cache = new WeakMap<ListViewState, Map<string, SearchRead>>();
function cached(memory: ListViewState, key: string) {
  const read = cache.get(memory)?.get(key);
  return read?.revision === inspirationSourceRevision() ? read : null;
}
function remember(memory: ListViewState, read: SearchRead) {
  const entries = cache.get(memory) ?? new Map<string, SearchRead>();
  entries.delete(read.key);
  if (read.rows.length <= 500) entries.set(read.key, read);
  while (entries.size > 3) entries.delete(entries.keys().next().value!);
  cache.set(memory, entries);
}

/** Search originals on the server; reuse owned results while refreshing. */
export function useArchiveSearch(profile: string | null | undefined, query: string | null, category: string | null, memory: ListViewState) {
  const key = JSON.stringify([profile, query, category]);
  const latest = useRef(key); latest.current = key;
  const [read, setRead] = useState<SearchRead | null>(() => cached(memory, key));
  const [status, setStatus] = useState<{ key: string; phase: 'loading' | 'ready' | 'failed' }>(() => ({ key, phase: cached(memory, key) ? 'ready' : 'loading' }));
  const [moreBusy, setMoreBusy] = useState(false), [moreFailed, setMoreFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false), [refreshFailed, setRefreshFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const request = useRef<AbortController | null>(null), paging = useRef(false);
  const refresh = useCallback(() => { cache.delete(memory); setRevision(value => value + 1); }, [memory]);

  useEffect(() => {
    const controller = new AbortController();
    request.current?.abort(); request.current = controller; paging.current = false;
    setMoreBusy(false); setMoreFailed(false); setRefreshFailed(false);
    if (query === null) { setRead(null); setRefreshing(false); return () => controller.abort(); }
    const previous = cached(memory, key);
    setRead(previous); setStatus({ key, phase: previous ? 'ready' : 'loading' }); setRefreshing(true);
    const wantedPages = previous?.pages ?? memory.searchPages ?? 1;
    const sourceRevision = inspirationSourceRevision();
    const timer = window.setTimeout(async () => {
      const rows = new Map<string, Inspiration>();
      let cursor: string | undefined, total: number | undefined, pages = 0;
      try {
        do {
          const page = await fetchInspirationPage({ profile: profile ?? undefined, q: query || undefined, category: category ?? undefined, limit: 50, cursor }, controller.signal);
          if (controller.signal.aborted || latest.current !== key) return;
          for (const row of page.inspirations) rows.set(row.id, toInspiration(row));
          total = page.total ?? total; pages += 1;
          cursor = page.nextCursor === cursor ? undefined : page.nextCursor;
        } while (cursor && pages < wantedPages);
        if (sourceRevision !== inspirationSourceRevision()) { refresh(); return; }
        const next = { key, rows: [...rows.values()], total, cursor, pages, revision: sourceRevision };
        memory.searchPages = pages; remember(memory, next);
        setRead(next); setStatus({ key, phase: 'ready' });
      } catch (error) {
        if (!controller.signal.aborted && latest.current === key) {
          // Authorization failure must never leave remembered material visible.
          const unauthorized = error && typeof error === 'object' && 'status' in error && (error.status === 401 || error.status === 403 || error.status === 404);
          if (previous && !unauthorized) setRefreshFailed(true);
          else { cache.delete(memory); setRead(null); setStatus({ key, phase: 'failed' }); }
        }
      } finally { if (request.current === controller) setRefreshing(false); }
    }, previous ? 0 : 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [key, profile, query, category, memory, revision, refresh]);

  const current = read?.key === key ? read : cached(memory, key);
  const more = async () => {
    if (!current?.cursor || paging.current || refreshing) return;
    const controller = request.current;
    paging.current = true; setMoreBusy(true); setMoreFailed(false);
    try {
      const page = await fetchInspirationPage({ profile: profile ?? undefined, q: query || undefined, category: category ?? undefined, limit: 50, cursor: current.cursor }, controller?.signal);
      if (controller?.signal.aborted || latest.current !== key) return;
      if (current.revision !== inspirationSourceRevision()) { refresh(); return; }
      const rows = new Map(current.rows.map(row => [row.id, row]));
      for (const row of page.inspirations) rows.set(row.id, toInspiration(row));
      const next = { ...current, rows: [...rows.values()], pages: current.pages + 1, cursor: page.nextCursor === current.cursor ? undefined : page.nextCursor };
      memory.searchPages = next.pages; remember(memory, next); setRead(next);
    } catch { if (!controller?.signal.aborted && latest.current === key) setMoreFailed(true); }
    finally { if (request.current === controller) { paging.current = false; setMoreBusy(false); } }
  };
  return { rows: current?.rows ?? EMPTY_ROWS, total: current?.total, cursor: current?.cursor,
    phase: current ? 'ready' as const : status.key === key ? status.phase : 'loading' as const,
    more, moreBusy, moreFailed, refreshing, refreshFailed, refresh };
}
