// @vitest-environment jsdom
/**
 * ═══ ONE SAVE RULE, ON BOTH OF THE PAGES THAT ARE ONE PAGE ══════════════════
 *
 * Founder, having opened a saved inspiration beside a new one: *"just make sure
 * that when I'm entering from create new inspiration or my past inspiration,
 * it's using the exact same component."*
 *
 * `test/one-note.test.tsx` holds the CHROME to that ruling — same parts, same
 * places, same order. This file holds the BAR, which is where the acts are, and
 * which was two implementations of one control.
 *
 * ── WHAT WAS WRONG, PRECISELY ──────────────────────────────────────────────
 *
 * `lib/keep-ready.ts` exists because the save condition had been written twice
 * and the two copies disagreed. Its header spends thirty lines on that, and the
 * lesson it draws is one level down from the deduplication itself: *"a helper
 * nobody calls does not stop a copy being made, it only makes the copy harder
 * to notice."*
 *
 * The notepad asks it — `Home` builds a `KeepReadiness` and calls `canKeep`.
 * The saved note did not. `SavesOverlay` computed
 *
 *     Boolean(open) && !saving && draft.trim().length > 0
 *       && draft.trim() !== open?.preview
 *
 * and passed it into `NoteTools` as a prop NAMED `canKeep` — the same CSS
 * class, the same dock slot, the same glyph, the same name, four of the eight
 * inputs. `NoteTools` then reasoned about the prop as though it were the lib's
 * ("the caller's own `canKeep` already folds in `saving`"), which was true by
 * luck rather than by contract.
 *
 * AND THE DIVERGENCE WAS REACHABLE. `NoteTools` renders Record on a saved note,
 * so a recording genuinely runs on that page — and `whyNotKept` puts a running
 * recorder FIRST, ahead of every other reason, because "a recording that is
 * still running is the thing to stop before thinking about anything else". The
 * old predicate never looked. That is the case this file opens with, and it is
 * the one that fails against the code as it was.
 *
 * ── AND WHAT IS ALLOWED TO DIFFER, WHICH IS THE OTHER HALF ─────────────────
 *
 * Some of the eight inputs have no subject on a saved note, and the review that
 * found this was explicit that the defect "is not that the predicates differ,
 * but that the file claiming to be the only statement of what blocks a save has
 * a second statement with no tombstone between them."
 *
 * So `uploading` is asserted here to be FALSE on purpose rather than left
 * untested: an attachment on a saved note is written on its own — "the write is
 * independent of the note's words … there is nothing to batch it with" — so
 * folding it in would dim Save while a photo goes up and silently discard an
 * edit made during the wait. A test that only checked "the two pages agree"
 * would have pushed somebody to make them agree HERE, which would be the wrong
 * fix made confidently. The divergence is a decision, so it gets a case.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). The same two seams `one-note.test.tsx`
 * uses, plus a microphone.
 *
 *   `lib/data` — where rows enter the archive, so the one saved note arrives as
 *   a fixture rather than over HTTP. Mocking `lib/api` for the read instead
 *   would put invented rows through translations written for real ones.
 *
 *   `lib/api` — spread through, with `updateInspiration` recording writes and
 *   `presignAttachment` returning a promise that never settles. That second one
 *   is the instrument for the `uploading` case: it parks the page in
 *   `attaching === true` indefinitely, which is the state a real slow upload
 *   holds and which no amount of waiting can otherwise produce reliably.
 *
 *   `MediaRecorder`, `navigator.mediaDevices` and `URL` — pieces of browser,
 *   not layers of this product. `NoteTools` only renders Record if
 *   `supportedRecordingType()` finds a format, and jsdom implements none of it.
 *   The real `useAudioRecording`, the real `SavesOverlay`, the real `NoteTools`
 *   and the real `keep-ready.ts` all run.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DOCK_SLOT } from "../src/components/NoteTools";
import { SavesOverlay } from "../src/components/SavesOverlay";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");

const ROW = {
  id: "kept-1",
  preview: "dusk on the hill",
  capturedMs: Date.UTC(2026, 9, 8, 19, 30),
  category: null,
  attachments: [],
};

/** Every write the explicit Save made, newest last. */
const written: Array<{ id: string; text: string }> = [];
/** Resolves nothing, ever: a presign that is still in flight. */
let presignHangs = false;

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return {
    ...actual,
    updateInspiration: async (id: string, patch: { text?: string }) => {
      written.push({ id, text: patch.text ?? "" });
      return undefined as never;
    },
    presignAttachment: async (...args: unknown[]) => {
      if (!presignHangs) return (actual.presignAttachment as (...a: unknown[]) => never)(...args);
      return new Promise(() => {}) as never;
    },
  };
});

vi.mock("../src/lib/data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/data")>()),
  loadInspirations: async () => ({ inspirations: [ROW], total: 1, short: false }),
}));

/** The recorder a browser would supply, with its wires brought out. */
class Recorder {
  static isTypeSupported = (): boolean => true;
  state = "inactive";
  mimeType: string;
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => Promise<void> | void;
  onerror?: () => void;
  constructor(_stream: MediaStream, options: { mimeType: string }) { this.mimeType = options.mimeType; }
  start(): void { this.state = "recording"; }
  stop(): void {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["fixture audio"], { type: this.mimeType }) });
    void this.onstop?.();
  }
}

let host: HTMLDivElement, root: Root, slot: HTMLSpanElement, stopTrack: ReturnType<typeof vi.fn>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  written.length = 0;
  presignHangs = false;
  stopTrack = vi.fn();
  vi.stubGlobal("MediaRecorder", Recorder);
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL(): string { return "blob:x"; }
    static revokeObjectURL(): void {}
  });
  /* `mediaDevices` IS DEFINED ON THE REAL `navigator` rather than replacing
     it. jsdom's navigator is read by React and by this product's platform
     checks; swapping the whole object for `{ mediaDevices }` makes unrelated
     code throw inside a catch somewhere and the test pass for the wrong
     reason. */
  Object.defineProperty(window.navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: async () => ({
        getTracks: () => [Object.assign(new EventTarget(), { stop: stopTrack })],
      }) as unknown as MediaStream,
    },
  });
  /* THE SLOT `Home` RENDERS IN THE DOCK. Without it `NoteTools` portals
     nowhere — the right behaviour on a surface with no bar, and the reason
     this file has to supply one. */
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

/** The archive, with its one row opened. */
async function openTheSavedNote(): Promise<void> {
  await act(async () => root.render(
    <SavesOverlay locale="en-US" title="Your Inspirations" onClose={vi.fn()} onNoteOpen={vi.fn()} />,
  ));
  for (let turn = 0; turn < 12 && !host.querySelector(".waka-list-row"); turn += 1) {
    await act(async () => { await Promise.resolve(); });
  }
  await act(async () => host.querySelector<HTMLButtonElement>(".waka-list-row")!.click());
}

const save = (): HTMLButtonElement => slot.querySelector<HTMLButtonElement>(".waka-dock-tool--keep")!;
const record = (): HTMLButtonElement | null => slot.querySelector<HTMLButtonElement>('[aria-label="Record"]');
const stopRecording = (): HTMLButtonElement | null =>
  slot.querySelector<HTMLButtonElement>('[aria-label="Stop recording"]');

/** Type into the open note the way a person does. */
async function type(text: string): Promise<void> {
  const words = host.querySelector<HTMLTextAreaElement>(".waka-note-page")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(words, text);
    words.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("the saved note's Save asks the one rule", () => {
  /**
   * THE CASE THAT FAILED BEFORE THE FIX, and it is not a corner: Record is in
   * the bar on this page, so starting a clip and then pressing Save is two
   * adjacent buttons in the order a person would press them.
   *
   * `whyNotKept` returns `worldComposerFinishRecording` for this state ahead of
   * everything else. The old predicate did not look at the recorder at all, so
   * the write went through under a clip that was about to attach to the same
   * row — and the notepad, one door away, refused the identical press.
   */
  it("will not keep a note while the microphone is still open", async () => {
    await openTheSavedNote();
    await type("dusk on the hill, and one light still on");
    expect(save().disabled).toBe(false);

    expect(record()).not.toBeNull();
    await act(async () => record()!.click());
    /* The recorder is running: the bar is showing its clock instead of the
       mic, which is how this page says so. */
    expect(stopRecording()).not.toBeNull();

    expect(save().disabled).toBe(true);
    await act(async () => save().click());
    expect(written).toEqual([]);
  });

  /**
   * AND IT LIGHTS AGAIN THE MOMENT THE CLIP IS DONE. A rule that blocks and
   * never unblocks is the same bug wearing the opposite sign — and this is the
   * half that proves the Save is reading the recorder's CURRENT phase rather
   * than a flag somebody set once.
   */
  it("keeps the note once the recording has stopped", async () => {
    await openTheSavedNote();
    await type("dusk on the hill, and one light still on");
    await act(async () => record()!.click());
    expect(save().disabled).toBe(true);

    await act(async () => stopRecording()!.click());
    for (let turn = 0; turn < 8; turn += 1) await act(async () => { await Promise.resolve(); });

    expect(save().disabled).toBe(false);
    await act(async () => save().click());
    expect(written).toEqual([{ id: ROW.id, text: "dusk on the hill, and one light still on" }]);
  });

  /**
   * THE DIVERGENCE THAT IS DELIBERATE, asserted so nobody "fixes" it.
   *
   * On the notepad an upload in flight blocks the save, because there the files
   * and the words leave together. On a saved note the attachment has its own
   * write — `attach` says so: "the write is independent of the note's words …
   * it is a file that has already been uploaded, there is nothing to batch it
   * with" — so a photo going up must not dim Save. If it did, an edit typed
   * while waiting on a slow upload would have nowhere to go, and `NoteTools`
   * would be contradicting its own comment that busy deliberately does not
   * block this one control.
   */
  it("keeps a note while an attachment is still going up, on purpose", async () => {
    presignHangs = true;
    await openTheSavedNote();
    const picker = host.querySelector<HTMLInputElement>('input[type="file"]')
      ?? slot.querySelector<HTMLInputElement>('input[type="file"]');
    expect(picker).not.toBeNull();
    await act(async () => {
      Object.defineProperty(picker!, "files", {
        configurable: true,
        /* REAL PNG BYTES, NOT A FILE NAMED `.png`. This was
           `new File(["bytes"], …)` — eight ASCII characters wearing an
           `image/png` label — and it worked because the archive's upload
           path classified attachments from `file.type`, the operating
           system's guess from the extension. That path now reads the first
           64 bytes (`inspectInspirationPhoto`), so a fake is refused before
           anything is sent and this case saw "Couldn't upload this
           attachment" instead of "Uploading".
           The eight-byte PNG signature is the whole fixture it needs: the
           sniffer reads a header, not an image. */
        value: [new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "hill.png", { type: "image/png" })],
      });
      picker!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    /* The page is holding an upload that will never finish: the bar says so. */
    expect(slot.textContent).toContain("Uploading");

    await type("dusk on the hill, and one light still on");
    expect(save().disabled).toBe(false);
    await act(async () => save().click());
    expect(written).toEqual([{ id: ROW.id, text: "dusk on the hill, and one light still on" }]);
  });

  /**
   * ── AND THE CHEAP HALF, WHICH BITES BEFORE ANY OF THE ABOVE ──────────────
   *
   * A behavioural test catches the rule being broken. This catches the rule
   * being RESTATED, which is how it got broken: somebody adds a third Save bar,
   * writes a predicate that happens to be right today, and nothing fails until
   * the ninth input changes under them.
   *
   * It names the two bars rather than scanning for a shape, because there are
   * exactly two and both are known. A third one is a deliberate act, and the
   * person committing it should have to add a line here and explain it.
   */
  it("is imported by both of the product's Save bars and restated by neither", () => {
    const bars = ["pages/Home.tsx", "components/SavesOverlay.tsx"];
    for (const name of bars) {
      const text = readFileSync(resolve(SRC, name), "utf8");
      expect(text).toMatch(/from "\.\.\/lib\/keep-ready"/);
      expect(text).toMatch(/\bcanKeep\(/);
      /* THE OLD PREDICATE, IN THE SHAPE IT ACTUALLY HAD. `draft.trim() !==`
         against the stored preview was the hand-written dirty check standing in
         for the rule; `hasWords` in `keepState` compares the same two strings,
         so the comparison is allowed — what is forbidden is it being the WHOLE
         answer. Guarded by the import assertions above: a file that compares
         the strings and never calls `canKeep` fails on the first two lines. */
      expect(text).not.toMatch(/const canKeepOpenNote = Boolean\(open\)/);
    }
  });
});
