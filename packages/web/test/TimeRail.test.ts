import { describe, expect, it } from "vitest";

import { marksFromTimeline } from "../src/components/TimeRail";
import type { ApiRoomTimeline } from "../src/lib/api";

const copy = {
  regionLabel: "this room over time",
  now: "now",
  formed: "the room was formed",
  turned: "the reading turned",
  arrived: (name: string) => `${name} arrived`,
  departed: (name: string) => `${name} left`,
  sinceLabel: (count: number, when: string) => `${count} · ${when}`,
};

function timeline(events: ApiRoomTimeline["events"]): ApiRoomTimeline {
  return { groupId: "g", formedAt: events[0]?.at ?? "", events };
}

describe("marksFromTimeline", () => {
  it("treats one pass as one mark, however many notes it wrote", () => {
    /**
     * A synthesis pass stamps every note it writes with one instant. Without
     * grouping, a pass that produced six readings would put six marks on the
     * rail — six places to stop that are all the same moment, and a room that
     * looks like it changed its mind six times in a row.
     */
    const at = "2026-08-01T19:36:00.000Z";
    const marks = marksFromTimeline(
      timeline([
        { kind: "note_written", at, noteId: "1", title: "a" },
        { kind: "note_written", at, noteId: "2", title: "b" },
        { kind: "note_written", at, noteId: "3", title: "c" },
      ]),
      copy,
    );
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ at, kind: "turn" });
  });

  it("does not count a retirement as its own moment", () => {
    /**
     * A note being replaced is the other half of the note that replaced it,
     * and both carry the same instant. Counting the replacement separately
     * would double every turn the room ever made.
     */
    const at = "2026-08-01T19:36:00.000Z";
    const marks = marksFromTimeline(
      timeline([
        { kind: "note_replaced", at, noteId: "old", title: "old" },
        { kind: "note_written", at, noteId: "new", title: "new" },
      ]),
      copy,
    );
    expect(marks).toHaveLength(1);
    expect(marks[0]?.kind).toBe("turn");
  });

  it("lets an arrival win the instant it shares with a turn", () => {
    /**
     * When a heart arrives and the board turns in the same breath, the arrival
     * is the reason and the turn is the effect. Showing the effect would name
     * the wrong one — and this mark carries the product's whole claim on the
     * time axis.
     */
    const at = "2026-07-07T00:12:54.000Z";
    const marks = marksFromTimeline(
      timeline([
        { kind: "note_written", at, noteId: "1", title: "a" },
        { kind: "member", at, event: "joined", userId: "u", name: "Se One" },
      ]),
      copy,
    );
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ kind: "arrival", label: "Se One arrived" });
  });

  it("marks a departure without erasing it", () => {
    const marks = marksFromTimeline(
      timeline([
        { kind: "formed", at: "2026-07-01T00:00:00.000Z" },
        {
          kind: "member",
          at: "2026-07-20T00:00:00.000Z",
          event: "left",
          userId: "u",
          name: "Jae Gyu",
        },
      ]),
      copy,
    );
    expect(marks.map((m) => m.kind)).toEqual(["formed", "departure"]);
  });

  it("puts the room's moments in the order they happened", () => {
    const marks = marksFromTimeline(
      timeline([
        { kind: "note_written", at: "2026-08-01T00:00:00.000Z", noteId: "2", title: "b" },
        { kind: "formed", at: "2026-07-01T00:00:00.000Z" },
        {
          kind: "member",
          at: "2026-07-15T00:00:00.000Z",
          event: "joined",
          userId: "u",
          name: "Q",
        },
      ]),
      copy,
    );
    expect(marks.map((m) => m.at)).toEqual([
      "2026-07-01T00:00:00.000Z",
      "2026-07-15T00:00:00.000Z",
      "2026-08-01T00:00:00.000Z",
    ]);
  });
});
