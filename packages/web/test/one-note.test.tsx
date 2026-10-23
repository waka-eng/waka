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
 * pages put the same parts in the same places, and that nothing but the date
 * and the one verb about the note stands in the top row. The geometry is
 * measured through classes rather than pixels — jsdom has no layout — so
 * this catches a page losing the shared chrome, and the browser gate catches
 * a page keeping it at the wrong coordinates.
 *
 * AND WHAT THIS FILE CANNOT SEE, SAID PLAINLY RATHER THAN LEFT TO BE
 * DISCOVERED. Every difference that still exists between these two pages is
 * in the BAR, and the bar is not reachable from here: the notepad's tools are
 * rendered by `Home.tsx` and the saved note's by `NoteTools`, which portals
 * into a slot the dock lends it and renders `null` when there is none. So
 * mounting these two components side by side — which is what this file does,
 * because it is cheap and the top row is all it needs — shows two empty bars
 * and would agree about anything. `one-dock-two-notes.test.tsx` mounts the
 * real world through both doors and compares the two rows of presses; the
 * Speak-versus-Record difference and the two Save predicates live there.
 * Nothing about the dock should be added here: a comparison that renders
 * neither implementation would pass for every possible divergence.
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
 * `helpers/note-top-row` is not a seam either: it is a DOM query over the
 * tree this suite rendered itself, shared with `inspiration-composer.test.tsx`
 * so the two ask the top row the same question.
 *
 * `helpers/archive` plays `Home`'s part: the archive's recorder lives in
 * `Home` now (L12), so the archive is mounted with the real
 * `useArchiveRecorder` handed to it, as `Home` mounts it.
 */
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { pressesInTopRow } from "./helpers/note-top-row";
import { InspirationComposer } from "../src/components/InspirationComposer";
import { DOCK_SLOT } from "../src/components/NoteTools";
import { Archive } from "./helpers/archive";

/** Every write the explicit Save has made, newest last. */
const written: Array<{ id: string; text: string }> = [];

const ROW = {
  id: "kept-1",
  preview: "dusk on the hill",
  capturedMs: Date.UTC(2026, 9, 8, 19, 30),
  category: null,
  attachments: [] as Array<{ id: string; type: "link"; label: string; url: string }>,
};

/** The link card's one read: counted, and answered when the test says. */
const details = vi.hoisted(() => {
  const state = { calls: 0, finish: (_value: unknown) => {}, fail: (_error: unknown) => {} };
  return Object.assign(state, {
    read: (..._args: unknown[]) => {
      state.calls += 1;
      return new Promise((done, failed) => { state.finish = done; state.fail = failed; });
    },
  });
});

/* THE WRITE, AND ONLY THE WRITE. `lib/api` is spread through rather than
   replaced because this page also reaches it for presign, upload, finalize
   and delete, and a bare mock would turn any of those into `undefined is
   not a function` inside the overlay's own catch — a silent pass. The one
   call under test is the one swapped. */
vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return {
    ...actual,
    /* HTTP only, for the link card's details; the card itself runs. Held
       open until the test lets it go, so the loading frame is observable. */
    fetchAttachmentDetails: (...args: unknown[]) => details.read(...args),
    updateInspiration: async (id: string, patch: { text?: string }) => {
      written.push({ id, text: patch.text ?? "" });
      return undefined as never;
    },
  };
});

vi.mock("../src/lib/data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/data")>();
  return {
    ...actual,
    loadInspirations: async () => ({ inspirations: [ROW], total: 1, short: false }),
    /* The full-text read a note now waits on before it can be edited. */
    loadInspiration: async () => ({ ...ROW, text: ROW.preview, reflections: [] }),
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
    onRemove: vi.fn(), onVisibility: vi.fn(), onClose: vi.fn(),
    onSubmit: vi.fn(), onKeyDown: vi.fn(), onForkDraft: vi.fn(), draftConflict: false,
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
      <Archive locale="en-US" title="Your Inspirations" onClose={vi.fn()} onNoteOpen={onNoteOpen} />,
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
    /* WHAT IS PRESSABLE BESIDE THE DATE. Read on both so that one page
       growing a control the other does not have fails here — which is the
       whole subject of this file. For one day (2026-10-15) the two differed
       here by the new note's "All inspirations"; then "never put something
       on any corners" moved that door into the note's bar, and the two rows
       are the same again — nothing pressable beside the date on either. */
    topPresses: pressesInTopRow(host),
    /* WHERE IN THE ROW THE MOMENT IS — the same place on both pages,
       which is all jsdom can be asked. It is centred on the PAGE by an
       explicit `grid-column: 2`, not by its order, so the index is read
       among the row's children OTHER than the new note's lead (which sits
       in `grid-column: 1`). The browser walk in `tools/e2e` is what
       measured the centring. The lead is still filtered and counted, so
       its coming back is caught by `leads` rather than shifting the index. */
    whens: host.querySelectorAll(".jar-note-when").length,
    whenIndex: top
      ? [...top.children].filter((n) => !n.classList.contains("jar-note-lead"))
        .findIndex((n) => n.classList.contains("jar-note-when"))
      : -1,
    leads: top ? top.querySelectorAll(":scope > .jar-note-lead").length : -1,
  };
}

it("gives a new note and a saved one the same chrome in the same order", async () => {
  await newNote();
  const fresh = shape();
  await savedNote();
  const kept = shape();

  /* The same chrome, with no exception: the one door the new note had for
     a day lives in its bar now (2026-10-15, "never put something on any
     corners"). */
  expect(fresh).toEqual(kept);
  /* Spelled out as well as compared, so a regression that breaks BOTH pages
     identically still fails. `toEqual` alone would pass for two pages that
     had each lost their date. */
  expect(fresh.topPresses, "something pressable came back beside a new note's date").toEqual([]);
  expect(fresh.leads, "the archive door came back into the new note's corner").toBe(0);
  expect(kept.topPresses, "something pressable appeared beside a saved note's date").toEqual([]);
  expect(kept.leads, "a saved note, already in the archive, grew a door to it").toBe(0);
  expect(host.textContent, "a saved note says All inspirations").not.toContain("All inspirations");
  expect(fresh.whens).toBe(1);
  expect(fresh.whenIndex).toBe(0);
});

/* ═══ THE DESTRUCTIVE VERB LEFT THE TOP ROW FOR THE BAR (2026-10-12) ══════
 *
 * Founder: "let's just add delete icon next to the save icon."
 *
 * THIS CASE USED TO ASSERT THE OPPOSITE, and the reversal is worth keeping
 * rather than overwriting, because the old arrangement was not merely a
 * different taste — it was broken, and in a way this suite could not see.
 * Delete sat in `.jar-note-verb`, the slot `NotePage` reserves for a verb
 * about the note. That slot is layout only: `display: inline-flex` and a
 * gap, no rule for its children. So the one irreversible act a note has
 * measured 59x32 in Chromium against this product's 44px floor for an act,
 * with its confirm sibling unstyled too.
 *
 * It got there tonight. The control used to live inside `.waka-note-foot`,
 * which carried `min-height: 44px`; the commit that merged the two note
 * pages into one `NotePage` moved the markup and left the rule behind, and
 * the rule was later swept as dead — correctly, since nothing wore the
 * class by then. The floor had been gone for hours and every gate was
 * green, including this one, which asserted only WHERE the verb was.
 *
 * WHAT THIS CASE CAN STILL PROVE, and it is the half that belongs here:
 * the top row holds no press at all now, on either page. This harness
 * renders `InspirationComposer` and `SavesOverlay` directly, with no dock
 * slot for `NoteTools` to portal into, so the bar is out of reach by
 * construction — which is exactly why the bar's own comparison needed a
 * suite that mounts the real world. See `one-dock-two-notes.test.tsx`,
 * where Delete's presence, its 44px floor and its absence on a new note
 * are the assertions. Two halves, each held where it is reachable. */
it("leaves no press in the top row of either note page", async () => {
  await newNote();
  expect(host.querySelectorAll(".jar-note-verb")).toHaveLength(0);
  expect(host.textContent).not.toContain("Delete");

  await savedNote();
  /* The slot renders only when something is passed to it, and nothing is
     any more — so its absence is the assertion, not an empty element. */
  expect(host.querySelector(".jar-note-verb")).toBeNull();
  expect(host.textContent).not.toContain("Delete");
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

/**
 * ═══ AND A SAVE YOU CAN PRESS ON A NOTE YOU WROTE MONTHS AGO ════════════
 *
 * Founder: "this button should appear when I'm editing old inspirations as
 * well. So when I'm looking at past saved inspirations, as soon as I start
 * typing, then that save button should be enabled."
 *
 * WHY THIS IS NOT COVERED BY THE AUTOSAVE'S OWN TESTS. `leaveNote` has
 * always written on the way out and still does — this is a second door onto
 * the same write, and the thing a second door can get wrong is the half
 * that has nothing to do with writing: WHEN IT IS LIT. Three states, and
 * the middle one is the only one anybody looks at.
 *
 * THE DIM-AFTER-PRESS IS THE LOAD-BEARING ASSERTION. The control reports
 * "your change is stored" by going out, which only works if the write
 * re-points the open note at the words it just saved. Forget that one line
 * and everything still saves correctly, the button stays lit for ever, and
 * the page quietly says the opposite of the truth — which is the exact
 * failure this product cannot have, because its whole claim is that its
 * account of you is checkable. The press itself passing is not the proof;
 * the going-out is.
 *
 * AND IT IS TRIMMED, NOT RAW. Enablement reads `draft.trim()`, the same
 * predicate the write reads, so a typed space cannot light a button that
 * then refuses — the "looks pressable, does nothing" failure `whyNoSend`
 * and `keep-ready.ts` were each written for after it happened.
 */
it("lends the bar a Save that lights only on an unsaved change, and goes out once it has taken", async () => {
  /* The slot `Home` renders in the dock. Without it `NoteTools` portals
     nowhere, which is the right behaviour on a surface with no bar and the
     reason this test has to supply one. */
  const slot = document.createElement("span");
  slot.id = DOCK_SLOT;
  document.body.append(slot);
  written.length = 0;
  try {
    await savedNote();
    const save = () => slot.querySelector<HTMLButtonElement>('[aria-label="Save inspiration"]');
    /* PRESENT BEFORE IT IS PRESSABLE. Founder, of the notepad's: "when the
       user didn't make any change, then make it lower opacity, like
       basically disable it." A control that is absent until it is usable
       has to be discovered twice. */
    expect(save()).not.toBeNull();
    expect(save()!.disabled).toBe(true);

    const words = host.querySelector<HTMLTextAreaElement>(".waka-note-page")!;
    const type = (text: string) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(words, text);
      words.dispatchEvent(new Event("input", { bubbles: true }));
    });

    /* Whitespace is not a change. */
    await type(`${ROW.preview}   `);
    expect(save()!.disabled).toBe(true);

    await type("dusk on the hill, and one light still on");
    expect(save()!.disabled).toBe(false);

    await act(async () => save()!.click());
    expect(written).toEqual([{ id: ROW.id, text: "dusk on the hill, and one light still on" }]);
    /* The receipt: it is not lit any more, and nothing had to say "saved". */
    expect(save()!.disabled).toBe(true);
    /* AND THE NOTE IS STILL OPEN. Saving is a statement about the words,
       not a second way out standing beside the one the bar already has —
       the "Save / Save as draft" pair the founder rejected once already:
       "this is so confusing." */
    expect(host.querySelector(".waka-over-one")).not.toBeNull();

    /* Pressing again writes nothing: there is nothing left to write. */
    await act(async () => save()!.click());
    expect(written).toHaveLength(1);
  } finally {
    slot.remove();
  }
});

/* ═══ A SAVED LINK KEEPS ITS LINK ON THE OPENED NOTE (2026-10-16) ═════════
 *
 * The row carried the attachment and the page drew only images and words,
 * so a note about an essay had lost the essay. The link's own card sits
 * under the words — and only the card. The note's states live in the bar
 * ("states should show and disappear in the bottom bar only"), so the card
 * is absent while it loads and says nothing about itself once it has. A
 * pending analysis is re-read silently, so the card fills in when the title
 * arrives; a failed read falls back to the bare link, never to nothing. */
const LINK = "https://example.test/essay";
const card = () => host.querySelector(".waka-over-one .jar-attachment-preview");
function detailsOf(pending: boolean) {
  return {
    attachment: { id: "link-1", inspirationId: ROW.id, type: "link", url: LINK,
      name: null, contentType: null, size: null, createdAt: new Date().toISOString(),
      enrichment: { status: pending ? "pending" : "ready", kind: "page_body", text: "Extracted page text", errorReason: null, updatedAt: null,
        image: null, link: pending ? null : { title: "An essay on dusk", description: "Light, late", siteName: "Example journal",
          hostname: "example.test", finalUrl: LINK, previewImageUrl: null } } },
    previewImageAvailable: false,
    analysis: { status: pending ? "pending" : "ready", canRetry: true, retryAfter: new Date().toISOString() },
  };
}
function expectNoState(): void {
  expect(card()!.querySelectorAll("button, [role=status], [role=alert], details")).toHaveLength(0);
  expect(host.querySelector(".waka-over-one")!.textContent).not.toMatch(/Loading|Reading|Check|Try again|Page text|retry|couldn/i);
}

it("shows a saved link's card under the words of the opened note, filling in silently", async () => {
  ROW.attachments = [{ id: "link-1", type: "link", label: LINK, url: LINK }];
  details.calls = 0;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    await savedNote();
    expect(details.calls).toBe(1);
    expect(card(), "a loading card drew on the note page").toBeNull();
    expect(host.textContent).not.toContain("Loading preview");

    /* Pending: the bare link, no word about the wait. */
    await act(async () => details.finish(detailsOf(true)));
    expect(card(), "the opened note lost its link").not.toBeNull();
    expect(card()!.querySelector("a")?.href).toBe(LINK);
    expect(card()!.textContent).not.toContain("An essay on dusk");
    expectNoState();
    expect(host.querySelector(".waka-note-page")!.compareDocumentPosition(card()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    /* A second read, and the card fills in. */
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(details.calls).toBe(2);
    await act(async () => details.finish(detailsOf(false)));
    expect(card()!.textContent).toContain("An essay on dusk");
    expect(card()!.textContent).toContain("Light, late");
    expectNoState();
  } finally {
    vi.useRealTimers();
    ROW.attachments = [];
  }
});

it("resumes the silent re-read when a hidden tab comes back", async () => {
  ROW.attachments = [{ id: "link-1", type: "link", label: LINK, url: LINK }];
  details.calls = 0;
  let hidden = false;
  const hiddenSpy = vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    await savedNote();
    await act(async () => details.finish(detailsOf(true)));
    hidden = true;
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(details.calls, "read while the tab was hidden").toBe(1);
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(details.calls).toBe(1);

    hidden = false;
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(details.calls, "the re-read never resumed").toBe(2);
    await act(async () => details.finish(detailsOf(false)));
    expect(card()!.textContent).toContain("An essay on dusk");
    expectNoState();
  } finally {
    vi.useRealTimers();
    hiddenSpy.mockRestore();
    ROW.attachments = [];
  }
});

it("keeps the bare link on the note when its details cannot be read", async () => {
  ROW.attachments = [{ id: "link-1", type: "link", label: LINK, url: LINK }];
  try {
    await savedNote();
    expect(card()).toBeNull();
    await act(async () => details.fail(new Error("private provider text")));
    expect(card(), "a failed read took the link off the note").not.toBeNull();
    expect(card()!.querySelector("a")?.href).toBe(LINK);
    expect(card()!.textContent).toContain("example.test");
    expect(host.textContent).not.toContain("private provider text");
    expectNoState();
  } finally {
    ROW.attachments = [];
  }
});
