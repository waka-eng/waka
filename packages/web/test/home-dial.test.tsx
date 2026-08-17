// @vitest-environment jsdom

/**
 * THE DIAL DECIDES WHAT HAS HAPPENED YET.
 *
 * The rail down the right edge is the only control in this product that
 * changes what EXISTS rather than how it looks. Wind it back and the memories
 * kept after that moment have not happened: they fade where they stand, the
 * field closes over the gap, and the ground you are left looking at is the
 * ground of that day. Everything else on this surface — travelling, standing
 * in someone's ground, opening a memory — rearranges or relabels a fixed set.
 * The dial changes the set.
 *
 * It had no test at all. What that leaves unguarded is not a cosmetic risk:
 * a dial that moved its handle, printed a date, and quietly kept showing you
 * today would look completely correct in a screenshot and in a walkthrough,
 * because the only evidence it is working is a count going down.
 *
 * SO EVERY CASE HERE IS A COUNT, AND EVERY COUNT IS PREDICTED BY THE FIXTURE.
 * `stood(t)` below asks the test's own list of memories how many of them had
 * been kept by time `t`. It never asks the page. A test that read the expected
 * number out of the thing it is testing would agree with any bug.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT CLAIM.
 *
 * The canvas stub draws nothing (see canvas-stub.ts), so the fade itself, the
 * handle's glow and the companion's turn are all invisible here and no
 * assertion below mentions them. In particular the companion's yaw — which
 * `scrubTo` drives from the dial's position, and which is the whole of what
 * the second argument to `scrubTo` is for — lives only in the loop's own
 * state and is only ever read by the draw pass. There is no honest way to
 * observe it from here, so it is not covered rather than covered by a claim
 * about a pixel that was never painted.
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
import { dateWords } from "../src/lib/words";

const DAY = 86_400_000;
const VIEW_W = 1280;
const VIEW_H = 900;

/**
 * SIX MEMORIES, MONTHS APART, AND NEVER AN EVEN NUMBER OF DAYS APART.
 *
 * Spread rather than bunched because every position this test presses is
 * derived from arithmetic over the rail's whole span, and a fixture packed
 * into one week would put every boundary within a pixel of its neighbour —
 * the test would then be measuring rounding rather than the dial.
 *
 * The gaps are odd on purpose. Each target below is the midpoint between two
 * consecutive memories, and the memories are dated from a UTC midnight, so an
 * even gap would put the target ON a midnight, where the sub-second drift
 * between the page's clock and this test's reading of it could land the
 * printed date a whole day out. An odd gap puts every target at midday, hours
 * from the nearest boundary.
 */
const KEPT_DAYS = [4, 21, 40, 61, 80, 101];

const FACTS = {
  inspirations: KEPT_DAYS.map((daysAgo, i) => ({
    id: `own-${i}`,
    text: `something I kept, ${i}`,
    daysAgo,
  })),
  /**
   * No groups. The dial stays out of a group — a group's ground is many
   * people's and there is no one history to wind — so a group on the axis
   * would only add a wall this file never stands on.
   */
  groups: [],
};

/**
 * `lib/data` IS THE SEAM, and mocking `lib/api` INSTEAD is the mistake this
 * project has already made once: the loaders throw on the first shape they do
 * not recognise, the page catches that and answers by replacing the whole
 * world with the dev fixture, and the suite then passes while describing a
 * fixture. `lib/api` is mocked too, but only for the reads that genuinely go
 * through it (groups), exactly as home-field.test.tsx does.
 */
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
/** every memory's moment, straight from the fixture — never from the page */
let keptMs: number[] = [];
/** the rail's two ends, in the page's own frozen clock */
let railStart = 0;
let railEnd = 0;
/** where the finger last left the rail, so each wind is a drag from there */
let railAt = 1;

beforeAll(() => {
  installCanvasStub();
  setViewport(VIEW_W, VIEW_H);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(async () => {
  layout = await mountWorld(FACTS);
  /* The same rows the page was handed, asked of the same mock. Reading the
     moments back out of this rather than recomputing them from a base date
     means the test cannot drift out of agreement with the fixture helper. */
  keptMs = (await dataMockFrom(FACTS).loadInspirations())
    .map((row) => row.capturedMs)
    .sort((a, b) => a - b);
  /* The rail runs from three days before your earliest memory to now. Both
     numbers are the page's, and both are restated here rather than read from
     it: a test that asked the dial where its own ends were could not tell a
     correct dial from one that had agreed with itself about being wrong.
     `Date.now` is the frozen clock the harness installed, a second or so past
     the moment the page took as the rail's bottom end — a second against a
     span of a hundred days, and every target below sits half a day clear of
     the nearest boundary. */
  railStart = keptMs[0] - 3 * DAY;
  railEnd = Date.now();
  railAt = 1;
});

afterEach(() => {
  layout?.unmount();
});

/** how many of the fixture's memories had been kept by `t` */
const stood = (t: number) => keptMs.filter((ms) => ms <= t).length;

/** where on the rail a moment sits, 0 at the top and 1 at the bottom */
const railPos = (t: number) => (t - railStart) / (railEnd - railStart);

/** midway between two of the memories, where the answer is unambiguous */
const between = (older: number, newer: number) => (keptMs[older] + keptMs[newer]) / 2;

function one(selector: string): HTMLElement {
  const el = layout.container.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`no ${selector} — the dial did not render`);
  return el;
}

/**
 * WIND THE RAIL, AND PROVE IT MOVED BEFORE ANYTHING ELSE IS ASKED.
 *
 * This project has already shipped a test that passed because the gesture it
 * fired silently did nothing and it then re-measured the state it started in.
 * So the handle's own position is checked against the position the finger
 * asked for, loudly, on every single wind — not once in one case. A dial that
 * ignores the pointer, or one whose rail runs the other way, fails here with
 * a sentence saying so rather than in some later count that reads as a
 * different bug entirely.
 *
 * The gesture is a genuine drag from wherever the finger last was, because
 * that is the gesture: press the handle, pull it, let go. Pressing and
 * releasing at the target would exercise `onDialDown` alone and leave
 * `onDialMove` — the part that runs for the whole of a real scrub —
 * untouched.
 */
async function windTo(pos: number): Promise<void> {
  const rail = one(".jar-dial-track");
  const from = railAt * VIEW_H;
  const to = pos * VIEW_H;
  /* jsdom has PointerEvent, so this is the event the handler really receives
     rather than a mouse event wearing its name. The stubbed rect makes the
     rail the full viewport height, so clientY and position are the same
     number scaled. */
  const at = (kind: string, y: number) =>
    new PointerEvent(kind, { bubbles: true, cancelable: true, clientY: y, pointerId: 1 });
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

  /* Long enough for what leaves to finish leaving: a departing memory fades
     over 260ms, about sixteen frames, and the field then eases into the gap.
     Forty frames is that with room to spare — and the count this test reads
     only changes when the fade completes, so a stingy number here would look
     exactly like a broken dial. */
  await layout.step(40);

  const asked = pos * 100;
  const landed = Number.parseFloat(one(".jar-dial-handle").style.top);
  if (!Number.isFinite(landed) || Math.abs(landed - asked) > 0.5) {
    throw new Error(
      `the dial did not move to where the pointer asked: wanted ${asked.toFixed(2)}% ` +
        `down the rail, handle sits at "${one(".jar-dial-handle").style.top || "(nowhere)"}". ` +
        `Every assertion below this would otherwise pass by re-measuring the ` +
        `moment the page opened at. If the handle landed at the mirror of the ` +
        `position asked for, the rail is upside down: the top is the past.`,
    );
  }
}

/**
 * The invariant home-field.test.tsx exists to keep, restated for a wound dial:
 * every memory that exists at this moment is switched on, and every one that
 * is switched on is inside the band the eye can see. It is the only honest
 * way to say "the re-solve actually happened" — a scrub that marked the field
 * dirty and never reconciled leaves the departed memories still active, so
 * `active` sits at the old number while `present` has already dropped.
 */
function expectGroundIsWhole(where: string) {
  const a = layout.audit();
  expect(a.present, `${where}: nothing is standing here at all`).toBeGreaterThan(0);
  expect(a.drawn.active, `${where}: memories are present but never switched on`).toBe(a.present);
  expect(a.onScreen, `${where}: memories are switched on but outside the visible band`).toBe(
    a.present,
  );
}

describe("winding the dial back", () => {
  it("takes away the memories that had not happened yet", async () => {
    await layout.toField();
    expect(layout.audit().present, "the ground opens holding everything kept").toBe(keptMs.length);

    const then = between(2, 3);
    await windTo(railPos(then));

    /* Three of six, and the three is the fixture's own arithmetic. A dial
       that reduced the count by some other amount is as wrong as one that
       reduced it by none. */
    expect(
      layout.audit().present,
      "the ground should hold only what had been kept by then",
    ).toBe(stood(then));
    expect(layout.audit().present).toBeLessThan(keptMs.length);
  });

  it("leaves a whole ground behind, not a half-erased one", async () => {
    await layout.toField();
    const then = between(2, 3);
    await windTo(railPos(then));

    /* THE COUNT FIRST, THEN THE INVARIANT ABOUT IT.
       present === active === onScreen is trivially true of a dial that did
       nothing at all, and this case was written without this line and passed
       against a scrub whose time never reached the loop. Stating that the set
       genuinely changed is what makes the sentence below mean anything. */
    expect(layout.audit().present, "the wind back reached the ground").toBe(stood(then));
    expectGroundIsWhole("wound back");
  });

  it("says which day it has been wound to", async () => {
    await layout.toField();
    const then = between(1, 2);
    await windTo(railPos(then));

    /* The rail's one visible statement of WHEN, and the only thing telling a
       person which day they are looking at. It is checked against the same
       moment the counts above are checked against, so a readout that is fed
       the wrong time — today's, the rail's end, the argument the other way
       round — parts company with the ground it is standing over. The words
       themselves come from the product's own formatter: what is pinned here
       is the wiring, not the spelling of a month. */
    expect(one(".jar-dial-date").textContent, "the rail's date should name the day wound to").toBe(
      dateWords(then, railEnd),
    );
  });
});

describe("winding the dial forward again", () => {
  it("brings the memories back, and brings them back switched on", async () => {
    await layout.toField();
    await windTo(railPos(between(2, 3)));
    expect(layout.audit().present, "the wind back happened").toBe(stood(between(2, 3)));

    await windTo(1);

    expect(layout.audit().present, "everything kept exists again at now").toBe(keptMs.length);
    /* The half that is easy to lose: what returns has to be poured back in,
       not merely counted back in. Without that the ground reads full in the
       audit and draws the smaller set. */
    expectGroundIsWhole("wound forward to now");
  });
});

describe("which end of the rail is which", () => {
  it("runs from before your first memory at the top to today at the bottom", async () => {
    await layout.toField();
    await windTo(0);

    /* The rail opens three days before the earliest thing you ever kept, so
       its top end is a day on which this ground was genuinely empty. This is
       the one place that cannot use expectGroundIsWhole — nothing present is
       the correct answer — so wholeness is stated the other way round:
       nothing present, and nothing left switched on behind it. */
    const top = layout.audit();
    expect(top.present, "the top of the rail is before your first memory").toBe(0);
    expect(top.drawn.active, "and nothing is left lit after the last one leaves").toBe(0);
    expect(top.onScreen).toBe(0);

    await windTo(1);

    expect(layout.audit().present, "the bottom of the rail is now").toBe(keptMs.length);
    expectGroundIsWhole("at the bottom of the rail");
  });
});

describe("the mouth while the dial is away from now", () => {
  /**
   * You cannot keep something into last March. The mouth is the one control
   * that writes, and a mouth left open over a wound-back dial would put a
   * memory in the ground at a time it did not exist — so it goes quiet, and
   * comes back with now. That is a correctness rule wearing a fade, which is
   * why it is asserted as state (the class the page puts on the slot) rather
   * than as an opacity nobody here can see.
   */
  it("goes quiet in the past and comes back with now", async () => {
    await layout.toField();
    expect(one(".jar-mouth-slot").className, "the mouth is open at now").not.toContain("--away");

    const then = between(2, 3);
    await windTo(railPos(then));
    /* the dial really is in the past — the ground says so, not just the
       handle. A mouth that went quiet over a dial that had not moved would
       be a different bug wearing this test's green. */
    expect(layout.audit().present, "the dial is genuinely in the past").toBe(stood(then));
    expect(
      one(".jar-mouth-slot").className,
      "the mouth should be quiet while the dial is in the past",
    ).toContain("--away");

    await windTo(1);
    expect(
      one(".jar-mouth-slot").className,
      "and open again once the dial is back at now",
    ).not.toContain("--away");
  });
});
