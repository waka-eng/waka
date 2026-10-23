import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DraftProblem, draftProblem } from './draft-problem';
import type { MessageKey } from './i18n';
import { loadInspirationDraft, newInspirationDraft, settleInspirationMediaDraft, writeInspirationDraft,
  type InspirationDraft, type InspirationDraftMedia } from './inspiration-draft-store';
import { profileStorageKey, readProfileText, writeProfileText, type ProfileStorageScope } from './profile-storage';

/** Failed durable writes stay queued for explicit retry. CAS conflicts never
 * overwrite another tab's words or files. `error` is a catalogue key (see
 * `lib/draft-problem`); empty is the success state. */
export function useInspirationDraft(scope: ProfileStorageScope | null) {
  const pointer = profileStorageKey(scope, 'activeInspirationDraft');
  const seed = useMemo(() => newInspirationDraft(readProfileText(scope, 'draft')), [pointer]);
  const [loadedPointer, setLoadedPointer] = useState(pointer);
  const [draft, setDraft] = useState(() => newInspirationDraft(readProfileText(scope, 'draft')));
  const [ready, setReady] = useState(false), [available, setAvailable] = useState(false), [error, setError] = useState<MessageKey | ''>('');
  const live = useRef(draft); live.current = loadedPointer === pointer ? draft : seed;
  const owner = useRef(scope); owner.current = scope;
  const alive = useRef(true), generation = useRef(0), queue = useRef<InspirationDraft[]>([]);
  const running = useRef<Promise<void> | null>(null), supported = useRef(false), blocked = useRef(false);
  useEffect(() => {
    alive.current = true; const epoch = ++generation.current;
    queue.current = []; running.current = null; supported.current = false; blocked.current = false;
    live.current = seed; setDraft(seed); setLoadedPointer(pointer);
    setReady(false); setAvailable(false); setError('');
    if (!scope) { setReady(true); return () => { alive.current = false; generation.current += 1; }; }
    let preferred: string | undefined;
    try { preferred = pointer ? sessionStorage.getItem(pointer) ?? undefined : undefined; } catch { /* recover by owner */ }
    void loadInspirationDraft(scope, preferred).then((stored) => {
      if (!alive.current || generation.current !== epoch) return;
      supported.current = true; setAvailable(true);
      const next = stored ?? newInspirationDraft(readProfileText(scope, 'draft'));
      live.current = next; setDraft(next);
      try { if (pointer) sessionStorage.setItem(pointer, next.id); } catch { /* owner-index recovery still works */ }
    }).catch(() => { /* text-only saves can still use the existing local journal */ })
      .finally(() => { if (alive.current && generation.current === epoch) setReady(true); });
    return () => { alive.current = false; generation.current += 1; };
  }, [pointer]);

  const pump = useCallback((): Promise<void> => {
    if (running.current) return running.current;
    const scopeAtStart = owner.current, epoch = generation.current;
    if (!scopeAtStart || !supported.current) return Promise.reject(new DraftProblem('worldDraftFilesUnavailable'));
    const work = async () => {
      while (queue.current.length && alive.current && generation.current === epoch) {
        const next = queue.current[0]!;
        await writeInspirationDraft(scopeAtStart, next, next.revision - 1);
        if (!alive.current || generation.current !== epoch) throw new Error('Draft owner changed');
        queue.current.shift();
      }
    };
    running.current = work().then(() => { if (generation.current === epoch) { blocked.current = false; setError(''); } })
      .catch((reason: unknown) => {
        if (alive.current && generation.current === epoch) { blocked.current = true; setError(draftProblem(reason)); }
        throw reason;
      }).finally(() => { if (generation.current === epoch) running.current = null; });
    return running.current;
  }, []);
  const change = useCallback((update: (current: InspirationDraft) => InspirationDraft) => {
    const previous = live.current;
    const next = { ...update(previous), revision: previous.revision + 1, updatedAt: Date.now() };
    live.current = next; setDraft(next);
    if (supported.current) { queue.current.push(next); if (!blocked.current) void pump().catch(() => undefined); }
    return next;
  }, [pump]);
  const setText = useCallback((text: string) => {
    if (live.current.text === text) return;
    writeProfileText(owner.current, 'draft', text); change(current => ({ ...current, text }));
  }, [change]);
  const setMedia = useCallback((media: InspirationDraftMedia[]) => {
    change(current => ({ ...current, media }));
    if (!supported.current) { setError('worldDraftFilesUnavailable'); return false; }
    return true;
  }, [change]);
  const setLinkText = useCallback((linkText:string) => {
    if (live.current.linkText === linkText) return;
    change(current=>({...current,linkText}));
    if (!supported.current) setError('worldDraftLinkUnavailable');
  },[change]);
  const setRecordingCandidate = useCallback((recordingCandidate: InspirationDraftMedia | null) => {
    change(current => ({ ...current, recordingCandidate }));
  }, [change]);
  const chooseRecording = useCallback((useNew: boolean) => {
    if (!live.current.recordingCandidate) return;
    change(current => ({ ...current, media: useNew && current.recordingCandidate
      ? [...current.media.filter(item => item.type !== 'audio'), current.recordingCandidate] : current.media, recordingCandidate: null }));
  }, [change]);
  const flush = useCallback(async () => {
    if (!supported.current) {
      if (live.current.media.length || live.current.recordingCandidate || live.current.linkText?.trim()) throw new DraftProblem('worldDraftFilesUnavailable');
      return null;
    }
    if (!live.current.revision) change(current => current);
    await pump();
    const snapshot = live.current;
    const stored = await loadInspirationDraft(owner.current!, snapshot.id);
    if (!stored || stored.revision !== snapshot.revision) throw new DraftProblem('worldDraftChangedElsewhere');
    return { id: snapshot.id, revision: snapshot.revision };
  }, [change, pump]);
  const settle = useCallback(async (submitted: { id: string; revision: number } | undefined, inspirationId: string) => {
    if (!submitted || !owner.current) return;
    const epoch = generation.current, scopeAtStart = owner.current;
    await running.current;
    await settleInspirationMediaDraft(scopeAtStart, submitted.id, submitted.revision, inspirationId);
    if (!alive.current || generation.current !== epoch) return;
    if (live.current.id === submitted.id && live.current.revision === submitted.revision) {
      const next = newInspirationDraft(); live.current = next; setDraft(next);
      const key = profileStorageKey(scopeAtStart, 'activeInspirationDraft');
      try { if (key) sessionStorage.setItem(key, next.id); } catch { /* lookup excludes saved tombstones */ }
    }
  }, []);
  /* ONE FORK AT A TIME. A second press while the first is out would fork the
     fork; it waits on the same one instead. */
  const forking = useRef<Promise<void> | null>(null);
  const forkOnce = useCallback(async () => {
    if (running.current) await running.current.catch(() => undefined);
    const next = { ...live.current, id: crypto.randomUUID(), revision: 0 };
    queue.current = []; blocked.current = false; live.current = next; setDraft(next);
    const key = profileStorageKey(owner.current, 'activeInspirationDraft');
    try { if (key) sessionStorage.setItem(key, next.id); } catch { /* owner-index recovery */ }
    change(current => current); await pump();
  }, [change, pump]);
  const fork = useCallback((): Promise<void> => {
    if (forking.current) return forking.current;
    const run = forkOnce().finally(() => { if (forking.current === run) forking.current = null; });
    forking.current = run;
    return run;
  }, [forkOnce]);
  return { draft: loadedPointer === pointer ? draft : seed, current: live, ready: ready && loadedPointer === pointer, available, error, setText, setMedia, setLinkText, setRecordingCandidate, chooseRecording, flush, settle, fork };
}
