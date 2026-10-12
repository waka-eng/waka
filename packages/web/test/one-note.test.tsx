// @vitest-environment jsdom
/**
 * ONE NOTE PAGE, WHICHEVER DOOR YOU CAME THROUGH.
 *
 * Founder, having opened a saved inspiration next to a new one: "when
 * clicking on a saved inspiration, it should go to the same exact UI as when
 * I'm creating a new inspiration ... the title should be the same position at
 * like middle center ... and the bottom bar should also change ... make sure
 * that when I'm entering from create new inspiration or my past inspiration,
 * it's using the exact same component."
 *
 * WHY A TEST AND NOT JUST THE SHARED COMPONENT. Extracting `NotePage` made
 * the two tops identical in the TREE and left four differences on screen:
 * the archive's note sat in a 650px column while the notepad is the whole
 * window, its chevron came out 11px wide because the square target was
 * scoped to the composer's class, its words were set at a reading size
 * rather than the notepad's, and its article's own `gap` added 16px above
 * the first line. A shared component is not a shared page.
 *
 * So what is asserted here is the thing that was actually wrong: that both
 * pages put the same parts in the same places, and that the archive's note
 * has no second attach corner. The geometry is measured through classes
 * rather than pixels — jsdom has no layout — so this catches a page losing
 * the shared chrome, and the browser gate catches a page keeping it at the
 * wrong coordinates.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). Two seams.
 *
 *   `lib/data` — the right one, and the only real seam here. The archive
 *   reaches its rows through `loadInspirations`, which follows the cursor
 *   and translates what comes back; mocking `lib/api` instead would put
 *   invented rows through translations written for real ones, and the first
 *   mismatch would be swallowed by the overlay's own catch. What is under
 *   test is what the page RENDERS, so the mock sits where the rows enter it.
 *
 *   `URL` — `URL.createObjectURL` and `URL.revokeObjectURL`, which jsdom
 *   does not implement. Not a layer of this product at all: it is a piece of
 *   browser the composer's media preview calls into, stubbed for the same
 *   reason a canvas is.
 *
 * The composer takes everything as props, so it needs no seam of its own.
 */
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { InspirationComposer } from "../src/components/InspirationComposer";
import { SavesOverlay } from "../src/components/SavesOverlay";

const ROW = {
  id: "kept-1",
  preview: "dusk on the hill",
  capturedMs: Date.UTC(2026, 9, 8, 19, 30),
  category: null,
  attachments: [],
};

vi.mock("../src/lib/data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/data")>();
  return {
    ...actual,
    loadInspirations: async () => ({ inspirations: [ROW], total: 1, short: false }),
  };
});

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL() { return "blob:x"; }
    static revokeObjectURL() {}
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function composerProps(): ComponentProps<typeof InspirationComposer> {
  return {
    text: "dusk on the hill", media: [], linkText: "", onLinkText: vi.fn(),
    locale: "en-US", public: false, ready: true, fileDraftsAvailable: true,
    busy: false, error: "", uploadingId: null, inputRef: null,
    save: { phase: "idle", pending: null, busy: false, start: vi.fn(), retry: vi.fn(),
      check: vi.fn(), dismiss: vi.fn(), resetInvalid: vi.fn(), editRejected: vi.fn() },
    recording: { phase: "idle", seconds: 0, error: "", notice: "",
      start: vi.fn(), stop: vi.fn(), cancel: vi.fn() },
    onText: vi.fn(), onFiles: vi.fn(), onRetryFile: vi.fn(), onChooseRecording: vi.fn(),
    onRemove: vi.fn(), onVisibility: vi.fn(), onPast: vi.fn(), onClose: vi.fn(),
    onSubmit: vi.fn(), onKeyDown: vi.fn(), onForkDraft: vi.fn(),
  };
}

/** The new note, rendered on its own. */
async function newNote(): Promise<void> {
  await act(async () => root.render(<InspirationComposer {...composerProps()} />));
}

/** The archive, with its one row opened. */
async function savedNote(onNoteOpen = vi.fn()): Promise<void> {
  await act(async () =>
    root.render(
      <SavesOverlay locale="en-US" title="Your Inspirations" onClose={vi.fn()} onNoteOpen={onNoteOpen} />,
    ),
  );
  for (let turn = 0; turn < 12 && !host.querySelector(".waka-list-row"); turn += 1) {
    await act(async () => { await Promise.resolve(); });
  }
  await act(async () => host.querySelector<HTMLButtonElement>(".waka-list-row")!.click());
}

/** What the page puts where, read through the shared chrome's classes. */
function shape() {
  const top = host.querySelector(".jar-note-top");
  return {
    /* NO WAY BACK ON EITHER PAGE. Founder: "I can just go to all the
       inspirations using the bottom panel. So don't do that." Counted on
       both so that one page growing a chevron the other does not have
       fails here — which is the whole subject of this file. */
    backs: host.querySelectorAll(".jar-note-back").length,
    headerBacks: host.querySelectorAll(".waka-over-back").length,
    /* WHERE IN THE ROW THE MOMENT IS — the same place on both pages,
       which is all jsdom can be asked. It is centred on the PAGE by an
       explicit `grid-column: 2` rather than by being the second child; the
       chevron that used to hold the first track is gone, and a filler
       element whose only job is to be nothing was the alternative. The
       browser walk in `tools/e2e` is what measured the centring. */
    whens: host.querySelectorAll(".jar-note-when").length,
    whenIndex: top ? [...top.children].findIndex((n) => n.classList.contains("jar-note-when")) : -1,
    /* The attach corner is in the bar on both; neither page may grow one. */
    corners: host.querySelectorAll(".jar-note-tools").length,
  };
}

it("gives a new note and a saved one the same chrome in the same order", async () => {
  await newNote();
  const fresh = shape();
  await savedNote();
  const kept = shape();

  expect(fresh).toEqual(kept);
  /* Spelled out as well as compared, so a regression that breaks BOTH pages
     identically still fails. `toEqual` alone would pass for two pages that
     had each lost their chevron. */
  expect(fresh.backs).toBe(0);
  expect(fresh.headerBacks).toBe(0);
  expect(fresh.whens).toBe(1);
  expect(fresh.whenIndex).toBe(0);
  expect(fresh.corners).toBe(0);
});

/* THE DELETE IS THE ONE THING A SAVED NOTE HAS AND A NEW ONE DOES NOT, and
   it is in the slot `NotePage` reserves for a verb about the note — not in
   the bottom-left corner, which is where it was when the founder said
   "delete being at bottom left like this is weird", and not in a row of its
   own. A new note has nothing there: a thing that does not exist yet cannot
   be destroyed. */
it("puts the one destructive verb in the top row, and only on a saved note", async () => {
  await newNote();
  expect(host.querySelectorAll(".jar-note-verb")).toHaveLength(0);
  expect(host.textContent).not.toContain("Delete");

  await savedNote();
  const verb = host.querySelector(".jar-note-verb");
  expect(verb).not.toBeNull();
  expect(verb!.textContent).toContain("Delete");
  /* Last in the row, so it is as far from the way back as the row has
     room for — the two are the only presses up there and one of them
     cannot be undone. */
  const top = host.querySelector(".jar-note-top")!;
  expect(top.lastElementChild).toBe(verb);
});

/**
 * THE BAR IS TOLD, WHICH IS HOW IT TRANSFORMS — AND HOW IT LEAVES.
 *
 * Founder: "the bottom bar should also change." The archive cannot reach
 * the dock — `Home` renders it — so it hands up a closer and `Home` swaps
 * the plus for a slot that `NoteTools` portals into.
 *
 * A FUNCTION RATHER THAN A FLAG, and that is not incidental. Since the
 * chevron went ("I can just go to all the inspirations using the bottom
 * panel"), pressing Inspirations IS the way out of an open note — so the
 * bar has to be able to CLOSE one, and closing commits what was typed.
 * Handing up a boolean and letting the world clear its own flag would be
 * the version of this that silently discards an edit.
 *
 * THE CLEANUP IS THE HALF WORTH TESTING. An archive unmounted with a note
 * open would otherwise leave the dock holding a mic — and a stale way out —
 * for a page that is no longer on screen.
 */
it("hands the world a way to close an open note, and takes it back on the way out", async () => {
  const told = vi.fn();
  await savedNote(told);
  const handed = told.mock.lastCall?.[0];
  expect(typeof handed).toBe("function");
  await act(async () => root.unmount());
  expect(told).toHaveBeenLastCalledWith(null);
  /* Re-created so `afterEach` has something to unmount. */
  root = createRoot(host);
});
