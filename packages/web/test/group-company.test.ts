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
import { COMPANY_IDLES, groupCompanyPlaces } from "../src/space/group-company";

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
      expect(Math.abs(p.dx)).toBeLessThan(1.4);
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
    /* and so are the things the craft pass added: how she stands and how
       quickly she answers are facts about her, not about the seating */
    expect(before?.idle).toBe(grown?.idle);
    expect(before?.notice).toBe(grown?.notice);
  });
});

/**
 * THE CRAFT PASS — a group of people, not a row of copies.
 *
 * Founder, on three grey blobs in a line: "conduct research on how to make
 * this group characters also have higher quality craft and interactions."
 * The research (written up at the top of `group-company.ts`) gives three
 * numbers the drawing then spends: a depth per member, one of several ways
 * of standing, and a ragged delay before answering. These hold the facts;
 * whether it FEELS alive is the founder's call, live.
 */
describe("the company stands on more than one plane", () => {
  it("gives every member a depth, and no two the same", () => {
    const places = groupCompanyPlaces(ROOM, "p-you");
    for (const p of places) {
      expect(p.depth).toBeGreaterThanOrEqual(0);
      expect(p.depth).toBeLessThanOrEqual(1);
    }
    /* the flat grey the founder photographed IS one depth shared by all: if
       these ever collapse to a single value the group is a card again */
    const depths = new Set(places.map((p) => p.depth.toFixed(4)));
    expect(depths.size, "a row on one plane reads as copies of one being").toBe(
      places.length,
    );
  });

  it("puts the ends of the arc further back than its middle", () => {
    /* five members, so there is a real middle to be nearest */
    const wide = groupCompanyPlaces(
      [
        member("p-a", "human"),
        member("p-b", "human"),
        member("p-c", "human"),
        member("p-d", "human"),
        member("p-e", "human"),
        member("p-you", "human"),
      ],
      "p-you",
    );
    const byX = [...wide].sort((a, b) => a.dx - b.dx);
    const middle = byX[Math.floor(byX.length / 2)]!;
    const edge = byX[0]!;
    expect(edge.depth).toBeGreaterThan(middle.depth);
  });

  it("does not give a whole room the same way of standing", () => {
    /* the research's finding, held as a fact: one idle for everybody is what
       reads as a crowd of copies. Eight members is enough that a single
       shared variant would be a real defect rather than small-sample luck. */
    const many = groupCompanyPlaces(
      [
        ...["p-1", "p-2", "p-3", "p-4", "p-5", "p-6", "p-7", "p-8"].map((id) =>
          member(id, "human"),
        ),
        member("p-you", "human"),
      ],
      "p-you",
    );
    const idles = new Set(many.map((p) => p.idle));
    expect(idles.size, "a room where everyone stands the same way is a chorus line")
      .toBeGreaterThan(1);
    for (const p of many) {
      expect(p.idle).toBeGreaterThanOrEqual(0);
      expect(p.idle).toBeLessThan(COMPANY_IDLES);
      /* nobody waits so long to answer that they look asleep */
      expect(p.notice).toBeGreaterThanOrEqual(0);
      expect(p.notice).toBeLessThan(1);
    }
    /* and they do not all answer at the same instant */
    expect(new Set(many.map((p) => p.notice)).size).toBeGreaterThan(1);
  });
});
