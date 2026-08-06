/**
 * Group note lifecycle — the decisions, separated from the SQL.
 *
 * The room's succession of readings is the timeline, and it is the one thing
 * that cannot be reconstructed after the fact. These tests pin the two rules
 * that decide what leaves the wall — never what leaves the table.
 */

import { describe, expect, it } from "vitest";

import { retiredNoteIdsAfterDeparture } from "./group-top-of-mind.js";

const noteA = "00000000-0000-4000-8000-0000000000a1";
const noteB = "00000000-0000-4000-8000-0000000000a2";
const noteC = "00000000-0000-4000-8000-0000000000a3";

describe("retiredNoteIdsAfterDeparture", () => {
  it("retires a reading that no longer spans two remaining members", () => {
    // A: three members cited, one left → still shared.
    // B: two cited, one left → no longer a group reading.
    const retired = retiredNoteIdsAfterDeparture(
      [noteA, noteB],
      new Map([
        [noteA, 2],
        [noteB, 1],
      ]),
    );
    expect(retired).toEqual([noteB]);
  });

  it("retires a reading the departing member was the only owner of", () => {
    // No remaining-owner row at all: every citation was theirs.
    expect(retiredNoteIdsAfterDeparture([noteC], new Map())).toEqual([noteC]);
  });

  it("keeps every reading when the departure changes nothing", () => {
    const retired = retiredNoteIdsAfterDeparture(
      [noteA, noteB],
      new Map([
        [noteA, 3],
        [noteB, 2],
      ]),
    );
    expect(retired).toEqual([]);
  });

  it("decides nothing about readings that were already retired", () => {
    // Callers pass only the currently-active ids; a reading retired by an
    // earlier refresh must not be re-touched (its replacedAt would move, and
    // the timeline would show it leaving twice).
    expect(retiredNoteIdsAfterDeparture([], new Map([[noteA, 0]]))).toEqual([]);
  });
});
