// @vitest-environment jsdom
/**
 * ONE WRITER PER OPEN TAB — kept across a reload, never shared by a copy.
 *
 * A duplicated tab copies `sessionStorage`, so it started out holding the
 * same writer id as the tab it came from; the two then refused each other's
 * draft writes on every keystroke. Each page load leases its id in
 * `localStorage`, and a page that finds its stored id leased by another live
 * page mints its own. The cases are two "pages" of one tab's storage, which
 * `claimTabWriter` takes as a parameter for exactly this.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. jsdom's real `localStorage`
 * and `sessionStorage` are the subject; `Date.now` is moved by
 * `vi.setSystemTime` where a lease has to go stale.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { claimTabWriter, LEASE_MS, writerIsLive } from "../src/lib/tab-writer";

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-17T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

it("keeps the tab's writer across a reload", () => {
  const first = claimTabWriter("page-before-reload");
  /* the old page let go on its way out (`pagehide`) — modelled by its lease
     going, which is what release does */
  localStorage.clear();
  expect(claimTabWriter("page-after-reload")).toBe(first);
});

it("gives a duplicated tab its own writer while the original is still open", () => {
  const original = claimTabWriter("original-page");
  /* the duplicate starts with a copy of the original's sessionStorage */
  const duplicate = claimTabWriter("duplicate-page");
  expect(duplicate, "the copy shares the original's writer").not.toBe(original);
  expect(sessionStorage.getItem("waka:draftWriter")).toBe(duplicate);
  expect(writerIsLive(original)).toBe(true);
  expect(writerIsLive(duplicate)).toBe(true);
});

it("treats a writer whose page stopped renewing as closed", () => {
  const writer = claimTabWriter("page-that-crashed");
  vi.setSystemTime(Date.now() + LEASE_MS + 1);
  expect(writerIsLive(writer)).toBe(false);
  /* and a page that finds only a stale lease keeps the id: a reload after a
     crash is still the same tab */
  expect(claimTabWriter("page-after-crash")).toBe(writer);
});
