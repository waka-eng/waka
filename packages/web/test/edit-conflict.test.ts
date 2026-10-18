/**
 * ═══ AN OPEN EDIT AND A SAVE MADE ELSEWHERE — `lib/edit-conflict.ts` ═══════
 *
 * Review, 2026-10-17. Only a write can conflict, only words that differ from
 * what the edit opened with are a change, an untouched edit is moved onto
 * them, and a typed-into edit asks.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). Nothing: the rule is a pure function.
 */
import { expect, it } from "vitest";

import { verdictOnSavedWords } from "../src/lib/edit-conflict";

const base = { how: "write" as const, openedWith: "old words", draft: "old words", saved: "new words", busy: false };

it("moves an untouched edit onto words saved elsewhere", () => {
  expect(verdictOnSavedWords(base)).toBe("rebase");
});

it("asks when the person has typed and the saved words differ", () => {
  expect(verdictOnSavedWords({ ...base, draft: "old words, and mine" })).toBe("ask");
});

it("never fires on a re-read, even one whose words differ", () => {
  expect(verdictOnSavedWords({ ...base, how: "read", draft: "old words, and mine" })).toBe("none");
});

it("never fires when the saved words are the ones the edit opened with", () => {
  expect(verdictOnSavedWords({ ...base, saved: "old words", draft: "old words, and mine" })).toBe("none");
});

it("never fires on the edit's own keep, or when the draft already says the saved words", () => {
  expect(verdictOnSavedWords({ ...base, busy: true, draft: "mine" })).toBe("none");
  expect(verdictOnSavedWords({ ...base, draft: "new words" })).toBe("none");
});
