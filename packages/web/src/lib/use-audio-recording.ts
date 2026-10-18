import { useCallback, useEffect, useRef, useState } from 'react';

import type { MessageKey } from './i18n';

export const MAX_RECORDING_SECONDS = 300;
const MAX_BYTES = 25 * 1024 * 1024;
const FORMATS = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];
export function supportedRecordingType(): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return null;
  return FORMATS.find(type => MediaRecorder.isTypeSupported(type)) ?? null;
}
/** The caller owns the resulting File. Closing the composer can await stop;
 * unmount always releases the microphone, including a late permission grant.
 *
 * `error` AND `notice` ARE CATALOGUE KEYS, NOT SENTENCES. They were finished
 * English sentences set from here and printed verbatim by every surface that
 * shows them, so a Korean reader denied the microphone was told so in
 * English. A hook does not know whose screen it is on; the surface does, so
 * it says the key with `say()` where it renders. Empty is "nothing to say". */
export function useAudioRecording(onRecorded: (file: File) => Promise<void> | void,
  getStream: () => Promise<MediaStream> = () => navigator.mediaDevices.getUserMedia({ audio: true })) {
  const [phase, setPhase] = useState<'idle' | 'requesting' | 'recording' | 'finishing'>('idle');
  const [seconds, setSeconds] = useState(0), [error, setError] = useState<MessageKey | ''>('');
  const [notice, setNotice] = useState<MessageKey | ''>('');
  const media = useRef<MediaRecorder | null>(null), stream = useRef<MediaStream | null>(null);
  const pending = useRef<Promise<void> | null>(null), epoch = useRef(0), mounted = useRef(true), clock = useRef(0);
  const requesting = useRef(false);
  const clearTrackListeners = useRef<(() => void) | null>(null);
  const finishCallback = useRef(onRecorded); finishCallback.current = onRecorded;
  const release = () => { clearTrackListeners.current?.(); clearTrackListeners.current = null;
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; window.clearInterval(clock.current); };
  const stop = useCallback(async (reason?: 'limit' | 'hidden' | 'interrupted') => {
    if (reason) setNotice(reason === 'limit' ? 'worldRecordingLimit'
      : reason === 'hidden' ? 'worldRecordingLeftPage'
      : 'worldRecordingDisconnected');
    const active = media.current;
    if (active?.state === 'recording') { setPhase('finishing'); active.stop(); }
    if (!active) { epoch.current += 1; requesting.current = false; setPhase('idle'); release(); }
    await pending.current;
  }, []);
  const cancel = useCallback(async () => {
    epoch.current += 1; requesting.current = false;
    await stop();
    if (mounted.current) { setNotice('worldRecordingCanceled'); setError(''); }
  }, [stop]);
  const start = useCallback(async () => {
    if (pending.current || media.current || requesting.current) return;
    const mimeType = supportedRecordingType();
    if (!mimeType || !navigator.mediaDevices?.getUserMedia) { setError('worldRecordingUnavailable'); return; }
    const currentEpoch = ++epoch.current; requesting.current = true; setError(''); setNotice(''); setSeconds(0); setPhase('requesting');
    try {
      const input = await getStream();
      if (!mounted.current || epoch.current !== currentEpoch) { input.getTracks().forEach(track => track.stop()); return; }
      requesting.current = false;
      stream.current = input;
      const recorder = new MediaRecorder(input, { mimeType, audioBitsPerSecond: 64000 });
      media.current = recorder;
      const ended = () => { if (mounted.current && media.current === recorder) void stop('interrupted'); };
      input.getTracks().forEach(track => track.addEventListener?.('ended', ended));
      clearTrackListeners.current = () => input.getTracks().forEach(track => track.removeEventListener?.('ended', ended));
      const chunks: Blob[] = []; let bytes = 0, failed = false;
      const started = performance.now();
      pending.current = new Promise<void>((resolve) => {
        recorder.ondataavailable = event => {
          if (!event.data.size || failed) return;
          bytes += event.data.size;
          if (bytes > MAX_BYTES) { failed = true; setError('worldRecordingTooLarge'); if (recorder.state === 'recording') recorder.stop(); return; }
          chunks.push(event.data);
        };
        recorder.onerror = () => { failed = true; if (mounted.current) setError('worldRecordingInterrupted'); release(); if (recorder.state !== 'inactive') recorder.stop(); };
        recorder.onstop = async () => {
          release(); media.current = null;
          try {
            if (!failed && mounted.current && epoch.current === currentEpoch) {
              const blob = new Blob(chunks, { type: recorder.mimeType || mimeType });
              if (!blob.size) { if (mounted.current) setError('worldRecordingEmpty'); return; }
              const extension = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
              await finishCallback.current(new File([blob], `Recording.${extension}`, { type: blob.type }));
            }
          } catch { if (mounted.current) setError('worldRecordingKeepFailed'); }
          finally { if (mounted.current) setPhase('idle'); pending.current = null; resolve(); }
        };
      });
      recorder.start(1000); setPhase('recording');
      clock.current = window.setInterval(() => {
        const elapsed = Math.floor((performance.now() - started) / 1000); setSeconds(Math.min(elapsed, MAX_RECORDING_SECONDS));
        if (elapsed >= MAX_RECORDING_SECONDS) void stop('limit');
      }, 250);
    } catch (reason) {
      release(); media.current = null; pending.current = null;
      if (mounted.current && epoch.current === currentEpoch) { requesting.current = false; setPhase('idle'); setError(reason instanceof DOMException && reason.name === 'NotAllowedError'
        ? 'worldRecordingDenied'
        : reason instanceof DOMException && reason.name === 'NotFoundError' ? 'worldRecordingNoMicrophone'
        : reason instanceof DOMException && reason.name === 'NotReadableError' ? 'worldRecordingMicrophoneBusy'
        : 'worldRecordingStartFailed'); }
    }
  }, [getStream, stop]);
  useEffect(() => {
    mounted.current = true;
    const leave = () => { if (document.hidden && (media.current?.state === 'recording' || requesting.current)) void stop('hidden'); };
    document.addEventListener('visibilitychange', leave);
    return () => { mounted.current = false; epoch.current += 1; document.removeEventListener('visibilitychange', leave);
      if (media.current?.state === 'recording') media.current.stop(); release(); };
  }, [stop]);
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'finishing') return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [phase]);
  return { phase, seconds, error, notice, start, stop, cancel };
}
