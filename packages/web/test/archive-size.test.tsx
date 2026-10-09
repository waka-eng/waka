// @vitest-environment jsdom

/**
 * WHAT THE ARCHIVE HOLDS, WHICH IS NOT WHAT ARRIVED.
 *
 * Every ground in this product loads up to a ceiling — ten pages of two
 * hundred for a personal archive, four hundred for a room's field. The
 * ceilings are deliberate: following a cursor forever lets one very old
 * account stall the world's first paint, so the field is honestly short rather
 * than slow.
 *
 * "Honestly short" was honest to somebody reading `lib/data.ts`. On screen, at
 * two and a half thousand memories, the door read `2000 inspirations`, the
 * ground drew two thousand orbs, and five hundred memories were absent from
 * both with nothing said anywhere — measured, at that size, in
 * `docs/audits/at-scale-2026-08-26.md`.
 *
 * The direction is what makes it worth a test rather than a note. The product
 * UNDERSTATED what it holds, in an archive whose whole promise is that it
 * keeps what you give it. Somebody who reached the ceiling had every reason to
 * read it as memories lost.
 *
 * So both numbers appear when they differ, and — the half that is easy to lose
 * later — NEITHER appears twice when they do not. A door that reads
 * `9 of 9 inspirations` on an ordinary account would be a worse bug than the
 * one this fixes, because every account would meet it.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). Three seams.
 *
 *   `lib/data` — THE RIGHT SEAM, and the subject of this file. The page reaches
 *   layer 1 through `loadInspirations`, which follows the cursor, translates
 *   the rows, and — since 2026-08-27 — reports what the archive holds beside
 *   what it walked. That last number is exactly what is under test, so the
 *   mock has to sit where it is produced. Mocking `lib/api` instead would put
 *   invented rows through translations written for real ones; the first
 *   mismatch throws inside the loader, the page catches it, calls
 *   `offlineHome()` and replaces the whole world with the dev fixture — and
 *   every assertion below would pass, in green, against data no product code
 *   produced. `helpers/render-home.tsx` carries the same warning beside
 *   `dataMockFrom`, and `withFixtureAlarm` is the net under it.
 *
 *   `lib/api` — for the group reads only, through `apiMockFrom`. Those have no
 *   loader above them, so here the HTTP client genuinely is the layer directly
 *   beneath the page. This world has no rooms in it; the mock is present so
 *   that the room fetches resolve rather than reach a network.
 *
 *   `lib/auth-context` — the session, stated rather than fetched. The page
 *   renders for a signed-out visitor too, and the door under test only appears
 *   for somebody standing in a world of their own.
 *
 * The canvas, the clock, the frame loop and the viewport come from
 * `helpers/canvas-stub` and `helpers/render-home`: the parts of a browser a
 * test cannot have for real. The simulation itself is NOT mocked — the same
 * effects and the same layout pass run here as ship.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { installCanvasStub, setViewport } from "./helpers/canvas-stub";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { createElement } from "react";

import { apiMockFrom, dataMockFrom, VIEWER_ID } from "./helpers/render-home";

/** Nine kept, and — as far as this world is concerned — nine held. */
const FACTS = {
  inspirations: Array.from({ length: 9 }, (_, i) => ({
    id: `own-${i}`,
    text: `something I kept, ${i}`,
    daysAgo: i + 1,
  })),
  groups: [],
};

/**
 * How many the archive says it holds. A `let` because the two cases differ
 * only in this number, and the mock factory below is hoisted above them both.
 */
let heldTotal = 9;

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return { ...actual, ...apiMockFrom(FACTS) };
});

vi.mock("../src/lib/data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/data")>();
  const honest = dataMockFrom(FACTS);
  return {
    ...actual,
    ...honest,
    /* The walk stopped at nine. Whether that was the end of the archive or the
       end of the ceiling is exactly what `total` answers. */
    loadInspirations: async () => {
      const field = await honest.loadInspirations();
      return {
        inspirations: field.inspirations,
        total: heldTotal,
        short: heldTotal > field.inspirations.length,
      };
    },
  };
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


beforeAll(() => {
  installCanvasStub();
  setViewport(1280, 900);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

/**
 * THE COUNT IS ON THE PAGE IT COUNTS.
 *
 * It rode the bottom bar's Inspirations button, then the menu row that
 * replaced that, and both are gone — a fact about the archive belongs on the
 * archive rather than on whatever happens to point at it. So this mounts the
 * archive's own page. Same span, same words, same `loadInspirations` behind
 * it, which is where the "never smaller than what arrived" invariant lives.
 */
let root: Root | null = null;
let host: HTMLElement | null = null;

async function doorText(): Promise<string> {
  const { Inspirations } = await import("../src/pages/Inspirations");
  const { AuthProvider } = await import("../src/lib/auth-context");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      createElement(
        MemoryRouter,
        null,
        createElement(AuthProvider, null, createElement(Inspirations)),
      ),
    );
  });
  /* The page fetches its own archive; the count cannot be read before it has. */
  for (let turn = 0; turn < 12 && !host.querySelector(".jar-saved-count"); turn += 1) {
    await act(async () => { await Promise.resolve(); });
  }
  const door = host.querySelector(".jar-saved-count");
  return (door?.textContent ?? "").replace(/\s+/g, " ").trim();
}

describe("the count under the door", () => {
  it("is one number when the walk reached the end of the archive", async () => {
    heldTotal = 9;
    /* The ordinary case, and the one every account lives in for a long time:
       nine kept, nine held, and nothing said about a ceiling nobody met. */
    expect(await doorText()).toBe("9 inspirations");
  });

  it("says both when the archive holds more than the walk reached", async () => {
    heldTotal = 2500;
    /* The first number is still the orbs in the ground the caret takes you
       into (founder, 2026-08-25). The second is what is actually kept. */
    expect(await doorText()).toBe("9 of 2500 inspirations");
  });

  it("never states a size smaller than what it is standing on", async () => {
    /**
     * THE INVARIANT, STATED AS ITS OWN CASE.
     *
     * A total is fetched, a ground is edited in place, and the two can only
     * disagree in one direction that makes sense. If a stale or wrong total
     * ever came back BELOW the number of orbs actually present, `N of M` would
     * print a memory count lower than the memories on screen — the product
     * contradicting itself in one sentence, which is worse than the silence
     * this replaced.
     *
     * `loadInspirations` holds this with a `max` and the door only speaks when
     * the total is strictly greater, so a smaller total is absorbed into the
     * ordinary case rather than printed.
     */
    heldTotal = 2;
    expect(await doorText()).toBe("9 inspirations");
  });
});
