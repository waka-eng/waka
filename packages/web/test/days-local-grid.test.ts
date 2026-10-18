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

import { formatMessage } from "../src/lib/locales";
import { numWords } from "../src/lib/words";
import { buildGrid, groupedInUtc } from "../src/pages/Days";

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

  it("says a day's count in words, never a numeral", () => {
    /* States render, numerals never — the screen-reader sentence is the one
       place the count is said at all, and it said "3개 담음". */
    for (const locale of ["en-US", "ko-KR"] as const) {
      const said = formatMessage(locale, "worldDaysKept", { count: 3, countWords: numWords(3, locale) });
      expect(said, said).not.toMatch(/[0-9]/);
    }
  });

  it("draws UTC dates when the server says it grouped in UTC", () => {
    /* The server fell back to UTC for a zone it did not know, and said so.
       At 00:30 in Seoul the UTC date is still the 16th, which is where the
       server put today's saves — so that is the last cell. */
    const now = new Date("2026-10-16T15:30:00Z");
    const cells = buildGrid([{ day: "2026-10-16", kept: 2 }], now, true);
    const last = cells[cells.length - 1]!;
    expect(last.key).toBe("2026-10-16");
    expect(last.kept).toBe(2);
    expect(last.at, "a UTC-date dot jumped to UTC noon, not the reader's").toBe(Date.parse("2026-10-16T12:00:00+09:00"));
  });

  it("opens the date the dot shows for a reader thirteen hours east, on the UTC fallback", () => {
    /* Tonga is UTC+13: UTC noon on the 16th is 01:00 on the 17th there, so a
       press on the 16th's dot used to open the 17th. */
    process.env.TZ = "Pacific/Tongatapu";
    const now = new Date("2026-10-16T20:00:00Z");
    const cells = buildGrid([], now, true);
    const sixteenth = cells.find((cell) => cell.key === "2026-10-16")!;
    expect(sixteenth.at).toBe(Date.parse("2026-10-16T12:00:00+13:00"));
    expect(new Date(sixteenth.at).getDate()).toBe(16);
  });

  it("treats a request that named no zone as grouped in UTC", () => {
    expect(groupedInUtc(undefined, { zone: "UTC" })).toBe(true);
    expect(groupedInUtc(undefined, { zone: "Asia/Seoul" })).toBe(true);
    expect(groupedInUtc("Asia/Seoul", { zone: "Asia/Seoul" })).toBe(false);
    expect(groupedInUtc("Asia/Seoul", { zone: "UTC" })).toBe(true);
    /* A reader whose zone IS UTC got their own zone back: local dates and UTC
       dates are the same, and the reply is not a fallback. */
    expect(groupedInUtc("UTC", { zone: "UTC" })).toBe(false);
  });

  it("takes the server's word on a fallback, so a canonicalized zone is not mistaken for one", () => {
    /* Asked Asia/Calcutta, grouped in Asia/Kolkata: the same place. */
    expect(groupedInUtc("Asia/Calcutta", { zone: "Asia/Kolkata", fallback: false })).toBe(false);
    expect(groupedInUtc("Asia/Seoul", { zone: "UTC", fallback: true })).toBe(true);
    expect(groupedInUtc(undefined, { zone: "UTC", fallback: true })).toBe(true);
    /* an older server, without the flag: compared in one spelling */
    expect(groupedInUtc("Asia/Calcutta", { zone: "Asia/Kolkata" })).toBe(false);
    expect(groupedInUtc("Europe/Kiev", { zone: "Europe/Kyiv" })).toBe(false);
    expect(groupedInUtc("asia/seoul", { zone: "Asia/Seoul" })).toBe(false);
    expect(groupedInUtc("Asia/Seoul", { zone: "UTC" })).toBe(true);
  });
});

describe("the zone the calendar asks for", () => {
  it("is sent only when it is shaped like a zone name", async () => {
    const { zoneToSend } = await import("../src/lib/api/inspiration-days");
    expect(zoneToSend("Asia/Seoul")).toBe("Asia/Seoul");
    expect(zoneToSend("America/Argentina/Buenos_Aires")).toBe("America/Argentina/Buenos_Aires");
    expect(zoneToSend("Etc/GMT+9")).toBe("Etc/GMT+9");
    expect(zoneToSend("UTC'; --")).toBeUndefined();
    expect(zoneToSend("a".repeat(65))).toBeUndefined();
    expect(zoneToSend(undefined)).toBeUndefined();
  });
});
