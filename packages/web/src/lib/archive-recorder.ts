import { Fragment, createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { attachToNote, NoteGoneError } from "./attach-to-note";
import { loadArchiveClips, putArchiveClip, removeArchiveClip } from './archive-clip-store';
import type { ProfileStorageScope } from './profile-storage';
import type { MessageKey } from "./i18n";
import { useAudioRecording } from "./use-audio-recording";

/**
 * ═══ THE ARCHIVE'S RECORDER, OWNED BY THE PAGE THAT OUTLIVES THE ARCHIVE ═══
 * L12, fixed 2026-10-21 (`docs/plans/card-and-archive.md`). The note page had
 * its own `useAudioRecording`, so closing the archive mid-recording (Close,
 * Escape, the top-of-mind row, Back, a cold link's close, a wall switch that
 * remounts it by key) unmounted the recorder with it. A browser delivers
 * `stop` in a later task; by then the hook's `mounted.current` was false and
 * its epoch bumped, and `onstop` refused the clip on both checks.
 *
 * So `Home` calls this and hands the result down. The hook's guards are left
 * exactly as they are — the notepad uses the same hook and needs them — and
 * they never fire here, because the hook never unmounts with the archive.
 *
 * THE CLIP KNOWS ITS NOTE AND ITS OWNER. `start` takes the note it is
 * pressed on and the archive's profile, and both are kept with the clip, so
 * a clip finished after the archive closed, or after it was remounted on
 * another wall, is attached to the note it was made on under the profile it
 * was made under — never to whatever is open now.
 *
 * A FAILURE IS REPORTED BY THE CALLER, which outlives the archive: `failures`
 * holds every clip that did not attach, with its file, until it is retried
 * into place or dismissed.
 */
export interface ClipTarget {
  noteId: string;
  /** What the note said when the recording began, for the failure line. */
  label: string;
  /** Whose archive the note is in; `null` asks as the signed-in profile. */
  profileId: string | null;
}

/** A clip that did not attach (`file`, which Try again sends again — with
    `reason` when its note was deleted, since a restore from the deleted
    shelf brings the note back under the same id), or a recording that never
    became a clip (`file: null`, `reason` the recorder's own catalogue key —
    empty, too large, interrupted, denied). */
export type ClipFailure = { draftId?: string; uploadedKey?: string; storageFailed?: boolean } & (
  | { id: number; target: ClipTarget; file: File; reason?: "worldRecordingNoteDeleted" }
  | { id: number; target: ClipTarget; file: null; reason: MessageKey });

const askForMicrophone = () => navigator.mediaDevices.getUserMedia({ audio: true });
const noteKey = (noteId: string, profileId: string | null) => `${profileId ?? ""}\u0000${noteId}`;

/** `blocked`: another recorder on the page (the notepad's) is recording or
    finishing — one microphone at a time, so `start` refuses while it is. */
export function useArchiveRecorder(options: { blocked?: boolean; enabled?: boolean; ownerProfileId?: string; ownerAccountId?: string } = {}) {
  const scope = useMemo<ProfileStorageScope | null>(() => options.ownerAccountId && options.ownerProfileId
    ? { accountId: options.ownerAccountId, profileId: options.ownerProfileId } : null, [options.ownerAccountId, options.ownerProfileId]);
  const enabled = options.enabled !== false;
  const enabledRef = useRef(enabled); enabledRef.current = enabled;
  const blocked = Boolean(options.blocked) || !enabled;
  const target = useRef<ClipTarget | null>(null);
  const [forNote, setForNote] = useState<ClipTarget | null>(null);
  /* EVERY UPLOAD IN FLIGHT, COUNTED PER NOTE (review, 2026-10-21). One
     `sending` slot meant a second clip's upload overwrote the first's, so
     the first note stopped saying "Uploading…" while its clip was still on
     its way, and the first to finish cleared the other's. */
  const [inFlight, setInFlight] = useState<ReadonlyMap<string, number>>(() => new Map());
  const bump = useCallback((key: string, by: 1 | -1) => setInFlight((was) => {
    const next = new Map(was);
    const count = (next.get(key) ?? 0) + by;
    if (count > 0) next.set(key, count); else next.delete(key);
    return next;
  }), []);
  /* THE RECENT LANDINGS, oldest first and numbered, so a reader that looks
     once per render sees every one since it last looked (review,
     2026-10-22). Bounded: a reader is never more than a few behind. */
  const [landed, setLanded] = useState<ReadonlyArray<{ target: ClipTarget; seq: number }>>([]);
  const [failures, setFailuresState] = useState<ClipFailure[]>([]);
  const failuresRef = useRef<ClipFailure[]>([]);
  const setFailures = useCallback((next: (all: ClipFailure[]) => ClipFailure[]) => {
    failuresRef.current = next(failuresRef.current);
    setFailuresState(failuresRef.current);
  }, []);
  const failureSeq = useRef(0), landedSeq = useRef(0);

  /* NOTES BEING DELETED (review, 2026-10-22): from the press of Delete,
     through Undo's moment, until the server has answered. A clip sent to one
     of them — a Try again from Home's line, say — would land and then be
     deleted with it, silently. So it is not sent: its line says the note was
     deleted, keeps the file, and is offered again after Undo or a restore. */
  const deleting = useRef(new Set<string>());
  const recovered = useRef(new Set<string>());
  useEffect(() => {
    if (!scope || !enabled) return;
    let live = true;
    void loadArchiveClips(scope).then(clips => {
      if (!live) return;
      for (const clip of clips) {
        if (recovered.current.has(clip.id)) continue;
        recovered.current.add(clip.id);
        setFailures(all => [...all, { id: ++failureSeq.current, draftId: clip.id, file: clip.file, target: clip.target, uploadedKey: clip.uploadedKey }]);
      }
    }).catch(() => { /* no clip to recover; new recordings report persistence failures */ });
    return () => { live = false; };
  }, [scope, enabled, setFailures]);
  const send = useCallback(async (file: File, to: ClipTarget, draftId: string = crypto.randomUUID(), uploadedKey?: string) => {
    recovered.current.add(draftId);
    let storageFailed = false;
    const key = noteKey(to.noteId, to.profileId);
    bump(key, 1);
    try {
      if (scope) {
        try { await putArchiveClip(scope, { id: draftId, target: to, file, uploadedKey }); }
        catch (error) { storageFailed = true; if (uploadedKey) throw error; }
      }
      if (deleting.current.has(key)) throw new Error('Note being deleted');
      await attachToNote(file, { noteId: to.noteId, profileId: to.profileId ?? options.ownerProfileId ?? null, type: "file" }, () => enabledRef.current, {
        uploadedKey,
        onUploaded: async key => {
          uploadedKey = key;
          if (scope) {
            try { await putArchiveClip(scope, { id: draftId, target: to, file, uploadedKey }); }
            catch (error) { storageFailed = true; throw error; }
          }
        },
      });
      if (scope) await removeArchiveClip(scope, draftId);
      landedSeq.current += 1;
      const seq = landedSeq.current;
      setLanded((was) => [...was.slice(-31), { target: to, seq }]);
    } catch (reason) {
      failureSeq.current += 1;
      const id = failureSeq.current;
      /* THE NOTE IS GONE (review, 2026-10-22): only finalize saying its
         note is not there (`NoteGoneError`). Any other 404 — presign's, the
         PUT's, finalize's "S3 object not found" — is a failed upload, offered
         again as one. EITHER WAY THE FILE IS KEPT: a deleted note can be
         restored from the shelf under the same id, and Try again then lands. */
      const gone = reason instanceof NoteGoneError || deleting.current.has(key);
      setFailures((all) => [...all, gone
        ? { id, draftId, uploadedKey, storageFailed, file, target: to, reason: "worldRecordingNoteDeleted" as const }
        : { id, draftId, uploadedKey, storageFailed, file, target: to }]);
    } finally {
      bump(key, -1);
    }
  }, [bump, setFailures, options.ownerProfileId, scope]);
  // Durable storage recovers completed clips. Keep the navigation warning
  // during pending work too, including browsers where storage is unavailable.
  const uploading = inFlight.size > 0 || failures.some(failure => failure.file);
  useEffect(() => {
    if (!uploading) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [uploading]);
  /** Whether a clip is on its way to this note in this archive. */
  const isSending = useCallback((noteId: string, profileId: string | null) =>
    inFlight.has(noteKey(noteId, profileId)), [inFlight]);

  /* The clip's note is read when the clip is handed over, which is before a
     next recording can begin: `start` refuses while one is finishing.

     THE UPLOAD IS NOT AWAITED HERE. The hook stays `finishing` until its
     callback settles, and `finishing` is what holds the other recorder off
     — so awaiting the upload would hold the notepad's microphone off for a
     network round trip after this one's had already been released. The
     upload reports through `isSending`, `landed` and `failures` instead. */
  const recorder = useAudioRecording((file) => {
    const to = target.current;
    if (to) void send(file, to);
  }, askForMicrophone);

  const recorderStart = recorder.start, phase = recorder.phase;
  /* NO AWAIT BEFORE THE MICROPHONE IS ASKED FOR — the iOS rule. `start` is
     called inside the tap, and the hook asks for the stream before its own
     first await. */
  const start = useCallback((note: { id: string; preview: string }, profileId: string | null) => {
    if (blocked || phase !== "idle") return Promise.resolve();
    const to = { noteId: note.id, label: note.preview, profileId };
    target.current = to;
    live.current = true;
    setForNote(to);
    return recorderStart();
  }, [blocked, phase, recorderStart]);
  /* LIVE FROM THE PRESS, not from the next render: `start` marks it before
     anything is committed, and only the recorder's return to idle clears it,
     so a surface leaving in the same breath as Record still stops it. */
  const live = useRef(false);
  useEffect(() => { if (phase === "idle") live.current = false; }, [phase]);
  const recorderStop = recorder.stop;
  const stopIfLive = useCallback(() => { if (live.current) void recorderStop(); }, [recorderStop]);
  useEffect(() => { if (!enabled) { viewing.current = null; void recorderStop(); } }, [enabled, recorderStop]);

  /* ═══ THE RECORDER'S OWN FAILURES, WHEN NOBODY IS LOOKING AT THE NOTE ══
     Review, 2026-10-21. An empty, too-large, interrupted or refused
     recording sets the hook's `error`, which the archive says in its bar —
     on the note the recording was made on. Arriving after the archive has
     closed (the clip is handed over in a later task), or while another note
     or another wall is showing, it was said nowhere. So the archive tells
     this hook which note it is showing (`setViewing`), and an error for any
     other note goes to the caller's failure list, and the hook's own line is
     cleared so it does not follow the person onto the next note. */
  const viewing = useRef<{ noteId: string; profileId: string | null } | null>(null);
  const setViewing = useCallback((note: { noteId: string; profileId: string | null } | null) => { viewing.current = note; }, []);
  const recorderError = recorder.error, recorderClear = recorder.clear;
  useEffect(() => {
    const to = target.current;
    if (!recorderError || !to) return;
    const seen = viewing.current;
    if (seen && seen.noteId === to.noteId && seen.profileId === to.profileId) return;
    failureSeq.current += 1;
    const id = failureSeq.current;
    setFailures((all) => [...all, { id, file: null, target: to, reason: recorderError }]);
    recorderClear();
  }, [recorderError, recorderClear, setFailures]);

  const retry = useCallback((id: number) => {
    const found = failuresRef.current.find((item) => item.id === id);
    if (!found) return;
    setFailures((all) => all.filter((item) => item.id !== id));
    /* a recording that never became a clip has nothing to send again */
    if (found.file) void send(found.file, found.target, found.draftId, found.uploadedKey);
  }, [send, setFailures]);
  /* A NOTE DELETED HERE: its unattached clips' lines say so and keep their
     file and Try again — the note can come back from the deleted shelf
     under the same id, and nothing should promise the clip is lost. */
  const forget = useCallback((noteId: string, profileId: string | null) => setFailures((all) => all.map((item) =>
    item.file && item.target.noteId === noteId && item.target.profileId === profileId
      ? { ...item, reason: "worldRecordingNoteDeleted" as const } : item)), [setFailures]);
  /** The archive says a note's delete has begun (`true`) or is settled —
      undone, refused, or sent (`false`). */
  const setDeleting = useCallback((noteId: string, profileId: string | null, on: boolean) => {
    if (on) deleting.current.add(noteKey(noteId, profileId)); else deleting.current.delete(noteKey(noteId, profileId));
  }, []);
  /* THE NOTE IS BACK — undone, a refused delete, or restored from the
     shelf: its clips' lines go back to plain upload failures. */
  const unforget = useCallback((noteId: string, profileId: string | null) => setFailures((all) => all.map((item) =>
    item.file && item.reason && item.target.noteId === noteId && item.target.profileId === profileId
      ? { ...item, reason: undefined } : item)), [setFailures]);
  /* THE NOTE IS DELETED FOR GOOD (off the shelf): nothing can bring it
     back, so its clips are let go and their lines say so, × only. */
  const drop = useCallback((noteId: string, profileId: string | null) => {
    for (const item of failuresRef.current) if (scope && item.draftId && item.target.noteId === noteId && item.target.profileId === profileId) void removeArchiveClip(scope, item.draftId).catch(() => {});
    setFailures((all) => all.map((item) =>
    item.file && item.target.noteId === noteId && item.target.profileId === profileId
      ? { id: item.id, file: null, target: item.target, reason: "worldRecordingNoteErased" as const } : item));
  }, [setFailures, scope]);
  const dismiss = useCallback((id: number) => {
    const item = failuresRef.current.find(item => item.id === id);
    const remove = () => setFailures(all => all.filter(item => item.id !== id));
    if (scope && item?.draftId) void removeArchiveClip(scope, item.draftId).then(remove).catch(() => {});
    else remove();
  }, [setFailures, scope]);

  /* ONE OBJECT WHILE NOTHING CHANGES (review, 2026-10-21), so what the
     archive builds from it (`useMemo` there) is not rebuilt on every render
     of `Home`. The microphone request is passed as a module constant above:
     the hook's default is a fresh arrow each render, which made its `start`
     — and so this object — new every time. */
  const { phase: recorderPhase, seconds, error, notice, stop, cancel, clear } = recorder;
  return useMemo(() => ({
    phase: recorderPhase, seconds, error, notice, stop, cancel, clear,
    start, stopIfLive, setViewing, blocked, forNote, isSending, landed, failures, retry, forget, setDeleting, unforget, drop, dismiss,
  }), [recorderPhase, seconds, error, notice, stop, cancel, clear, start, stopIfLive, setViewing, blocked, forNote, isSending, landed, failures, retry, forget, setDeleting, unforget, drop, dismiss]);
}

export type ArchiveRecorder = ReturnType<typeof useArchiveRecorder>;

/* ═══ THE CLOCK STAYS OUT OF HOME (review, 2026-10-22) ════════════════════
   `Home` owning the recorder meant its per-second clock re-rendered all of
   Home's world every second of every recording. The recorder lives in this
   provider instead, which `Home` mounts AROUND its world: when the clock
   ticks only the provider and the context's readers re-render (the archive),
   because the world is the provider's `children` and does not change.

   TWO CONTEXTS, BY HOW OFTEN THEY CHANGE. The archive reads the whole
   recorder. `Home` reads `ArchiveClips` — whether the archive's microphone is
   in use, the failure list, and a way to say the notepad's is — which changes
   a handful of times per recording, never per second. */
export interface ArchiveClips {
  /** The archive's recorder is not idle: the notepad must not start. */
  active: boolean;
  failures: ClipFailure[];
  retry: (id: number) => void;
  dismiss: (id: number) => void;
  /** Tell the archive's recorder the notepad's is live (one microphone). */
  setBlocked: (blocked: boolean) => void;
}

const RecorderContext = createContext<ArchiveRecorder | null>(null);
const ClipsContext = createContext<ArchiveClips | null>(null);

export function ArchiveRecorderProvider({ children, enabled, ownerProfileId, ownerAccountId }: { children?: ReactNode; enabled?: boolean; ownerProfileId?: string; ownerAccountId?: string }): JSX.Element {
  const [blocked, setBlocked] = useState(false);
  const recorder = useArchiveRecorder({ blocked, enabled, ownerProfileId, ownerAccountId });
  const active = recorder.phase !== "idle";
  const { failures, retry, dismiss } = recorder;
  const clips = useMemo<ArchiveClips>(() => ({ active, failures, retry, dismiss, setBlocked }), [active, failures, retry, dismiss]);
  return createElement(RecorderContext.Provider, { value: recorder },
    createElement(ClipsContext.Provider, { value: clips }, children));
}

/** Standalone Home mounts (including previews) still get a recorder. */
export function ArchiveRecorderFallback({ children }: { children: ReactNode }): JSX.Element {
  const existing = useContext(RecorderContext);
  return existing ? createElement(Fragment, null, children)
    : createElement(ArchiveRecorderProvider, null, children);
}

/** The whole recorder, ticking clock included — the archive's. */
export function useArchiveRecorderContext(): ArchiveRecorder {
  const recorder = useContext(RecorderContext);
  if (!recorder) throw new Error("useArchiveRecorderContext needs an ArchiveRecorderProvider above it");
  return recorder;
}

/** What `Home` needs from the archive's recorder, and nothing that ticks. */
export function useArchiveClips(): ArchiveClips {
  const clips = useContext(ClipsContext);
  if (!clips) throw new Error("useArchiveClips needs an ArchiveRecorderProvider above it");
  return clips;
}
