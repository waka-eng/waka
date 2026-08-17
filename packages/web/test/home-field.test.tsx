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
 * What this deliberately does not check is appearance. The canvas here draws
 * nothing (see canvas-stub.ts), so brightness, colour and position on screen
 * are outside its reach and no test in this file may claim otherwise.
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

let world: MountedWorld;

beforeAll(() => {
  installCanvasStub();
  setViewport(1280, 900);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(async () => {
  world = await mountWorld(FACTS);
});

afterEach(() => {
  world?.unmount();
});

/** The one sentence this file exists to keep true. */
function expectGroundIsWhole(where: string) {
  const a = world.audit();
  expect(a.present, `${where}: nothing is standing here at all`).toBeGreaterThan(0);
  expect(a.drawn.active, `${where}: memories are laid out but never switched on`).toBe(
    a.present,
  );
  expect(a.onScreen, `${where}: memories are switched on but outside the visible band`).toBe(
    a.present,
  );
}

describe("the ground under a wall", () => {
  it("is whole when the world first opens", async () => {
    await world.toField();
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
    await world.travelTo(/four of us/i);
    await world.toField();
    expectGroundIsWhole("after travelling");
  });

  it("is whole again after travelling back", async () => {
    await world.travelTo(/four of us/i);
    await world.toField();
    await world.travelTo(/waka|just me/i);
    await world.toField();
    expectGroundIsWhole("after returning");
  });
});

describe("whose ground you are standing in", () => {
  it("starts as your own, and holds only your memories", async () => {
    await world.travelTo(/four of us/i);
    await world.toField();
    const a = world.audit();

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
    await world.travelTo(/four of us/i);
    await world.toField();
    const mine = world.audit().present;

    await world.standIn(/hana/i);
    const theirs = world.audit();

    expect(theirs.ground, "the switch reached the simulation").toBe(OTHER);
    expect(theirs.present, "Hana kept three of the group's memories").toBe(3);
    expect(theirs.present).not.toBe(mine);
    expectGroundIsWhole("standing in Hana's ground");
  });

  it("comes back to your own ground when you switch back", async () => {
    await world.travelTo(/four of us/i);
    await world.toField();
    await world.standIn(/hana/i);
    await world.standIn(/^you$/i);

    const a = world.audit();
    expect(a.ground).toBeNull();
    expect(a.present).toBe(5);
    expectGroundIsWhole("back in my own ground");
  });
});
