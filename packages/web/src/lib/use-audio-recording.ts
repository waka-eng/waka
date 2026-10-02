import { useCallback, useEffect, useRef, useState } from 'react';

export const MAX_RECORDING_SECONDS = 300;
const MAX_BYTES = 25 * 1024 * 1024;
const FORMATS = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];
export function supportedRecordingType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return FORMATS.find(type => MediaRecorder.isTypeSupported(type)) ?? null;
}
/** The caller owns the resulting File. Closing the composer can await stop;
 * unmount always releases the microphone, including a late permission grant. */
export function useAudioRecording(onRecorded: (file: File) => Promise<void> | void,
  getStream: () => Promise<MediaStream> = () => navigator.mediaDevices.getUserMedia({ audio: true })) {
  const [phase, setPhase] = useState<'idle' | 'requesting' | 'recording' | 'finishing'>('idle');
  const [seconds, setSeconds] = useState(0), [error, setError] = useState('');
  const media = useRef<MediaRecorder | null>(null), stream = useRef<MediaStream | null>(null);
  const pending = useRef<Promise<void> | null>(null), epoch = useRef(0), mounted = useRef(true), clock = useRef(0);
  const requesting = useRef(false);
  const finishCallback = useRef(onRecorded); finishCallback.current = onRecorded;
  const release = () => { stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; window.clearInterval(clock.current); };
  const stop = useCallback(async () => {
    const active = media.current;
    if (active?.state === 'recording') { setPhase('finishing'); active.stop(); }
    if (!active) { epoch.current += 1; requesting.current = false; setPhase('idle'); release(); }
    await pending.current;
  }, []);
  const start = useCallback(async () => {
    if (pending.current || media.current || requesting.current) return;
    const mimeType = supportedRecordingType();
    if (!mimeType || !navigator.mediaDevices?.getUserMedia) { setError('Recording is unavailable in this browser. You can still add a note or photo.'); return; }
    const currentEpoch = ++epoch.current; requesting.current = true; setError(''); setSeconds(0); setPhase('requesting');
    try {
      const input = await getStream();
      if (!mounted.current || epoch.current !== currentEpoch) { input.getTracks().forEach(track => track.stop()); return; }
      requesting.current = false;
      stream.current = input;
      const recorder = new MediaRecorder(input, { mimeType, audioBitsPerSecond: 64000 });
      media.current = recorder;
      const chunks: Blob[] = []; let bytes = 0, failed = false;
      const started = performance.now();
      pending.current = new Promise<void>((resolve) => {
        recorder.ondataavailable = event => {
          if (!event.data.size || failed) return;
          bytes += event.data.size;
          if (bytes > MAX_BYTES) { failed = true; setError('This recording is too large. Try a shorter clip.'); if (recorder.state === 'recording') recorder.stop(); return; }
          chunks.push(event.data);
        };
        recorder.onerror = () => { failed = true; if (mounted.current) setError('The recording was interrupted. Please try again.'); release(); if (recorder.state !== 'inactive') recorder.stop(); };
        recorder.onstop = async () => {
          release(); media.current = null;
          try {
            if (!failed && mounted.current && epoch.current === currentEpoch) {
              const blob = new Blob(chunks, { type: recorder.mimeType || mimeType });
              if (!blob.size) throw new Error('Nothing was recorded. Please try again.');
              const extension = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
              await finishCallback.current(new File([blob], `Recording.${extension}`, { type: blob.type }));
            }
          } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : 'Could not keep the recording.'); }
          finally { if (mounted.current) setPhase('idle'); pending.current = null; resolve(); }
        };
      });
      recorder.start(1000); setPhase('recording');
      clock.current = window.setInterval(() => {
        const elapsed = Math.floor((performance.now() - started) / 1000); setSeconds(elapsed);
        if (elapsed >= MAX_RECORDING_SECONDS) void stop();
      }, 250);
    } catch (reason) {
      release(); media.current = null; pending.current = null;
      if (mounted.current && epoch.current === currentEpoch) { requesting.current = false; setPhase('idle'); setError(reason instanceof DOMException && reason.name === 'NotAllowedError'
        ? 'Microphone access was not allowed. You can enable it in your browser and try again.' : 'Could not start recording. Check your microphone and try again.'); }
    }
  }, [getStream, stop]);
  useEffect(() => {
    mounted.current = true;
    const leave = () => { if (document.hidden && media.current?.state === 'recording') void stop(); };
    document.addEventListener('visibilitychange', leave);
    return () => { mounted.current = false; epoch.current += 1; document.removeEventListener('visibilitychange', leave);
      if (media.current?.state === 'recording') media.current.stop(); release(); };
  }, [stop]);
  return { phase, seconds, error, start, stop };
}
