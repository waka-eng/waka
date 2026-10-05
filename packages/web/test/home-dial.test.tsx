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
 * WHAT THIS MOCKS, AND WHY (gate G6).
 *
 *   `lib/data` — the seam, and mocking `lib/api` INSTEAD is the mistake this
 *   project has already made once. The loaders throw on the first shape they
 *   do not recognise, the page catches that and answers by replacing the whole
 *   world with the dev fixture, and the suite then passes while describing a
 *   fixture. That would be especially invisible HERE, where every assertion is
 *   a count: the fixture has memories too, so the numbers would simply be
 *   someone else's and still move when the rail moved.
 *
 *   `lib/api` — for the group reads only, which have no loader above them.
 *   This file's facts hold no groups, so it keeps those fetches off the
 *   network rather than supplying anything.
 *
 *   `lib/auth-context` — the session stated as a fact, because the page also
 *   renders for a signed-out visitor and that is a different world.
 *
 *   `helpers/canvas-stub` and `helpers/render-home` — the canvas, the clock,
 *   the frame loop and the viewport. The clock matters more here than in any
 *   other file: the rail's two ends are computed from the page's own frozen
 *   `Date.now`, so the test and the dial are reading one calendar.
 *
 * `home-field.test.tsx` gives the long version of all four.
 *
 * THE INSTRUMENT IS A LIST OF DATES, NOT A RAIL (founder, 2026-08-30:
 * "instead of this draggable line, when clicking on now, just show the major
 * dates to make them clickable").
 *
 * Every claim above survived the change unaltered, which is the point of
 * writing them as counts: they are about WHAT EXISTS at a moment, and none of
 * them ever cared how a finger named that moment. What changed is the gesture
 * — press the word, press a date — and it changed in exactly one place below,
 * `windTo`, rather than in a dozen assertions about time.
 *
 * ONE CLAIM IS GENUINELY NEW, because the list can make it and the rail could
 * not: every date offered is a day with something standing on it. A rail
 * offered its whole length, and most of that length was the same wall shown
 * again at a different height — including a stretch at the far end where the
 * ground was simply empty.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT CLAIM.
 *
 * The canvas stub draws nothing (see canvas-stub.ts), so the fade itself and
 * the field closing over the gap are invisible here and no assertion below
 * mentions them. The counts are read from the loop's own audit.
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
/* AND ONE KEPT TODAY, which the list must NOT print as a date: the first row
   already says `now`, and a day offered twice under two names is a menu that
   cannot be read. The rail had no such hazard — a position is a position —
   so it is new with the list and it needs a case of its own below. */
const KEPT_DAYS = [0, 4, 21, 40, 61, 80, 101];

const FACTS = {
  inspirations: KEPT_DAYS.map((daysAgo, i) => ({
    id: `own-${i}`,
    text: `something I kept, ${i}`,
    daysAgo,
  })),
  /**
   * No groups. A room has a dial of its own now — it winds the room's board
   * along the room's own chain — but that is a different rail with a
   * different span, and it is `group-dial.test.tsx`'s subject. Every case
   * here is about YOUR archive, so a group on the axis would only add a wall
   * this file never stands on.
   */
  groups: [],
};

/* Why these three and not others: see the G6 paragraph in the header. */
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
/**
 * NOW, in the page's own frozen clock. Every date the list prints is spelled
 * against this — `dateWords` drops the year when it matches the year of the
 * moment it is read at — so a test spelling its expectations against a
 * different `now` would disagree with a correct list every New Year.
 */
let railEnd = 0;

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
  keptMs = (await dataMockFrom(FACTS).loadInspirations()).inspirations
    .map((row) => row.capturedMs)
    .sort((a, b) => a - b);
  /* The page's own clock, restated here rather than read from the page: a
     test that asked the dial what time it thought it was could not tell a
     correct dial from one that had agreed with itself about being wrong.
     `Date.now` is the frozen clock the harness installed, a second or so past
     the moment the page takes as the present — a second against a span of a
     hundred days, and every day this fixture holds is whole days clear of
     its neighbours. */
  railEnd = Date.now();
});

afterEach(() => {
  layout?.unmount();
});

/** how many of the fixture's memories had been kept by `t` */
const stood = (t: number) => keptMs.filter((ms) => ms <= t).length;

/**
 * The last instant of the day a moment falls on — which is where every stop
 * in the list lands, because winding to a day shows what the wall held UP TO
 * it. Computed here from the fixture's own moments, never read off the page.
 */
const endOfDayOf = (ms: number) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
};

/**
 * The days the list should print, newest first: every day this wall changed
 * that is far enough back for the word to be able to NAME it. Computed from
 * the fixture, never read from the page.
 *
 * Half a day is not a number picked here — it is the threshold the winder
 * itself uses to decide that a moment means the present. A row nearer than
 * that would be a second way of saying `now`, and pressing it would leave the
 * word reading `now` rather than the row's own words. That consequence is
 * asserted directly by the case that presses every row, so this filter is a
 * statement about the same fact rather than a copy of an implementation.
 */
const pastDays = () =>
  Array.from(new Set(keptMs.map(endOfDayOf)))
    .filter((ms) => railEnd - ms >= DAY / 2)
    .sort((a, b) => b - a);

function one(selector: string): HTMLElement {
  const el = layout.container.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`no ${selector} — the dial did not render`);
  return el;
}

/** the dates the page is offering, in the order it offers them */
const rows = () => Array.from(layout.container.querySelectorAll<HTMLElement>(".jar-dial-stop"));

/** press the word that says `now`, which is the only way the dates open */
async function openDates(): Promise<void> {
  if (rows().length > 0) return;
  await act(async () => {
    one(".jar-when").click();
  });
  if (rows().length === 0) {
    throw new Error(
      "pressing the word opened nothing. The dates are mounted from `timeOpen` " +
        "and that press is the only thing that sets it — every case below would " +
        "otherwise fail as though the dial were broken.",
    );
  }
}

/**
 * WIND THE WALL, AND PROVE IT MOVED BEFORE ANYTHING ELSE IS ASKED.
 *
 * This project has already shipped a test that passed because the gesture it
 * fired silently did nothing and it then re-measured the state it started in.
 * So the WORD is checked against the day the press asked for, loudly, on every
 * single wind — not once in one case. A dial that ignores the press, or one
 * whose rows are wired to the wrong moments, fails here with a sentence saying
 * so rather than in some later count that reads as a different bug entirely.
 *
 * The gesture is the whole gesture: press the word to open the dates, press a
 * date. Reaching into the page and calling `windTo` directly would exercise
 * the winding and leave the two presses — which are the only route a person
 * has — untouched.
 *
 * `label` is what the row must SAY, computed by the test from the fixture's
 * own moments. Finding the row by its words rather than by its index is what
 * makes "the list is in the wrong order" fail here instead of silently
 * winding somewhere else and failing as a count.
 */
async function windToDay(at: number): Promise<void> {
  await openDates();
  const label = dateWords(at, railEnd);
  const row = rows().find((r) => (r.textContent ?? "").trim() === label);
  if (!row) {
    throw new Error(
      `the dates do not offer ${JSON.stringify(label)}. They offer ` +
        `${JSON.stringify(rows().map((r) => (r.textContent ?? "").trim()))}. ` +
        `Every assertion below this would otherwise pass by re-measuring the ` +
        `moment the page opened at.`,
    );
  }
  await act(async () => {
    row.click();
  });
  /* Long enough for what leaves to finish leaving: a departing memory fades
     over 260ms, about sixteen frames, and the field then eases into the gap.
     Forty frames is that with room to spare — and the count this test reads
     only changes when the fade completes, so a stingy number here would look
     exactly like a broken dial. */
  await layout.step(40);

  const said = (one(".jar-when").textContent ?? "").trim();
  if (said !== label) {
    throw new Error(
      `the wall did not wind to the date that was pressed: pressed ` +
        `${JSON.stringify(label)}, the word now reads ${JSON.stringify(said)}. ` +
        'If it still says "now", the press never reached the winder.',
    );
  }
}

/** back to the present, by the row that says so */
async function windToNow(): Promise<void> {
  await openDates();
  const row = rows().find((r) => (r.textContent ?? "").trim() === "now");
  if (!row) throw new Error("the dates offer no way back to now");
  await act(async () => {
    row.click();
  });
  await layout.step(40);
  const said = (one(".jar-when").textContent ?? "").trim();
  if (said !== "now") {
    throw new Error(`pressing \`now\` left the word reading ${JSON.stringify(said)}`);
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

    const then = endOfDayOf(keptMs[2]);
    await windToDay(then);

    /* Three of six, and the three is the fixture's own arithmetic. A dial
       that reduced the count by some other amount is as wrong as one that
       reduced it by none. */
    expect(layout.audit().present, "the ground should hold only what had been kept by then").toBe(
      stood(then),
    );
    expect(layout.audit().present).toBeLessThan(keptMs.length);
  });

  it("leaves a whole ground behind, not a half-erased one", async () => {
    await layout.toField();
    const then = endOfDayOf(keptMs[2]);
    await windToDay(then);

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
    const then = endOfDayOf(keptMs[1]);
    await windToDay(then);

    /* The dial's one visible statement of WHEN, and the only thing telling a
       person which day they are looking at. It is checked against the same
       moment the counts above are checked against, so a readout that is fed
       the wrong time — today's, the list's end, the argument the other way
       round — parts company with the ground it is standing over. The words
       themselves come from the product's own formatter: what is pinned here
       is the wiring, not the spelling of a month. */
    expect(one(".jar-when").textContent, "the word should name the day wound to").toBe(
      dateWords(then, railEnd),
    );
  });

  it("puts the dates away once one of them has been pressed", async () => {
    /* A menu that stays open over the wall after it has been answered is the
       rail's own defect in a new shape: an instrument left switched on. The
       question it was opened to ask has been answered. */
    await layout.toField();
    await windToDay(endOfDayOf(keptMs[2]));
    expect(rows().length, "the dates are still standing over the wall").toBe(0);
  });
});

describe("winding the dial forward again", () => {
  it("brings the memories back, and brings them back switched on", async () => {
    await layout.toField();
    const then = endOfDayOf(keptMs[2]);
    await windToDay(then);
    expect(layout.audit().present, "the wind back happened").toBe(stood(then));

    await windToNow();

    expect(layout.audit().present, "everything kept exists again at now").toBe(keptMs.length);
    /* The half that is easy to lose: what returns has to be poured back in,
       not merely counted back in. Without that the ground reads full in the
       audit and draws the smaller set. */
    expectGroundIsWhole("wound forward to now");
  });
});

describe("how the list opens", () => {
  /**
   * A MOUSE ARRIVING ON THE WORD IS A REACH FOR THE LIST.
   *
   * Founder, 2026-09-08: "when I hover on now, the text list should appear."
   * This reverses half of 2026-08-30, and only half. A `timeNear` used to
   * open the rail on hover AND close it on leaving the word — which cannot
   * work for a menu, because the pointer has to leave the word to reach the
   * list. So the opening comes back and the closing does not: the ways out
   * are still a press on the word, a press anywhere else, and picking a day.
   *
   * AND IT IS GATED ON A MOUSE, which is the case a phone would otherwise
   * lose entirely: a tap fires `pointerenter` before it fires `click`, so an
   * ungated hover would open the list and the press would toggle it straight
   * shut. Both cases are here because passing one alone is what shipping the
   * bug looks like.
   */
  const arrive = (pointerType: string) => {
    const word = one(".jar-when");
    /* React routes `onPointerEnter` through `pointerover` with no
       `relatedTarget`, so that is the event a hover really is */
    word.dispatchEvent(
      new PointerEvent("pointerover", { bubbles: true, pointerType, relatedTarget: null }),
    );
  };

  it("opens the days when a mouse arrives on the word", async () => {
    expect(rows().length, "the list was already open before the hover").toBe(0);
    await act(async () => {
      arrive("mouse");
    });
    expect(rows().length, "hovering `now` opened nothing").toBeGreaterThan(0);
  });

  it("leaves the list up when the pointer travels to it", async () => {
    /* the whole reason the 2026-08-30 hover was removed: the list is not
       under the word, it is beside it, so a hover that closes on leaving is
       a list nobody can reach */
    await act(async () => {
      arrive("mouse");
    });
    const open = rows().length;
    await act(async () => {
      one(".jar-when").dispatchEvent(
        new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse" }),
      );
    });
    expect(rows().length, "the list went with the pointer").toBe(open);
  });

  it("keeps the list up when the word is pressed after the hover", async () => {
    /* THE REGRESSION THIS CASE EXISTS FOR. The first cut opened on hover and
       left the press a plain toggle, so the most ordinary gesture there is —
       move onto the word, then click the thing you are looking at — opened
       the list and shut it again in one motion. Found by pressing it the way
       Playwright does: `click()` moves the pointer first, so four walks that
       reach the dates through this word (`the-timeline`, `first-sixty`,
       `nothing-invisible`) were photographing a surface that was not there.
       A person who hovers and then presses means "yes, this one". */
    await act(async () => {
      arrive("mouse");
    });
    const open = rows().length;
    expect(open, "the hover opened nothing, so this case proves nothing").toBeGreaterThan(0);
    await act(async () => {
      one(".jar-when").click();
    });
    expect(rows().length, "the press after the hover shut the list").toBe(open);
  });

  it("still closes on the press after that, so the word is a way out", async () => {
    /* and the memory is spent, not permanent: the second press is the exit
       the 2026-08-30 note promised and this must not quietly remove */
    await act(async () => {
      arrive("mouse");
    });
    await act(async () => {
      one(".jar-when").click();
    });
    await act(async () => {
      one(".jar-when").click();
    });
    expect(rows().length, "the word stopped being a way out of its own list").toBe(0);
  });

  it("does not open under a finger, because the press already answers", async () => {
    await act(async () => {
      arrive("touch");
    });
    expect(
      rows().length,
      "a touch opened the list on `pointerenter`, so the press that follows " +
        "will toggle it shut and the word will do nothing on a phone",
    ).toBe(0);
  });
});

describe("what the list offers", () => {
  /**
   * THE ROWS ARE THE DAYS THIS WALL CHANGED, AND NOTHING ELSE IS ON THEM.
   *
   * The rail could not make this claim. It offered its whole length, and most
   * of that length was the same wall shown again at a different height — plus
   * a stretch at the far end, three days long, where the ground was simply
   * empty, because the rail began before the first thing you ever kept.
   *
   * Both halves are asserted, because each alone is satisfiable by a bug:
   * "every day the fixture holds is offered" passes for a list that also
   * offers a hundred days that hold nothing, and "every day offered holds
   * something" passes for a list of one.
   */
  it("lists the days this wall actually changed, newest first, and no others", async () => {
    await layout.toField();
    await openDates();

    const said = rows().map((r) => (r.textContent ?? "").trim());
    expect(said[0], "the first row is the way back to the present").toBe("now");

    expect(said.slice(1), "the dates offered are this wall's own days, newest first").toEqual(
      pastDays().map((ms) => dateWords(ms, railEnd)),
    );
  });

  it("offers nothing it cannot then name — every row is where the word lands", async () => {
    /**
     * THE ONE HAZARD A LIST HAS THAT A RAIL DID NOT. A position on a rail is
     * just a position; a ROW is a promise, and the promise it makes is the
     * words on it. The newest memory in this fixture was kept close enough to
     * the present that winding to it IS winding to now — so offering it as a
     * date would be the same destination under two names, and pressing it
     * would leave the word reading `now` rather than the row it answered.
     *
     * Every row is pressed and the word is read back. `windToDay` and
     * `windToNow` each throw with their own sentence if the two part company,
     * so a list that offered a day it could not name fails here by name.
     */
    await layout.toField();
    await openDates();
    const said = rows().map((r) => (r.textContent ?? "").trim());
    expect(said.length, "there are rows to press").toBeGreaterThan(1);
    expect(said.filter((t) => t === "now").length, "the present is offered once").toBe(1);
    expect(new Set(said).size, "and no row is offered twice").toBe(said.length);

    for (const label of said) {
      if (label === "now") {
        await windToNow();
        continue;
      }
      const at = pastDays().find((ms) => dateWords(ms, railEnd) === label);
      expect(at, `the list offers ${label}, which is not a day this wall changed`).toBeDefined();
      await windToDay(at as number);
    }
  });

  it("never offers a day with nothing standing on it", async () => {
    await layout.toField();
    await openDates();
    const dates = rows()
      .map((r) => (r.textContent ?? "").trim())
      .filter((t) => t !== "now");
    expect(dates.length, "there are dates to check").toBeGreaterThan(0);

    for (const label of dates) {
      const at = pastDays().find((ms) => dateWords(ms, railEnd) === label);
      expect(at, `the list offers ${label}, which is not a day this wall changed`).toBeDefined();
      await windToDay(at as number);
      expect(
        layout.audit().present,
        `${label} is offered but the wall is empty there — a date you can press ` +
          "and see nothing is the rail's own dead length come back",
      ).toBeGreaterThan(0);
      expect(layout.audit().present, `${label} should show what had been kept by then`).toBe(
        stood(at as number),
      );
    }
  });

  it("means today by `now`, not the day of your newest save", async () => {
    /**
     * The assertion the counts cannot make: the newest memory in this fixture
     * is four days old, so a list whose top row meant "the day of your last
     * save" would hold every memory and satisfy every count above, while the
     * four days since would have quietly vanished from the world.
     */
    await layout.toField();
    await windToDay(endOfDayOf(keptMs[0]));
    await windToNow();
    expect(one(".jar-when").textContent, "the top of the list is the present itself").toBe("now");
    expect(layout.audit().present, "and the present holds everything kept").toBe(keptMs.length);
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

    const then = endOfDayOf(keptMs[2]);
    await windToDay(then);
    /* the dial really is in the past — the ground says so, not just the word.
       A mouth that went quiet over a dial that had not moved would be a
       different bug wearing this test's green. */
    expect(layout.audit().present, "the dial is genuinely in the past").toBe(stood(then));
    expect(
      one(".jar-mouth-slot").className,
      "the mouth should be quiet while the dial is in the past",
    ).toContain("--away");

    await windToNow();
    expect(
      one(".jar-mouth-slot").className,
      "and open again once the dial is back at now",
    ).not.toContain("--away");
  });

  it("offers capture in the past, returns to now, and focuses the existing composer", async () => {
    await windToDay(endOfDayOf(keptMs[2]));
    expect(one(".jar-mouth-slot").hasAttribute("inert")).toBe(true);
    const shortcut = one(".jar-capture-shortcut");
    expect(shortcut.textContent).toContain("Capture inspiration");
    expect(shortcut.querySelector('[data-home-action-icon="capture"]')).not.toBeNull();
    await act(async () => shortcut.click());
    await layout.step(40);
    expect(one(".jar-when").textContent).toBe("now");
    const field = one(".jar-mouth-field");
    expect(field.getAttribute("placeholder")).toBe("A thought, link, photo or recording…");
    expect(document.activeElement).toBe(field);
  });

  it("offers capture from the ground and brings the pen back into view", async () => {
    await layout.toField();
    expect(one(".jar-mouth-slot").hasAttribute("inert")).toBe(true);
    await act(async () => one(".jar-capture-shortcut").click());
    await layout.step(80);
    const field = one(".jar-mouth-field");
    expect(document.activeElement).toBe(field);
    expect(one(".jar-mouth-slot").hasAttribute("inert")).toBe(false);
  });
});
