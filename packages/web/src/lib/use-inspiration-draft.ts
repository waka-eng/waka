import { useCallback, useEffect, useRef, useState } from 'react';
import { loadInspirationDraft, newInspirationDraft, settleInspirationMediaDraft, writeInspirationDraft,
  type InspirationDraft, type InspirationDraftMedia } from './inspiration-draft-store';
import { profileStorageKey, readProfileText, writeProfileText, type ProfileStorageScope } from './profile-storage';

/** Failed durable writes stay queued for explicit retry. CAS conflicts never
 * overwrite another tab's words or files. */
export function useInspirationDraft(scope: ProfileStorageScope | null) {
  const [draft, setDraft] = useState(() => newInspirationDraft(readProfileText(scope, 'draft')));
  const [ready, setReady] = useState(false), [available, setAvailable] = useState(false), [error, setError] = useState('');
  const live = useRef(draft); live.current = draft;
  const owner = useRef(scope); owner.current = scope;
  const alive = useRef(true), generation = useRef(0), queue = useRef<InspirationDraft[]>([]);
  const running = useRef<Promise<void> | null>(null), supported = useRef(false), blocked = useRef(false);
  const pointer = profileStorageKey(scope, 'activeInspirationDraft');
  useEffect(() => {
    alive.current = true; const epoch = ++generation.current;
    queue.current = []; running.current = null; supported.current = false; blocked.current = false;
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
    if (!scopeAtStart || !supported.current) return Promise.reject(new Error('File drafts are unavailable on this device.'));
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
        if (alive.current && generation.current === epoch) { blocked.current = true; setError(reason instanceof Error ? reason.message : 'Could not keep the draft on this device.'); }
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
    if (!supported.current) { setError('File drafts are unavailable on this device. Keep this window open.'); return false; }
    return true;
  }, [change]);
  const setLinkText = useCallback((linkText:string) => {
    if (live.current.linkText === linkText) return;
    change(current=>({...current,linkText}));
    if (!supported.current) setError('This link cannot be kept on this device yet. Paste it into your note before closing.');
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
      if (live.current.media.length || live.current.recordingCandidate || live.current.linkText?.trim()) throw new Error('File drafts are unavailable on this device.');
      return null;
    }
    if (!live.current.revision) change(current => current);
    await pump();
    const snapshot = live.current;
    const stored = await loadInspirationDraft(owner.current!, snapshot.id);
    if (!stored || stored.revision !== snapshot.revision) throw new Error('This draft changed in another tab. Reopen it before saving.');
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
  const fork = useCallback(async () => {
    if (running.current) await running.current.catch(() => undefined);
    const next = { ...live.current, id: crypto.randomUUID(), revision: 0 };
    queue.current = []; blocked.current = false; live.current = next; setDraft(next);
    const key = profileStorageKey(owner.current, 'activeInspirationDraft');
    try { if (key) sessionStorage.setItem(key, next.id); } catch { /* owner-index recovery */ }
    change(current => current); await pump();
  }, [change, pump]);
  return { draft, current: live, ready, available, error, setText, setMedia, setLinkText, setRecordingCandidate, chooseRecording, flush, settle, fork };
}
