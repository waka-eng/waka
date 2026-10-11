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
 *   `lib/api` — for the group reads ONLY. `fetchGroups`, `fetchGroupField`,
 *   `fetchGroupMembers` and the rest have no loader above them, so here the
 *   client genuinely IS the layer directly beneath the page. Two different
 *   seams for two different reads is not an inconsistency; it is the shape of
 *   the code being described accurately.
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

const OTHER = "profile-other";

/**
 * A viewer with nine memories of their own, in a group whose ground holds
 * theirs and one other person's. The counts are deliberately different so a
 * filter that silently does nothing cannot pass by coincidence.
 */
const FACTS = {
  inspirations: Array.from({ length: 9 }, (_, i) => ({
    id: `own-${i}`,
    text: `something I kept, ${i}`,
    daysAgo: i + 1,
  })),
  groups: [
    {
      id: "group-1",
      name: "The four of us",
      field: [
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `g-mine-${i}`,
          ownerProfileId: VIEWER_ID,
          ownerName: "You",
          daysAgo: i + 2,
        })),
        ...Array.from({ length: 3 }, (_, i) => ({
          id: `g-theirs-${i}`,
          ownerProfileId: OTHER,
          ownerName: "Hana",
          daysAgo: i + 4,
        })),
      ],
    },
  ],
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

  /**
   * THE REGRESSION, AS A TEST.
   *
   * `arriveColumn` re-ran the layout and gave every newly-present memory a
   * home, but `active` is only ever set by `enter()` through a pour or by
   * `settleInstantly`, and travelling ran neither. Measured at the time: 0 of
   * 9 present. Against the commit before the fix this case fails and the two
   * either side of it pass, which is the point — the failure is specific.
   */
  it("is whole after travelling to another wall", async () => {
    await layout.travelTo(/four of us/i);
    await layout.toField();
    expectGroundIsWhole("after travelling");
  });

  it("is whole again after travelling back", async () => {
    await layout.travelTo(/four of us/i);
    await layout.toField();
    await layout.travelTo(/^me$/i);
    await layout.toField();
    expectGroundIsWhole("after returning");
  });
});

describe("whose ground you are standing in", () => {
  it("starts as your own, and holds only your memories", async () => {
    await layout.travelTo(/four of us/i);
    await layout.toField();
    const a = layout.audit();

    expect(a.ground, "the default ground is the viewer's own").toBeNull();
    expect(a.present, "five of the group's memories are the viewer's").toBe(5);
    expectGroundIsWhole("standing in my own ground");
  });

  /**
   * Switching is the product's claim that a group's ground belongs to one
   * person at a time. If the count does not change, the switch drew a
   * different label over the same memories — which is what happened the first
   * time this was built, and it read as working.
   */
  it("changes the memories, not just the label, when you switch", async () => {
    await layout.travelTo(/four of us/i);
    await layout.toField();
    const mine = layout.audit().present;

    await layout.standIn(/hana/i);
    const theirs = layout.audit();

    expect(theirs.ground, "the switch reached the simulation").toBe(OTHER);
    expect(theirs.present, "Hana kept three of the group's memories").toBe(3);
    expect(theirs.present).not.toBe(mine);
    expectGroundIsWhole("standing in Hana's ground");
  });

  it("comes back to your own ground when you switch back", async () => {
    await layout.travelTo(/four of us/i);
    await layout.toField();
    await layout.standIn(/hana/i);
    await layout.standIn(/^you$/i);

    const a = layout.audit();
    expect(a.ground).toBeNull();
    expect(a.present).toBe(5);
    expectGroundIsWhole("back in my own ground");
  });
});

/**
 * WHAT THE CLAIM IS STANDING ON.
 *
 * A group's poster is its board's lead entry, and under it sits the peek row:
 * the memories that entry was read from. That row was EMPTY for every group,
 * because the provenance map was written under a hand-built key
 * (`room:<id>`, then `cached:<id>`) while the only reader asked for
 * `spaceKey(w)` — `group:<id>`. Two spellings, both wrong, and 64 tests
 * stayed green through both.
 *
 * A count is the smallest assertion that would have caught it. The rule is
 * not "provenance is non-empty" in general — a group whose members shared
 * nothing genuinely has none — it is that a group WITH shared signals feeding
 * its decision has a claim standing on something.
 */
describe("what a wall's claim rests on", () => {
  it("is not empty on a group whose shared signals fed its decision", async () => {
    await layout.travelTo(/four of us/i);
    await layout.toField();

    const a = layout.audit();
    expect(a.wallKind, "we are standing on the group").toBe("group");
    expect(
      a.provenanceCount,
      "the group's poster is standing on nothing — check the key the " +
        "provenance map is written under against spaceKey()",
    ).toBeGreaterThan(0);
  });
});
