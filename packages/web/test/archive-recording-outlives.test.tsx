// @vitest-environment jsdom
/**
 * ═══ A RECORDING MADE IN THE ARCHIVE OUTLIVES THE ARCHIVE (L12) ═══════════
 *
 * A recording started on a saved note in the archive was lost when the
 * archive itself closed or remounted while it ran: the recorder lived in
 * `SavesOverlay`, a browser's `MediaRecorder` delivers `stop` in a later
 * task, and by then the overlay had unmounted — the hook's `mounted.current`
 * was false, its epoch bumped, and `onstop` refused the clip on both checks.
 *
 * The recorder lives in `Home` now (`lib/archive-recorder.ts`). These cases
 * close the archive every way it can be closed with the recording running,
 * deliver `stop` only AFTER the archive is gone (the ordering a browser
 * produces and jsdom does not), and assert the clip reached the note it was
 * made on, under the profile it was made under.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). `lib/data` and `lib/api` through the
 * shared builders in `helpers/render-home`, with the attachment calls
 * recorded (and the finalize made to fail when a case says). `fetchProfiles`
 * answers with one agent, so a wall switch has somewhere to go.
 * `lib/auth-context` states the signed-in viewer. `MediaRecorder` and
 * `navigator.mediaDevices` are pieces of browser jsdom lacks; the stub holds
 * `stop`'s delivery until the case releases it.
 *
 * `helpers/canvas-stub` stands in for drawing (jsdom has no 2D context) and
 * `helpers/render-home` for the mount and the frame loop.
 */
import { act } from "react";
import { useNavigate } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { installCanvasStub, setViewport } from "./helpers/canvas-stub";
import { apiMockFrom, dataMockFrom, mountWorld, VIEWER_ID, type MountedWorld } from "./helpers/render-home";

const FACTS = {
  inspirations: Array.from({ length: 3 }, (_, i) => ({ id: `own-${i}`, text: `something I kept, ${i}`, daysAgo: i + 1 })),
};
const AGENT_ID = "agent-1";

const S = vi.hoisted(() => ({
  presigned: [] as Array<string | undefined>,
  finalized: [] as string[],
  /* finalize answers with a failure this many more times */
  failFinalize: 0,
  /* `stop` deliveries the browser has not made yet */
  undelivered: [] as Array<() => void>,
  recorders: 0,
}));

vi.mock("../src/lib/api", async (original) => ({
  ...await original<typeof import("../src/lib/api")>(),
  ...apiMockFrom(FACTS),
  fetchProfiles: vi.fn(async () => [{ id: "agent-1", name: "My helper", type: "agent", createdAt: "2026-08-01T00:00:00.000Z" }]),
  presignAttachment: async (input: { filename: string }, _signal?: AbortSignal, options?: { profile?: string }) => {
    S.presigned.push(options?.profile);
    return { uploadUrl: "https://bucket.test/put", key: `k/${input.filename}`, headers: {}, profileId: options?.profile ?? "profile-viewer", expiresAt: "" };
  },
  uploadToPresignedUrl: async () => undefined,
  finalizeAttachment: async (input: { inspirationId: string }) => {
    if (S.failFinalize > 0) { S.failFinalize -= 1; throw new Error("offline"); }
    S.finalized.push(input.inspirationId);
    return { id: "att-1" };
  },
}));
vi.mock("../src/lib/data", async (original) => ({
  ...await original<typeof import("../src/lib/data")>(),
  ...dataMockFrom(FACTS),
}));
vi.mock("../src/lib/auth-context", async (original) => {
  const session = { status: "authenticated", account: { id: "account-1", email: "you@example.test" },
    profile: { id: VIEWER_ID, name: "You", type: "human" }, profiles: [], refresh: async () => undefined, signOut: async () => undefined };
  return { ...await original<typeof import("../src/lib/auth-context")>(), useOptionalAuth: () => session, useAuth: () => session };
});

/** A browser's recorder: `stop` is delivered in a later task, when the case says. */
class Recorder {
  static isTypeSupported = (): boolean => true;
  state = "inactive";
  mimeType: string;
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => Promise<void> | void;
  onerror?: () => void;
  constructor(_stream: MediaStream, options: { mimeType: string }) { this.mimeType = options.mimeType; S.recorders += 1; }
  start(): void { this.state = "recording"; }
  stop(): void {
    this.state = "inactive";
    S.undelivered.push(() => {
      this.ondataavailable?.({ data: new Blob(["fixture audio"], { type: this.mimeType }) });
      void this.onstop?.();
    });
  }
}

let go: ReturnType<typeof useNavigate>;
function RouterTools() { go = useNavigate(); return null; }

let world: MountedWorld;
beforeAll(() => {
  installCanvasStub();
  setViewport(1280, 900);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  window.localStorage.clear();
  Object.assign(S, { presigned: [], finalized: [], failFinalize: 0, undelivered: [], recorders: 0 });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("MediaRecorder", Recorder);
  Object.defineProperty(window.navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [Object.assign(new EventTarget(), { stop: () => undefined })] }) },
  });
});
afterEach(() => { world?.unmount(); vi.useRealTimers(); vi.unstubAllGlobals(); });

async function settle(turns = 8) {
  for (let turn = 0; turn < turns; turn += 1) { await world.step(100); await act(async () => { await vi.advanceTimersByTimeAsync(100); }); }
}
const q = <T extends Element = HTMLElement>(selector: string) => world.container.querySelector<T>(selector) ?? document.querySelector<T>(selector);
const archiveOpen = () => Boolean(q(".waka-over[data-jar-surface]"));

/** The browser finally hands over every clip it was holding. */
async function deliverStops() {
  const due = S.undelivered.splice(0);
  await act(async () => { for (const deliver of due) deliver(); });
  await settle(4);
}

async function openArchive(address = "/?open=saves") {
  if (address !== "/") { await act(async () => { go(address); }); }
  await settle();
  expect(archiveOpen(), "the archive did not open").toBe(true);
}

async function recordOn(id: string) {
  const row = [...document.querySelectorAll<HTMLButtonElement>(".waka-list-row")]
    .find((item) => item.textContent?.includes(FACTS.inspirations.find((fact) => fact.id === id)!.text));
  expect(row, `no row for ${id}`).toBeTruthy();
  await act(async () => row!.click());
  await settle();
  const record = q<HTMLButtonElement>('.waka-dock-tool[aria-label="Record"]');
  expect(record, "the open note offers no Record").toBeTruthy();
  await act(async () => record!.click());
  await settle(2);
  expect(q('.waka-dock-tool--live[aria-label="Stop recording"]'), "the recording did not start").toBeTruthy();
}

it("attaches the clip to its note when the archive is closed with Close mid-recording", async () => {
  world = await mountWorld(FACTS, { routerTools: <RouterTools /> }); await settle();
  await openArchive();
  await recordOn("own-1");
  const close = q<HTMLButtonElement>(".waka-dock button.waka-dock-item--close");
  expect(close, "the bar has no Close").toBeTruthy();
  await act(async () => close!.click());
  await settle();
  expect(archiveOpen(), "Close did not close the archive").toBe(false);
  await deliverStops();
  expect(S.finalized, "the clip was lost with the archive").toEqual(["own-1"]);
  expect(S.presigned).toEqual([VIEWER_ID]);
});

it("attaches the clip to its note when the archive is closed with Escape mid-recording", async () => {
  world = await mountWorld(FACTS, { routerTools: <RouterTools /> }); await settle();
  await openArchive();
  await recordOn("own-2");
  /* Escape on the open note leaves the note; a second leaves the archive */
  for (let press = 0; press < 3 && archiveOpen(); press += 1) {
    const target = q(".waka-over[data-jar-surface]") ?? document.body;
    await act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    await settle(2);
  }
  expect(archiveOpen(), "Escape did not close the archive").toBe(false);
  await deliverStops();
  expect(S.finalized, "the clip was lost with the archive").toEqual(["own-2"]);
});

it("attaches the clip to its note when the browser's Back leaves the archive mid-recording", async () => {
  world = await mountWorld(FACTS, { routerTools: <RouterTools /> }); await settle();
  await openArchive();
  await recordOn("own-1");
  for (let press = 0; press < 3 && archiveOpen(); press += 1) {
    await act(async () => { go(-1); });
    await settle(2);
  }
  expect(archiveOpen(), "Back did not leave the archive").toBe(false);
  await deliverStops();
  expect(S.finalized, "the clip was lost with the archive").toEqual(["own-1"]);
});

it("attaches the clip when a cold link's archive is closed mid-recording (the replace close)", async () => {
  world = await mountWorld(FACTS, { initialEntries: ["/?open=saves"], routerTools: <RouterTools /> }); await settle();
  expect(archiveOpen()).toBe(true);
  await recordOn("own-0");
  await act(async () => q<HTMLButtonElement>(".waka-dock button.waka-dock-item--close")!.click());
  await settle();
  expect(archiveOpen()).toBe(false);
  await deliverStops();
  expect(S.finalized, "the clip was lost with the archive").toEqual(["own-0"]);
});

it("attaches the clip to the original note under the original profile when a wall switch remounts the archive", async () => {
  world = await mountWorld(FACTS, { routerTools: <RouterTools /> }); await settle();
  await openArchive();
  await recordOn("own-1");
  /* The faces are hidden while a saved note is open, so the switch comes
     from outside the page (an address, the simulation's own command) — the
     path that remounts the archive by its key with no Close and no popstate. */
  await world.travelTo(new RegExp(AGENT_ID));
  await settle();
  expect(world.audit().wallKind, "the switch did not reach the agent").toBe("agent");
  expect(archiveOpen(), "the archive did not stay open across the switch").toBe(true);
  await deliverStops();
  expect(S.finalized, "the clip was lost in the remount, or went to another note").toEqual(["own-1"]);
  expect(S.presigned, "the clip was attached under the agent instead of its owner").toEqual([VIEWER_ID]);
  expect(S.presigned).not.toContain(AGENT_ID);
});

it("says on Home that a clip failed to attach after the archive closed, and Try again attaches it to its note", async () => {
  world = await mountWorld(FACTS, { routerTools: <RouterTools /> }); await settle();
  await openArchive();
  await recordOn("own-2");
  S.failFinalize = 1;
  await act(async () => q<HTMLButtonElement>(".waka-dock button.waka-dock-item--close")!.click());
  await settle();
  expect(archiveOpen()).toBe(false);
  await deliverStops();
  expect(S.finalized, "nothing should have attached yet").toEqual([]);
  const line = q(".waka-clip-failed");
  expect(line, "the failure was said nowhere once the archive had gone").toBeTruthy();
  expect(line!.getAttribute("role")).toBe("alert");
  expect(line!.textContent).toContain("Couldn’t attach your recording to “something I kept, 2”.");
  /* it stays until it is handled */
  await settle(12);
  expect(q(".waka-clip-failed"), "the failure line went away on its own").toBeTruthy();
  const retry = [...line!.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Try again");
  expect(retry, "the failure line offers no Try again").toBeTruthy();
  await act(async () => retry!.click());
  await settle(4);
  expect(S.finalized, "Try again did not attach the clip to the note it was made on").toEqual(["own-2"]);
  expect(S.presigned).toEqual([VIEWER_ID, VIEWER_ID]);
  expect(q(".waka-clip-failed"), "the line stayed after the clip attached").toBeNull();
});

it("lets the failure line go with ×, without attaching anything", async () => {
  world = await mountWorld(FACTS, { routerTools: <RouterTools /> }); await settle();
  await openArchive();
  await recordOn("own-0");
  S.failFinalize = 1;
  await act(async () => q<HTMLButtonElement>(".waka-dock button.waka-dock-item--close")!.click());
  await settle();
  await deliverStops();
  const close = q<HTMLButtonElement>('.waka-clip-failed button[aria-label="Close"]');
  expect(close, "the failure line has no ×").toBeTruthy();
  await act(async () => close!.click());
  await settle(2);
  expect(q(".waka-clip-failed")).toBeNull();
  expect(S.finalized).toEqual([]);
});
