// @vitest-environment jsdom

/**
 * THE GROUND, WITHOUT A POINTER.
 *
 * `docs/audits/by-keyboard-2026-08-26.md` found the chrome excellent — eight
 * stops, every one named, every one visibly focused, the mouth fully usable
 * with keys — and then found that a person who cannot use a pointer could put
 * memories in and could not get a single one back out. An orb is painted
 * pixels: no element, no `tabindex`, nothing for Tab to land on.
 *
 * The reach is the answer, and the shape of it was a decision rather than an
 * oversight: roving focus IN the world rather than a list of saves beside it.
 * One tab stop for the whole ground, `aria-activedescendant` naming the
 * cursor, and the ordinary `select` on the way — so the orb lights, the
 * companion leans and the panel opens exactly as a tap would.
 *
 * `e2e:by-keyboard` holds the same three facts against a real browser, which
 * is the only place a Tab CYCLE is real. What is held here is the wiring the
 * browser walk can only observe from outside: which memories the ground
 * offers, in what order, and that a cursor moves along them.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). Three seams.
 *
 *   `lib/data` — THE RIGHT SEAM. The page reaches the three layers through
 *   `loadInspirations` / `loadSignals` / `loadTopOfMind`, which paginate and
 *   translate on the way down. Mock `lib/api` instead and invented rows go
 *   through translations written for real ones; the first mismatch throws
 *   inside a loader, the page catches it and replaces the whole world with the
 *   dev fixture, and every assertion below would pass against data no product
 *   code produced. `withFixtureAlarm` in `helpers/render-home` is the net.
 *
 *   `lib/api` — the group reads only, which have no loader above them.
 *
 *   `lib/auth-context` — the session, stated rather than fetched. The reach
 *   belongs to somebody standing in a world of their own.
 *
 *   `helpers/canvas-stub` and `helpers/render-home` — the canvas, the clock,
 *   the frame loop and the viewport: the parts of a browser a test cannot
 *   have for real. The simulation itself is NOT mocked. The same effects, the
 *   same layout pass and the same activation rules run here as ship, which is
 *   why `toField()` below stands in a real ground and `select` refuses an orb
 *   that is not in it.
 */
import { act } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { installCanvasStub, setViewport } from "./helpers/canvas-stub";
import { apiMockFrom, dataMockFrom, mountWorld, VIEWER_ID, type MountedWorld } from "./helpers/render-home";

/** Five memories, each with words of its own so an order can be read back. */
const FACTS = {
  inspirations: [
    { id: "own-oldest", text: "the first thing I ever kept", daysAgo: 40 },
    { id: "own-2", text: "a second thought", daysAgo: 30 },
    { id: "own-3", text: "a third", daysAgo: 20 },
    { id: "own-4", text: "a fourth", daysAgo: 10 },
    { id: "own-newest", text: "what I kept this morning", daysAgo: 1 },
  ],
  groups: [],
};

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return { ...actual, ...apiMockFrom(FACTS) };
});

vi.mock("../src/lib/data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/data")>();
  return { ...actual, ...dataMockFrom(FACTS) };
});

vi.mock("../src/lib/auth-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/auth-context")>();
  const session = {
    status: "authenticated",
    account: { id: "account-1", email: "you@example.test" },
    profile: { id: VIEWER_ID, name: "You", type: "human" },
    profiles: [],
    refresh: async () => undefined,
    signOut: async () => undefined,
  };
  return { ...actual, useOptionalAuth: () => session, useAuth: () => session };
});

let layout: MountedWorld;

beforeAll(() => {
  installCanvasStub();
  setViewport(1280, 900);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(async () => {
  layout = await mountWorld(FACTS);
  /* The reach belongs to the ground and exists nowhere else — standing at the
     wall there is no field to move a cursor along. */
  await layout.toField();
});

afterEach(() => {
  layout?.unmount();
});

const reach = (): HTMLElement => {
  const el = layout.container.querySelector<HTMLElement>(".jar-reach");
  if (!el) throw new Error("the ground has no keyboard reach");
  return el;
};

const options = (): HTMLElement[] => [...reach().querySelectorAll<HTMLElement>('[role="option"]')];

async function press(key: string): Promise<void> {
  await act(async () => {
    reach().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
  await layout.step(2);
}

describe("the ground answers to the keyboard", () => {
  it("is one stop for the whole ground, named for a listener", () => {
    const el = reach();
    expect(el.getAttribute("role")).toBe("listbox");
    expect(el.tabIndex).toBe(0);
    /* Named, and named with the two keys that work — a listbox whose label is
       "your memories" tells a reader what it is and not what to do with it. */
    const label = el.getAttribute("aria-label") ?? "";
    expect(label).not.toBe("");
    expect(label.toLowerCase()).toContain("arrow");
    expect(label.toLowerCase()).toContain("enter");
  });

  it("offers every memory in the ground, newest first", () => {
    /* Newest first is NOT the field's own order — the field lays memories down
       oldest-first so its layout never moves. This is a reading order over the
       same ground: somebody opening their archive starts at what they last
       kept. */
    expect(options().map((o) => o.textContent)).toEqual([
      "what I kept this morning",
      "a fourth",
      "a third",
      "a second thought",
      "the first thing I ever kept",
    ]);
  });

  it("has no cursor until somebody asks for one", () => {
    /* The world never moves unless the user moved it, and a cursor sitting on
       a memory nobody chose is the world having an opinion on arrival. */
    expect(reach().getAttribute("aria-activedescendant")).toBeNull();
    expect(options().filter((o) => o.getAttribute("aria-selected") === "true")).toEqual([]);
  });

  it("starts at the newest and walks back through time", async () => {
    await press("ArrowDown");
    expect(reach().getAttribute("aria-activedescendant")).toBe("jar-reach-own-newest");

    await press("ArrowDown");
    expect(reach().getAttribute("aria-activedescendant")).toBe("jar-reach-own-4");

    await press("ArrowUp");
    expect(reach().getAttribute("aria-activedescendant")).toBe("jar-reach-own-newest");
  });

  it("cannot be walked off either end", async () => {
    await press("End");
    expect(reach().getAttribute("aria-activedescendant")).toBe("jar-reach-own-oldest");
    await press("ArrowDown");
    expect(
      reach().getAttribute("aria-activedescendant"),
      "past the oldest memory there is nothing, and nothing is where it stays",
    ).toBe("jar-reach-own-oldest");

    await press("Home");
    expect(reach().getAttribute("aria-activedescendant")).toBe("jar-reach-own-newest");
    await press("ArrowUp");
    expect(reach().getAttribute("aria-activedescendant")).toBe("jar-reach-own-newest");
  });

  it("marks exactly one memory as the one in hand", async () => {
    await press("ArrowDown");
    await press("ArrowDown");
    const selected = options().filter((o) => o.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0]?.id).toBe("jar-reach-own-4");
  });

  it("opens the memory it is standing on, and closes it again", async () => {
    await press("Enter");
    /* The same verb the pointer has. `select` toggles, so the keyboard gets
       the whole of it rather than a one-way version. */
    expect(layout.container.querySelector(".jar-panel--in")).not.toBeNull();

    await press("Enter");
    /* `--out` rather than gone: the card fades, and the node it fades out of
       is removed by a real 200ms timer that this harness's clock does not
       drive — it advances frames, not `setTimeout`. Asserting on absence here
       would be asserting on the harness. What the second Enter is responsible
       for is the panel being on its way out, and that is in the class. */
    expect(layout.container.querySelector(".jar-panel--in")).toBeNull();
    expect(layout.container.querySelector(".jar-panel--out")).not.toBeNull();
  });

  it("lights and opens each memory as the cursor arrives on it", async () => {
    /**
     * SELECTION FOLLOWS THE CURSOR, and that is the design rather than a
     * convenience. Light is this product's only meaning channel: a cursor
     * that moved without lighting anything would leave a sighted person
     * pressing arrows at a world that does not react, which is the quiet
     * corner this whole family of work exists to close. So an arrow runs the
     * same `select` a tap runs — the orb lights, the companion leans, the
     * card opens beside it — and Enter is left as the toggle for the one in
     * hand.
     */
    await press("End");
    const oldest = layout.container.querySelector(".jar-panel--in");
    expect(
      oldest?.textContent ?? "",
      "the oldest memory in the ground, read with one key and no pointer at all",
    ).toContain("the first thing I ever kept");

    await press("ArrowUp");
    const nextUp = layout.container.querySelector(".jar-panel--in");
    expect(nextUp?.textContent ?? "").toContain("a second thought");
  });
});
