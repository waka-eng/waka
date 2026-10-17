/**
 * THE DAYS CALENDAR IS THE READER'S CALENDAR.
 *
 * The grid was built in UTC dates, so for a reader in Seoul the last dot —
 * "today" — was yesterday until nine in the morning, a save made at breakfast
 * lit the dot before it, and pressing a dot jumped to UTC noon, which is a
 * different local date for anyone far enough east. The server now groups by
 * the browser's zone; this pins the client half: keys are local dates and the
 * jump target is local noon.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. `buildGrid` is a pure function
 * of rows and a clock; the clock is handed in and the zone is set through the
 * process's own `TZ`, which is how Node is told what "local" means.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildGrid } from "../src/pages/Days";

let savedTz: string | undefined;

beforeEach(() => {
  savedTz = process.env.TZ;
  process.env.TZ = "Asia/Seoul";
});

afterEach(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

describe("the days grid", () => {
  it("ends on the local date, not the UTC one", () => {
    /* 00:30 on the 17th in Seoul is still the 16th in UTC. */
    const now = new Date("2026-10-16T15:30:00Z");
    const cells = buildGrid([{ day: "2026-10-17", kept: 2 }], now);
    const today = cells[cells.length - 1]!;

    expect(today.key).toBe("2026-10-17");
    expect(today.kept).toBe(2);
    expect(today.glow).toBeGreaterThan(0);
  });

  it("jumps to local noon of the pressed date", () => {
    const now = new Date("2026-10-16T15:30:00Z");
    const today = buildGrid([], now).at(-1)!;

    expect(today.at).toBe(Date.parse("2026-10-17T12:00:00+09:00"));
  });

  it("draws every date once, across a daylight-saving change", () => {
    /* New York leaves summer time on 2026-11-01: a 25-hour day. The clock is
       pinned at 23:30 local, which is 04:30 the NEXT day in UTC — so a grid
       that walked UTC dates ends a day late, and every cell's noon is the
       local noon of its own date on both sides of the change. */
    process.env.TZ = "America/New_York";
    const cells = buildGrid([], new Date("2026-11-21T04:30:00Z"));
    const keys = cells.map((cell) => cell.key);
    const noonOf = (key: string) => cells.find((cell) => cell.key === key)!.at;

    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.at(-1)).toBe("2026-11-20");
    expect(noonOf("2026-10-31")).toBe(Date.parse("2026-10-31T12:00:00-04:00"));
    expect(noonOf("2026-11-01")).toBe(Date.parse("2026-11-01T12:00:00-05:00"));
    expect(noonOf("2026-11-02")).toBe(Date.parse("2026-11-02T12:00:00-05:00"));
  });
});
