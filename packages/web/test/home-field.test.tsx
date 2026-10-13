// @vitest-environment jsdom

/**
 * THE GROUND IS WHAT IT SAYS IT IS.
 *
 * This is the test that did not exist when a real bug shipped. Travelling to a
 * wall ran the layout — every memory standing there got a place — but nothing
 * switched them on, so the wall drew an empty ground with a fully solved field
 * behind it. Three green checks missed it: the front-end suite never drew a
 * canvas, the back-end suites never open a browser, and the one diagnostic the
 * page had was itself broken, counting every wall's memories at once and so
 * reporting the same number wherever you stood.
 *
 * The invariant below is the whole of what those checks were missing:
 *
 *     present === active === onScreen
 *
 * Every memory that exists on this wall at this moment is switched on, and
 * every one that is switched on is inside the band the eye can see. Any two of
 * those three agreeing is not enough — the bug had `present` and `onScreen`
 * agreeing perfectly while `active` sat at zero.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). Four seams, and the first is the one the
 * gate was written for.
 *
 *   `lib/data` — THE RIGHT SEAM, and the reason G6 exists. The page reaches
 *   the three layers through `loadInspirations` / `loadSignals` /
 *   `loadTopOfMind`, which paginate and translate on the way down; the HTTP
 *   client is a layer below that and the page never calls it for these. Mock
 *   `lib/api` instead and the invented rows go through translations written
 *   for real ones, the first mismatch throws inside a loader, and the page
 *   does what it is built to do — it catches, calls `offlineHome()` and
 *   replaces the entire world with the dev fixture. Every assertion here would
 *   then hold, in green, against a world no product code had produced. That is
 *   not hypothetical: it is what happened on the first attempt at this file,
 *   and it was caught only because the fixture's wall has a recognisable name.
 *   `helpers/render-home.tsx` carries the same warning beside `dataMockFrom`,
 *   and `fixture-says-so.test.ts` proves the fixture now announces itself.
 *
 *   `lib/api` — FOR WHAT HAS NO LOADER ABOVE IT. This used to read "for the
 *   group reads ONLY": `fetchGroups`, `fetchGroupField`, `fetchGroupMembers`
 *   and the rest had no loader above them, so the client genuinely WAS the
 *   layer directly beneath the page, and two seams for two kinds of read was
 *   the shape of the code rather than an inconsistency. Rooms went on
 *   2026-10-12 (founder: "방 없애"); what is left of `apiMockFrom` is three
 *   verbs that answer with nothing, and the rule it illustrates still holds
 *   for the next read that arrives without a loader.
 *
 *   `lib/auth-context` — the session, stated rather than fetched. The page
 *   reads the OPTIONAL hook and renders for a signed-out visitor too, so
 *   without this the suite would be measuring the visitor's world. How a
 *   session is actually obtained is `auth-boundary.test.ts`'s subject.
 *
 *   `helpers/canvas-stub` and `helpers/render-home` — the canvas, the clock,
 *   the frame loop, the viewport and `Math.random`: the parts of a browser a
 *   test cannot have for real. The simulation itself is NOT mocked. The same
 *   `useEffect`, the same layout pass and the same activation rules run here
 *   as ship, which is the only reason the invariant above means anything.
 *
 * What this deliberately does not check is appearance. The canvas here draws
 * nothing (see canvas-stub.ts), so brightness, colour and position on screen
 * are outside its reach and no test in this file may claim otherwise.
 */
import { act } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { installCanvasStub, setViewport } from "./helpers/canvas-stub";
import {
  apiMockFrom,
  dataMockFrom,
  mountWorld,
  VIEWER_ID,
  type MountedWorld,
} from "./helpers/render-home";

/**
 * A viewer with nine memories of their own.
 *
 * IT USED TO HOLD A ROOM TOO — "The four of us", whose ground carried five of
 * the viewer's memories and three of Hana's, counts deliberately different so
 * that a filter silently doing nothing could not pass by coincidence. Rooms
 * went on 2026-10-12 (founder: "방 없애"), and with them five cases in this
 * file. They are named where they stood.
 */
const FACTS = {
  inspirations: Array.from({ length: 9 }, (_, i) => ({
    id: `own-${i}`,
    text: `something I kept, ${i}`,
    daysAgo: i + 1,
  })),
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
  return {
    ...actual,
    /* the page reads the OPTIONAL hook — it renders for a signed-out visitor too */
    useOptionalAuth: () => session,
    useAuth: () => ({
      status: "authenticated",
      account: { id: "account-1", email: "you@example.test" },
      profile: { id: VIEWER_ID, name: "You", type: "human" },
      profiles: [],
      refresh: async () => undefined,
      signOut: async () => undefined,
    }),
  };
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

/** The one sentence this file exists to keep true. */
function expectGroundIsWhole(where: string) {
  const a = layout.audit();
  expect(a.present, `${where}: nothing is standing here at all`).toBeGreaterThan(0);
  expect(a.drawn.active, `${where}: memories are laid out but never switched on`).toBe(
    a.present,
  );
  expect(a.onScreen, `${where}: memories are switched on but outside the visible band`).toBe(
    a.present,
  );
}

describe("native input inside the world", () => {
  /* `jar-inspiration-composer`, WHERE THIS NAMED `jar-reflect-room`
     (2026-10-10). The surface was the standalone reflect sheet, which went
     with the folded writing flow — and a suite that builds a node with a class
     nothing renders is describing a surface the product does not have, which
     is the same shape as a message nothing renders. The composer is a live
     `.jar-seek` with a real textarea in it, so the property is now asserted
     about a surface a person can actually be standing in. The property itself
     is unchanged: a native writer inside world chrome owns its own keystroke
     and the camera's shortcuts must not steal it. */
  it("lets a writer inside world chrome type a slash without opening search", async () => {
    const sheet = document.createElement("div");
    sheet.className = "jar-seek jar-inspiration-composer";
    sheet.setAttribute("role", "dialog");
    const answer = document.createElement("textarea");
    sheet.append(answer);
    layout.container.querySelector(".jar")!.append(sheet);
    const key = new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true });
    await act(async () => answer.dispatchEvent(key));
    expect(key.defaultPrevented, "the writer owns its slash").toBe(false);
    expect(layout.container.querySelectorAll(".jar-seek")).toHaveLength(1);
    sheet.remove();
  });

  it.each(["jar-roomform", "jar-seek jar-inspiration-composer", "jar-settings", "jar-dial"])(
    "leaves wheel scrolling to %s instead of cancelling it for the camera",
    async (className) => {
      const sheet = document.createElement("div");
      sheet.className = className;
      sheet.setAttribute("data-jar-chrome", "1");
      layout.container.querySelector(".jar")!.append(sheet);
      const wheel = new WheelEvent("wheel", { deltaY: 240, bubbles: true, cancelable: true });
      await act(async () => sheet.dispatchEvent(wheel));
      expect(wheel.defaultPrevented, "the browser must be able to scroll this surface").toBe(false);
      sheet.remove();
    },
  );
});

describe("the ground under a wall", () => {
  it("is whole when the layout first opens", async () => {
    await layout.toField();
    expectGroundIsWhole("on opening");
  });

  /* ═══ THE REGRESSION THIS FILE EXISTS FOR CANNOT BE STAGED ANY MORE ═════
     Two cases stood here — "is whole after travelling to another wall" and
     "is whole again after travelling back" — and they were the reason this
     suite was written. `arriveColumn` re-ran the layout and gave every newly
     present memory a home, but `active` is only ever set by `enter()`
     through a pour or by `settleInstantly`, and travelling ran neither.
     Measured at the time: 0 of 9 present. Against the commit before that fix
     these two failed and the ones either side passed, which was the point —
     the failure was specific.

     BOTH TRAVELLED TO A ROOM, because a room was the only second wall a
     fixture could cheaply have: an agent's wall needs an agent bundle, and
     this file mocks `lib/data` rather than the agent roster. Rooms went on
     2026-10-12 (founder: "방 없애").

     WHAT IS LEFT COVERING IT: `home-memory` and `where-it-last-went` both
     travel to an agent's wall and assert the ground, and the invariant itself
     — present === active === onScreen — is asserted on opening below and
     after every pour in `home-light`. If the lateral-travel activation bug
     ever returns, the first place to re-stage it is here with an AGENT wall,
     which is a bigger fixture and the honest cost of rooms going. */


  /**
   * NOTHING ARRIVES BY TRAVELLING — the pour, as a test.
   *
   * Founder, 2026-10-11: "When I save an inspiration, I don't know why the
   * balls are forming and headed to the bottom of the page. That's from the
   * old design that we got completely rid of." The staggered arrival is
   * deleted; the tombstone and the whole argument are where `POUR_MS` used to
   * be in `canvas/simulation.ts`.
   *
   * WHY THIS MEASUREMENT AND NOT A PICTURE. The canvas here draws nothing, so
   * no test in this file may claim anything about appearance — but "an orb is
   * part-way through arriving" is not an appearance, it is a number the field
   * publishes about itself. `arrive` runs 0 → 1 across an entrance and is 1 on
   * a ball that was placed rather than flown, so `drawn.arriveMin` is 1 for a
   * field that is simply there and less than 1 for one that is still coming in.
   *
   * AND IT IS MEASURED HERE, with no `toField()` and no extra frames, because
   * that is the window the pour lived in. `mountWorld` ends at 30 frames —
   * 501ms — and the pour's deadlines ran from 300ms at 35ms apiece, so against
   * the commit before this one, four of these nine memories are still staged
   * at this instant: `drawn.active` reads 5 or 6 of 9 and `arriveMin` reads 0.
   * Step the clock further and both heal, which is exactly why the case above
   * could not see the pour and this one can.
   */
  it("has nothing part-way through arriving, the moment the world exists", () => {
    const a = layout.audit();
    expect(a.present, "nothing is standing on this wall at all").toBeGreaterThan(0);
    expect(
      a.drawn.active,
      "memories are laid out but not switched on — an arrival is still in flight",
    ).toBe(a.present);
    expect(
      a.drawn.arriveMin,
      "an orb is part-way through an entrance: the field is animating its own arrival",
    ).toBe(1);
  });
});

/* ═══ WHOSE GROUND YOU ARE STANDING IN — GONE WITH THE ROOM ══════════════
   Founder, 2026-10-12: "방 없애" — remove rooms.

   Three cases: the default ground is your own, switching CHANGES THE
   MEMORIES rather than the label, and switching back returns you. The middle
   one carried the argument — "if the count does not change, the switch drew a
   different label over the same memories, which is what happened the first
   time this was built, and it read as working." A room's ground belonged to
   one person at a time and the band of names was how you chose whose; both
   are deleted, along with `MountedWorld.standIn` and the audit's `ground`
   field having anything to report. */


/* ═══ WHAT THE CLAIM IS STANDING ON — GONE WITH THE ROOM ════════════════
   A room's poster was its board's lead entry, and under it sat the peek row:
   the memories that entry was read from. That row was EMPTY for every room,
   because the provenance map was written under a hand-built key
   (`room:<id>`, then `cached:<id>`) while its only reader asked for
   `spaceKey(w)` — `group:<id>`. Two spellings, both wrong, and 64 tests
   stayed green through both. A count was the smallest assertion that would
   have caught it.

   THE RULE OUTLIVES THE ROOM and is worth carrying to the next keyed map:
   write and read a key through the SAME FUNCTION, never through two strings
   that have to agree. `pages/Home` keeps that note where the room branch
   used to be. */
