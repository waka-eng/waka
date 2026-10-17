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
}));

vi.mock("../src/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/api")>()),
  updateInspiration: async (id: string, patch: { text?: string }) => {
    state.written.push({ id, text: patch.text ?? "" });
    return undefined as never;
  },
}));
vi.mock("../src/lib/data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/data")>()),
  loadInspirations: async () => ({ inspirations: [state.row], total: 1, short: false }),
  /* HELD OPEN until the test answers it, so "before the text arrives" is a
     state the test can stand in rather than a race it hopes to lose. */
  loadInspiration: () => new Promise((done, fail) => {
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

async function openSave(row: Record<string, unknown>, text: string): Promise<void> {
  state.row = row;
  state.text = text;
  await act(async () => root.render(
    <SavesOverlay locale="en-US" title="Your Inspirations" onClose={vi.fn()}
      onNoteOpen={(close) => { closer = close; }} />,
  ));
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
  expect(save()).toBeNull(); // no tool is offered until there is a note to act on
  expect(bar()).toBe("Opening this note…");

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
  expect(bar()).toContain("This note didn’t open. Nothing was changed.");
  await act(async () => closer!());
  expect(state.written).toEqual([]);

  await openSave(longRow, LONG);
  await answer(false);
  const retry = [...slot.querySelectorAll("button")].find((item) => item.textContent === "Try again")!;
  await act(async () => retry.click());
  expect(bar()).toBe("Opening this note…");
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
