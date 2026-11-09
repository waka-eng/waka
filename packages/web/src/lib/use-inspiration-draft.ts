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
      // Text-only saves rely on the durable save journal, not IndexedDB.
      // Keep a revision identity so an identical newer draft is not cleared.
      if (!live.current.revision) change(current => current);
      return { id: live.current.id, revision: live.current.revision };
    }
    if (!live.current.revision) change(current => current);
    await pump();
    const snapshot = live.current;
    const stored = await loadInspirationDraft(owner.current!, snapshot.id);
    if (!stored || stored.revision !== snapshot.revision) throw new DraftProblem('worldDraftChangedElsewhere');
    return { id: snapshot.id, revision: snapshot.revision };
  }, [change, pump]);
  const settle = useCallback(async (submitted: { id: string; revision: number } | undefined, inspirationId: string, assertCurrent?: () => void, submittedKeys: readonly string[] = []) => {
    if (!submitted || !owner.current) return false;
    assertCurrent?.();
    const epoch = generation.current, scopeAtStart = owner.current;
    await running.current;
    if (!alive.current || generation.current !== epoch) return false;
    assertCurrent?.();
    const settled = supported.current ? await settleInspirationMediaDraft(scopeAtStart, submitted.id, submitted.revision, inspirationId) : true;
    if (!alive.current || generation.current !== epoch) return false;
    assertCurrent?.();
    // A newer draft keeps its words and new files, but not object tickets
    // already consumed by this confirmed save. Each object belongs to one
    // attachment; retaining it would make the next save fail with a conflict.
    if (live.current.id === submitted.id && live.current.revision !== submitted.revision &&
      live.current.media.some(item => item.uploaded && submittedKeys.includes(item.uploaded.key))) {
      change(current => ({ ...current, media: current.media.filter(item => !item.uploaded || !submittedKeys.includes(item.uploaded.key)) }));
      await pump();
      if (!alive.current || generation.current !== epoch) return false;
      assertCurrent?.();
    }
    // Compare after asynchronous cleanup, not before it: a newer revision
    // can contain identical words and still belongs to the next capture.
    if (settled && live.current.id === submitted.id && live.current.revision === submitted.revision) {
      const next = newInspirationDraft(); live.current = next; setDraft(next);
      const key = profileStorageKey(scopeAtStart, 'activeInspirationDraft');
      try { if (key) sessionStorage.setItem(key, next.id); } catch { /* lookup excludes saved tombstones */ }
      return true;
    }
    return false;
  }, [change, pump]);
  const discard = useCallback(async () => {
    const epoch = generation.current, scopeAtStart = owner.current;
    if (!scopeAtStart || !ready) return false;
    if (supported.current) await pump();
    if (!alive.current || generation.current !== epoch) return false;
    const previous = live.current;
    const next: InspirationDraft = { ...previous, text: '', linkText: '', media: [], recordingCandidate: null,
      revision: previous.revision + 1, updatedAt: Date.now() };
    if (supported.current) await writeInspirationDraft(scopeAtStart, next, previous.revision);
    if (!alive.current || generation.current !== epoch || live.current !== previous) return false;
    live.current = next; setDraft(next); setError('');
    writeProfileText(scopeAtStart, 'draft', '');
    return true;
  }, [pump, ready]);
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
  /* ═══ A FRESH PAGE, THE OLD ONE SET ASIDE, NOT LOST (founder, 2026-11-09) ═══
     "the photo is here when im trying to record fresh": Your voice and a
     screenshot from home are a NEW thing to keep, so they start on a blank
     page instead of reopening yesterday's draft (whose words the dictation
     was being appended to). The draft they would have reopened stays stored
     exactly as it was, in its own row; `resumeLatest` brings it back the
     next time the notepad is closed with nothing in it, so Keep a thought
     opens it again once the fresh note is kept, kept as a draft or discarded.

     Synchronous on purpose: the microphone must start inside the tap. Only
     where the draft can be stored (`supported`), and never over a write that
     failed (`blocked`): a draft that is not safely on disk is not set aside. */
  const startFresh = useCallback((): boolean => {
    const previous = live.current, scopeNow = owner.current;
    if (!scopeNow || !supported.current || blocked.current) return false;
    if (!(previous.text.trim() || previous.linkText?.trim() || previous.media.length || previous.recordingCandidate)) return false;
    /* A draft seeded from the text journal was never written to the store;
       write it before stepping off it, so it has a row to come back from. */
    if (!previous.revision) { queue.current.push({ ...previous, revision: 1, updatedAt: Date.now() }); void pump().catch(() => undefined); }
    const next = newInspirationDraft();
    live.current = next; setDraft(next); setError('');
    writeProfileText(scopeNow, 'draft', '');
    const key = profileStorageKey(scopeNow, 'activeInspirationDraft');
    try { if (key) sessionStorage.setItem(key, next.id); } catch { /* owner-index recovery */ }
    return true;
  }, [pump]);
  /** With the page empty, take up the newest draft still waiting (one set
      aside by `startFresh`, or left by another tab). Never over words. */
  const resumeLatest = useCallback(async (): Promise<boolean> => {
    const scopeAtStart = owner.current, epoch = generation.current, empty = live.current;
    if (!scopeAtStart || !supported.current || empty.text.trim() || empty.linkText?.trim() || empty.media.length || empty.recordingCandidate) return false;
    if (running.current) await running.current.catch(() => undefined);
    const stored = await loadInspirationDraft(scopeAtStart).catch(() => null);
    if (!stored || stored.id === empty.id || !alive.current || generation.current !== epoch || live.current !== empty) return false;
    /* Not written to the text journal: that journal is also what opens the
       notepad by itself on the next load, and a draft set aside is waiting
       to be asked for, not announced. */
    live.current = stored; setDraft(stored);
    const key = profileStorageKey(scopeAtStart, 'activeInspirationDraft');
    try { if (key) sessionStorage.setItem(key, stored.id); } catch { /* owner-index recovery */ }
    return true;
  }, []);
  return { draft: loadedPointer === pointer ? draft : seed, current: live, ready: ready && loadedPointer === pointer, available, error, setText, setMedia, setLinkText, setRecordingCandidate, chooseRecording, flush, settle, fork, discard, startFresh, resumeLatest };
}
