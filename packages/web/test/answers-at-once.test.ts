/**
 * A MEMBER'S NAME IS AN ANSWER, AND AN ANSWER DOES NOT WAIT.
 *
 * Founder, 2026-09-08: "when in a room when I click on one of the agents
 * behind me, it takes a few seconds for the name to appear. It should show
 * immediately upon hover or click."
 *
 * WHAT IT WAS. A room draws one small being per member behind your companion,
 * and pointing at one lights it and writes its name above it — built on
 * 2026-08-27 from the founder's own ask. It was built as ONE number: `lit`,
 * the member's brightness, was also the name's alpha. And `lit` waits for
 * `notice`, a per-member delay drawn from the member's id, because a room
 * that turns to you in unison reads as a chorus line rather than as people.
 *
 * So the name inherited a delay that was designed for a body. MEASURED from
 * the arithmetic: `notice` is `unit(id, "nt") * 0.75`, so between 0 and 0.75
 * seconds, plus a 0.18s ramp — up to 0.93 seconds, and A DIFFERENT WAIT FOR
 * EVERY MEMBER. The same gesture answering at a different speed depending on
 * whom you pointed at is worse than a slow answer that is always slow: there
 * is nothing to learn, so it reads as the world being unsure.
 *
 * WHAT IT IS NOW. Two answers. The body keeps its raggedness — that is the
 * research finding it was built from and it costs no information. The name
 * rises from the instant of the notice, over `NAME_RISE`, on every member
 * equally.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). Nothing. `noticeLight` takes its clock
 * as arguments rather than reading `performance.now()`, precisely so this can
 * be checked without a browser to run frames in — the same reason
 * `canvas/scale.ts` takes a device ratio.
 */

import { describe, expect, it } from "vitest";

import {
  BODY_RISE,
  NAME_RISE,
  NOTICE_MS,
  groupCompanyPlaces,
  noticeLight,
} from "../src/space/group-company";

/** the notice's full brightness window: `msLeft` while nothing is fading out */
const HELD = NOTICE_MS;

describe("a noticed member answers at once, and turns in its own time", () => {
  it("names itself immediately, however long its own delay is", () => {
    /* the slowest member there can be, and the fastest */
    for (const notice of [0, 0.3, 0.75]) {
      expect(noticeLight(0.001, notice, HELD).name).toBeGreaterThan(0);
      expect(noticeLight(NAME_RISE, notice, HELD).name).toBe(1);
    }
  });

  it("makes every member's name arrive at the same speed", () => {
    const fast = noticeLight(0.05, 0, HELD).name;
    const slow = noticeLight(0.05, 0.75, HELD).name;
    expect(slow).toBe(fast);
  });

  it("still lets the room turn raggedly", () => {
    /* THE HALF THAT MUST NOT BE FIXED. At a fifth of a second the eager one
       has turned and the slow one has not, which is the whole point of
       `notice` — a room answering in unison is a chorus line. */
    expect(noticeLight(0.2, 0, HELD).body).toBe(1);
    expect(noticeLight(0.2, 0.75, HELD).body).toBe(0);
    expect(noticeLight(0.75 + BODY_RISE, 0.75, HELD).body).toBeCloseTo(1, 5);
  });

  it("gives nothing at all to a member nobody is pointing at", () => {
    expect(noticeLight(-1, 0, HELD)).toEqual({ body: 0, name: 0 });
  });

  it("lets the name and the body go together at the end", () => {
    /* a name outliving the light under it would leave a label floating over
       a dark room, which is the one shape this must never make */
    for (const msLeft of [900, 450, 90, 0]) {
      const late = noticeLight(1.5, 0, msLeft);
      expect(late.name).toBeCloseTo(late.body, 5);
    }
  });

  it("is the timing the room actually uses", () => {
    /* the tripwire: this file's numbers are only worth anything if the seats
       really carry a per-member delay inside the range it assumes */
    const seats = groupCompanyPlaces(
      [
        { profileId: "p1", name: "One", type: "human" },
        { profileId: "p2", name: "Two", type: "human" },
        { profileId: "p3", name: "Three", type: "agent" },
        { profileId: "me", name: "You", type: "human" },
      ] as never,
      "me",
    );
    expect(seats.length).toBe(3);
    for (const seat of seats) {
      expect(seat.notice).toBeGreaterThanOrEqual(0);
      expect(seat.notice).toBeLessThanOrEqual(0.75);
    }
    /* and they really do differ, or there was never a raggedness to keep */
    expect(new Set(seats.map((s) => s.notice)).size).toBeGreaterThan(1);
  });
});
