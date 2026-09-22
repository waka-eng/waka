// @vitest-environment jsdom

/**
 * ANOTHER PERSON'S MEMORY OFFERS YOU NOTHING TO DO TO IT.
 *
 * Reported in the meeting of 2026-09-18, in passing and by someone who was
 * not looking for it: *"이상한게 내가 재규 영감에 뭘 추가할 수가 있네"* — the
 * odd thing is I can add something to Jae Gyu's inspiration.
 *
 * THE LAW WAS ALREADY WRITTEN, ten lines above the verbs it governs, in
 * `Home.tsx`: *"Only your own: another member's is theirs, and a room orb is
 * a statement that was shared rather than a memory that can be reached."*
 *
 * IT WAS ENFORCED THROUGH THE WRONG FACT. The gate read
 * `panelCanReflect = !panelIsGroup || own`, and `panelIsGroup` means
 * `col !== undefined`, which `orb.ts` defines in its own words: *"Which
 * column this orb lives in. Unset = the personal jar."* `col` and `own` are
 * room-orb extras — they exist on shared STATEMENTS.
 *
 * A member's own capture, seen because you stood in their ground on a group
 * wall, is not a room orb. It is an ordinary ball carrying an owner, `col` is
 * unset, so `panelIsGroup` was false and `!panelIsGroup` alone made the whole
 * row true: reflect, edit AND delete, offered on a memory belonging to
 * somebody else.
 *
 * NOTHING WAS EVER WRITTEN, and that is worth being exact about rather than
 * dramatic. Every inspiration handler goes through `resolveTargetProfile`,
 * which narrows to the session's own profile; a profile in another account
 * answers 404; and the reflections insert re-checks
 * `eq(inspirations.profileId, target.profileId)` before it runs. The server
 * refuses all three verbs. What shipped was a control that invites an act the
 * server must reject — which on `delete`, offered over somebody else's
 * memory, is not a small thing to have offered.
 *
 * SO THIS FILE ASKS THE QUESTION BY OWNER, NOT BY SHAPE. It does not care
 * whether an orb is a room orb; it cares whose memory it is. That is the
 * distinction the bug turned on, and testing the shape again would reproduce
 * the bug in the gate.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6).
 *
 *   `lib/data` — the seam for the three layers. Mocking `lib/api` instead is
 *   the mistake gate G6 names: the loaders throw on a shape they do not know,
 *   the page answers by replacing the world with the dev fixture, and the
 *   suite passes while describing that fixture. Here that would be
 *   particularly quiet, because the fixture has a group with other people's
 *   memories in it — the surface would look right and belong to nobody this
 *   test chose.
 *
 *   `lib/api` — for the group reads, which have no loader above them.
 *
 *   `lib/auth-context` — to be a known viewer, since "whose is this" is the
 *   entire subject and it is answered against the session's profile id.
 *
 *   `helpers/canvas-stub` and `helpers/render-home` — the canvas, clock,
 *   frame loop and viewport. The canvas matters here for the same reason it
 *   does in `home-memory.test.tsx`: orbs are painted, not rendered, so the
 *   only way to open one is to press across the ground until it answers.
 */
import { act } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { installCanvasStub, setViewport } from "./helpers/canvas-stub";
import { apiMockFrom, dataMockFrom, mountWorld, VIEWER_ID, type MountedWorld } from "./helpers/render-home";

const VIEW_W = 1280;
const VIEW_H = 900;

const THEM = "profile-someone-else";
const GROUP = "group-the-reading-circle";

/** A room with one memory of yours in it and three of somebody else's. */
const FACTS = {
  inspirations: [0, 6, 19].map((daysAgo, i) => ({
    id: `own-${i}`,
    text: `something I kept, ${i}`,
    daysAgo,
  })),
  groups: [
    {
      id: GROUP,
      name: "the reading circle",
      field: [
        { id: "mine-in-room", ownerProfileId: VIEWER_ID, ownerName: "You", daysAgo: 2 },
        { id: "theirs-1", ownerProfileId: THEM, ownerName: "Jae Gyu", daysAgo: 3 },
        { id: "theirs-2", ownerProfileId: THEM, ownerName: "Jae Gyu", daysAgo: 9 },
        { id: "theirs-3", ownerProfileId: THEM, ownerName: "Jae Gyu", daysAgo: 16 },
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
  return { ...actual, useOptionalAuth: () => session, useAuth: () => session };
});

let layout: MountedWorld;

const pointer = { pointerId: 1, pointerType: "mouse", bubbles: true } as const;

async function pressOn(el: HTMLElement, x: number, y: number): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, cancelable: true, clientX: x, clientY: y }));
  });
}
async function liftAt(x: number, y: number): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new PointerEvent("pointerup", { ...pointer, clientX: x, clientY: y }));
  });
}
function canvas(): HTMLElement {
  const el = layout.container.querySelector("canvas");
  if (!el) throw new Error("no canvas — the layout never mounted");
  return el as HTMLElement;
}

/** Press across the ground until a memory answers. */
async function openAMemory(): Promise<HTMLElement> {
  const a = layout.audit();
  if (a.drawn.active === 0) throw new Error("the ground is empty — nothing to press");
  const step = Math.max(12, Math.floor(a.drawn.rMin));
  for (let y = Math.floor(a.highest); y <= Math.ceil(a.lowest); y += step) {
    for (let x = 20; x <= VIEW_W + 120; x += step) {
      await pressOn(canvas(), x, y);
      await liftAt(x, y);
      await layout.step(24);
      const open = layout.container.querySelector<HTMLElement>(".jar-panel--in");
      if (open) return open;
    }
  }
  throw new Error(`nothing opened: ${a.drawn.active} drawn, band ${a.highest}–${a.lowest}`);
}

/** Every verb the open panel is offering. */
const verbsOf = (panel: HTMLElement): string[] =>
  Array.from(panel.querySelectorAll<HTMLElement>(".jar-panel-foot button"))
    .map((b) => (b.textContent ?? "").trim())
    .filter((t) => t !== "");

beforeAll(() => {
  installCanvasStub();
  setViewport(VIEW_W, VIEW_H);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(async () => {
  layout = await mountWorld(FACTS);
});

afterEach(() => {
  layout?.unmount();
});

describe("a memory that is not yours", () => {
  it("offers you nothing to do to it", async () => {
    await layout.travelTo(/reading circle/i);
    await layout.standIn(/Jae Gyu/i);
    await layout.step(30);

    const panel = await openAMemory();
    expect(
      verbsOf(panel),
      "somebody else's memory offered verbs — the law is 'only your own', and " +
        "`delete` over another person's memory is not a small thing to offer",
    ).toEqual([]);
  });

  it("still offers them on your own, which is what makes the case above mean something", async () => {
    /* WITHOUT THIS the case above passes on a panel that never opened, on a
       ground that never loaded, and on a verb row this file cannot find. */
    await layout.step(30);
    const panel = await openAMemory();
    const verbs = verbsOf(panel);
    expect(verbs.length, "your own memory offered no verbs either — the selector is wrong, not the gate").toBeGreaterThan(0);
  });
});
