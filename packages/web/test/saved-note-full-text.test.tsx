// @vitest-environment jsdom
/**
 * ═══ AN OPENED SAVE IS EDITED FROM ITS WHOLE TEXT, NEVER FROM ITS PREVIEW ════
 *
 * P0, 2026-10-17: editing a long save from All inspirations destroyed the rest
 * of it. The archive's rows come from the LIST read, whose `textPreview` the
 * server cuts at 220 characters and ends with "…" (and which, for a save with
 * no words, is an attachment label such as "Photo"). `SavesOverlay` seeded its
 * editor with that preview and PATCHed it back — so one typed word turned a
 * 1,000-character save into 220 characters and the word.
 *
 * These cases pin the fix: the editor waits for the detail read, is read-only
 * until it lands, never writes when it fails, and writes the WHOLE text plus
 * the edit when it succeeds — through the explicit Save and through the
 * autosave on the way out.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). `lib/data` (where rows enter — the list row and the detail read are
 * fixtures here, with the detail read held open so the loading frame is
 * observable); `lib/api`, spread through with only `updateInspiration` (the
 * write under test) swapped to record what would be sent; and `URL`, a piece
 * of browser jsdom lacks the blob half of. The real `SavesOverlay`,
 * `NoteTools` and `keep-ready.ts` run.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { DOCK_SLOT } from "../src/components/NoteTools";
import { SavesOverlay } from "../src/components/SavesOverlay";

const LONG = Array.from({ length: 40 }, (_, i) => `line ${String(i).padStart(2, "0")} of a long thought.`).join(" ").slice(0, 1000);
const state = vi.hoisted(() => ({
  row: null as null | Record<string, unknown>,
  text: "",
  written: [] as Array<{ id: string; text: string }>,
  reads: [] as Array<{ resolve: () => void; reject: () => void }>,
  /* whose profile each read, write and delete named */
  profiles: [] as Array<{ act: string; profile?: string }>,
  saved: [] as Array<{ id: string; text: string }>,
  failUpload: false,
  holdUpload: false,
  /* rows listed after the one under test */
  more: [] as Array<Record<string, unknown>>,
}));

vi.mock("../src/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/api")>()),
  updateInspiration: async (id: string, patch: { text?: string }, options: { profile?: string } = {}) => {
    state.written.push({ id, text: patch.text ?? "" });
    state.profiles.push({ act: "write", profile: options.profile });
    /* the server's row, as the PATCH answers it */
    return { id, text: patch.text ?? "", attachments: [], reflections: [] } as never;
  },
  deleteInspiration: async (_id: string, options: { profile?: string } = {}) => {
    state.profiles.push({ act: "delete", profile: options.profile });
  },
  /* an attachment's three network steps, and the row read after it */
  presignAttachment: async (input: { filename: string; contentType: string }) =>
    ({ uploadUrl: "https://bucket.test/put", key: `k/${input.filename}`, headers: {}, profileId: "p", expiresAt: "" }) as never,
  uploadToPresignedUrl: async () => undefined,
  finalizeAttachment: async () => {
    if (state.holdUpload) await new Promise(() => {});
    if (state.failUpload) throw new Error("upload refused");
    return { id: "att-1" } as never;
  },
  fetchInspiration: async (id: string) =>
    ({ id, text: state.text, attachments: [{ id: "att-1", type: "file", name: "notes.pdf", url: "" }], reflections: [] }) as never,
}));
vi.mock("../src/lib/data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/data")>()),
  loadInspirations: async () => ({ inspirations: [...state.more, state.row], total: 1 + state.more.length, short: false }),
  /* HELD OPEN until the test answers it, so "before the text arrives" is a
     state the test can stand in rather than a race it hopes to lose. */
  loadInspiration: (_id: string, profile?: string) => new Promise((done, fail) => {
    state.profiles.push({ act: "read", profile });
    state.reads.push({
      resolve: () => done({ ...state.row, text: state.text, reflections: [] }),
      reject: () => fail(new Error("offline")),
    });
  }),
}));

let host: HTMLDivElement, root: Root, slot: HTMLSpanElement;
let closer: (() => void) | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.written.length = 0;
  state.reads.length = 0;
  state.profiles.length = 0;
  state.saved.length = 0;
  state.failUpload = false;
  state.holdUpload = false;
  state.more = [];
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL(): string { return "blob:x"; }
    static revokeObjectURL(): void {}
  });
  slot = document.createElement("span");
  slot.id = DOCK_SLOT;
  document.body.append(slot);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  slot.remove();
  vi.unstubAllGlobals();
});

type World = { profileId?: string; ownArchive?: boolean; readFull?: (id: string) => Promise<never>; onAttached?: (id: string) => void };
/** The archive as Home renders it: every callback a NEW inline function on
    every render, exactly as Home passes them. */
async function renderArchive(whose: World = {}): Promise<void> {
  await act(async () => root.render(
    <SavesOverlay locale="en-US" title="Your Inspirations" onClose={vi.fn()}
      profileId={whose.profileId} ownArchive={whose.ownArchive}
      onSaved={(made) => { state.saved.push({ id: made.id, text: made.text }); }}
      onErased={() => undefined}
      readFull={whose.readFull} onAttached={whose.onAttached}
      onNoteOpen={(close) => { closer = close; }} />,
  ));
}
async function openSave(row: Record<string, unknown>, text: string, whose: World = {}): Promise<void> {
  state.row = row;
  state.text = text;
  await renderArchive(whose);
  for (let turn = 0; turn < 12 && !host.querySelector(".waka-list-row"); turn += 1) {
    await act(async () => { await Promise.resolve(); });
  }
  await act(async () => host.querySelector<HTMLButtonElement>(".waka-list-row")!.click());
}
const page = (): HTMLTextAreaElement => host.querySelector<HTMLTextAreaElement>(".waka-note-page")!;
const save = (): HTMLButtonElement => slot.querySelector<HTMLButtonElement>(".waka-dock-tool--keep")!; // null while unread
const bar = (): string => slot.querySelector(".waka-dock-state")?.textContent ?? "";
async function answer(ok: boolean): Promise<void> {
  await act(async () => { const read = state.reads.at(-1)!; if (ok) read.resolve(); else read.reject(); });
}
async function type(text: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(page(), text);
    page().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const longRow = {
  id: "long-1",
  /* exactly what `buildTextPreview` sends for a long save: 219 characters and an ellipsis */
  preview: `${LONG.slice(0, 219).trimEnd()}…`,
  capturedMs: Date.UTC(2026, 9, 8),
  category: null,
  attachments: [],
};

it("keeps all 1,000 characters through open → edit → Save", async () => {
  expect(LONG).toHaveLength(1000);
  await openSave(longRow, LONG);
  /* Before the text arrives: the preview stands in, read-only, nothing can be saved. */
  expect(page().readOnly).toBe(true);
  expect(save()).toBeNull(); // no making tool is offered until there is a note to act on
  expect(bar()).toBe("Opening…");
  expect(slot.querySelector('[aria-label="Delete"]'), "Delete needs only the id").not.toBeNull();

  await answer(true);
  expect(page().readOnly).toBe(false);
  expect(page().value).toBe(LONG);
  expect(bar()).toBe("");

  await type(`${LONG} And one more sentence.`);
  expect(save().disabled).toBe(false);
  await act(async () => save().click());
  expect(state.written).toEqual([{ id: "long-1", text: `${LONG} And one more sentence.` }]);
  expect(state.written[0].text).not.toContain("…");
  /* Saved: the button dims against what is now stored, not the old preview. */
  expect(save().disabled).toBe(true);
});

it("keeps all 1,000 characters through the autosave on the way out", async () => {
  await openSave(longRow, LONG);
  await answer(true);
  await type(`Preface. ${LONG}`);
  await act(async () => closer!());
  expect(state.written).toEqual([{ id: "long-1", text: `Preface. ${LONG}` }]);
});

it("writes nothing while the full text is still on its way, even on the way out", async () => {
  await openSave(longRow, LONG);
  await type("typed too early");
  await act(async () => closer!());
  expect(state.written).toEqual([]);
});

it("stays read-only and never saves when the read fails, and Try again recovers", async () => {
  await openSave(longRow, LONG);
  await answer(false);
  expect(page().readOnly).toBe(true);
  expect(save()).toBeNull();
  expect(bar()).toBe("Didn’t open.");
  /* The alert holds the sentence only; Try again is its own control beside
     it, and Delete is still offered — it needs nothing but the id. */
  const alert = slot.querySelector('[role="alert"]')!;
  expect(alert.querySelector("button")).toBeNull();
  const again = [...slot.querySelectorAll("button")].find((item) => item.textContent === "Try again");
  expect(again?.className).toContain("waka-dock-item");
  expect(slot.querySelector('[aria-label="Delete"]')).not.toBeNull();
  await act(async () => closer!());
  expect(state.written).toEqual([]);

  await openSave(longRow, LONG);
  await answer(false);
  const retry = [...slot.querySelectorAll("button")].find((item) => item.textContent === "Try again")!;
  await act(async () => retry.click());
  expect(bar()).toBe("Opening…");
  await answer(true);
  expect(page().value).toBe(LONG);
  expect(page().readOnly).toBe(false);
});

it("does not pick the attachment's label up into a photo-only save's text", async () => {
  await openSave({
    id: "photo-1",
    preview: "Photo",
    capturedMs: Date.UTC(2026, 9, 8),
    category: null,
    attachments: [{ id: "a1", type: "image", label: "IMG_0001.jpg" }],
  }, "");
  await answer(true);
  expect(page().value).toBe("");
  await type("the light on the wall");
  await act(async () => save().click());
  expect(state.written).toEqual([{ id: "photo-1", text: "the light on the wall" }]);
});

it("keeps a photo-only note's cleared words as a real edit", async () => {
  await openSave({
    id: "photo-2",
    preview: "words beside a photo",
    capturedMs: Date.UTC(2026, 9, 8),
    category: null,
    attachments: [{ id: "a2", type: "image", label: "IMG_0002.jpg" }],
  }, "words beside a photo");
  await answer(true);
  await type("");
  expect(save().disabled).toBe(false);
  await act(async () => save().click());
  expect(state.written).toEqual([{ id: "photo-2", text: "" }]);
});

it("will not empty a note that has nothing else on it, and says why on the page", async () => {
  await openSave(longRow, LONG);
  await answer(true);
  await type("   ");
  expect(save().disabled).toBe(true);
  expect(page().placeholder).toBe("Write something, or add a photo or file, to keep this note.");
  await act(async () => closer!());
  expect(state.written).toEqual([]);
});

it("on an agent's archive, writes and deletes name the same profile the read did", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    state.more = [{ ...longRow, id: "older-1", preview: "an older note stays" }];
    await openSave(longRow, LONG, { profileId: "agent-7", ownArchive: false });
    await answer(true);
    await type(`${LONG} By the agent.`);
    await act(async () => save().click());
    expect(state.profiles.filter((item) => item.act !== "delete")).toEqual([
      { act: "read", profile: "agent-7" },
      { act: "write", profile: "agent-7" },
    ]);
    /* an agent's archive asks before it deletes, then sends at once */
    const del = () => slot.querySelector<HTMLButtonElement>(".waka-dock-tool--erase")!;
    await act(async () => del().click());
    expect(document.activeElement?.getAttribute("aria-label"), "an armed delete puts focus on its confirmation").toBe("Delete it anyway");
    await act(async () => del().click());
    expect(document.activeElement?.matches(".waka-list-row, .waka-over-search"), "and after it, focus goes to the list it returns to").toBe(true);
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(state.profiles.filter((item) => item.act === "delete")).toEqual([{ act: "delete", profile: "agent-7" }]);
  } finally {
    vi.useRealTimers();
  }
});

it("tells the world behind it what was stored, with the server's row", async () => {
  await openSave(longRow, LONG);
  await answer(true);
  await type(`${LONG} Told.`);
  await act(async () => save().click());
  expect(state.saved).toEqual([{ id: "long-1", text: `${LONG} Told.` }]);
});

/* THE ⋯ MENU (narrow phones fold Share and Delete into it). Rendered at
   every width — the stylesheet chooses which shape shows — so its keyboard
   and pointer rules are testable here; they are `lib/use-dock-menu.ts`'s,
   shared with the ＋. */
it("folds Share and Delete into a More menu with the bar's menu keys", async () => {
  await openSave(longRow, LONG);
  await answer(true);
  await type(`${LONG} so there is something to share`);
  const more = slot.querySelector<HTMLButtonElement>('[aria-label="More"]')!;
  expect(more.getAttribute("aria-haspopup")).toBe("menu");
  await act(async () => more.click());
  const rows = () => [...slot.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  expect(rows().map((row) => row.textContent)).toEqual(["Share this inspiration", "Delete"]);
  expect(document.activeElement, "focus moves into the menu").toBe(rows()[0]);
  const key = async (name: string) => act(async () => {
    (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
  });
  await key("ArrowDown"); expect(document.activeElement).toBe(rows()[1]);
  await key("ArrowDown"); expect(document.activeElement, "the arrows wrap").toBe(rows()[0]);
  await key("End"); expect(document.activeElement).toBe(rows()[1]);
  await key("Home"); expect(document.activeElement).toBe(rows()[0]);
  await key("ArrowUp"); expect(document.activeElement).toBe(rows()[1]);
  await key("Escape");
  expect(rows(), "Escape closes it").toEqual([]);
  expect(document.activeElement, "and gives focus back to the button").toBe(more);

  await act(async () => more.click());
  await act(async () => { document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
  expect(rows(), "a press outside closes it").toEqual([]);

  await act(async () => more.click());
  await act(async () => rows()[1]!.click());
  expect(host.querySelector(".waka-note-page"), "its Delete row deletes the note").toBeNull();
  expect(document.activeElement?.textContent, "and focus lands on the Undo line, not the page body").toBe("Undo");
});

it("tells the world behind it when an attachment lands, with the server's row", async () => {
  await openSave(longRow, LONG);
  await answer(true);
  const input = [...slot.querySelectorAll<HTMLInputElement>('input[type="file"]')].find((node) => node.accept.includes("application/pdf"))!;
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["%PDF-1.7"], "notes.pdf", { type: "application/pdf" })] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  for (let turn = 0; turn < 10 && state.saved.length === 0; turn += 1) await act(async () => { await Promise.resolve(); });
  expect(state.saved).toEqual([{ id: "long-1", text: LONG }]);
});

it("does not carry one note's upload failure onto the next note opened", async () => {
  await openSave(longRow, LONG);
  await answer(true);
  state.failUpload = true;
  const input = [...slot.querySelectorAll<HTMLInputElement>('input[type="file"]')].find((node) => node.accept.includes("application/pdf"))!;
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["%PDF-1.7"], "notes.pdf", { type: "application/pdf" })] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  for (let turn = 0; turn < 10 && !bar(); turn += 1) await act(async () => { await Promise.resolve(); });
  expect(bar(), "the failure is said on the note it happened to").toContain("upload");
  await act(async () => closer!());
  await act(async () => host.querySelector<HTMLButtonElement>(".waka-list-row")!.click());
  await answer(true);
  expect(bar(), "and not on the next note opened").toBe("");
});

/* HOME RE-RENDERS BEHIND THE ARCHIVE ALL THE TIME, and its callbacks are new
   functions each time. They once rebuilt the delete's flush, whose cleanup
   ran — and FLUSHED the pending delete — on every one, so the six-second
   Undo was gone the moment anything behind the archive moved. */
it("keeps a delete undoable while the world behind re-renders", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    await openSave(longRow, LONG);
    await answer(true);
    await act(async () => slot.querySelector<HTMLButtonElement>(".waka-dock-tool--erase")!.click());
    for (let turn = 0; turn < 3; turn += 1) await renderArchive();
    await act(async () => { vi.advanceTimersByTime(1_000); });
    expect(state.profiles.filter((item) => item.act === "delete"), "no delete sent while Undo still stands").toEqual([]);
    const undo = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Undo");
    expect(undo, "Undo is still offered").toBeTruthy();
    await act(async () => undo!.click());
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(state.profiles.filter((item) => item.act === "delete"), "and Undo meant it: nothing was ever sent").toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});

it("opens a note through the world's stamped read when the world offers one", async () => {
  const SAVED_ON_THE_CARD = `${LONG} (saved on the card a moment ago)`;
  await openSave(longRow, LONG, { readFull: async (id) => ({ ...longRow, id, text: SAVED_ON_THE_CARD, reflections: [] }) as never });
  for (let turn = 0; turn < 5 && page().readOnly; turn += 1) await act(async () => { await Promise.resolve(); });
  expect(page().value).toBe(SAVED_ON_THE_CARD);
  expect(state.reads, "the archive did not read for itself").toHaveLength(0);
});

it("tells the world an attachment landed, so it re-reads through its own stamps", async () => {
  const attached: string[] = [];
  await openSave(longRow, LONG, { onAttached: (id) => { attached.push(id); } });
  await answer(true);
  const input = [...slot.querySelectorAll<HTMLInputElement>('input[type="file"]')].find((node) => node.accept.includes("application/pdf"))!;
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["%PDF-1.7"], "notes.pdf", { type: "application/pdf" })] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  for (let turn = 0; turn < 10 && attached.length === 0; turn += 1) await act(async () => { await Promise.resolve(); });
  expect(attached).toEqual(["long-1"]);
  expect(state.saved, "and does not hand it a row of its own").toEqual([]);
});

/* AN UPLOAD IS ITS NOTE'S (review, 2026-10-17). A clip can finish uploading
   to the note it was made on after that note is left; the next note opened
   must not say "Uploading…" or have its tools held by it. */
it("keeps one note's upload off another note's bar", async () => {
  state.more = [{ ...longRow, id: "older-1", preview: "an older note" }];
  await openSave(longRow, LONG);
  await answer(true);
  state.holdUpload = true;
  const input = [...slot.querySelectorAll<HTMLInputElement>('input[type="file"]')].find((node) => node.accept.includes("application/pdf"))!;
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["%PDF-1.7"], "notes.pdf", { type: "application/pdf" })] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  for (let turn = 0; turn < 10 && bar() !== "Uploading…"; turn += 1) await act(async () => { await Promise.resolve(); });
  expect(bar(), "the upload is said on its own note").toBe("Uploading…");
  await act(async () => closer!());
  const other = [...host.querySelectorAll<HTMLButtonElement>(".waka-list-row")].find((b) => (b.textContent ?? "").includes("an older note"))!;
  await act(async () => other.click());
  await answer(true);
  expect(bar(), "and not on the next note").toBe("");
  expect(slot.querySelector<HTMLButtonElement>('[aria-label="Add photo or file"]')?.disabled, "whose tools it does not hold").toBe(false);
});
