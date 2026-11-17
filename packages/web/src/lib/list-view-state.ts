import { useLayoutEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import type { ProfileStorageScope } from './profile-storage';

export type ListViewState = {
  query: string;
  category: string | null;
  onShelf: boolean;
  scrollTop: number;
  searchPages?: number;
  archivePages?: number;
};

const createListViewState = (): ListViewState => ({ query: '', category: null, onShelf: false, scrollTop: 0 });

/** Only UI preferences, held for this mounted account. No records or drafts. */
export function useProfileListViews(scope: ProfileStorageScope | null) {
  const profiles = useMemo(() => new Map<string, { inspirations: ListViewState; chats: ListViewState }>(), [scope?.accountId]);
  const key = scope?.profileId ?? '';
  let views = profiles.get(key);
  if (!views) {
    views = { inspirations: createListViewState(), chats: createListViewState() };
    profiles.set(key, views);
  }
  return views;
}

export function useListFilters(viewState?: ListViewState) {
  const [memory] = useState(() => viewState ?? createListViewState());
  const [filters, setFilters] = useState(() => ({ query: memory.query, category: memory.category, onShelf: memory.onShelf }));
  const change = (patch: Partial<typeof filters>) => {
    if ((patch.query === undefined || patch.query === memory.query) &&
      (patch.category === undefined || patch.category === memory.category) &&
      (patch.onShelf === undefined || patch.onShelf === memory.onShelf)) return;
    Object.assign(memory, patch, { scrollTop: 0, searchPages: 1 });
    setFilters(previous => ({ ...previous, ...patch }));
  };
  return { ...filters, memory,
    setQuery: (query: string) => change({ query }),
    setCategory: (category: string | null) => change({ category }),
    setOnShelf: (onShelf: boolean) => change({ onShelf }),
    clearFilters: () => change({ query: '', category: null, onShelf: false }),
  };
}

/** Loading placeholders and note editors must never replace the list position. */
export function useListScroll(memory: ListViewState, ready: boolean, filterKey: string, topRequest = 0) {
  const ref = useRef<HTMLDivElement>(null);
  const previousTopRequest = useRef(topRequest);
  useLayoutEffect(() => {
    if (previousTopRequest.current === topRequest) return;
    previousTopRequest.current = topRequest;
    memory.scrollTop = 0;
    if (ref.current) {
      ref.current.scrollTop = 0;
      ref.current.focus({ preventScroll: true });
    }
  }, [memory, topRequest]);
  useLayoutEffect(() => {
    if (ready && ref.current) ref.current.scrollTop = memory.scrollTop;
  }, [memory, ready, filterKey]);
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    if (ready) memory.scrollTop = event.currentTarget.scrollTop;
  };
  return { ref, onScroll };
}
