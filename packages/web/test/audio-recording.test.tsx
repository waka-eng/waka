// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `navigator` supplies microphone outcomes,
 * `MediaRecorder` supplies recording events, `Blob`/`File` use Node's cloneable
 * implementations, and `performance` plus timers control elapsed time. The
 * shipped hook runs; these tests do not claim microphone/device compatibility. */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Blob, File } from 'node:buffer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MAX_RECORDING_SECONDS, useAudioRecording } from '../src/lib/use-audio-recording';
import { t, type MessageKey } from '../src/lib/locales';

/* The hook reports catalogue keys, not sentences — the surface says them in
   the reader's language — so the cases read them back through the English
   catalogue, and one case below reads the Korean. */
const said = (key: MessageKey | '', locale: 'en-US' | 'ko-KR' = 'en-US') => (key ? t(locale, key) : '');

let hook: ReturnType<typeof useAudioRecording>, host: HTMLDivElement, root: Root, now: number;
let mounted = false;
const saved = vi.fn(), acquire = vi.fn<() => Promise<MediaStream>>(), stopTrack = vi.fn();
const track = Object.assign(new EventTarget(), { stop: stopTrack });
const stream = { getTracks: () => [track] } as unknown as MediaStream;
class Recorder {
  static instances: Recorder[] = [];
  static isTypeSupported = () => true;
  static bytes = 'fixture audio';
  state = 'inactive'; mimeType: string;
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => Promise<void>; onerror?: () => void;
  constructor(_stream: MediaStream, options: { mimeType: string }) { this.mimeType = options.mimeType; Recorder.instances.push(this); }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob([Recorder.bytes], { type: this.mimeType }) }); void this.onstop?.(); }
}
function Harness() { hook = useAudioRecording(saved, acquire); return <p>{hook.phase} {said(hook.error)}</p>; }
beforeEach(async () => {
  vi.resetAllMocks(); now = 0; Recorder.instances = []; Recorder.bytes = 'fixture audio';
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('MediaRecorder', Recorder); vi.stubGlobal('Blob', Blob); vi.stubGlobal('File', File);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: acquire } });
  acquire.mockResolvedValue(stream);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); mounted = true;
  await act(async () => root.render(<Harness />));
});
afterEach(async () => { if (mounted) await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it('keeps the emitted bytes and releases the microphone when stopped', async () => {
  await act(async () => hook.start()); expect(hook.phase).toBe('recording');
  await act(async () => hook.stop());
  expect(saved).toHaveBeenCalledOnce(); expect(await (saved.mock.calls[0]![0] as File).text()).toBe('fixture audio');
  expect(stopTrack).toHaveBeenCalledOnce(); expect(hook.phase).toBe('idle');
});
it('allows only one permission request and ignores a grant after cancellation', async () => {
  let resolve!: (value: MediaStream) => void;
  acquire.mockImplementation(() => new Promise(done => { resolve = done; }));
  let first!: Promise<void>;
  await act(async () => { first = hook.start(); void hook.start(); });
  expect(acquire).toHaveBeenCalledOnce();
  await act(async () => hook.stop());
  await act(async () => { resolve(stream); await first; });
  expect(stopTrack).toHaveBeenCalledOnce(); expect(Recorder.instances).toHaveLength(0); expect(saved).not.toHaveBeenCalled();
});
it('says a refused microphone in Korean to a Korean reader', async () => {
  acquire.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
  await act(async () => hook.start());
  expect(hook.error).toBe('worldRecordingDenied');
  expect(said(hook.error, 'ko-KR')).toMatch(/[가-힣]/);
  expect(said(hook.error, 'ko-KR')).not.toMatch(/[A-Za-z]{2,}\s+[A-Za-z]{2,}/);
});
it('shows a permission failure without starting a recording', async () => {
  acquire.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
  await act(async () => hook.start()); expect(hook.phase).toBe('idle'); expect(said(hook.error)).toContain('Microphone access');
  expect(saved).not.toHaveBeenCalled(); expect(Recorder.instances).toHaveLength(0);
});
it('stops and keeps the clip at the configured duration limit', async () => {
  await act(async () => hook.start()); now = MAX_RECORDING_SECONDS * 1000;
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(saved).toHaveBeenCalledOnce(); expect(hook.phase).toBe('idle'); expect(stopTrack).toHaveBeenCalledOnce();
  expect(said(hook.notice)).toContain('Five-minute limit');
});
it('cancels an active replacement without delivering bytes to the draft', async () => {
  await act(async () => hook.start()); await act(async () => hook.cancel());
  expect(saved).not.toHaveBeenCalled(); expect(stopTrack).toHaveBeenCalledOnce();
  expect(hook.phase).toBe('idle'); expect(said(hook.notice)).toBe('Recording canceled.');
});
it('keeps a clip and explains why recording stopped when the page becomes hidden', async () => {
  await act(async () => hook.start());
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(saved).toHaveBeenCalledOnce(); expect(said(hook.notice)).toContain('left this page'); expect(stopTrack).toHaveBeenCalledOnce();
});
it('releases a late permission grant after leaving the page', async () => {
  let resolve!: (value: MediaStream) => void, first!: Promise<void>;
  acquire.mockImplementation(() => new Promise(done => { resolve = done; }));
  await act(async () => { first = hook.start(); });
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  await act(async () => { resolve(stream); await first; });
  expect(saved).not.toHaveBeenCalled(); expect(Recorder.instances).toHaveLength(0); expect(stopTrack).toHaveBeenCalledOnce();
});
it('handles microphone disconnection without continuing to hold the device', async () => {
  await act(async () => hook.start()); await act(async () => track.dispatchEvent(new Event('ended')));
  expect(saved).toHaveBeenCalledOnce(); expect(said(hook.notice)).toContain('disconnected'); expect(stopTrack).toHaveBeenCalledOnce();
});
it.each([['NotFoundError', 'No microphone'], ['NotReadableError', 'busy or unavailable']])('explains %s', async (name, message) => {
  acquire.mockRejectedValue(new DOMException('fixture', name)); await act(async () => hook.start());
  expect(said(hook.error)).toContain(message); expect(saved).not.toHaveBeenCalled();
});
it('does not offer an empty or failed recording as a replacement', async () => {
  Recorder.bytes = ''; await act(async () => hook.start()); await act(async () => hook.stop());
  expect(said(hook.error)).toContain('Nothing was recorded'); expect(saved).not.toHaveBeenCalled();
  Recorder.bytes = 'bytes after a recorder failure'; await act(async () => hook.start());
  await act(async () => Recorder.instances.at(-1)?.onerror?.());
  expect(saved).not.toHaveBeenCalled(); expect(hook.phase).toBe('idle'); expect(said(hook.error)).toContain('interrupted');
});
it('warns before leaving with an unfinished recording, but not after it is kept', async () => {
  await act(async () => hook.start());
  const active = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(active);
  expect(active.defaultPrevented).toBe(true);
  await act(async () => hook.stop());
  const stopped = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(stopped);
  expect(stopped.defaultPrevented).toBe(false);
});
it('releases active input without publishing into another mounted owner', async () => {
  await act(async () => hook.start());
  await act(async () => root.unmount()); mounted = false;
  expect(stopTrack).toHaveBeenCalledOnce(); expect(saved).not.toHaveBeenCalled();
});
