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
 * WHAT THIS MOCKS, AND WHY (gate G6). `lib/use-inspiration-draft` is passed
 * through unchanged and only counted: it runs once per render of Home's
 * world, which is the render counter one case needs. `lib/data` and `lib/api` through the
 * shared builders in `helpers/render-home`, with the attachment calls
 * recorded (and the finalize made to fail when a case says). `fetchProfiles`
 * answers with one agent, so a wall switch has somewhere to go.
 * `lib/auth-context` states the signed-in viewer. `MediaRecorder` and
 * `navigator.mediaDevices` are pieces of browser jsdom lacks; the stub holds
 * `stop`'s delivery until the case releases it. `indexedDB` is
 * `fake-indexeddb`, the notepad's draft store, without which its Record is
 * disabled and the one-microphone cases could not start the notepad's.
 *
 * `helpers/canvas-stub` stands in for drawing (jsdom has no 2D context) and
 * `helpers/render-home` for the mount and the frame loop.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useNavigate } from "react-router-dom";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { installCanvasStub, setViewport } from "./helpers/canvas-stub";
import { apiMockFrom, dataMockFrom, mountWorld, pressDockRow, VIEWER_ID, type MountedWorld } from "./helpers/render-home";

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
  /* the browser hands over a clip with nothing in it */
  emptyClip: false,
  /* a note the list read gives an attachment the open card has not seen */
  attachedOnRead: null as string | null,
  /* finalize answers that the note is gone */
  noteGone: false,
  /* finalize answers that the uploaded object is missing (an upload problem) */
  objectMissing: 0,
  /* finalize waits until the case lets it answer */
  holdFinalize: null as null | (() => void),
  /* every held finalize, oldest first */
  heldFinalizes: [] as Array<() => void>,
  holding: false,
  deleted: [] as string[],
}));

vi.mock("../src/lib/api", async (original) => {
  const actual = await original<typeof import("../src/lib/api")>();
  return {
  ...actual,
  ...apiMockFrom(FACTS),
  deleteInspiration: async (id: string) => { S.deleted.push(id); },
  listDeletedInspirations: async () => [],
  fetchProfiles: vi.fn(async () => [{ id: "agent-1", name: "My helper", type: "agent", createdAt: "2026-08-01T00:00:00.000Z" }]),
  presignAttachment: async (input: { filename: string }, _signal?: AbortSignal, options?: { profile?: string }) => {
    S.presigned.push(options?.profile);
    return { uploadUrl: "https://bucket.test/put", key: `k/${input.filename}`, headers: {}, profileId: options?.profile ?? "profile-viewer", expiresAt: "" };
  },
  uploadToPresignedUrl: async () => undefined,
  finalizeAttachment: async (input: { inspirationId: string }) => {
    if (S.holding) await new Promise<void>((answer) => { S.holdFinalize = answer; S.heldFinalizes.push(answer); });
    if (S.noteGone) throw new actual.ApiError({ status: 404, message: "Inspiration not found" });
    if (S.objectMissing > 0) { S.objectMissing -= 1; throw new actual.ApiError({ status: 404, message: "S3 object not found at the supplied key. Did the PUT succeed?" }); }
    if (S.failFinalize > 0) { S.failFinalize -= 1; throw new Error("offline"); }
    S.finalized.push(input.inspirationId);
    return { id: "att-1" };
  },
  };
});
vi.mock("../src/lib/data", async (original) => ({
  ...await original<typeof import("../src/lib/data")>(),
  ...dataMockFrom(FACTS),
  loadInspirations: async () => {
    const field = await dataMockFrom(FACTS).loadInspirations();
    return { ...field, inspirations: field.inspirations.map((row) => row.id === S.attachedOnRead
      ? { ...row, attachments: [{ id: "att-x", type: "file" as const, label: "Recording.webm" }] } : row) };
  },
}));
/* A RENDER COUNTER FOR HOME. `useInspirationDraft` is called once per render
   of Home's world and nowhere else, so counting its calls counts those
   renders without putting a counter in the product. */
const renders = vi.hoisted(() => ({ home: 0 }));
vi.mock("../src/lib/use-inspiration-draft", async (original) => {
  const actual = await original<typeof import("../src/lib/use-inspiration-draft")>();
  return { ...actual, useInspirationDraft: (...args: Parameters<typeof actual.useInspirationDraft>) => { renders.home += 1; return actual.useInspirationDraft(...args); } };
});
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
      this.ondataavailable?.({ data: new Blob(S.emptyClip ? [] : ["fixture audio"], { type: this.mimeType }) });
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
  /* the notepad's draft store, so its Record can be pressed */
  (globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory();
  Object.assign(S, { presigned: [], finalized: [], failFinalize: 0, undelivered: [], recorders: 0, emptyClip: false, attachedOnRead: null, noteGone: false, objectMissing: 0, holdFinalize: null, heldFinalizes: [], holding: false, deleted: [] });
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
  const record = q<HTMLButtonElement>('#waka-note-tools .waka-dock-tool[aria-label="Record"]');
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

/* A SAVED NOTE HAS ITS OWN ADDRESS NOW (#460), so the browser's Back from an
   open note steps back to the list, with the archive still up. The note is
   left mid-recording; the recording stops there and its clip still goes to
   the Home-level recorder and onto the note it was made on. */
it("attaches the clip to its note when the browser's Back leaves only the note", async () => {
  world = await mountWorld(FACTS, { routerTools: <RouterTools /> }); await settle();
  await openArchive();
  await recordOn("own-1");
  await act(async () => { go(-1); });
  await settle(2);
  expect(archiveOpen(), "Back from a note should leave the note, not the archive").toBe(true);
  expect(q(".waka-over--note"), "the note is still open after Back").toBeNull();
  expect(q('.waka-dock-tool--live[aria-label="Stop recording"]'), "the recording is still live with its note gone").toBeNull();
  await deliverStops();
  expect(S.finalized, "the clip did not reach its note").toEqual(["own-1"]);
  expect(S.presigned).toEqual([VIEWER_ID]);
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

/* ═══ ONE MICROPHONE AT A TIME ═══════════════════════════════════════════
   The archive can stand over an open notepad (`?compose=1&open=saves`), and
   with the archive's recorder in `Home` beside the notepad's, both could
   hold a microphone at once. Each refuses while the other is live. (With
   the notepad recording, the bar keeps the notepad's tools and the archive
   offers no Record at all, so that direction is held at the hook.) */
it("does not let the notepad record while the archive's recording is still finishing", async () => {
  world = await mountWorld(FACTS, { routerTools: <RouterTools /> }); await settle();
  await openArchive();
  await recordOn("own-1");
  expect(S.recorders).toBe(1);
  /* the archive closes; the browser has not yet handed over its clip, so
     its microphone is still live — and a new note is opened at once */
  await act(async () => q<HTMLButtonElement>(".waka-dock button.waka-dock-item--close")!.click());
  await settle();
  expect(archiveOpen()).toBe(false);
  await pressDockRow(world.container, "Inspiration");
  await settle();
  const notepadRecord = () => q<HTMLButtonElement>('.waka-dock .waka-dock-tool[aria-label="Record"]');
  expect(notepadRecord(), "the notepad under the archive is not on screen").toBeTruthy();
  expect(notepadRecord()!.disabled, "the notepad's Record was offered over a live microphone").toBe(true);
  /* a press that reaches it anyway starts nothing */
  notepadRecord()!.disabled = false;
  await act(async () => notepadRecord()!.click());
  await settle(2);
  expect(S.recorders, "two recorders ran at once").toBe(1);
  /* once the clip is handed over, the notepad's microphone is free */
  await deliverStops();
  expect(S.finalized).toEqual(["own-1"]);
  expect(notepadRecord()!.disabled, "the notepad stayed locked after the archive let go").toBe(false);
  await act(async () => notepadRecord()!.click());
  await settle(2);
  expect(S.recorders, "the notepad could not record once the archive was done").toBe(2);
});

it("does not let the archive's recorder start while the notepad's is live", async () => {
  const { useArchiveRecorder } = await import("../src/lib/archive-recorder");
  let recorder: ReturnType<typeof useArchiveRecorder> | null = null;
  function Probe({ blocked }: { blocked: boolean }) { recorder = useArchiveRecorder({ blocked }); return null; }
  const host = document.createElement("div");
  document.body.append(host);
  const probe = createRoot(host);
  try {
    await act(async () => probe.render(<Probe blocked />));
    await act(async () => { await recorder!.start({ id: "own-1", preview: "something I kept, 1" }, VIEWER_ID); });
    expect(S.recorders, "the archive recorded over the notepad's microphone").toBe(0);
    expect(recorder!.phase).toBe("idle");
    await act(async () => probe.render(<Probe blocked={false} />));
    await act(async () => { await recorder!.start({ id: "own-1", preview: "something I kept, 1" }, VIEWER_ID); });
    expect(S.recorders, "the archive could not record once the notepad was done").toBe(1);
  } finally {
    await act(async () => probe.unmount());
    host.remove();
  }
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

/* ═══ A CLIP LANDING ON ONE NOTE RE-POINTS ONLY THAT NOTE (review) ═══════
   The archive re-reads its list when a clip lands. It used to re-point
   WHICHEVER note was open at the row that came back — so a clip for note A
   landing while note B was open replaced B's card with the list's copy of
   B. Only the note the clip landed on is re-pointed. */
it("re-points the open note only when the clip landed on it", async () => {
  world = await mountWorld(FACTS, { routerTools: <RouterTools /> }); await settle();
  await openArchive();
  await recordOn("own-1");
  /* back to the list (the recording stops there), and into another note */
  await act(async () => q<HTMLButtonElement>('.waka-dock button[aria-label="Back"]')!.click());
  await settle(2);
  const other = [...document.querySelectorAll<HTMLButtonElement>(".waka-list-row")]
    .find((item) => item.textContent?.includes("something I kept, 0"));
  expect(other, "the list did not come back").toBeTruthy();
  await act(async () => other!.click());
  await settle();
  const field = () => q<HTMLTextAreaElement>(".waka-over textarea");
  expect(field()?.placeholder, "the open note should know it holds nothing").toBeTruthy();
  /* the list read after the landing says the OTHER note holds something */
  S.attachedOnRead = "own-0";
  await deliverStops();
  expect(S.finalized).toEqual(["own-1"]);
  expect(field()?.placeholder, "a clip for another note re-pointed this one").toBeTruthy();
});

/* ═══ A RECORDING THAT FAILS AFTER THE ARCHIVE CLOSED IS SAID ON HOME (review)
   The recorder's own failures (empty, too large, interrupted, denied) were
   said only in the archive's bar. One that arrives after the archive has
   gone — the clip is handed over in a later task — was said nowhere. It
   goes to Home's line now, and opening the archive again does not clear it. */
it("says on Home that a recording failed after the archive closed, and keeps saying it when the archive reopens", async () => {
  world = await mountWorld(FACTS, { routerTools: <RouterTools /> }); await settle();
  await openArchive();
  await recordOn("own-2");
  S.emptyClip = true;
  await act(async () => q<HTMLButtonElement>(".waka-dock button.waka-dock-item--close")!.click());
  await settle();
  expect(archiveOpen()).toBe(false);
  await deliverStops();
  expect(S.finalized, "an empty clip was attached").toEqual([]);
  const line = () => q(".waka-clip-failed");
  expect(line(), "the recording's failure was said nowhere once the archive had gone").toBeTruthy();
  expect(line()!.textContent).toContain("something I kept, 2");
  expect(line()!.textContent).toContain("Nothing was recorded. Please try again.");
  expect([...line()!.querySelectorAll("button")].some((button) => button.textContent === "Try again"),
    "there is no clip to try again with").toBe(false);
  await openArchive();
  expect(line(), "opening the archive cleared Home's line").toBeTruthy();
});

/* ═══ A CLIP WHOSE NOTE WAS DELETED WAITS FOR ITS RESTORE (review, 2026-10-22)
   Finalize saying the note is not there, or the note deleted here, used to
   drop the clip. But a deleted note can come back from the shelf under the
   same id, so the clip is kept: the line says the note was deleted and how
   to bring it back, and Try again lands once it is back. And while a clip
   is on its way to a note, that note cannot be deleted. */
const tryAgainOn = (line: Element | null) => [...(line?.querySelectorAll("button") ?? [])].some((button) => button.textContent === "Try again");

it("keeps the clip for a restore when the server no longer has its note", async () => {
  world = await mountWorld(FACTS, { routerTools: <RouterTools /> }); await settle();
  await openArchive();
  await recordOn("own-1");
  S.noteGone = true;
  await act(async () => q<HTMLButtonElement>(".waka-dock button.waka-dock-item--close")!.click());
  await settle();
  await deliverStops();
  const line = q(".waka-clip-failed");
  expect(line, "the lost clip was said nowhere").toBeTruthy();
  expect(line!.textContent).toContain("The note was deleted. Restore it to attach the recording.");
  expect(tryAgainOn(line), "the clip was dropped, though the note can be restored").toBe(true);
  /* the note is restored; Try again lands the same clip on it */
  S.noteGone = false;
  const retry = [...line!.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Try again")!;
  await act(async () => retry.click());
  await settle(4);
  expect(S.finalized, "the restored note did not get its clip").toEqual(["own-1"]);
  expect(q(".waka-clip-failed")).toBeNull();
});

it("keeps the clip and offers Try again when finalize cannot find the uploaded object", async () => {
  world = await mountWorld(FACTS, { routerTools: <RouterTools /> }); await settle();
  await openArchive();
  await recordOn("own-1");
  S.objectMissing = 1;
  await act(async () => q<HTMLButtonElement>(".waka-dock button.waka-dock-item--close")!.click());
  await settle();
  await deliverStops();
  const line = q(".waka-clip-failed");
  expect(line?.textContent, "an upload problem was said as a deleted note").toContain("Couldn’t attach your recording to “something I kept, 1”.");
  expect(tryAgainOn(line), "the clip was dropped over an upload problem").toBe(true);
  const retry = [...line!.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Try again")!;
  await act(async () => retry.click());
  await settle(4);
  expect(S.finalized, "Try again did not attach the kept clip").toEqual(["own-1"]);
});

it("says a clip's note was deleted here, and keeps the clip for its restore", async () => {
  world = await mountWorld(FACTS, { routerTools: <RouterTools /> }); await settle();
  await openArchive();
  await recordOn("own-1");
  S.failFinalize = 1;
  await act(async () => q<HTMLButtonElement>('.waka-dock-tool--live[aria-label="Stop recording"]')!.click());
  await deliverStops();
  expect(tryAgainOn(q(".waka-clip-failed")), "the failed clip offered no Try again").toBe(true);
  await act(async () => q<HTMLButtonElement>('#waka-note-tools [aria-label="Delete"]')!.click());
  /* past Undo's moment, the delete is sent */
  await act(async () => { await vi.advanceTimersByTimeAsync(7000); });
  await settle(4);
  expect(S.deleted).toEqual(["own-1"]);
  const line = q(".waka-clip-failed");
  expect(line?.textContent).toContain("The note was deleted. Restore it to attach the recording.");
  expect(tryAgainOn(line), "the clip was dropped with its note, though a restore can bring the note back").toBe(true);
});

/* While a delete is pending (Undo's moment, then the request), a Try again
   from Home's line could still send the clip — to land and be deleted with
   the note, silently. It is held instead; Undo brings the plain line back,
   and Try again then lands. */
it("does not send a clip to a note whose delete is pending, and lets Undo bring it back", async () => {
  world = await mountWorld(FACTS, { routerTools: <RouterTools /> }); await settle();
  await openArchive();
  await recordOn("own-1");
  S.failFinalize = 1;
  await act(async () => q<HTMLButtonElement>('.waka-dock-tool--live[aria-label="Stop recording"]')!.click());
  await deliverStops();
  const presignedBefore = S.presigned.length;
  await act(async () => q<HTMLButtonElement>('#waka-note-tools [aria-label="Delete"]')!.click());
  await settle(2);
  const line = () => q(".waka-clip-failed");
  expect(line()?.textContent, "the line did not say the note was deleted").toContain("The note was deleted. Restore it to attach the recording.");
  const retry = () => [...(line()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((button) => button.textContent === "Try again");
  await act(async () => retry()!.click());
  await settle(2);
  expect(S.presigned.length, "Try again sent the clip to a note whose delete is pending").toBe(presignedBefore);
  expect(line()?.textContent).toContain("The note was deleted. Restore it to attach the recording.");
  /* Undo: the note is back, and so is the plain line */
  const undo = [...document.querySelectorAll<HTMLButtonElement>(".waka-dock-undo")].find((button) => button.textContent === "Undo");
  expect(undo, "no Undo").toBeTruthy();
  await act(async () => undo!.click());
  await settle(2);
  expect(line()?.textContent).toContain("Couldn’t attach your recording to “something I kept, 1”.");
  await act(async () => retry()!.click());
  await settle(4);
  expect(S.finalized, "after Undo, Try again did not attach the clip").toEqual(["own-1"]);
  expect(S.deleted, "the undone delete was sent").toEqual([]);
});

/* Deleting a note cancels a recording made ON IT. It used to cancel the one
   shared recorder whatever note it was recording for, so deleting note B
   while note A's clip was still being handed over threw A's clip away. */
it("does not throw away another note's finishing clip when a note is deleted", async () => {
  world = await mountWorld(FACTS, { routerTools: <RouterTools /> }); await settle();
  await openArchive();
  await recordOn("own-1");
  /* back to the list stops A's recording; the browser has not handed it over */
  await act(async () => q<HTMLButtonElement>('.waka-dock button[aria-label="Back"]')!.click());
  await settle(2);
  const other = [...document.querySelectorAll<HTMLButtonElement>(".waka-list-row")]
    .find((item) => item.textContent?.includes("something I kept, 0"))!;
  await act(async () => other.click());
  await settle();
  await act(async () => q<HTMLButtonElement>('#waka-note-tools [aria-label="Delete"]')!.click());
  await settle(2);
  await deliverStops();
  expect(S.finalized, "deleting note B threw away note A's clip").toEqual(["own-1"]);
});

it("does not let a note be deleted while its clip is on its way", async () => {
  world = await mountWorld(FACTS, { routerTools: <RouterTools /> }); await settle();
  await openArchive();
  await recordOn("own-1");
  S.holding = true;
  await act(async () => q<HTMLButtonElement>('.waka-dock-tool--live[aria-label="Stop recording"]')!.click());
  await deliverStops();
  const erase = () => q<HTMLButtonElement>('#waka-note-tools [aria-label="Delete"]');
  expect(erase(), "the note's Delete is gone").toBeTruthy();
  expect(erase()!.disabled, "Delete was offered over a clip still uploading to this note").toBe(true);
  S.holding = false;
  await act(async () => { S.holdFinalize?.(); });
  await settle(4);
  expect(S.finalized).toEqual(["own-1"]);
  expect(erase()!.disabled, "Delete stayed off after the clip landed").toBe(false);
});

/* ═══ THE RECORDING'S CLOCK DOES NOT RE-RENDER HOME (review, 2026-10-22) ═══
   With the recorder in Home, its per-second clock re-rendered the whole of
   Home's world — twelve thousand lines — every second of every recording.
   The ticking state lives in a provider only the archive reads; Home hears
   only what changes rarely (a phase, a failure). */
it("keeps the archive recording's clock from re-rendering Home every second", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  world = await mountWorld(FACTS, { routerTools: <RouterTools /> }); await settle();
  await openArchive();
  await recordOn("own-1");
  const clock = () => q('#waka-note-tools .waka-dock-state span[aria-hidden="true"]')?.textContent;
  const before = renders.home, startedAt = clock();
  for (let second = 0; second < 5; second += 1) {
    await world.step(60);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  }
  expect(clock(), "the clock never ticked, so this proved nothing").not.toBe(startedAt);
  expect(renders.home - before, "Home re-rendered with the recording's clock").toBeLessThan(3);
});

/* ═══ EVERY LANDING COUNTS, NOT ONLY THE LAST (review, 2026-10-22) ═══════
   The recorder kept only the latest landing, so two clips landing in one
   render — the open note's, then another's — left the open note stale: the
   archive only ever saw the second. */
it("re-points the open note when its clip lands in the same render as another note's", async () => {
  world = await mountWorld(FACTS, { routerTools: <RouterTools /> }); await settle();
  await openArchive();
  S.holding = true;
  /* a clip for note A, then one for note B, both still uploading */
  await recordOn("own-1");
  await act(async () => q<HTMLButtonElement>('.waka-dock-tool--live[aria-label="Stop recording"]')!.click());
  await deliverStops();
  await act(async () => q<HTMLButtonElement>('.waka-dock button[aria-label="Back"]')!.click());
  await settle(2);
  await recordOn("own-0");
  await act(async () => q<HTMLButtonElement>('.waka-dock-tool--live[aria-label="Stop recording"]')!.click());
  await deliverStops();
  expect(S.heldFinalizes, "both uploads should be waiting").toHaveLength(2);
  /* back on note A, which does not yet know about its clip */
  await act(async () => q<HTMLButtonElement>('.waka-dock button[aria-label="Back"]')!.click());
  await settle(2);
  const rowA = [...document.querySelectorAll<HTMLButtonElement>(".waka-list-row")].find((item) => item.textContent?.includes("something I kept, 1"))!;
  await act(async () => rowA.click());
  await settle();
  const field = () => q<HTMLTextAreaElement>(".waka-over textarea");
  expect(field()?.placeholder, "note A should not yet know it holds anything").toBeTruthy();
  /* the list read after the landings says note A now holds its clip */
  S.attachedOnRead = "own-1";
  S.holding = false;
  await act(async () => { for (const answer of S.heldFinalizes.splice(0)) answer(); });
  await settle(4);
  expect(S.finalized).toEqual(["own-1", "own-0"]);
  expect(field()?.placeholder, "note A's clip landed and its page was never re-pointed").toBe("");
});
