/**
 * A room's recorded events are shared by the panel and the date menu.
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. This pure formatter receives a
 * timeline value and has no server, clock, canvas, or session boundary.
 */
import { describe, expect, it } from "vitest";
import type { ApiGroupTimeline } from "../src/lib/api/groups";
import { eventsAtStop, groupHistoryCaption, groupHistoryEvents, groupReadingChangeAtStop } from "../src/space-kinds/group-history";

const at = (month: number, day: number, hour: number) => new Date(2026, month, day, hour).toISOString();

const timeline: ApiGroupTimeline = {
  versions: [
    { id: "changed", version: 3, status: "live", reason: "member_proposal", entryCount: 1, createdAt: at(8, 12, 14) },
    { id: "same", version: 2, status: "superseded", reason: "no_change", entryCount: 1, createdAt: at(8, 11, 14) },
    { id: "first", version: 1, status: "superseded", reason: "initial", entryCount: 1, createdAt: at(7, 2, 10) },
  ],
  doorMarks: [
    { profileId: "member-1", name: "Sora Kim", kind: "joined", occurredAt: at(8, 12, 9) },
    { profileId: null, name: null, kind: "left", occurredAt: at(7, 2, 12) },
  ],
};

describe("room history captions", () => {
  it("uses the same recorded events as the panel and omits no-change reads", () => {
    const events = groupHistoryEvents(timeline, "en-US");
    expect(events).toHaveLength(4);
    expect(events.map((event) => event.line)).toContain("Sora arrived");
    expect(events.map((event) => event.line)).toContain("someone left");
    expect(events.map((event) => event.line)).not.toContain("the room re-read itself");
  });

  it("groups events by the date menu's day, month, or year stop", () => {
    const events = groupHistoryEvents(timeline, "en-US");
    const september = new Date(2026, 8, 30, 23, 59, 59, 999).getTime();
    const twelfth = new Date(2026, 8, 12, 23, 59, 59, 999).getTime();
    expect(eventsAtStop(events, twelfth, "day").map((event) => event.line))
      .toEqual(["a proposal carried", "Sora arrived"]);
    expect(eventsAtStop(events, september, "month")).toHaveLength(2);
    expect(eventsAtStop(events, september, "year")).toHaveLength(4);
    expect(groupHistoryCaption(eventsAtStop(events, twelfth, "day"), "en-US", 1))
      .toBe("a proposal carried · 1 more");
  });

  it("finds the readings before and after a selected period, without treating a no-change pass as a turn", () => {
    const day = (month: number, date: number) => new Date(2026, month, date, 23, 59, 59, 999).getTime();
    expect(groupReadingChangeAtStop(timeline, { at: day(8, 12), grain: "day", label: "Sep 12" }))
      .toMatchObject({ before: { id: "same" }, after: { id: "changed" } });
    expect(groupReadingChangeAtStop(timeline, { at: day(8, 11), grain: "day", label: "Sep 11" }))
      .toBeNull();
    expect(groupReadingChangeAtStop(timeline, { at: day(7, 2), grain: "day", label: "Aug 2" }))
      .toMatchObject({ before: null, after: { id: "first" } });
  });
});
