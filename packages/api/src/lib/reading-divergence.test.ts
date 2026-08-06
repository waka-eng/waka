/**
 * Reading divergence — which pairs get measured.
 *
 * The scoring pass's SQL runs elsewhere and the judge's request/response
 * handling lives in `reading-divergence-gemini.test.ts`. What this pins down
 * is the selection: newest note per side, unchanged pairs skipped, and
 * cross-tenant mismatches dropped rather than measured.
 */

import { describe, expect, it } from "vitest";

import {
  pickDivergencePairs,
  type DivergenceGroupSideRow,
  type DivergenceSoloSideRow,
} from "./reading-divergence.js";

const owner = "00000000-0000-4000-8000-000000000001";
const otherOwner = "00000000-0000-4000-8000-000000000002";
const signalA = "00000000-0000-4000-8000-000000000011";
const signalB = "00000000-0000-4000-8000-000000000012";

function groupRow(overrides: Partial<DivergenceGroupSideRow>): DivergenceGroupSideRow {
  return {
    signalId: signalA,
    ownerUserId: owner,
    noteId: "g-note-1",
    belief: "group belief",
    title: "group title",
    why: "group why",
    locale: "en-US",
    noteCreatedAt: new Date("2026-07-15T00:00:00.000Z"),
    ...overrides,
  };
}

function soloRow(overrides: Partial<DivergenceSoloSideRow>): DivergenceSoloSideRow {
  return {
    signalId: signalA,
    ownerUserId: owner,
    noteId: "s-note-1",
    belief: "solo belief",
    title: "solo title",
    why: "solo why",
    noteCreatedAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("pickDivergencePairs", () => {
  it("pairs each signal's newest group note with its owner's newest solo note", () => {
    const pairs = pickDivergencePairs(
      [
        groupRow({ noteId: "g-old", noteCreatedAt: new Date("2026-07-10T00:00:00.000Z") }),
        groupRow({ noteId: "g-new", noteCreatedAt: new Date("2026-07-20T00:00:00.000Z") }),
      ],
      [
        soloRow({ noteId: "s-old", noteCreatedAt: new Date("2026-06-01T00:00:00.000Z") }),
        soloRow({ noteId: "s-new", noteCreatedAt: new Date("2026-07-01T00:00:00.000Z") }),
      ],
      [],
    );

    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.group.noteId).toBe("g-new");
    expect(pairs[0]?.solo.noteId).toBe("s-new");
    expect(pairs[0]?.ownerUserId).toBe(owner);
  });

  it("skips a pair whose two note ids were already judged", () => {
    const pairs = pickDivergencePairs(
      [groupRow({ noteId: "g-1" })],
      [soloRow({ noteId: "s-1" })],
      [{ signalId: signalA, soloNoteId: "s-1", groupNoteId: "g-1" }],
    );
    expect(pairs).toHaveLength(0);
  });

  it("re-judges when either side's note changed since the stored judgment", () => {
    const pairs = pickDivergencePairs(
      [groupRow({ noteId: "g-2" })],
      [soloRow({ noteId: "s-1" })],
      [{ signalId: signalA, soloNoteId: "s-1", groupNoteId: "g-1" }],
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.group.noteId).toBe("g-2");
  });

  it("drops signals with no solo reading and cross-owner mismatches", () => {
    const pairs = pickDivergencePairs(
      [
        groupRow({ signalId: signalA }),
        groupRow({ signalId: signalB, ownerUserId: otherOwner, noteId: "g-b" }),
      ],
      [
        // signalA has a solo reading under a DIFFERENT user — cross-tenant,
        // must not be measured. signalB has none at all.
        soloRow({ signalId: signalA, ownerUserId: otherOwner }),
      ],
      [],
    );
    expect(pairs).toHaveLength(0);
  });
});
