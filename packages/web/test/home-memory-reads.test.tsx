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
  updateInspiration: async (id: string, input: { text: string }) => {
    S.written.push({ id, text: input.text });
    S.store.set(id, input.text);
    /* the server's row, as the PATCH answers it */
    return { id, profileId: VIEWER_ID, text: input.text, kind: "note", category: null, source: "app", visibility: "private",
      createdAt: new Date(Date.UTC(2026, 9, 1)).toISOString(), updatedAt: new Date().toISOString(), attachments: [], reflections: [] };
  },
}));
vi.mock("../src/lib/data", async (original) => ({
  ...await original<typeof import("../src/lib/data")>(),
  ...dataMockFrom(FACTS),
  loadInspiration: (id: string) => {
    const answer = () => row(id, S.store.get(id) ?? "");
    if (id !== "own-4" || S.hold === null) return Promise.resolve(answer());
    if (S.hold === "fail") return Promise.reject(new Error("offline"));
    return new Promise((done, fail) => {
      S.held.push({ resolve: () => done(answer()), reject: () => fail(new Error("offline")) });
    });
  },
}));
vi.mock("../src/lib/auth-context", async (original) => {
  const session = { status: "authenticated", account: { id: "account-1", email: "you@example.test" },
    profile: { id: VIEWER_ID, name: "You", type: "human" }, profiles: [], refresh: async () => undefined, signOut: async () => undefined };
  return { ...await original<typeof import("../src/lib/auth-context")>(), useOptionalAuth: () => session, useAuth: () => session };
});

let go: ReturnType<typeof useNavigate>;
function RouterTools() { go = useNavigate(); useLocation(); return null; }

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
