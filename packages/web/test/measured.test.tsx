// @vitest-environment jsdom

/**
 * THE LOOP STILL REACHES THE PAGE'S ELEMENTS.
 *
 * WHAT THIS MOCKS AND WHY (gate G6). The same four seams every suite that
 * mounts this page uses, for the same reasons `home-field.test.tsx` gives at
 * length:
 *
 *   `lib/data` — THE SEAM THAT MATTERS. The page reads the three layers
 *   through the loaders, not through the HTTP client, so this is the module
 *   directly beneath it. Mocking one layer lower would send invented rows
 *   through translations that throw, and the page answers a throw by replacing
 *   the world with the dev fixture — green, and describing nothing.
 *
 *   `lib/api` — for the group reads only, which genuinely do go straight
 *   through it. There are no groups in this file's facts, so this mock exists
 *   to keep those fetches off the network rather than to supply anything.
 *
 *   `lib/auth-context` — the session, stated as a fact. The page renders for a
 *   signed-out visitor too, so without this it would render the visitor's
 *   version and the twelve elements below would not all exist.
 *
 *   `helpers/canvas-stub` and `helpers/render-home` — the canvas, the clock,
 *   the frame loop, the viewport and `Math.random`. Each is a thing a test
 *   cannot have for real, and each file says why in its own header.
 *
 * Nothing below asserts anything about the mocked material itself — the counts
 * and the names are scenery, and every assertion is about an element the loop
 * wrote into.
 *
 * AND THAT IS EXACTLY WHY THIS FILE CANNOT POLICE ITS OWN SEAM. The seam above
 * is correct, but nothing here could tell if it were not. Measured during the
 * G6 survey: with `lib/data` deliberately unmocked, this file mounts the dev
 * fixture — 24 invented memories in place of the 3 declared below, the
 * fixture's "Course marketing" wall on screen — and all four tests PASS, since
 * "the loop wrote a transform into this element" is true of any world at all.
 * Every other suite that mounts the page goes loudly red under the same break;
 * this one did not, which makes it the closest thing in the package to a
 * repeat of the original incident.
 *
 * It is not covered by better assertions here, because sharper assertions
 * would change what this file is for — the twelve elements are the subject and
 * their contents are not. It is covered by `withFixtureAlarm` in
 * `helpers/render-home.tsx`, which now refuses to hand back a world the
 * fixture produced, so a wrong seam fails at mount before any assertion runs.
 * That guard is the reason this paragraph describes a closed hole rather than
 * an open one.
 *
 * WHY IT EXISTS. `canvas/measured.ts` collects the twelve elements the canvas
 * side reads and writes. The whole file is a promise that `.current` is read AT
 * USE TIME rather than captured once, and the failure mode when that promise
 * breaks is silent: a captured element is simply the one that was mounted when
 * the loop started, or `null`, and every write goes to the wrong place or
 * nowhere. Nothing throws and nothing else in the suite notices.
 *
 * Measured before this file was written, by pinning each of the twelve to its
 * value at construction and re-running everything: freezing `root` or `canvas`
 * turned the existing suite red, and freezing the other TEN left all 65 tests
 * green. Ten silent holes in the one place a silent failure was predicted is
 * not a net.
 *
 * WHAT IT CHECKS, AND WHAT IT STILL CANNOT. Four more of the twelve —
 * `atmos`, `hq`, `charSay` and `mouth` — are written by the loop into styles a
 * DOM test can read back, so they are checked here, and freezing any one of
 * them turns this file red. The remaining six are still uncovered and it is
 * worth saying which and why rather than implying a coverage that is not
 * there: `grain` is written by the palette pass from a canvas the stub does
 * not really rasterise; `hqInner` is only ever READ, and what it feeds is the
 * companion's size, which lives on the canvas; `nebEls`, `clusterEls` and
 * `satSay` need a formed candidate and a pointer resting on one of its
 * satellites; `mouthSpot` is measured once, at the moment a memory is kept.
 *
 * It also does not check that anything LOOKS right. The canvas draws nothing
 * here (see canvas-stub.ts), so a transform being present is the claim, and
 * the number inside it is not.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { installCanvasStub, setViewport } from "./helpers/canvas-stub";
import {
  apiMockFrom,
  dataMockFrom,
  mountWorld,
  VIEWER_ID,
  type MountedWorld,
} from "./helpers/render-home";

/** One person, three memories. The loop writes the same styles either way. */
const FACTS = {
  inspirations: Array.from({ length: 3 }, (_, i) => ({
    id: `own-${i}`,
    text: `something I kept, ${i}`,
    daysAgo: i + 1,
  })),
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
});

afterEach(() => {
  layout?.unmount();
});

function need(selector: string): HTMLElement {
  const el = layout.container.querySelector<HTMLElement>(selector);
  expect(el, `${selector} is not on the page at all`).not.toBeNull();
  return el as HTMLElement;
}

describe("what the frame loop writes into the page", () => {
  /**
   * The root is the one place the columns' own CSS gets its numbers from, and
   * it is written once per resize rather than per frame — so a frozen root is
   * a layout that never learns how big it is.
   */
  it("gives the root the viewport it measured", async () => {
    await layout.step(2);
    const root = need(".jar");
    expect(root.style.getPropertyValue("--jar-vw"), "the measured width").toBe("1280px");
    expect(root.style.getPropertyValue("--jar-vh"), "the measured height").toBe("900px");
    /* the seam the mouth hangs off — a real number, never zero */
    const seam = Number.parseInt(root.style.getPropertyValue("--jar-seam"), 10);
    expect(seam, "the seam between headquarters and the field").toBeGreaterThan(0);
  });

  /**
   * The volume is a layout-tall gradient, so the loop writes its height as
   * well as its transform. A frozen `atmos` leaves both empty and the page
   * looks like it has no depth at all.
   */
  it("gives the volume its height and rides it down the camera", async () => {
    await layout.step(2);
    const atmos = need(".jar-atmos");
    expect(Number.parseInt(atmos.style.height, 10), "the volume's height").toBeGreaterThan(0);
    expect(atmos.style.transform, "the volume rides the vertical camera").toMatch(
      /translate3d/,
    );
  });

  /**
   * Headquarters and the mouth both ride BOTH axes — they are two layers of
   * one wall, which is why they are checked together.
   */
  it("carries headquarters and the mouth on the camera", async () => {
    await layout.step(2);
    expect(need(".jar-hq").style.transform, "headquarters rides the camera").toMatch(
      /translate3d/,
    );
    expect(need(".jar-mouth").style.transform, "the mouth rides the camera").toMatch(
      /translate3d/,
    );
  });

  /**
   * The companion's whisper is the one element written from BOTH passes: its
   * `top` comes from the resize, where the companion's slot is solved, and its
   * transform comes from the frame, cancelling the horizontal camera so it
   * stays screen-anchored. Checking both is what makes this specific — a
   * freeze that only broke one of the two would otherwise pass.
   */
  it("puts the companion's whisper where the companion is", async () => {
    await layout.step(2);
    const say = need(".jar-char-say");
    expect(Number.parseInt(say.style.top, 10), "solved against the companion's slot")
      .toBeGreaterThan(0);
    expect(say.style.transform, "screen-anchored against the horizontal camera").toMatch(
      /translate3d/,
    );
  });
});
