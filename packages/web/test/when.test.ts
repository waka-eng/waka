/**
 * "TODAY", "YESTERDAY", "3 DAYS AGO".
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing, including the clock. `whenShort`
 * takes an ISO string and returns words, and the one thing it reaches for is
 * `Date.now()`. Every case below is written as an offset FROM that same
 * `Date.now()` rather than as a fixed date, so the answer is identical at any
 * wall-clock moment and a frozen clock would buy nothing — it would only add a
 * second mechanism that can itself be wrong, and a reader would then have to
 * check the fake clock before believing the assertion.
 *
 * The one thing a real clock could still spoil is a boundary, and none is
 * pressed: today, yesterday and three days ago each sit a whole day away from
 * the nearest edge of their bucket, so the milliseconds that pass between the
 * test reading the clock and the function reading it cannot change an answer.
 * If a case is ever added AT an edge — the last second before "yesterday"
 * becomes "2 days ago" — that is the moment this file needs a frozen clock,
 * and this paragraph is what says so.
 */
import { describe, expect, it } from "vitest";

import { whenShort } from "../src/lib/when";

/*
 * This block used to live in `markQuote.test.tsx`, beside tests for
 * `markQuote` and `paragraphs` — both exports of `pages/Surface`, which went
 * with the archive. `whenShort` did not: `pages/Profile.tsx` still reads it,
 * and these were its only tests, so they move here rather than dying with
 * their neighbours.
 *
 * What DID die uncovered: the quote-marking contract. Its successor is
 * `markPassages` in `Home.tsx`, which is module-local and therefore
 * untestable from here — the same 13,000-line file the split exists to open
 * up. When the memory panel reaches `space/inspiration/`, that contract gets
 * its tests back.
 */
describe("whenShort", () => {
  it("says the recent days in words, because a wall is read at a glance", () => {
    const now = Date.now();
    expect(whenShort(new Date(now).toISOString())).toBe("today");
    expect(whenShort(new Date(now - 86_400_000).toISOString())).toBe("yesterday");
    expect(whenShort(new Date(now - 3 * 86_400_000).toISOString())).toBe("3 days ago");
  });

  it("renders nothing at all for a timestamp it cannot read", () => {
    expect(whenShort("not a date")).toBe("");
  });
});
