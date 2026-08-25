// @vitest-environment jsdom

/**
 * A ROOM'S DIAL WINDS THE ROOM, NOT YOU.
 *
 * goal: no-quiet-corners, Phase 8 — "dial-scrubbing the room's history (the
 * timeline is served and told — the dial does not yet wind it)".
 *
 * The dial used to stay out of a group, and the reason written in
 * `space-kinds/index.ts` was that a group is several people's statements
 * arriving on their own clocks so there is no single history to scrub. That is
 * true of a room's FIELD and it was never true of the thing the dial governs.
 * A room's board is one chain — version one superseded by version two — hung
 * on one door ledger of arrivals and departures. That is a single history.
 *
 * Three claims, and each of them fails in a way a screenshot would miss:
 *
 *   1. THE RAIL SPANS THE ROOM'S LIFE, not yours. Your archive can predate a
 *      room by months, and a rail whose top half is a room that did not exist
 *      puts every mark on it in the wrong place while looking perfectly fine.
 *
 *   2. THE DOOR'S MARKS ARE ON IT. `goals/room-timeline.md` names this as the
 *      phase's unmet thesis — "join marks are not hinges: every stop renders
 *      the same class, so a join is visually identical to a refresh".
 *
 *   3. WINDING BACK SHOWS THE SENTENCE THE ROOM ACTUALLY HAD UP. This is the
 *      one that matters and the one most likely to rot into a lie: a dial that
 *      moves its handle, prints a date and keeps showing today's sentence
 *      looks completely correct to the eye, because the only evidence it is
 *      working is a sentence that was never on screen before.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6).
 *
 *   `lib/data` — the seam above the loaders, for the reason `home-dial` gives
 *   at length: mocking `lib/api` instead lets a shape mismatch throw inside a
 *   loader, which the page answers by replacing the world with the dev
 *   fixture, and the suite then passes while describing a fixture.
 *
 *   `lib/api` — the group reads, which have no loader above them. This file
 *   supplies the two the room's history is made of and which nothing else
 *   mocks: `fetchGroupTimeline` (the chain and the door's ledger) and a
 *   `fetchGroupTopOfMind` that answers differently when a version is named.
 *   That second one is the whole point — a mock that ignored the version
 *   argument would agree with the bug this file exists to catch.
 *
 *   `lib/auth-context` — the session as a fact, because the page also renders
 *   for a signed-out visitor and that is a different world.
 *
 *   `helpers/canvas-stub` and `helpers/render-home` — the canvas, the clock,
 *   the frame loop and the viewport. The clock matters here as much as in
 *   `home-dial`: the rail's ends are computed from the page's own frozen
 *   `Date.now`, so the test and the dial read one calendar.
 *
 * WHAT IT DELIBERATELY DOES NOT CLAIM. The canvas stub draws nothing, so the
 * hinge's appearance is asserted as a mark in the DOM at a position, never as
 * a pixel. Whether it READS as a hinge is the founder's eye, and that gate is
 * named in the goal rather than faked here.
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

const DAY = 86_400_000;
const VIEW_W = 1280;
const VIEW_H = 900;

const GROUP_ID = "group-reading-circle";
const GROUP_NAME = "the reading circle";

/** What the room reads now, and what it read before that. */
const NOW_TEXT = "We ask the owner when the spec and the code disagree.";
const THEN_TEXT = "We ship the thing we can explain to a stranger.";

/**
 * THE ROOM IS YOUNGER THAN THE ARCHIVE, ON PURPOSE.
 *
 * The viewer's oldest memory is two hundred days old; the room's first mark is
 * a hundred. If the rail in a room were still spanning YOUR archive, every
 * position this file presses would land on the wrong month — and the handle
 * would still move, the date would still print, and only the sentence would
 * be wrong. Which is exactly the failure being guarded.
 */
const OWN_DAYS = [3, 30, 200];
const DOOR_DAYS = [100, 45];
/** version 1 goes up at ninety days; version 2 supersedes it at ten */
const V1_DAYS = 90;
const V2_DAYS = 10;

const FACTS = {
  inspirations: OWN_DAYS.map((daysAgo, i) => ({
    id: `own-${i}`,
    text: `something I kept, ${i}`,
    daysAgo,
  })),
  groups: [
    {
      id: GROUP_ID,
      name: GROUP_NAME,
      field: [
        { id: "them-1", ownerProfileId: "profile-other", ownerName: "Bo", daysAgo: 20 },
        { id: "mine-1", ownerProfileId: VIEWER_ID, ownerName: "You", daysAgo: 25 },
      ],
    },
  ],
};

/* The page's clock is frozen by the helper; these are read off it in
   `beforeAll` so the fixture and the dial share one calendar. */
let ago: (days: number) => number;

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  const base = apiMockFrom(FACTS);
  const day = 86_400_000;
  /* Date.now is stubbed by the helper before the page mounts, and these
     factories run at call time, so they see the frozen clock. */
  const iso = (days: number) => new Date(Date.now() - days * day).toISOString();
  return {
    ...actual,
    ...base,
    /** The chain, newest first, exactly as the endpoint serves it. */
    fetchGroupTimeline: async (groupId: string) => {
      if (groupId !== GROUP_ID) return { versions: [], doorMarks: [] };
      return {
        versions: [
          {
            id: "v2",
            version: 2,
            status: "live" as const,
            reason: "member_proposal",
            entryCount: 1,
            createdAt: iso(V2_DAYS),
          },
          {
            id: "v1",
            version: 1,
            status: "superseded" as const,
            reason: "initial",
            entryCount: 1,
            createdAt: iso(V1_DAYS),
          },
        ],
        doorMarks: DOOR_DAYS.map((days, i) => ({
          profileId: `profile-${i}`,
          name: i === 0 ? "You" : "Bo",
          kind: "joined" as const,
          occurredAt: iso(days),
        })),
      };
    },
    /**
     * THE READ THAT HAS TO NOTICE THE VERSION.
     *
     * A mock that returned the live board whatever it was asked for would pass
     * every assertion below on a page that had never learned to ask — which is
     * this file's entire subject.
     */
    fetchGroupTopOfMind: async (groupId: string, version?: number) => {
      if (groupId !== GROUP_ID) return { topOfMind: null, entries: [] };
      const body = version === 1 ? THEN_TEXT : NOW_TEXT;
      const at = version === 1 ? V1_DAYS : V2_DAYS;
      return {
        topOfMind: {
          id: `tom-${version ?? 2}`,
          version: version ?? 2,
          status: version === 1 ? "superseded" : "live",
          reason: version === 1 ? "initial" : "member_proposal",
          createdAt: iso(at),
        },
        entries: [
          {
            id: `entry-${version ?? 2}`,
            type: "pattern",
            body,
            belief: null,
            prompt: null,
            lockedAt: null,
            pinnedAt: iso(at),
            sortOrder: 0,
            createdAt: iso(at),
            contributors: [{ profileId: VIEWER_ID, name: "You" }],
          },
        ],
      };
    },
  };
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
/** the rail's two ends in the room, in the page's own clock */
let railStart = 0;
let railEnd = 0;
let railAt = 1;

beforeAll(() => {
  installCanvasStub();
  setViewport(VIEW_W, VIEW_H);
});

beforeEach(async () => {
  layout = await mountWorld(FACTS);
  ago = (days: number) => Date.now() - days * DAY;
  await layout.travelTo(new RegExp(GROUP_NAME, "i"));
  await layout.toField();
  /* the room's rail: three days before its first mark, to now */
  railStart = ago(DOOR_DAYS[0]) - 3 * DAY;
  railEnd = Date.now();
  railAt = 1;
});

afterEach(() => {
  layout?.unmount();
});

function one(selector: string): HTMLElement {
  const el = layout.container.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`no ${selector} — the room's dial did not render`);
  return el;
}

const railPos = (t: number) => (t - railStart) / (railEnd - railStart);

/** The poster of the wall being stood on — the room's. */
function posterText(): string {
  const el = layout.container.querySelector<HTMLElement>('h1.jar-poster[data-jar-chrome="1"]');
  if (!el) {
    const seen = [...layout.container.querySelectorAll("h1.jar-poster, p.jar-forming")].map((n) =>
      (n.textContent ?? "").trim(),
    );
    throw new Error(`no poster on the room's wall — saw: ${JSON.stringify(seen)}`);
  }
  return (el.textContent ?? "").trim();
}

/**
 * Wind the rail, and prove it moved before anything else is asked — the same
 * rule `home-dial` states at length, for the same reason: this project has
 * shipped a test that passed because its gesture silently did nothing and it
 * then re-measured the state it started in.
 */
async function windTo(pos: number): Promise<void> {
  const rail = one(".jar-dial-track");
  const from = railAt * VIEW_W;
  const to = pos * VIEW_W;
  const at = (kind: string, x: number) =>
    new PointerEvent(kind, { bubbles: true, cancelable: true, clientX: x, pointerId: 1 });
  await act(async () => {
    rail.dispatchEvent(at("pointerdown", from));
  });
  await act(async () => {
    rail.dispatchEvent(at("pointermove", to));
  });
  await act(async () => {
    rail.dispatchEvent(at("pointerup", to));
  });
  railAt = pos;
  /* the past board arrives a request later than the wind, so the frames here
     have to outlast a resolved promise as well as the fade */
  await layout.step(40);
  await act(async () => {
    await Promise.resolve();
  });
  await layout.step(10);

  const asked = pos * 100;
  const landed = Number.parseFloat(one(".jar-dial-handle").style.left);
  if (!Number.isFinite(landed) || Math.abs(landed - asked) > 0.5) {
    throw new Error(
      `the room's dial did not move to where the pointer asked: wanted ` +
        `${asked.toFixed(2)}% along the rail, handle sits at ` +
        `"${one(".jar-dial-handle").style.left || "(nowhere)"}".`,
    );
  }
}

describe("the dial in a room", () => {
  it("is there at all — a room's board is one chain, and one chain can be wound", async () => {
    const dial = one(".jar-dial");
    expect(
      dial.className.includes("jar-dial--away"),
      "the dial faded out over the room: `hasDial` still refuses a group",
    ).toBe(false);
  });

  it("spans the room's life rather than the viewer's archive", async () => {
    /* The viewer's oldest memory is two hundred days old and the room's
       history begins a hundred days ago. Wind to the very start of the rail
       and ask what day it landed on: a rail spanning the ROOM answers with
       the room's opening, and one still spanning the archive answers with
       something twice as old.

       THIS USED TO COUNT THE DOOR'S MARKS. The marks were 1px ticks on the
       rail for who joined and who left, and they were removed on 2026-08-25
       — the founder asked four times, having read them as a stray `||`
       rather than as events. Counting them was never the claim anyway; it
       was a way of reading the rail's span off the DOM, and it took the
       whole test down with the feature. The date the dial reports is the
       same reading, taken from the thing the test is actually about. */
    await windTo(0);
    /* The dial prints a day and a month and no year — it is a label, not a
       timestamp — so the year has to be supplied to read it back. This rail
       spans about a hundred days, well inside one year, so today's is right;
       a rail that ever spans a new year would need the label to carry one. */
    const shown = one(".jar-dial-date").textContent ?? "";
    const days = Math.round(
      (Date.now() - Date.parse(`${shown.trim()} ${new Date().getFullYear()}`)) / DAY,
    );
    expect(
      Number.isFinite(days) ? days : NaN,
      `wound to the far left, the dial says "${shown}". A rail spanning this ` +
        `room starts about ${Math.round((Date.now() - railStart) / DAY)} days ` +
        `back; one still spanning the viewer's archive would start about 200.`,
    ).toBeLessThan(150);
  });

  it("shows the sentence the room actually had up, not today's", async () => {
    expect(posterText(), "the room should open at what it reads now").toContain(NOW_TEXT);

    /* Halfway between the first board going up and the second superseding it:
       one moment where the answer is unambiguous. */
    await windTo(railPos((ago(V1_DAYS) + ago(V2_DAYS)) / 2));

    const then = posterText();
    expect(
      then,
      "wound back between the two versions, the room still shows today's sentence — " +
        "the dial moved and the board did not follow it",
    ).not.toContain(NOW_TEXT);
    expect(then, "and it should be the version that was actually up").toContain(THEN_TEXT);
  });

  it("says the room had nothing up before it had anything up", async () => {
    /* Wound back past the first version — but not past the room's own start —
       the honest answer is a blank wall, and a blank wall is a `formingAlt`
       line rather than a poster: there is no sentence to set. Falling back to
       the live board would print today's sentence over a month that never had
       one, which is the single thing a history must not do.

       Read off the whole surface rather than off one element, because the
       claim is an ABSENCE and the honest way to state it is that neither of
       the room's two sentences is anywhere on screen. Both belong to this
       room alone, so no other wall can supply them. */
    await windTo(railPos((ago(DOOR_DAYS[0]) + ago(V1_DAYS)) / 2));
    const surface = layout.container.textContent ?? "";
    expect(
      surface,
      "a room before its first board must not show its latest one",
    ).not.toContain(NOW_TEXT);
    expect(surface, "nor the one that had not been written yet").not.toContain(THEN_TEXT);
    expect(
      surface,
      "and it should say so rather than showing an unexplained blank",
    ).toContain("Nothing read together yet");
  });

  it("comes back to now, and back to what the room reads now", async () => {
    await windTo(railPos((ago(V1_DAYS) + ago(V2_DAYS)) / 2));
    expect(posterText()).toContain(THEN_TEXT);
    await windTo(1);
    expect(
      posterText(),
      "the rail's bottom end is now, and now is the live board",
    ).toContain(NOW_TEXT);
  });
});
