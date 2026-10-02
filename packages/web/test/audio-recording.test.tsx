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

let hook: ReturnType<typeof useAudioRecording>, host: HTMLDivElement, root: Root, now: number;
let mounted = false;
const saved = vi.fn(), acquire = vi.fn<() => Promise<MediaStream>>(), stopTrack = vi.fn();
const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
class Recorder {
  static instances: Recorder[] = [];
  static isTypeSupported = () => true;
  state = 'inactive'; mimeType: string;
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => Promise<void>; onerror?: () => void;
  constructor(_stream: MediaStream, options: { mimeType: string }) { this.mimeType = options.mimeType; Recorder.instances.push(this); }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['fixture audio'], { type: this.mimeType }) }); void this.onstop?.(); }
}
function Harness() { hook = useAudioRecording(saved, acquire); return <p>{hook.phase} {hook.error}</p>; }
beforeEach(async () => {
  vi.resetAllMocks(); now = 0; Recorder.instances = [];
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
it('shows a permission failure without starting a recording', async () => {
  acquire.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
  await act(async () => hook.start()); expect(hook.phase).toBe('idle'); expect(hook.error).toContain('Microphone access');
  expect(saved).not.toHaveBeenCalled(); expect(Recorder.instances).toHaveLength(0);
});
it('stops and keeps the clip at the configured duration limit', async () => {
  await act(async () => hook.start()); now = MAX_RECORDING_SECONDS * 1000;
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(saved).toHaveBeenCalledOnce(); expect(hook.phase).toBe('idle'); expect(stopTrack).toHaveBeenCalledOnce();
});
it('releases active input without publishing into another mounted owner', async () => {
  await act(async () => hook.start());
  await act(async () => root.unmount()); mounted = false;
  expect(stopTrack).toHaveBeenCalledOnce(); expect(saved).not.toHaveBeenCalled();
});
