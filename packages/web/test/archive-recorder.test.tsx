// @vitest-environment jsdom
/**
 * ═══ THE ARCHIVE'S RECORDER, ON ITS OWN ═════════════════════════════════
 * `lib/archive-recorder.ts` is the recorder `Home` owns for the archive (L12).
 * `archive-recording-outlives.test.tsx` drives it through the whole page;
 * these cases hold the parts of it that are about the hook itself, found in
 * review (2026-10-21): uploads in flight are counted per note, and leaving
 * the page warns while any is.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). `lib/api` — presign is HELD per call,
 * so two uploads can be in flight at once and land in the order a case says.
 * `MediaRecorder` and `navigator.mediaDevices` are pieces of browser jsdom
 * lacks; this stub hands its clip over on `stop` at once, which is enough
 * here because the hook stays mounted throughout.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const S = vi.hoisted(() => ({
  held: [] as Array<{ land: () => void; fail: () => void }>,
  finalized: [] as string[],
}));

vi.mock("../src/lib/api", async (original) => ({
  ...await original<typeof import("../src/lib/api")>(),
  presignAttachment: () => new Promise((land, fail) => {
    S.held.push({
      land: () => land({ uploadUrl: "https://bucket.test/put", key: "k", headers: {}, profileId: "me", expiresAt: "" }),
      fail: () => fail(new Error("offline")),
    });
  }),
  uploadToPresignedUrl: async () => undefined,
  finalizeAttachment: async (input: { inspirationId: string }) => { S.finalized.push(input.inspirationId); return { id: "att" }; },
}));

import { useArchiveRecorder, type ArchiveRecorder } from "../src/lib/archive-recorder";

class Recorder {
  static isTypeSupported = (): boolean => true;
  state = "inactive";
  mimeType: string;
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => Promise<void> | void;
  constructor(_stream: MediaStream, options: { mimeType: string }) { this.mimeType = options.mimeType; }
  start(): void { this.state = "recording"; }
  stop(): void {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["clip"], { type: this.mimeType }) });
    void this.onstop?.();
  }
}

let recorder: ArchiveRecorder;
let renders: ArchiveRecorder[] = [];
function Probe({ tick }: { tick: number }) { recorder = useArchiveRecorder(); renders.push(recorder); return <i data-tick={tick} />; }

let host: HTMLDivElement, root: Root;
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.assign(S, { held: [], finalized: [] });
  renders = [];
  vi.stubGlobal("MediaRecorder", Recorder);
  Object.defineProperty(window.navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [Object.assign(new EventTarget(), { stop: () => undefined })] }) },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Probe tick={0} />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function recordOnto(id: string) {
  await act(async () => { await recorder.start({ id, preview: `note ${id}` }, "me"); });
  await act(async () => { await recorder.stop(); });
}

it("keeps each note's upload its own while two are in flight", async () => {
  await recordOnto("a");
  await recordOnto("b");
  expect(S.held, "both uploads should be on their way").toHaveLength(2);
  expect(recorder.isSending("a", "me"), "the second upload took the first note's state").toBe(true);
  expect(recorder.isSending("b", "me")).toBe(true);
  /* the second lands first: the first is still on its way */
  await act(async () => { S.held[1]!.land(); await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  expect(S.finalized).toEqual(["b"]);
  expect(recorder.isSending("b", "me")).toBe(false);
  expect(recorder.isSending("a", "me"), "the first note's upload was cleared by the second's").toBe(true);
  await act(async () => { S.held[0]!.land(); await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  expect(recorder.isSending("a", "me")).toBe(false);
  /* the same note in another archive is another note */
  expect(recorder.isSending("a", "agent")).toBe(false);
});

it("warns before the page is left while a clip is still uploading, and not after", async () => {
  const leave = () => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  expect(leave(), "warned with nothing in flight").toBe(false);
  await recordOnto("a");
  expect(recorder.phase, "the recorder itself is done").toBe("idle");
  expect(leave(), "the page could be left over an upload still in flight").toBe(true);
  await act(async () => { S.held[0]!.land(); await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  expect(leave(), "still warned after the clip landed").toBe(false);
});
