import { describe, expect, it } from "vitest";

import { noteIsOnBoardAt } from "./room-timeline.js";

/**
 * The replaced/active boundary, pinned.
 *
 * This one predicate decides everything a scrubbing wall shows. It is tested
 * directly rather than through the query because the SQL and this function are
 * two statements of the same rule, and the rule is the part that can be wrong
 * in a way nobody notices: an off-by-one at the boundary does not throw, it
 * just shows the wrong board at exactly the moment a user dragged to.
 */

const t = (iso: string) => new Date(iso);
const MARCH = t("2026-03-01T00:00:00.000Z");
const APRIL = t("2026-04-01T00:00:00.000Z");
const MAY = t("2026-05-01T00:00:00.000Z");

describe("a note's presence on the board at a moment", () => {
  it("is absent before it was written", () => {
    expect(noteIsOnBoardAt({ createdAt: APRIL, replacedAt: null }, MARCH)).toBe(false);
  });

  it("is present from the instant it was written", () => {
    // Inclusive at the near edge: a note written at T is on the board at T.
    expect(noteIsOnBoardAt({ createdAt: APRIL, replacedAt: null }, APRIL)).toBe(true);
  });

  it("stays until something replaces it", () => {
    expect(noteIsOnBoardAt({ createdAt: MARCH, replacedAt: null }, MAY)).toBe(true);
  });

  it("is gone at the exact instant it was replaced", () => {
    /**
     * Half-open on purpose, and this is the case worth arguing about.
     *
     * Scrubbing to the moment of a change should show what the room BECAME,
     * not what it was leaving behind — "what did this turn into?" is the
     * question the rail is asking. The inclusive alternative would show the
     * old and new note simultaneously at that instant, which reads as a
     * duplicate rather than as a change.
     */
    expect(noteIsOnBoardAt({ createdAt: MARCH, replacedAt: APRIL }, APRIL)).toBe(false);
  });

  it("is present right up to the moment before", () => {
    const justBefore = new Date(APRIL.getTime() - 1);
    expect(noteIsOnBoardAt({ createdAt: MARCH, replacedAt: APRIL }, justBefore)).toBe(true);
  });

  it("is absent after it was replaced", () => {
    expect(noteIsOnBoardAt({ createdAt: MARCH, replacedAt: APRIL }, MAY)).toBe(false);
  });

  it("handles a note written and replaced in the same instant", () => {
    // Degenerate but reachable: a synthesis pass that supersedes its own
    // output. It must not appear, or the board gains a note nobody ever saw.
    expect(noteIsOnBoardAt({ createdAt: APRIL, replacedAt: APRIL }, APRIL)).toBe(false);
  });
});

describe("board-as-of-now equals the live board", () => {
  /**
   * The Phase 1 gate, as a property.
   *
   * "Active" is what the wall shows today; `replacedAt === null` is what the
   * resolver calls present-at-now. If those two ever disagree, the timeline's
   * resting position would not match the wall it is attached to — the most
   * visible possible bug in this feature.
   */
  it("treats exactly the unreplaced notes as current", () => {
    const now = new Date("2026-08-01T12:00:00.000Z");
    const board = [
      { id: "live-1", createdAt: MARCH, replacedAt: null },
      { id: "live-2", createdAt: MAY, replacedAt: null },
      { id: "retired", createdAt: MARCH, replacedAt: APRIL },
      { id: "future", createdAt: new Date("2026-09-01T00:00:00.000Z"), replacedAt: null },
    ];
    const present = board.filter((note) => noteIsOnBoardAt(note, now)).map((n) => n.id);
    expect(present).toEqual(["live-1", "live-2"]);
  });
});

describe("a synthesis pass is one event", () => {
  /**
   * The property the atomic handover buys.
   *
   * Synthesis used to stamp each new note at its own insert time and retire the
   * old generation afterwards, from a second clock reading. On a real run that
   * left 62 seconds in which this resolver reported ELEVEN notes — the six new
   * ones plus the five they replaced — a board no member ever saw, which a
   * scrub rail would animate as the wall doubling and then collapsing.
   *
   * With one instant for the pass, the handover is a clean swap at every
   * moment, including the exact instant of the change.
   */
  const HANDOVER = t("2026-06-01T00:00:00.000Z");
  const board = [
    { id: "old-1", createdAt: t("2026-05-01T00:00:00.000Z"), replacedAt: HANDOVER },
    { id: "old-2", createdAt: t("2026-05-02T00:00:00.000Z"), replacedAt: HANDOVER },
    { id: "new-1", createdAt: HANDOVER, replacedAt: null },
    { id: "new-2", createdAt: HANDOVER, replacedAt: null },
  ];
  const at = (moment: Date) =>
    board.filter((note) => noteIsOnBoardAt(note, moment)).map((n) => n.id);

  it("shows only the old generation a moment before", () => {
    expect(at(new Date(HANDOVER.getTime() - 1))).toEqual(["old-1", "old-2"]);
  });

  it("shows only the new generation at the instant of the swap", () => {
    // The count never rises above the board size — no doubling, ever.
    expect(at(HANDOVER)).toEqual(["new-1", "new-2"]);
  });

  it("never reports both generations at any moment across the handover", () => {
    for (const offset of [-2, -1, 0, 1, 2]) {
      const present = at(new Date(HANDOVER.getTime() + offset));
      const hasOld = present.some((id) => id.startsWith("old-"));
      const hasNew = present.some((id) => id.startsWith("new-"));
      expect(hasOld && hasNew, `both generations present at offset ${offset}`).toBe(false);
    }
  });
});

describe("a reading the room considered but never showed", () => {
  /**
   * Selection keeps the readings it did not put on the wall, written retired at
   * the instant they were created. They must never appear on ANY board — not
   * today's, and not one scrubbed to the exact moment they were written, which
   * is the only instant where a naive window would let them through.
   */
  const PASS_AT = new Date("2026-08-01T19:36:00.000Z");

  it("is off the board at the instant it was written", () => {
    expect(noteIsOnBoardAt({ createdAt: PASS_AT, replacedAt: PASS_AT }, PASS_AT)).toBe(false);
  });

  it("is off the board before and after that instant", () => {
    const before = new Date(PASS_AT.getTime() - 1000);
    const after = new Date(PASS_AT.getTime() + 1000);
    expect(noteIsOnBoardAt({ createdAt: PASS_AT, replacedAt: PASS_AT }, before)).toBe(false);
    expect(noteIsOnBoardAt({ createdAt: PASS_AT, replacedAt: PASS_AT }, after)).toBe(false);
  });
});
