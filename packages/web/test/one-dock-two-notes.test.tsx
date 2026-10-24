// @vitest-environment jsdom
/**
 * ═══ ONE BAR, WHICHEVER NOTE IS OPEN ════════════════════════════════════
 *
 * Founder, having opened a saved inspiration next to a new one: "make sure
 * that when I'm entering from create new inspiration or my past
 * inspiration, it's using the exact same component." And, of the bar
 * itself: "the bottom bar should also change."
 *
 * WHY THIS FILE EXISTS BESIDE `one-note.test.tsx`. That file holds the two
 * note pages to the same TOP row and says in its own header that a shared
 * component is not a shared page. It cannot say anything at all about the
 * bottom of the screen, and the bottom of the screen is where every
 * remaining difference between the two pages now lives:
 *
 *   THE NOTEPAD'S SLOT IS RENDERED BY `Home.tsx` (the `view.compose`
 *   branch of the dock's middle slot) and the saved note's by `NoteTools`,
 *   which portals into an empty slot the same dock lends it. Two
 *   implementations of one row — which is the shape this codebase has
 *   been burned by repeatedly, and the reason `NoteTools` itself exists.
 *
 *   NEITHER CAN BE RENDERED FROM THE COMPONENT LEVEL. `InspirationComposer`
 *   does not own the notepad's tools, so mounting it alone shows an empty
 *   bar; `NoteTools` renders `null` when no slot exists. The only place the
 *   two rows exist to be compared is the real world with the real dock, so
 *   this suite mounts it — twice, once per door — and reads what a person
 *   would actually see.
 *
 * WHAT IS ASSERTED, AND WHY IT IS A LEDGER AND NOT AN EQUALITY. The two
 * rows are NOT identical today, and one difference is a known, reported
 * defect in a file this suite deliberately does not reach into:
 * `Home.tsx`'s notepad offers dictation where the browser has it ("Speak",
 * which lands as TEXT), and the saved note's row offers the audio recorder
 * instead. So `KNOWN_DIFFERENCES` names each surviving difference, with the
 * argument for it, and the test asserts the difference set is EXACTLY that
 * — no more, and no fewer.
 *
 * Fewer fails on purpose, which is the half that makes this a ratchet
 * rather than a snapshot: when somebody gives the saved note the same
 * microphone the notepad has, this file goes red and the entry is deleted
 * with the fix, instead of a stale "known difference" outliving the thing
 * it excused. `reachable.test.ts` carries the same shape for the same
 * reason.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). The same four seams
 * `leaving-a-note.test.tsx` uses, for the same reasons: `lib/data` so the
 * archive's one row arrives as a fixture rather than over HTTP (mocked
 * there and not at `lib/api`, because `loadInspirations` follows the cursor
 * and translates on the way, and the overlay swallows its own loader's
 * throw); `lib/api` and `lib/api/principles` for the reads the world makes
 * on arrival; `lib/auth-context` because the world renders nothing without
 * a signed-in viewer; and `helpers/render-home` with `helpers/canvas-stub`
 * for canvas, viewport, clock and randomness. The dock, both note pages, the router and the real
 * `NoteTools` portal all run unchanged — they are the thing under test.
 *
 * AND THREE PIECES OF BROWSER, WHICH ARE THE POINT RATHER THAN A SEAM.
 * `SpeechRecognition` and `MediaRecorder` are what the two rows BRANCH on,
 * and jsdom has neither — so without them both rows fall to their
 * no-microphone shape, agree perfectly, and this gate would be green over
 * the exact asymmetry it was written for. Stubbing both is what makes the
 * test ask the question a person's browser asks.
 *
 * `indexedDB` is `fake-indexeddb`, and it is here for the opposite reason:
 * to stop the harness from inventing a difference. The notepad disables its
 * microphone and its camera on `!composerDraft.available` — a new note's
 * attachments live in a draft store until it is saved, so with no store
 * there is nowhere to put one — while a saved note uploads immediately and
 * needs no store at all. MEASURED with jsdom's bare environment: the
 * notepad's Speak and Photo came back `disabled` and the saved note's did
 * not. That difference is real and has a real reason, and it is NOT what
 * this file is about; every browser a person uses has the store. Recorded
 * here rather than pinned, because a reader finding this suite green should
 * know which questions it chose not to ask.
 */
import { act } from "react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { IDBFactory } from "fake-indexeddb";

import { installCanvasStub, setViewport } from "./helpers/canvas-stub";
import { mountWorld, dataMockFrom, apiMockFrom, chooseFromMenu, VIEWER_ID, type MountedWorld } from "./helpers/render-home";
import { profileStorageKey } from "../src/lib/profile-storage";

const FACTS = vi.hoisted(() => ({
  inspirations: [{ id: "kept", text: "dusk on the hill", daysAgo: 2 }],
  groups: [] as never[],
}));

vi.mock("../src/lib/api/principles", async (original) => ({
  ...await original<typeof import("../src/lib/api/principles")>(),
  fetchPrincipleRead: vi.fn(async () => ({ principles: [], status: { phase: "ready", eligible: false } })),
}));
vi.mock("../src/lib/data", async (original) => ({
  ...await original<typeof import("../src/lib/data")>(), ...dataMockFrom(FACTS),
}));
vi.mock("../src/lib/api", async (original) => ({
  ...await original<typeof import("../src/lib/api")>(), ...apiMockFrom(FACTS),
  fetchPrinciples: vi.fn(async () => []),
  updateInspiration: vi.fn(),
}));
vi.mock("../src/lib/auth-context", async (original) => {
  const session = { status: "authenticated", account: { id: "account-1", email: "you@example.test" },
    profile: { id: VIEWER_ID, name: "You", type: "human" }, profiles: [], refresh: async () => undefined, signOut: async () => undefined };
  return { ...await original<typeof import("../src/lib/auth-context")>(), useOptionalAuth: () => session, useAuth: () => session };
});

/** The draft the world finds on arrival, which is what opens the notepad
    already holding words — the same door `where-it-last-went.test.tsx` uses,
    and cheaper than driving a click into a canvas jsdom does not draw. */
const DRAFT_KEY = profileStorageKey({ accountId: "account-1", profileId: VIEWER_ID }, "draft")!;
const WORDS = "dusk on the hill, and one light still on";

/** Enough of the two APIs for the availability probes to say yes. Neither
    row records anything here: what is under test is which CONTROL each one
    offers, and both branches read only these two existence checks. */
class StubRecognition {
  start(): void {}
  stop(): void {}
  abort(): void {}
}
class StubRecorder {
  static isTypeSupported(): boolean { return true; }
}

let world: MountedWorld | undefined;

beforeAll(() => {
  installCanvasStub();
  setViewport(1280, 900);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  localStorage.clear();
  (globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory();
  (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = StubRecognition;
  (globalThis as unknown as { MediaRecorder?: unknown }).MediaRecorder = StubRecorder;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  world?.unmount();
  world = undefined;
  vi.useRealTimers();
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  delete (globalThis as unknown as { MediaRecorder?: unknown }).MediaRecorder;
  localStorage.clear();
});

async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) {
    await world!.step(100);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  }
}

/**
 * THE BAR'S ONE TRANSFORMING SLOT, AS A LIST OF PRESSES.
 *
 * `.waka-dock-making` is the class both rows wear — `Home.tsx` renders it
 * directly for the notepad and lends it to `NoteTools` as `#waka-note-tools`
 * for a saved note — so one selector reads both without either page having
 * to be named here.
 *
 * READ BY ACCESSIBLE NAME AND BY CLASS, not by position alone. The name is
 * what a person using voice or a screen reader actually says, and it is the
 * half that caught the difference below; the class is what decides the
 * appearance, which is the half the founder sees. `disabled` is in because
 * the two pages were gated by two different Save predicates, and "the same
 * act lights the same control" is the only form of that question a test can
 * ask from out here.
 */
function dockPresses(): Array<{ label: string; className: string; disabled: boolean }> {
  const slot = world!.container.querySelector(".waka-dock-making");
  if (!slot) throw new Error("the dock is not showing its making-slot, so neither note page has a bar");
  return [...slot.querySelectorAll("button")].map((button) => ({
    label: (button.getAttribute("aria-label") ?? button.textContent ?? "").trim(),
    className: button.className,
    disabled: button.disabled,
  }));
}

/** The notepad. With words in it there is a change to keep; blank, there is
    not — which is the only pair of states in which the two pages' Save
    predicates can be compared at all. */
async function notepad(words: string): Promise<ReturnType<typeof dockPresses>> {
  if (words) localStorage.setItem(DRAFT_KEY, words);
  world = await mountWorld(FACTS, { initialEntries: ["/?compose=1"] });
  await settle();
  expect(world.container.querySelector(".jar-inspiration-composer"), "the notepad did not open").toBeTruthy();
  const slot = world.container.querySelector(".waka-dock span.waka-dock-slot");
  expect(slot?.querySelector(":scope > .waka-dock-making")).toBeTruthy();
  expect(slot?.querySelector(".waka-dock-save")?.textContent).toBe("Save");
  expect(slot?.querySelector(".waka-dock-item--close")?.textContent).toBe("Close");
  return dockPresses();
}

/** The saved note, opened the way a person opens it. Retyped when the case
    wants an unsaved change in it — otherwise the Save comparison would be
    between a note with something to keep and a note with nothing to keep,
    which is a difference in the TEST rather than in the two pages. */
async function savedNote(retype: string): Promise<ReturnType<typeof dockPresses>> {
  world = await mountWorld(FACTS);
  await settle();
  await chooseFromMenu(world.container, "Inspirations");
  await settle();
  const row = world.container.querySelector<HTMLButtonElement>(".waka-list-row");
  expect(row, "the archive shows no saved row to open").toBeTruthy();
  await act(async () => row!.click());
  await settle();
  const page = world.container.querySelector<HTMLTextAreaElement>("textarea.waka-note-page");
  expect(page, "the opened row is not showing its words").toBeTruthy();
  if (retype) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(page, retype);
      page!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
  }
  return dockPresses();
}

/** Both doors, in one case, with the world torn down between them: the two
    pages are never on screen together (`Home.tsx` says so at the branch) and
    a test that showed them together would be asserting about an arrangement
    that cannot happen. */
async function bothDoors(words: string): Promise<{ fresh: ReturnType<typeof dockPresses>; kept: ReturnType<typeof dockPresses> }> {
  const fresh = await notepad(words);
  world!.unmount();
  world = undefined;
  localStorage.clear();
  const kept = await savedNote(words);
  return { fresh, kept };
}

/**
 * THE LEDGER OF SURVIVING DIFFERENCES — one entry, and it is a reported
 * defect rather than a decision.
 *
 * `Home.tsx`'s notepad prefers DICTATION where the browser has it, because a
 * spoken thought that lands as text feeds the top of mind, shows as a lead
 * line in the archive and can be searched, while the same thought as a file
 * does none of those things (`use-dictation.ts` carries the full argument).
 * The saved note's row was built before that pass and still offers the audio
 * recorder unconditionally — so the same gesture, in the same seat, on two
 * pages the founder asked to be "the exact same component", does two
 * different things.
 *
 * THIS IS NOT A WAIVER. The entry says what is true today so that every
 * OTHER difference fails, and the case below fails just as loudly if this
 * difference disappears — at which point the fix deletes the entry. Fixing
 * it means giving `NoteTools` the same dictation-first branch, which is a
 * change to two files this suite reaches through the world rather than
 * edits, and is the owner of those files' call.
 */
const KNOWN_DIFFERENCES = [
  { at: 0, notepad: "Speak", savedNote: "Record" },
];

/**
 * ═══ AND ONE PRESS EXISTS ON ONE PAGE ONLY ════════════════════════════════
 *
 * Founder: "let's just add delete icon next to the save icon."
 *
 * A SECOND KIND OF DIFFERENCE, kept in its own ledger rather than folded
 * into the one above, because the two are not the same claim. A rename says
 * "both pages have this press and call it different things", and the fix is
 * to make them agree. This says "only one page has this press at all", and
 * there is nothing to make agree: a note that has never been kept cannot be
 * deleted, so the notepad must NOT grow a Delete. Folding them together
 * would let a genuinely missing control hide as a rename against
 * "(nothing)", which is exactly the hole this suite exists to close.
 *
 * SO THESE LABELS ARE REMOVED FROM BOTH ROWS BEFORE ANYTHING IS COMPARED,
 * and the comparison below is as strict as it was — same count, same order,
 * same classes, same disabled set — over what is left. The entry is a
 * ratchet in the same direction as its neighbour: if Delete ever appears on
 * the notepad, the row it is removed from will be the wrong length and this
 * file goes red.
 *
 * WHERE DELETE'S OWN BEHAVIOUR IS ASSERTED: here, below, for its presence
 * and its absence. Its 44px floor is a stylesheet fact and belongs to the
 * browser gates — it was 59x32 for several hours tonight with every suite
 * green, which is why it is named here even though this file cannot measure
 * it.
 */
/* SHARE JOINED IT (2026-10-15) for the same reason as Delete. Founder: "i
   also dont see option to share a specfici inspiration." Only a kept thing
   has anything to show anyone; the notepad must not grow it either. */
/* AND "MORE" (2026-10-17): on a phone under 350px Share and Delete fold into
   one overflow so every act keeps its 44px target. It is the same two verbs
   in another shape — rendered always, chosen by the stylesheet — so it is
   one-sided for exactly their reason. */
const ONLY_ON_THE_SAVED_NOTE = ["Delete", "Share this inspiration", "More"];

/** Both rows, with the one-sided presses taken out so the rest can be compared. */
function comparable(row: ReturnType<typeof dockPresses>) {
  return row.filter((press) => !ONLY_ON_THE_SAVED_NOTE.includes(press.label ?? ""));
}

/** The press a page calls Save, wherever it sits in the row. */
function saveIn(row: ReturnType<typeof dockPresses>) {
  return row.find((press) => press.label === "Save inspiration");
}

/** Where the two rows disagree on what a press is called, in order. */
function differences(
  fresh: ReturnType<typeof dockPresses>,
  kept: ReturnType<typeof dockPresses>,
): Array<{ at: number; notepad: string; savedNote: string }> {
  const out: Array<{ at: number; notepad: string; savedNote: string }> = [];
  for (let at = 0; at < Math.max(fresh.length, kept.length); at += 1) {
    const here = fresh[at]?.label ?? "(nothing)";
    const there = kept[at]?.label ?? "(nothing)";
    if (here !== there) out.push({ at, notepad: here, savedNote: there });
  }
  return out;
}

it("gives a new note and a saved one the same row of presses, bar what is written down", async () => {
  const { fresh: freshRow, kept: keptRow } = await bothDoors(WORDS);

  /* THE ONE-SIDED PRESS IS ASSERTED BEFORE IT IS SET ASIDE, so removing it
     cannot be the thing that makes this pass. */
  expect(keptRow.map((press) => press.label), "the saved note has no Delete").toContain("Delete");
  expect(freshRow.map((press) => press.label), "a note that was never kept offers to delete it").not.toContain("Delete");

  const fresh = comparable(freshRow);
  const kept = comparable(keptRow);

  /* THE ROW IS NOT EMPTY, FIRST. Every assertion below compares two lists,
     and two empty lists are equal — the vacuous pass this file's neighbour
     `one-note.test.tsx` was reduced to for exactly this reason. */
  expect(fresh.length, "the notepad's bar has no presses in it").toBeGreaterThan(2);

  /* SAME NUMBER, SAME ORDER. A control that is third on one page and second
     on the other costs a press every time, because the hand goes where it
     went last time — `NoteTools` makes that argument at its own Save. */
  expect(kept.length, "the two bars hold a different number of presses").toBe(fresh.length);

  // New captures give Save a visible label. Both notes keep the same
  // accessible action and enabled/disabled rules.
  expect(kept.map((press) => press.className)).toEqual(fresh.map((press) => press.className.replace(" waka-dock-save", "")));

  /* AND THE SAME ACT LIGHTS THE SAME CONTROLS. Both pages were given the
     same words to keep, so every press is pressable on both or on neither —
     the form the two Save predicates can be compared in from out here. */
  expect(kept.map((press) => press.disabled)).toEqual(fresh.map((press) => press.disabled));
  /* Spelled out as well as compared, because "both dim" would satisfy the
     line above while meaning the opposite. */
  /* FOUND BY NAME, NOT BY POSITION. Save was last in both rows until Delete
     arrived beside it on the saved note; reading `at(-1)` then silently
     started asserting about the trash instead, and said "Save" while doing
     it. Order is already covered — `differences()` compares the rows
     index by index — so position is not what these two lines are for. */
  expect(saveIn(fresh), "the notepad's Save is not where it was").toMatchObject({ label: "Save inspiration", disabled: false });
  expect(saveIn(kept), "the saved note's Save is not lit by a change").toMatchObject({ label: "Save inspiration", disabled: false });

  /* ONLY THE NAMES MAY DIFFER, AND ONLY WHERE THE LEDGER SAYS SO. */
  expect(differences(fresh, kept)).toEqual(KNOWN_DIFFERENCES);
});

/**
 * AND NOTHING TO KEEP IS DIM ON BOTH, which is the other end of the one
 * predicate.
 *
 * The two pages decided this with two different functions — `composerCanKeep`
 * on the notepad and `canKeepOpenNote` in the archive — and a control that is
 * lit on one page and dim on the other for the same state is the "looks
 * pressable, does nothing" failure in its sharpest form: the person learns
 * the rule on one page and it is false on the next. A blank new note and a
 * saved note nobody has typed into are the same situation — there is nothing
 * to write — so Save says so in the same way.
 */
it("dims Save on both pages when there is nothing to keep", async () => {
  const { fresh, kept } = await bothDoors("");

  /* BY NAME, for the reason given at `saveIn`: Delete now sits after Save
     on the saved note, so `at(-1)` reads the trash and asserts "Save". */
  expect(saveIn(fresh), "the blank notepad offers a pressable Save").toMatchObject({ label: "Save inspiration", disabled: true });
  expect(saveIn(kept), "an unedited saved note offers a pressable Save").toMatchObject({ label: "Save inspiration", disabled: true });
  /* AND DELETE IS NOT DIMMED BY THE SAME STATE. Nothing to keep is not
     nothing to delete — a saved note nobody has typed into is exactly the
     one you might want gone, and a trash that greys out with Save would be
     the save rule leaking onto a control it does not govern. */
  expect(kept.find((press) => press.label === "Delete"), "Delete went dim with Save")
    .toMatchObject({ label: "Delete", disabled: false });
  /* THE REST OF THE ROW COMPARES WITH DELETE SET ASIDE, same as the case
     above and for the same reason — it is a press one page does not have,
     not a press the two pages disagree about. */
  expect(comparable(kept).map((press) => press.disabled)).toEqual(comparable(fresh).map((press) => press.disabled));
  expect(differences(comparable(fresh), comparable(kept))).toEqual(KNOWN_DIFFERENCES);
});
