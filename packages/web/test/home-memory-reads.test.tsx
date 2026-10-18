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
import { apiMockFrom, dataMockFrom, mountWorld, VIEWER_ID, type MountedWorld } from "./helpers/render-home";

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
}));

const row = (id: string, text: string) => {
  const at = Date.UTC(2026, 9, 1);
  return {
    id, preview: text, text, isPublic: false, kind: "note" as const, source: "app" as const, category: null,
    capturedMs: at, updatedMs: at, attachments: [], reflectionCount: 0, reflections: [], conversationOrigin: null,
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
  finalizeAttachment: async () => ({ id: "att-1" }),
  /* the server row, as of WHEN THE READ WAS ASKED, stamped then */
  fetchInspiration: (id: string) => {
    const snapshot = { id, profileId: VIEWER_ID, text: S.store.get(id) ?? "", kind: "note", category: null, source: "app", visibility: "private",
      createdAt: new Date(Date.UTC(2026, 9, 1)).toISOString(), updatedAt: new Date(Date.now() - 60_000).toISOString(), attachments: [], reflections: [] };
    if (!S.holdFetch) return Promise.resolve(snapshot);
    return new Promise((done) => { S.heldFetch = () => done(snapshot); });
  },
  updateInspiration: async (id: string, input: { text: string }) => {
    S.written.push({ id, text: input.text });
    S.store.set(id, input.text);
    /* the server's row, as the PATCH answers it */
    if (S.bareWrites) return undefined;
    return { id, profileId: VIEWER_ID, text: input.text, kind: "note", category: null, source: "app", visibility: "private",
      createdAt: new Date(Date.UTC(2026, 9, 1)).toISOString(), updatedAt: new Date().toISOString(), attachments: [], reflections: [] };
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
  const p = words();
  if (!p) throw new Error("the card is not showing its words");
  await act(async () => p.click());
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

it("a late full read: Opening… and no edit while it is out, then the card takes it", { timeout: 30_000 }, async () => {
  await openByAddress("own-5");
  S.hold = "hold";
  await stepOn();
  await wait(2300); // past the card's two-second wait
  await world.step(4);
  expect(note(), "the card says it is still opening").toBe("Opening…");
  await pressWords();
  expect(editBox(), "an edit cannot begin on words that are not known to be whole").toBeNull();

  await act(async () => S.held.at(-1)!.resolve());
  await world.step(6);
  expect(note(), "the late read landed on the card").toBe("");
  await pressWords();
  expect(editBox()?.value, "and the edit opens on the whole text").toBe("something I kept, 4");
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

it("an archive edit reaches the card, so the card's next edit keeps it (no overwrite)", { timeout: 30_000 }, async () => {
  /* The card stands on own-3; own-2 — the next one along — is already read
     into the world's cache by the time the archive edits it. */
  await openByAddress("own-3");
  await stepOn();
  await wait(100);
  await act(async () => { go("/inspirations/own-3"); });
  await world.step(12);
  const FROM_ARCHIVE = "something I kept, 2 — and then I said more in the archive.";
  /* the archive, over the same world, opening the same note */
  await act(async () => { go("/inspirations/own-3?open=saves"); });
  for (let turn = 0; turn < 30 && !world.container.querySelector(".waka-list-row"); turn += 1) { await world.step(4); await wait(30); }
  const archiveRow = [...world.container.querySelectorAll<HTMLButtonElement>(".waka-list-row")]
    .find((b) => (b.textContent ?? "").includes("something I kept, 2"));
  if (!archiveRow) throw new Error("the archive did not list own-2");
  await act(async () => archiveRow.click());
  for (let turn = 0; turn < 20 && world.container.querySelector<HTMLTextAreaElement>(".waka-note-page")?.readOnly !== false; turn += 1) { await world.step(2); await wait(20); }
  const page = world.container.querySelector<HTMLTextAreaElement>(".waka-note-page")!;
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => { set.call(page, FROM_ARCHIVE); page.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => document.querySelector<HTMLButtonElement>(".waka-dock-tool--keep")!.click());
  await world.step(4);
  expect(S.written).toEqual([{ id: "own-2", text: FROM_ARCHIVE }]);

  /* back to the card, and on to own-2 the way a person walks there: by the
     caret, which opens from the world's cache when it holds the note */
  await act(async () => { go("/inspirations/own-3"); });
  await world.step(12);
  await wait(100);
  await stepOn();
  await wait(100);
  await world.step(6);
  await pressWords();
  expect(editBox()?.value, "the card's edit begins from the archive's words, not its own stale read").toBe(FROM_ARCHIVE);
  await typeAndKeep(`${FROM_ARCHIVE} And on the card.`);
  expect(S.store.get("own-2"), "both edits survive").toBe(`${FROM_ARCHIVE} And on the card.`);
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

it("a read that started before a save cannot put the old words back", { timeout: 30_000 }, async () => {
  const NEWER = "something I kept, 4 — rewritten while an old read was still out.";
  await openByAddress("own-5");
  S.hold = "hold";
  await stepOn(); // the card's read of own-4 goes out, and is held
  const staleRead = S.held.at(-1)!;
  await wait(50);
  /* the archive reads own-4 too (held as well) — release that one — edit, save */
  const page = await openInArchive("/inspirations/own-5", "something I kept, 4", async () => {
    await act(async () => S.held.at(-1)!.resolve());
  });
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => { set.call(page, NEWER); page.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => document.querySelector<HTMLButtonElement>(".waka-dock-tool--keep")!.click());
  await world.step(4);
  expect(S.store.get("own-4")).toBe(NEWER);

  /* now the old read lands, carrying the words from before the save */
  S.hold = null;
  await act(async () => staleRead.resolve());
  await world.step(4);

  /* back on the world, walk to own-4: the card must open on the NEWER words */
  await act(async () => { go("/inspirations/own-5"); });
  await world.step(12);
  await wait(100);
  await stepOn();
  await wait(100);
  await world.step(6);
  await pressWords();
  expect(editBox()?.value, "the stale read was dropped; the save's words stand").toBe(NEWER);
});

it("a note deleted in the archive leaves the field and closes its card", { timeout: 30_000 }, async () => {
  await openByAddress("own-2");
  const before = world.audit().present;
  await openInArchive("/inspirations/own-2", "something I kept, 2");
  await act(async () => document.querySelector<HTMLButtonElement>(".waka-dock-tool--erase")!.click());
  /* leaving the archive sends the delete at once (Undo's moment is the page's) */
  await act(async () => { go("/"); });
  await world.step(12);
  await wait(50);
  await world.step(6);
  expect(S.deleted).toEqual(["own-2"]);
  expect(card(), "the card showing the deleted note closed").toBeNull();
  expect(world.audit().present, "and the field holds one memory fewer").toBe(before - 1);
});

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

it("the archive's re-read after an upload cannot put words older than a later save back", { timeout: 30_000 }, async () => {
  const NEWER = "something I kept, 2 — saved after the upload's re-read went out.";
  await openByAddress("own-3");
  await stepOn(); // own-2 now read into the world's cache
  await wait(100);
  await act(async () => { go("/inspirations/own-3"); });
  await world.step(12);
  const page = await openInArchive("/inspirations/own-3", "something I kept, 2");
  /* attach a file: the archive then re-reads the note — held, so it lands late */
  S.holdFetch = true;
  const input = [...document.querySelectorAll<HTMLInputElement>('nav.waka-dock input[type="file"]')].find((node) => node.accept.includes("application/pdf"))!;
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["%PDF-1.7"], "notes.pdf", { type: "application/pdf" })] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  for (let turn = 0; turn < 20 && !S.heldFetch; turn += 1) { await world.step(2); await wait(10); }
  expect(S.heldFetch, "the archive did not re-read after the upload").not.toBeNull();
  /* then the words are saved */
  await setText(page, NEWER);
  await archiveSave();
  /* and only now does the re-read — with the words from before — land */
  await act(async () => S.heldFetch!());
  await world.step(4);
  await act(async () => { go("/inspirations/own-3"); });
  await world.step(12);
  await wait(100);
  await stepOn();
  await wait(100);
  await world.step(6);
  await pressWords();
  expect(editBox()?.value, "the late re-read was older than the save and was dropped").toBe(NEWER);
});

it("a note brought back from the deleted shelf comes back to the field", { timeout: 30_000 }, async () => {
  await openByAddress("own-2");
  const before = world.audit().present;
  await openInArchive("/inspirations/own-2", "something I kept, 2");
  await act(async () => document.querySelector<HTMLButtonElement>(".waka-dock-tool--erase")!.click());
  await act(async () => { go("/"); });
  await world.step(12);
  await wait(50);
  expect(world.audit().present).toBe(before - 1);
  await act(async () => { go("/?open=saves"); });
  for (let turn = 0; turn < 30 && ![...world.container.querySelectorAll("button")].some((b) => b.textContent === "Deleted"); turn += 1) { await world.step(4); await wait(30); }
  await act(async () => [...world.container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Deleted")!.click());
  await world.step(4);
  await act(async () => world.container.querySelector<HTMLButtonElement>(".waka-shelf-back")!.click());
  for (let turn = 0; turn < 20 && world.audit().present !== before; turn += 1) { await world.step(4); await wait(20); }
  expect(world.audit().present, "restored to the field").toBe(before);
});

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

