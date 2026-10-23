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
 * `lib/data` — the one case that mounts the archive itself reads its one row
 * through here, as `one-save-rule.test.tsx` does.
 * `lib/auth-context` supplies changing identities to exercise the real
 * recording boundary through sign-out and sign-in.
 * `indexedDB` is fake-indexeddb, with real transactions and owner keys.
 * `MediaRecorder` and `navigator.mediaDevices` are pieces of browser jsdom
 * lacks; this stub hands its clip over on `stop` at once, which is enough
 * here because the hook stays mounted throughout.
 */
import { IDBFactory } from "fake-indexeddb";
import { loadArchiveClips } from "../src/lib/archive-clip-store";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const S = vi.hoisted(() => ({
  held: [] as Array<{ land: () => void; fail: () => void }>,
  finalized: [] as string[],
  presignedProfiles: [] as Array<string | undefined>,
  live: new Set<unknown>(),
  viewer: null as null | { account: { id: string }; profile: { id: string } },
  delayedStop: false,
  failFinalize: false,
  deliveries: [] as Array<() => void>,
}));

vi.mock("../src/lib/auth-context", async (original) => ({
  ...await original<typeof import("../src/lib/auth-context")>(), useOptionalAuth: () => S.viewer,
}));

vi.mock("../src/lib/data", async (original) => {
  const row = { id: "kept-1", preview: "dusk on the hill", capturedMs: Date.UTC(2026, 9, 8), category: null, attachments: [] };
  return {
    ...await original<typeof import("../src/lib/data")>(),
    loadInspirations: async () => ({ inspirations: [row], total: 1, short: false }),
    loadInspiration: async () => ({ ...row, text: row.preview, reflections: [] }),
  };
});

vi.mock("../src/lib/api", async (original) => ({
  ...await original<typeof import("../src/lib/api")>(),
  presignAttachment: (_input: unknown, _signal?: AbortSignal, options?: { profile?: string }) => new Promise((land, fail) => {
    S.presignedProfiles.push(options?.profile);
    S.held.push({
      land: () => land({ uploadUrl: "https://bucket.test/put", key: "k", headers: {}, profileId: "me", expiresAt: "" }),
      fail: () => fail(new Error("offline")),
    });
  }),
  uploadToPresignedUrl: async () => undefined,
  finalizeAttachment: async (input: { inspirationId: string }) => {
    S.finalized.push(input.inspirationId);
    if (S.failFinalize) throw new Error('Response interrupted');
    return { id: "att" };
  },
}));

import { useState } from "react";
import { DOCK_SLOT } from "../src/components/NoteTools";
import { SavesOverlay } from "../src/components/SavesOverlay";
import { ArchiveRecorderProvider, useArchiveRecorder, useArchiveRecorderContext, type ArchiveRecorder } from "../src/lib/archive-recorder";

import { ArchiveRecordingBoundary } from "../src/lib/archive-recording-boundary";

class Recorder {
  static isTypeSupported = (): boolean => true;
  state = "inactive";
  mimeType: string;
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => Promise<void> | void;
  constructor(_stream: MediaStream, options: { mimeType: string }) { this.mimeType = options.mimeType; }
  start(): void { this.state = "recording"; S.live.add(this); }
  stop(): void {
    this.state = "inactive";
    S.live.delete(this);
    const deliver = () => {
      this.ondataavailable?.({ data: new Blob(["clip"], { type: this.mimeType }) });
      void this.onstop?.();
    };
    if (S.delayedStop) S.deliveries.push(deliver); else deliver();
  }
}

let recorder: ArchiveRecorder;
let renders: ArchiveRecorder[] = [];
function Probe({ tick }: { tick: number }) { recorder = useArchiveRecorder(); renders.push(recorder); return <i data-tick={tick} />; }

let host: HTMLDivElement, root: Root;
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.assign(S, { held: [], finalized: [], presignedProfiles: [], live: new Set(), viewer: null, delayedStop: false, failFinalize: false, deliveries: [] });
  renders = [];
  vi.stubGlobal("indexedDB", new IDBFactory());
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

it("hands back the same recorder while nothing about it changed", async () => {
  const before = renders.length;
  await act(async () => root.render(<Probe tick={1} />));
  await act(async () => root.render(<Probe tick={2} />));
  expect(renders.length, "the probe did not re-render").toBeGreaterThan(before);
  expect(renders[renders.length - 1], "a re-render of the page made a new recorder object").toBe(renders[before - 1]);
  /* and a change is a new object */
  await recordOnto("a");
  expect(renders[renders.length - 1]).not.toBe(renders[before - 1]);
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

/* ═══ RECORD AND LEAVE IN ONE BREATH LEAVES NO LIVE MICROPHONE (review) ═══
   The archive decided whether to stop on its way out from the phase of its
   last committed render. Record pressed and the archive gone in the same
   commit read "idle" there, so nothing stopped: the microphone arrived after
   the archive had gone and recorded with no Stop on screen. The press marks
   the recorder live itself now, and the archive asks it. */
it("stops a recording whose Record and the archive's leaving land in one commit", async () => {
  let hide: () => void = () => undefined;
  /* the provider stays; only the archive inside it goes */
  function Toggle() {
    const [shown, setShown] = useState(true);
    hide = () => setShown(false);
    return shown ? <SavesOverlay locale="en-US" title="Your Inspirations" onClose={() => undefined} /> : null;
  }
  const Host = () => <ArchiveRecorderProvider><Toggle /></ArchiveRecorderProvider>;
  const slot = document.createElement("span");
  slot.id = DOCK_SLOT;
  document.body.append(slot);
  try {
    await act(async () => root.render(<Host />));
    for (let turn = 0; turn < 12 && !host.querySelector(".waka-list-row"); turn += 1) await act(async () => { await Promise.resolve(); });
    await act(async () => host.querySelector<HTMLButtonElement>(".waka-list-row")!.click());
    for (let turn = 0; turn < 12 && !slot.querySelector('[aria-label="Record"]'); turn += 1) await act(async () => { await Promise.resolve(); });
    const record = slot.querySelector<HTMLButtonElement>('[aria-label="Record"]');
    expect(record, "the open note offers no Record").toBeTruthy();
    await act(async () => { record!.click(); hide(); });
    for (let turn = 0; turn < 6; turn += 1) await act(async () => { await Promise.resolve(); });
    expect(host.querySelector(".waka-over"), "the archive did not go").toBeNull();
    expect(S.live.size, "a recorder is running with no archive, and so no Stop, on screen").toBe(0);
  } finally {
    slot.remove();
  }
});

function OwnedProbe() {
  recorder = useArchiveRecorderContext();
  return <span>{recorder.failures.map(failure => failure.target.label).join(',')}</span>;
}
const ownerA = { account: { id: 'account-a' }, profile: { id: 'profile-a' } };
const ownerB = { account: { id: 'account-b' }, profile: { id: 'profile-b' } };
async function changeOwner(viewer: typeof S.viewer) {
  S.viewer = viewer;
  await act(async () => root.render(<ArchiveRecordingBoundary>{viewer ? <OwnedProbe /> : <span>Signed out</span>}</ArchiveRecordingBoundary>));
}

it('pauses a delayed upload across an account switch and offers it only to its original owner', async () => {
  await changeOwner(ownerA);
  await recordOnto('private-note');
  await act(async () => { await vi.waitFor(() => expect(S.held).toHaveLength(1)); });
  await changeOwner(ownerB);
  await act(async () => S.held[0]!.land());
  expect(S.finalized).toEqual([]);
  expect(recorder.failures).toHaveLength(0);
  expect(host.textContent).not.toContain('private-note');
  await changeOwner(ownerA);
  expect(recorder.failures).toHaveLength(1);
  expect(recorder.failures[0]!.file?.size).toBeGreaterThan(0);
  await act(async () => recorder.retry(recorder.failures[0]!.id));
  await act(async () => { await vi.waitFor(() => expect(S.held).toHaveLength(2)); S.held[1]!.land(); });
  await act(async () => { await vi.waitFor(() => expect(S.finalized).toEqual(['private-note'])); });
  await until(() => expect(recorder.failures).toHaveLength(0));
});

it('retains the delayed stop event after sign-out and releases the microphone', async () => {
  await changeOwner(ownerA);
  S.delayedStop = true;
  await act(async () => recorder.start({ id: 'private-note', preview: 'Private recording' }, null));
  await changeOwner(null);
  expect(S.live.size).toBe(0);
  await act(async () => S.deliveries[0]!());
  await act(async () => { await vi.waitFor(async () => expect(await loadArchiveClips({ accountId: 'account-a', profileId: 'profile-a' })).toHaveLength(1)); });
  expect(S.held).toHaveLength(0);
  await changeOwner(ownerB);
  expect(host.textContent).not.toContain('Private recording');
  expect(recorder.failures).toHaveLength(0);
  await changeOwner(ownerA);
  expect(recorder.failures[0]!.target.profileId).toBeNull();
  expect(recorder.failures[0]!.file?.size).toBeGreaterThan(0);
  const leave = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(leave);
  expect(leave.defaultPrevented).toBe(true);
  await act(async () => recorder.retry(recorder.failures[0]!.id));
  await act(async () => { await vi.waitFor(() => expect(S.presignedProfiles).toEqual(['profile-a'])); });
  await act(async () => S.held[0]!.land());
  await until(() => expect(recorder.isSending('private-note', null)).toBe(false));
});

async function until(check: () => void) {
  await vi.waitFor(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    check();
  });
}

it('recovers completed audio after a full remount only for its owner and retries the original target', async () => {
  await changeOwner(ownerA);
  await act(async () => { await recorder.start({ id: 'noah-note', preview: 'Noah recording' }, 'noah'); });
  await act(async () => { await recorder.stop(); });
  await act(async () => { await vi.waitFor(() => expect(S.held).toHaveLength(1)); S.held[0]!.fail(); });
  await until(() => expect(recorder.failures).toHaveLength(1));
  const before = await loadArchiveClips({ accountId: 'account-a', profileId: 'profile-a' });
  expect(before[0]!.file.size).toBeGreaterThan(0);
  await act(async () => root.unmount()); root = createRoot(host);
  await changeOwner(ownerB);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(recorder.failures).toHaveLength(0);
  await changeOwner(ownerA);
  await until(() => expect(recorder.failures).toHaveLength(1));
  expect(recorder.failures[0]!.target).toMatchObject({ noteId: 'noah-note', profileId: 'noah' });
  await act(async () => recorder.retry(recorder.failures[0]!.id));
  await act(async () => { await vi.waitFor(() => expect(S.held).toHaveLength(2)); S.held[1]!.land(); });
  await act(async () => { await vi.waitFor(async () => expect(await loadArchiveClips({ accountId: 'account-a', profileId: 'profile-a' })).toEqual([])); });
  expect(S.presignedProfiles).toEqual(['noah', 'noah']);
  expect(S.finalized).toEqual(['noah-note']);
});

it('reuses the persisted upload after an interrupted finalize response and reload', async () => {
  S.failFinalize = true;
  await changeOwner(ownerA);
  await recordOnto('private-note');
  await act(async () => { await vi.waitFor(() => expect(S.held).toHaveLength(1)); S.held[0]!.land(); });
  await until(() => expect(recorder.failures).toHaveLength(1));
  expect((await loadArchiveClips({ accountId: 'account-a', profileId: 'profile-a' }))[0]?.uploadedKey).toBe('k');
  await act(async () => root.unmount()); root = createRoot(host);
  await changeOwner(ownerA);
  await until(() => expect(recorder.failures).toHaveLength(1));
  S.failFinalize = false;
  await act(async () => recorder.retry(recorder.failures[0]!.id));
  await until(() => expect(recorder.isSending('private-note', null)).toBe(false));
  expect(S.held).toHaveLength(1);
  expect(S.finalized).toEqual(['private-note', 'private-note']);
  expect(await loadArchiveClips({ accountId: 'account-a', profileId: 'profile-a' })).toEqual([]);
});
