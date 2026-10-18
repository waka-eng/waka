// @vitest-environment jsdom
/**
 * ONE WRITER ID PER TAB, AND THE SAME ONE EVERYWHERE.
 *
 * The id lives in `sessionStorage` so a reload keeps writing its own draft;
 * a duplicated tab that collides takes a new one. When storage throws, the id
 * is held in memory — and the case that matters is that the id a draft is
 * WRITTEN with is the id every later call reports, or the panel's own drafts
 * would look like a stranger's.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing at the module level — jsdom's
 * real storage throughout, except that the last case spies on the storage
 * prototype's get and set to make them throw the way a locked-down browser
 * does, and restores them after.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { newTabWriterId, tabWriterId } from "../src/lib/tab-writer";

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

it("keeps the tab's id across calls, as a reload would find it", () => {
  const first = tabWriterId();
  expect(tabWriterId()).toBe(first);
  expect(sessionStorage.getItem("waka:draftWriter")).toBe(first);
});

it("takes a new id for the tab after a collision, and keeps reporting it", () => {
  const shared = tabWriterId();
  const own = newTabWriterId();
  expect(own).not.toBe(shared);
  expect(tabWriterId()).toBe(own);
});

it("holds one id in memory when storage throws, and reports that one everywhere", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  const first = tabWriterId();
  expect(tabWriterId()).toBe(first);
  const own = newTabWriterId();
  expect(own).not.toBe(first);
  expect(tabWriterId(), "the id written with is not the id reported").toBe(own);
});
