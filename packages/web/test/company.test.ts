/**
 * WHO IS IN THIS ROOM — the eyebrow's second half.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `nothing`. `groupCompany` is a pure
 * function of a member list and a viewer id, and it reaches for no clock, no
 * `fetch` and no storage. Every case below hands it rows shaped exactly as
 * `ApiGroupMember` arrives from `lib/api/groups`, so there is no seam between
 * the test and the thing tested and nothing to get wrong about which layer was
 * replaced.
 *
 * WHY IT IS WORTH A SUITE. A room pours ONE member's ground at a time by
 * design, so this string is the only thing at headquarters that can say
 * anybody else is present. It used to categorise the room — "people",
 * "agents only" — which was true of the room and true of nobody in it.
 */
import { describe, expect, it } from "vitest";
import { groupCompany } from "../src/lib/words";
import type { ApiGroupMember } from "../src/lib/api";

const ME = "p-me";
/** A row exactly as the groups route hands one over. */
const who = (
  profileId: string,
  name: string,
  type: ApiGroupMember["type"] = "human",
): ApiGroupMember => ({
  profileId,
  name,
  initials: name.slice(0, 1).toUpperCase(),
  type,
  role: "member",
  joinedAt: new Date(0).toISOString(),
});

describe("groupCompany", () => {
  it("says nothing about a room whose members have not arrived", () => {
    expect(groupCompany(undefined, ME)).toBeNull();
    expect(groupCompany([], ME)).toBeNull();
  });

  it("names a room you are the whole of as your own", () => {
    expect(groupCompany([who(ME, "Yunji")], ME)).toBe("on your own");
  });

  it("leaves you out — you are the one reading it", () => {
    expect(groupCompany([who(ME, "Yunji"), who("p-1", "Jina Park")], ME)).toBe("with Jina");
  });

  it("says a given name, which is what a person would say out loud", () => {
    expect(groupCompany([who("p-1", "Jina Park")], ME)).toBe("with Jina");
    /* a Korean name is written without a space, so the whole of it is given */
    expect(groupCompany([who("p-1", "박지나")], ME)).toBe("with 박지나");
  });

  it("joins two and three names as speech does", () => {
    const two = [who("p-1", "Jina"), who("p-2", "Minsu")];
    expect(groupCompany(two, ME)).toBe("with Jina and Minsu");
    expect(groupCompany([...two, who("p-3", "Tae")], ME)).toBe("with Jina, Minsu and Tae");
  });

  it("counts the rest in words past the third name, never in digits", () => {
    const many = [
      who("p-1", "Jina"),
      who("p-2", "Minsu"),
      who("p-3", "Tae"),
      who("p-4", "Hana"),
      who("p-5", "Bo"),
    ];
    const said = groupCompany(many, ME);
    expect(said).toBe("with Jina, Minsu and three others");
    expect(said).not.toMatch(/\d/);
  });

  it("puts people before machines, whatever order the room arrived in", () => {
    const mixed = [who("p-a", "Atlas", "agent"), who("p-1", "Jina")];
    expect(groupCompany(mixed, ME)).toBe("with Jina and Atlas");
  });

  it("never says human or machine — the machine hand already does", () => {
    const machines = [who("p-a", "Atlas", "agent"), who("p-b", "Beacon", "agent")];
    const said = groupCompany(machines, ME) ?? "";
    expect(said).toBe("with Atlas and Beacon");
    expect(said).not.toMatch(/agent|machine|bot/i);
  });

  it("says nothing until it knows which member is you", () => {
    /* the viewer id resolves a moment after the member list can. Until then
       every row looks like somebody else, and a room of just you would
       announce itself as company under your own name. */
    expect(groupCompany([who(ME, "Yunji")], null)).toBeNull();
    expect(groupCompany([who(ME, "Yunji"), who("p-1", "Jina")], null)).toBeNull();
  });

  it("does not name a member whose row carries a blank name", () => {
    expect(groupCompany([who(ME, "Yunji"), who("p-1", "   ")], ME)).toBe("on your own");
  });
});
