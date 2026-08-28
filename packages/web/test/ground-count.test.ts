/**
 * THE DOOR MUST COUNT THE GROUND IT OPENS.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `nothing`. `groundCount` is a pure
 * function of a list, a selection and an id — no clock, no network, no DOM.
 *
 * The bug it holds shut was reported live: standing on a room's wall the
 * archive door read "3 INSPIRATIONS" and the ground under it was empty. Two
 * correct rules disagreeing — the room pours ONE member's ground at a time,
 * and the door counted the room's WHOLE pooled field. The first case below is
 * that exact situation and fails if the door goes back to counting the room.
 */
import { describe, expect, it } from "vitest";

import { groundCount } from "../src/space/ground-count";
import type { ApiGroupFieldInspiration } from "../src/lib/api/groups";

const ME = "p-me";
const BO = "p-bo";

const kept = (ownerProfileId: string, id: string): ApiGroupFieldInspiration => ({
  id,
  text: "something kept",
  kind: null,
  source: "capture",
  createdAt: "2026-08-28T00:00:00.000Z",
  updatedAt: "2026-08-28T00:00:00.000Z",
  ownerProfileId,
  ownerName: ownerProfileId === ME ? "Me" : "Bo",
  ownerType: "human",
});

describe("groundCount", () => {
  it("counts none of a room's three when none of them are yours", () => {
    /* the founder's own report, 2026-08-28: "why does it say 3 inspirations
       but 0 are on the ground?" */
    const room = [kept(BO, "a"), kept(BO, "b"), kept(BO, "c")];
    expect(groundCount(room, null, ME)).toBe(0);
  });

  it("counts yours, and only yours, when the room holds both", () => {
    const room = [kept(BO, "a"), kept(ME, "b"), kept(BO, "c"), kept(ME, "d")];
    expect(groundCount(room, null, ME)).toBe(2);
  });

  it("follows you when you stand in somebody else's ground", () => {
    const room = [kept(BO, "a"), kept(ME, "b"), kept(BO, "c")];
    expect(groundCount(room, BO, ME)).toBe(2);
    expect(groundCount(room, ME, ME)).toBe(1);
  });

  it("says nothing rather than something when it does not know who you are", () => {
    /* the viewer's id resolves a moment after a room's field can, and a count
       that guessed would be a number over a ground it cannot describe */
    const room = [kept(BO, "a"), kept(ME, "b")];
    expect(groundCount(room, null, null)).toBe(0);
  });

  it("an empty or missing field is zero, not a crash", () => {
    expect(groundCount([], null, ME)).toBe(0);
    expect(groundCount(undefined, null, ME)).toBe(0);
  });

  it("a room of only your own memories counts all of them", () => {
    const room = [kept(ME, "a"), kept(ME, "b")];
    expect(groundCount(room, null, ME)).toBe(2);
  });
});
