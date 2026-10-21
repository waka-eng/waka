import { useCallback, useRef, useState } from "react";

import { finalizeAttachment, presignAttachment, uploadToPresignedUrl } from "./api";
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

export interface ClipFailure {
  id: number;
  file: File;
  target: ClipTarget;
}

/** `blocked`: another recorder on the page (the notepad's) is recording or
    finishing — one microphone at a time, so `start` refuses while it is. */
export function useArchiveRecorder(options: { blocked?: boolean } = {}) {
  const blocked = Boolean(options.blocked);
  const target = useRef<ClipTarget | null>(null);
  const [forNote, setForNote] = useState<ClipTarget | null>(null);
  const [sending, setSending] = useState<ClipTarget | null>(null);
  const [landed, setLanded] = useState<{ target: ClipTarget; seq: number } | null>(null);
  const [failures, setFailuresState] = useState<ClipFailure[]>([]);
  const failuresRef = useRef<ClipFailure[]>([]);
  const setFailures = useCallback((next: (all: ClipFailure[]) => ClipFailure[]) => {
    failuresRef.current = next(failuresRef.current);
    setFailuresState(failuresRef.current);
  }, []);
  const failureSeq = useRef(0), landedSeq = useRef(0);

  const send = useCallback(async (file: File, to: ClipTarget) => {
    setSending(to);
    try {
      const pre = await presignAttachment(
        { filename: file.name, contentType: file.type || "application/octet-stream", size: file.size },
        undefined,
        ...(to.profileId ? [{ profile: to.profileId }] as const : []),
      );
      await uploadToPresignedUrl(pre.uploadUrl, file, pre.headers);
      await finalizeAttachment({
        type: "file",
        inspirationId: to.noteId,
        key: pre.key,
        name: file.name,
        ...(file.type ? { contentType: file.type } : {}),
      });
      landedSeq.current += 1;
      setLanded({ target: to, seq: landedSeq.current });
    } catch {
      failureSeq.current += 1;
      const id = failureSeq.current;
      setFailures((all) => [...all, { id, file, target: to }]);
    } finally {
      setSending((was) => (was === to ? null : was));
    }
  }, [setFailures]);

  /* The clip's note is read when the clip is handed over, which is before a
     next recording can begin: `start` refuses while one is finishing.

     THE UPLOAD IS NOT AWAITED HERE. The hook stays `finishing` until its
     callback settles, and `finishing` is what holds the other recorder off
     — so awaiting the upload would hold the notepad's microphone off for a
     network round trip after this one's had already been released. The
     upload reports through `sending`, `landed` and `failures` instead. */
  const recorder = useAudioRecording((file) => {
    const to = target.current;
    if (to) void send(file, to);
  });

  const recorderStart = recorder.start, phase = recorder.phase;
  /* NO AWAIT BEFORE THE MICROPHONE IS ASKED FOR — the iOS rule. `start` is
     called inside the tap, and the hook asks for the stream before its own
     first await. */
  const start = useCallback((note: { id: string; preview: string }, profileId: string | null) => {
    if (blocked || phase !== "idle") return Promise.resolve();
    const to = { noteId: note.id, label: note.preview, profileId };
    target.current = to;
    setForNote(to);
    return recorderStart();
  }, [blocked, phase, recorderStart]);

  const retry = useCallback((id: number) => {
    const found = failuresRef.current.find((item) => item.id === id);
    if (!found) return;
    setFailures((all) => all.filter((item) => item.id !== id));
    void send(found.file, found.target);
  }, [send, setFailures]);
  const dismiss = useCallback((id: number) => setFailures((all) => all.filter((item) => item.id !== id)), [setFailures]);

  return { ...recorder, start, blocked, forNote, sending, landed, failures, retry, dismiss };
}

export type ArchiveRecorder = ReturnType<typeof useArchiveRecorder>;
