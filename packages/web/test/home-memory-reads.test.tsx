// @vitest-environment jsdom
/**
 * ═══ THE MEMORY CARD EDITS ONLY WORDS IT KNOWS ARE WHOLE AND CURRENT ═══════
 *
 * Review, 2026-10-17, of the P0 save-truncation fix. The card on Home and the
 * archive's note page both edit a stored note, and each one's edit is seeded
 * from words it read earlier. These cases pin the four ways those words could
 * be wrong:
 *
 *   - the full read is still in flight after the card's two-second wait
 *     (the card shows "Opening…" and refuses an edit; when the read lands the
 *     card takes it and the edit opens on the whole text);
 *   - the full read failed (the card refuses an edit, says so, and Try again
 *     reads again);
 *   - the archive saved new words the card never heard of (DATA LOSS: the
 *     card's next edit began from the old text and overwrote them).
 *
 * WHAT THIS MOCKS, AND WHY (gate G6).
 *
 * `lib/data` and `lib/api` — the world arrives through the shared builders in
 * `helpers/render-home`, plus a STORE behind `loadInspiration` and
 * `updateInspiration` so a read after a write sees the write, the way the
 * server does. Reads of `own-4` can be HELD (answered when the case says) or
 * made to FAIL, which is how "late" and "failed" become states a case can
 * stand in rather than races it hopes to lose.
 *
 * `lib/auth-context` — a signed-in viewer; the world renders nothing without
 * one. `helpers/canvas-stub` — jsdom has no 2D context. `helpers/render-home`
 * — the mount and the frame loop.
 */
import { act } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { installCanvasStub, setViewport } from "./helpers/canvas-stub";
import { apiMockFrom, barShape, dataMockFrom, mountWorld, pressDockRow, VIEWER_ID, type MountedWorld } from "./helpers/render-home";

const FACTS = {
  inspirations: Array.from({ length: 6 }, (_, i) => ({ id: `own-${i}`, text: `something I kept, ${i}`, daysAgo: i + 1 })),
};

const S = vi.hoisted(() => ({
  store: new Map<string, string>(),
  written: [] as Array<{ id: string; text: string }>,
  hold: null as null | "hold" | "fail",
  held: [] as Array<{ resolve: () => void; reject: () => void }>,
  deleted: [] as string[],
  /* the archive's re-read after an upload, held so it can land late */
  heldFetch: null as null | (() => void),
  holdFetch: false,
  /* a write whose answer carries no row (as a fixture world's does) */
  bareWrites: false,
  shelf: [] as Array<{ id: string; text: string }>,
  holdWrite: false,
  writtenAt: new Map<string, number>(),
  landWrite: null as null | (() => void),
  /* the notes a clip was attached to, and whether the attach fails */
  finalized: [] as string[],
  failFinalize: false,
}));

const row = (id: string, text: string) => {
  const at = Date.UTC(2026, 9, 1);
  return {
    id, preview: text, text, isPublic: false, kind: "note" as const, source: "app" as const, category: null,
    /* the server's updatedAt: when it was last written, as a real server's is */
    capturedMs: at, updatedMs: S.writtenAt.get(id) ?? at, attachments: [], reflectionCount: 0, reflections: [], conversationOrigin: null,
  };
};

vi.mock("../src/lib/api", async (original) => ({
  ...await original<typeof import("../src/lib/api")>(),
  ...apiMockFrom(FACTS),
  deleteInspiration: async (id: string) => {
    S.deleted.push(id);
    S.shelf.push({ id, text: S.store.get(id) ?? "" });
    S.store.delete(id);
  },
  listDeletedInspirations: async () => S.shelf.map((item) => ({ id: item.id, text: item.text, kind: "note", hadPhoto: false,
    createdAt: new Date(Date.UTC(2026, 9, 1)).toISOString(), deletedAt: new Date().toISOString() })),
  restoreInspiration: async (id: string) => {
    const item = S.shelf.find((row) => row.id === id)!;
    S.shelf = S.shelf.filter((row) => row.id !== id);
    S.store.set(id, item.text);
  },
  presignAttachment: async (input: { filename: string }) =>
    ({ uploadUrl: "https://bucket.test/put", key: `k/${input.filename}`, headers: {}, profileId: VIEWER_ID, expiresAt: "" }),
  uploadToPresignedUrl: async () => undefined,
  finalizeAttachment: async (input: { inspirationId?: string }) => {
    if (S.failFinalize) throw new Error("offline");
    S.finalized.push(input.inspirationId ?? "");
    return { id: "att-1" };
  },
  /* the server row, as of WHEN THE READ WAS ASKED, stamped then */
  fetchInspiration: (id: string) => {
    const snapshot = { id, profileId: VIEWER_ID, text: S.store.get(id) ?? "", kind: "note", category: null, source: "app", visibility: "private",
      createdAt: new Date(Date.UTC(2026, 7, 16, 12) - (FACTS.inspirations.find((item) => item.id === id)?.daysAgo ?? 0) * 86_400_000).toISOString(), updatedAt: new Date(Date.now() - 60_000).toISOString(), attachments: [], reflections: [] };
    if (!S.holdFetch) return Promise.resolve(snapshot);
    return new Promise((done) => { S.heldFetch = () => done(snapshot); });
  },
  updateInspiration: async (id: string, input: { text: string }) => {
    S.written.push({ id, text: input.text });
    /* a write the case holds in flight lands only when it says so */
    if (S.holdWrite) await new Promise<void>((land) => { S.landWrite = land; });
    S.store.set(id, input.text);
    const writtenAt = Date.now();
    S.writtenAt.set(id, writtenAt);
    /* the server's row, as the PATCH answers it */
    if (S.bareWrites) return undefined;
    return { id, profileId: VIEWER_ID, text: input.text, kind: "note", category: null, source: "app", visibility: "private",
      createdAt: new Date(Date.UTC(2026, 9, 1)).toISOString(), updatedAt: new Date(writtenAt).toISOString(), attachments: [], reflections: [] };
  },
}));
vi.mock("../src/lib/data", async (original) => ({
  ...await original<typeof import("../src/lib/data")>(),
  ...dataMockFrom(FACTS),
  loadInspiration: (id: string) => {
    /* what was stored WHEN THE READ WAS ASKED — a held read answers with
       that, the way a slow response carries the row it read */
    const snapshot = row(id, S.store.get(id) ?? "");
    if (id !== "own-4" || S.hold === null) return Promise.resolve(snapshot);
    if (S.hold === "fail") return Promise.reject(new Error("offline"));
    return new Promise((done, fail) => {
      S.held.push({ resolve: () => done(snapshot), reject: () => fail(new Error("offline")) });
    });
  },
}));
vi.mock("../src/lib/auth-context", async (original) => {
  const session = { status: "authenticated", account: { id: "account-1", email: "you@example.test" },
    profile: { id: VIEWER_ID, name: "You", type: "human" }, profiles: [], refresh: async () => undefined, signOut: async () => undefined };
  return { ...await original<typeof import("../src/lib/auth-context")>(), useOptionalAuth: () => session, useAuth: () => session };
});

let go: ReturnType<typeof useNavigate>;
let here = "/";
function RouterTools() { go = useNavigate(); const at = useLocation(); here = at.pathname; return null; }

let world: MountedWorld;
beforeAll(() => {
  installCanvasStub();
  setViewport(1280, 900);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  window.localStorage.clear();
  S.store = new Map(FACTS.inspirations.map((item) => [item.id, item.text]));
  S.written.length = 0;
  S.hold = null;
  S.held.length = 0;
  S.deleted.length = 0;
  S.heldFetch = null;
  S.holdFetch = false;
  S.bareWrites = false;
  S.shelf = [];
  S.holdWrite = false;
  S.landWrite = null;
  S.writtenAt = new Map();
  S.finalized = [];
  S.failFinalize = false;
});
afterEach(() => world?.unmount());

const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const card = () => world.container.querySelector<HTMLElement>(".jar-panel--in");
const words = () => card()?.querySelector<HTMLElement>("p.jar-panel-text") ?? null;
const editBox = () => card()?.querySelector<HTMLTextAreaElement>("textarea.jar-panel-edit") ?? null;
const note = () => card()?.querySelector(".jar-panel-note")?.textContent ?? "";

async function openByAddress(id: string): Promise<void> {
  world = await mountWorld(FACTS, { initialEntries: [`/inspirations/${id}`], routerTools: <RouterTools /> });
  for (let turn = 0; turn < 40 && !card(); turn += 1) { await world.step(10); await wait(90); }
  if (!card()) throw new Error(`the address of ${id} opened no memory`);
  await world.step(12);
}
/** Step to the next memory with the card's own caret — the panel effect's path. */
async function stepOn(): Promise<void> {
  const next = [...world.container.querySelectorAll<HTMLElement>(".jar-panel-foot-c button")]
    .find((b) => /after this one/.test(b.getAttribute("aria-label") ?? ""));
  if (!next) throw new Error("the card offers no way on");
  await act(async () => next.click());
  await world.step(10);
}
async function pressWords(): Promise<void> {
  /* Coming back from the archive re-applies the address on timers; under a
     loaded full run the card can be a few frames behind (it failed once in
     CI that way while passing alone). Wait for it, within a bound. */
  for (let turn = 0; turn < 30 && !words(); turn += 1) { await world.step(4); await wait(30); }
  const p = words();
  if (!p) throw new Error("the card is not showing its words");
  await act(async () => p.click());
  /* every edit reads the note fresh before it opens: give that read its turn */
  for (let turn = 0; turn < 10 && !editBox() && !note(); turn += 1) { await world.step(2); await wait(10); }
  for (let turn = 0; turn < 20 && !editBox() && note() === "Opening…" && S.hold !== "hold"; turn += 1) { await world.step(2); await wait(10); }
}
async function typeAndKeep(text: string): Promise<void> {
  const box = editBox()!;
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => { set.call(box, text); box.dispatchEvent(new Event("input", { bubbles: true })); });
  const keep = [...card()!.querySelectorAll<HTMLElement>(".jar-panel-foot-c button")].find((b) => /^save$/i.test((b.textContent ?? "").trim()))!;
  await act(async () => keep.click());
  await world.step(10);
  await act(async () => { box.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  await world.step(4);
}

it("a slow full read: Couldn't load the rest and no edit at two seconds; Try again opens it", { timeout: 30_000 }, async () => {
  await openByAddress("own-5");
  S.hold = "hold";
  await stepOn();
  await wait(2300); // past the card's two-second wait
  await world.step(4);
  expect(note(), "the card says the rest did not load, with a way to ask again").toContain("Couldn’t load the rest.");
  await pressWords();
  expect(editBox(), "an edit is never seeded from the preview").toBeNull();

  /* the first read's late answer is ignored once the fallback has fired
     (dev's rule) — Try again is the way on */
  await act(async () => S.held.at(-1)!.resolve());
  await world.step(6);
  expect(note(), "a late first answer does not land").toContain("Couldn’t load the rest.");
  S.hold = null;
  await act(async () => card()!.querySelector<HTMLButtonElement>(".jar-panel-retry")!.click());
  for (let turn = 0; turn < 10 && note() !== ""; turn += 1) { await world.step(2); await wait(10); }
  expect(note(), "Try again brought the full text").toBe("");
  /* INSIDE THE TAP: no network between the press and the editor, so a
     phone raises its keyboard and the caret lands where the finger did */
  await act(async () => words()!.click());
  expect(editBox()?.value, "and the edit opens at once on the whole text").toBe("something I kept, 4");
});

/* TRY AGAIN ASKS AGAIN (review, 2026-10-18). Reads in flight are shared, so
   a first read that hung used to answer every Try again too. */
it("Try again sends a fresh request even while the first read still hangs", { timeout: 30_000 }, async () => {
  await openByAddress("own-5");
  S.hold = "hold";
  await stepOn();
  await wait(2300);
  await world.step(4);
  const before = S.held.length;
  await act(async () => card()!.querySelector<HTMLButtonElement>(".jar-panel-retry")!.click());
  await world.step(4);
  expect(S.held.length, "a new request went out").toBe(before + 1);
  await act(async () => S.held.at(-1)!.resolve());
  await world.step(6);
  expect(note()).toBe("");
  expect(words()?.textContent).toContain("something I kept, 4");
});

it("a failed full read: no edit, Couldn't load the rest, and Try again reads again", { timeout: 30_000 }, async () => {
  await openByAddress("own-5");
  S.hold = "fail";
  await stepOn();
  await wait(300);
  await world.step(4);
  expect(note()).toContain("Couldn’t load the rest.");
  await pressWords();
  expect(editBox(), "a partial card is not editable").toBeNull();

  S.hold = null;
  const retry = card()!.querySelector<HTMLButtonElement>(".jar-panel-retry");
  expect(retry?.textContent).toBe("Try again");
  await act(async () => retry!.click());
  await world.step(6);
  expect(note()).toBe("");
  await pressWords();
  expect(editBox()?.value).toBe("something I kept, 4");
});

/** Open the archive over the world, open one note in it, and wait for its full read. */
async function openInArchive(path: string, words: string, release?: () => Promise<void>): Promise<HTMLTextAreaElement> {
  await act(async () => { go(`${path}?open=saves`); });
  for (let turn = 0; turn < 30 && !world.container.querySelector(".waka-list-row"); turn += 1) { await world.step(4); await wait(30); }
  const archiveRow = [...world.container.querySelectorAll<HTMLButtonElement>(".waka-list-row")]
    .find((b) => (b.textContent ?? "").includes(words));
  if (!archiveRow) throw new Error(`the archive did not list "${words}"`);
  await act(async () => archiveRow.click());
  if (release) await release();
  for (let turn = 0; turn < 20 && world.container.querySelector<HTMLTextAreaElement>(".waka-note-page")?.readOnly !== false; turn += 1) { await world.step(2); await wait(20); }
  return world.container.querySelector<HTMLTextAreaElement>(".waka-note-page")!;
}

/* The card has no way to attach anything, so its empty editor must not tell
   people to add a photo or a file — only to write. */
it("tells an emptied memory card to write something, and offers nothing it cannot do", { timeout: 30_000 }, async () => {
  await openByAddress("own-2");
  await pressWords();
  const box = editBox()!;
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => { set.call(box, ""); box.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(box.placeholder).toBe("Write something to keep this memory.");
  expect(card()!.querySelector<HTMLButtonElement>(".jar-panel-save")!.disabled, "and Save stays dim").toBe(true);
});

const setText = async (box: HTMLTextAreaElement, text: string) => {
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => { set.call(box, text); box.dispatchEvent(new Event("input", { bubbles: true })); });
};
const archiveSave = async () => {
  await act(async () => document.querySelector<HTMLButtonElement>(".waka-dock-tool--keep")!.click());
  await world.step(4);
};


/* AN ARCHIVE SAVE NEVER LANDS ON AN OPEN CARD EDIT. Opening the archive
   ends the card's edit, so the archive's words cannot be overwritten by a
   card draft that began before them — and the card's next edit starts from
   them. (Home also guards the case in code — rebase an untouched draft, ask
   on a changed one — in case another door ever saves while the card is
   editing; this pins that today no door does.) */
it("an archive save of a note the card was editing: the edit is closed first, and the next one starts from the archive's words", { timeout: 30_000 }, async () => {
  const FROM_ARCHIVE = "something I kept, 2 — from the archive.";
  await openByAddress("own-2");
  await pressWords();
  expect(editBox(), "the card's edit is open").not.toBeNull();
  const path = here;
  const page = await openInArchive(path, "something I kept, 2");
  expect(editBox(), "opening the archive closed the card's edit").toBeNull();
  await setText(page, FROM_ARCHIVE);
  await archiveSave();
  await act(async () => { go(path); });
  await world.step(8);
  await pressWords();
  expect(editBox()?.value).toBe(FROM_ARCHIVE);
});


/* AN ADDRESS THAT CANNOT BE READ FRESH OPENS NOTHING EDITABLE (review,
   2026-10-17). The address now reads through the one rule; when that rule
   has no fresh words to give, no card opens on stale ones. */
it("opening a memory by its address when no fresh read can be had opens no editable card", { timeout: 30_000 }, async () => {
  S.hold = "fail";
  world = await mountWorld(FACTS, { initialEntries: ["/inspirations/own-4"], routerTools: <RouterTools /> });
  for (let turn = 0; turn < 15; turn += 1) { await world.step(10); await wait(60); }
  expect(card(), "no card opened on words it could not read").toBeNull();
  expect(editBox()).toBeNull();
});

/* ONE CURRENT REQUEST PER PANEL (review, 2026-10-18). Once Try again has
   brought the words, the first read's late answer — older, or failed — is
   never applied over them. */
async function partialThenRetry(): Promise<{ first: (typeof S.held)[number] }> {
  await openByAddress("own-5");
  S.hold = "hold";
  await stepOn();
  await wait(2300);
  await world.step(4);
  const first = S.held.at(-1)!;
  S.store.set("own-4", "something I kept, 4 — as the retry read it.");
  await act(async () => card()!.querySelector<HTMLButtonElement>(".jar-panel-retry")!.click());
  await world.step(4);
  await act(async () => S.held.at(-1)!.resolve());
  await world.step(6);
  expect(words()?.textContent).toContain("as the retry read it");
  return { first };
}

it("a late first answer after a successful Try again is ignored", { timeout: 30_000 }, async () => {
  const { first } = await partialThenRetry();
  await act(async () => first.resolve()); // the words from before
  await world.step(6);
  expect(words()?.textContent, "the retry's words stay").toContain("as the retry read it");
});

it("a failure arriving after the full text is on the card leaves it editable, with no failure line", { timeout: 30_000 }, async () => {
  const { first } = await partialThenRetry();
  await act(async () => first.reject());
  await world.step(6);
  expect(note(), "no Couldn't load the rest over a full card").toBe("");
  await act(async () => words()!.click());
  expect(editBox()?.value).toBe("something I kept, 4 — as the retry read it.");
});

it("a save between Try again and a late answer: the kept words stay and seed the next edit", { timeout: 30_000 }, async () => {
  const KEPT = "something I kept, 4 — kept on the card.";
  const { first } = await partialThenRetry();
  S.hold = null;
  await act(async () => words()!.click());
  await typeAndKeep(KEPT);
  await act(async () => first.resolve()); // older than the save
  await world.step(6);
  expect(words()?.textContent, "the kept words stay").toContain("kept on the card");
  await act(async () => words()!.click());
  expect(editBox()?.value, "and seed the next edit").toBe(KEPT);
});


/* ═══ THE CARD DOES NOT LET GO OF UNSAVED WORDS (L11, L13) ═══════════════
   `docs/plans/card-and-archive.md`, rule 1. A press that would take Home
   off a card holding changed words (or a save still out) is not made; the
   card says so, and its own Save and Cancel are the way on. Nothing waits:
   the press either goes through inside the tap or does not happen. */
const held = () => card()?.querySelector(".jar-panel-warn")?.textContent ?? "";
const pressBar = async (label: string) => {
  await pressDockRow(world.container, label);
  for (let turn = 0; turn < 6; turn += 1) { await world.step(4); await wait(20); }
};

it("a bar press over a card holding changed words is refused, says why, and goes through once the edit is cancelled", { timeout: 30_000 }, async () => {
  await openByAddress("own-2");
  await pressWords();
  await setText(editBox()!, "something I kept, 2 — typed and not saved.");
  await pressBar("Inspiration");
  expect(editBox()?.value, "the typed words are still on the card").toBe("something I kept, 2 — typed and not saved.");
  expect(held()).toBe("Save or cancel this edit first.");
  expect(barShape(world.container), "no new note opened").toEqual(["Inspiration", "Chat"]);
  expect(S.written).toEqual([]);
  await act(async () => [...card()!.querySelectorAll<HTMLButtonElement>(".jar-panel-foot-r button")].find((b) => /cancel edit/i.test(b.textContent ?? ""))!.click());
  await pressBar("Inspiration");
  expect(barShape(world.container), "the press goes through now").toContain("All inspirations");
});

it("a bar press while the card's save is still out is refused until the save lands", { timeout: 30_000 }, async () => {
  await openByAddress("own-2");
  await pressWords();
  S.holdWrite = true;
  await setText(editBox()!, "something I kept, 2 — saving.");
  await act(async () => card()!.querySelector<HTMLButtonElement>(".jar-panel-save")!.click());
  await world.step(4);
  await pressBar("Inspiration");
  expect(editBox(), "the edit is still open while its save is out").not.toBeNull();
  expect(barShape(world.container)).toEqual(["Inspiration", "Chat"]);
  await act(async () => S.landWrite!());
  await world.step(6);
  await pressBar("Inspiration");
  expect(S.store.get("own-2")).toBe("something I kept, 2 — saving.");
  expect(barShape(world.container), "the press goes through once it is saved").toContain("All inspirations");
});

it("a bar press over a card edit with unchanged words goes through as before", { timeout: 30_000 }, async () => {
  await openByAddress("own-2");
  await pressWords();
  await pressBar("Inspiration");
  expect(barShape(world.container)).toContain("All inspirations");
});


/* ═══ CLOSING THE ARCHIVE MID-RECORDING KEEPS THE CLIP (L12) ═════════════
   `docs/plans/card-and-archive.md`, rule 3. Close stops the recording and
   waits for the clip to be attached to the note it was made on; when that
   upload fails the archive stays on the note and says so.

   WHAT THIS MOCKS, AND WHY (gate G6): `MediaRecorder` and
   `navigator.mediaDevices` stand in for a microphone jsdom does not have —
   the recorder emits one chunk when stopped, as a real one does. */
class StubRecorder {
  static isTypeSupported(): boolean { return true; }
  state = "inactive";
  mimeType: string;
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => Promise<void>;
  onerror?: () => void;
  constructor(_stream: MediaStream, options: { mimeType: string }) { this.mimeType = options.mimeType; }
  start(): void { this.state = "recording"; }
  /* a browser's recorder hands over its last chunk and `stop` in a LATER
     task, not inside the call — which is what lets an unmount get between */
  stop(): void {
    this.state = "inactive";
    setTimeout(() => {
      this.ondataavailable?.({ data: new Blob(["fixture audio"], { type: this.mimeType }) });
      void this.onstop?.();
    }, 0);
  }
}
async function recordInArchive(): Promise<void> {
  (globalThis as unknown as { MediaRecorder?: unknown }).MediaRecorder = StubRecorder;
  Object.defineProperty(navigator, "mediaDevices", { configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {}, addEventListener() {}, removeEventListener() {} }] }) } });
  await openByAddress("own-3");
  await openInArchive(here, "something I kept, 3");
  const record = document.querySelector<HTMLButtonElement>('#waka-note-tools button[aria-label="Record"]');
  if (!record) throw new Error("the open note offers no Record");
  await act(async () => record.click());
  for (let turn = 0; turn < 4; turn += 1) { await world.step(2); await wait(10); }
  expect(document.querySelector('button[aria-label="Stop recording"]'), "a recording is running").not.toBeNull();
}
const archiveOpen = () => Boolean(world.container.querySelector(".waka-over[data-jar-surface]"));
const pressClose = async () => {
  await act(async () => document.querySelector<HTMLButtonElement>(".waka-dock-item--close")!.click());
  for (let turn = 0; turn < 10; turn += 1) { await world.step(4); await wait(20); }
};
afterEach(() => {
  delete (globalThis as unknown as { MediaRecorder?: unknown }).MediaRecorder;
  delete (navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
});

it("closing the archive while recording attaches the clip to its note, then closes", { timeout: 30_000 }, async () => {
  await recordInArchive();
  await pressClose();
  expect(S.finalized, "the clip went onto the note it was recorded on").toEqual(["own-3"]);
  expect(archiveOpen(), "and the archive closed").toBe(false);
});

it("closing the archive while recording, when the upload fails, stays on the note and says so", { timeout: 30_000 }, async () => {
  S.failFinalize = true;
  await recordInArchive();
  await pressClose();
  expect(archiveOpen(), "the archive stayed").toBe(true);
  expect(world.container.querySelector<HTMLTextAreaElement>(".waka-note-page"), "on the note").not.toBeNull();
  expect(document.body.textContent).toContain("Couldn’t upload this attachment.");
  await pressClose();
  expect(archiveOpen(), "a second Close, with nothing recording, closes").toBe(false);
});
