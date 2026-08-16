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
 * `markPassages` in `World.tsx`, which is module-local and therefore
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
