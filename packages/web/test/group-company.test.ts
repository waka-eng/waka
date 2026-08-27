/**
 * WHO STANDS BEHIND YOUR COMPANION IN A ROOM — the facts, held.
 *
 * The drawing is a canvas and cannot be asserted on here; what can be is the
 * half of the feature that is a statement about people rather than pixels.
 * Three rules, each of which would otherwise only break visibly in a live
 * room with real members in it:
 *
 *   - the viewer is never among the company (a room that drew you twice
 *     would be a room with a stranger in it);
 *   - humans before machines, in the room's own order — the sequence every
 *     other naming of the room already uses;
 *   - placement is a pure function of the ids: nothing reshuffles between
 *     frames, visits, or reloads.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing, and that is the point. The
 * placement was extracted into `space/group-company.ts` precisely so the
 * facts could be held without standing up the world around them. The sim's
 * use of it is one map-and-draw, exercised (for not crashing) by every suite
 * that walks a group wall.
 */
import { describe, expect, it } from "vitest";

import type { ApiGroupMember } from "../src/lib/api";
import { groupCompanyPlaces } from "../src/space/group-company";

const member = (profileId: string, type: "human" | "agent"): ApiGroupMember => ({
  profileId,
  name: profileId,
  initials: profileId.slice(0, 2).toUpperCase(),
  type,
  role: "member",
  joinedAt: "2026-08-01T00:00:00.000Z",
});

const ROOM = [
  member("p-hana", "human"),
  member("p-you", "human"),
  member("a-scout", "agent"),
  member("p-mio", "human"),
];

describe("the room's company", () => {
  it("never includes the viewer", () => {
    const places = groupCompanyPlaces(ROOM, "p-you");
    expect(places.map((p) => p.profileId)).not.toContain("p-you");
    expect(places).toHaveLength(3);
  });

  it("stands humans before machines, in the room's own order", () => {
    expect(groupCompanyPlaces(ROOM, "p-you").map((p) => p.profileId)).toEqual([
      "p-hana",
      "p-mio",
      "a-scout",
    ]);
  });

  it("stands nobody until it knows which member is you", () => {
    /* the viewer's id resolves a moment after a member list can — drawing
       anyone before then risks drawing you, which is the worse mistake */
    expect(groupCompanyPlaces(ROOM, null)).toEqual([]);
    expect(groupCompanyPlaces(undefined, "p-you")).toEqual([]);
  });

  it("gives everyone the same seat every time", () => {
    const a = groupCompanyPlaces(ROOM, "p-you");
    const b = groupCompanyPlaces(ROOM, "p-you");
    expect(a).toEqual(b);
  });

  it("keeps the whole company behind and above, at bounded spread", () => {
    const places = groupCompanyPlaces(ROOM, "p-you");
    for (const p of places) {
      /* behind means above: every dy is negative, none absurdly far */
      expect(p.dy).toBeLessThan(0);
      expect(p.dy).toBeGreaterThan(-1);
      /* the arc stays near the companion — within one size either way for a
         room this small */
      expect(Math.abs(p.dx)).toBeLessThan(1);
      expect(p.phase).toBeGreaterThanOrEqual(0);
      expect(p.phase).toBeLessThan(1);
    }
    /* and it is an arc around yours, not a queue off to one side */
    const xs = places.map((p) => p.dx);
    expect(Math.min(...xs)).toBeLessThan(0);
    expect(Math.max(...xs)).toBeGreaterThan(0);
  });

  it("keeps a member's identity when the room changes around them", () => {
    /* Hana's SEAT may move when the arc re-centres — the room changed who it
       is — but her hover phase is hers: derived from her id alone, so the
       being does not become a stranger because somebody joined. */
    const before = groupCompanyPlaces(ROOM, "p-you").find((p) => p.profileId === "p-hana");
    const grown = groupCompanyPlaces([...ROOM, member("p-new", "human")], "p-you").find(
      (p) => p.profileId === "p-hana",
    );
    expect(before?.phase).toBe(grown?.phase);
  });
});
