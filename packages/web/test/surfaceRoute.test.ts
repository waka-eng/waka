/**
 * The flat screen's own addresses: `buildSurfacePath` / `parseSurfacePath`.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6)
 *
 * Nothing, and nothing needs replacing. Both functions under test are pure
 * string work — a view name and an optional id in, a path out, and back. They
 * touch no network, no database, no router and no clock, so there is no layer
 * here to stand in for. A fake would only be a second implementation of the
 * same two functions, and the test would then be checking the fake.
 *
 * ON `parseSurfacePath("/") === { view: "wall" }`, WHICH READS ODDLY NOW.
 * `/` is the world, not Surface's wall — the world took the root route when it
 * landed. That does not make this assertion wrong: it is Surface's own
 * internal notion of "the view with no suffix", and it is what the page's back
 * affordance resolves to, so leaving `/` there is what sends someone back to
 * the world when they finish with a list. That is the intended way home now,
 * not an escape hatch. If Surface is ever given its own root — `/surface` —
 * this line is the one that has to move with it.
 */
import { describe, expect, it } from "vitest";

import { buildSurfacePath, parseSurfacePath } from "../src/lib/surface-route";

describe("Surface routes", () => {
  it("gives every state of the surface its own address", () => {
    expect(parseSurfacePath("/")).toEqual({ view: "wall", entityId: null });
    expect(parseSurfacePath("/capture")).toEqual({ view: "capture", entityId: null });
    expect(parseSurfacePath("/inspirations")).toEqual({
      view: "archive",
      entityId: null,
    });
    expect(parseSurfacePath("/signals")).toEqual({ view: "signals", entityId: null });
    /* The wall's own address. It used to have none but "/", and the world took
       "/" — so the flat screen's top of mind was the one view on its bottom bar
       that nothing outside Surface could link to. Both addresses resolve here:
       "/" because the back affordance still builds it, "/top-of-mind" because
       the world's menu has to be able to point AT this view rather than at the
       world it is already showing. */
    expect(parseSurfacePath("/top-of-mind")).toEqual({ view: "wall", entityId: null });
    expect(parseSurfacePath("/")).toEqual({ view: "wall", entityId: null });
    expect(parseSurfacePath("/inspirations/inspiration-1")).toEqual({
      view: "inspiration",
      entityId: "inspiration-1",
    });
    expect(parseSurfacePath("/rooms")).toEqual({ view: "rooms", entityId: null });
    expect(parseSurfacePath("/rooms/group-1")).toEqual({
      view: "room",
      entityId: "group-1",
    });
  });

  it("decodes an id that had to be escaped to fit in a path", () => {
    expect(parseSurfacePath("/inspirations/one%20%2F%20two")).toEqual({
      view: "inspiration",
      entityId: "one / two",
    });
  });

  /*
    An unopenable capture must not strand anyone on a blank layer: the archive
    is one step behind it and is what they were reaching through anyway.
  */
  it("falls back to the archive when the id cannot be read", () => {
    expect(parseSurfacePath("/inspirations/%E0%A4%A")).toEqual({
      view: "archive",
      entityId: null,
    });
    expect(
      buildSurfacePath({ view: "inspiration", entityId: null }),
    ).toBe("/inspirations");
  });

  it("sends anything it does not recognise home rather than nowhere", () => {
    for (const path of ["/readings/read-1", "/sit", "/nonsense/deep"]) {
      expect(parseSurfacePath(path)).toEqual({ view: "wall", entityId: null });
    }
  });

  /* A malformed room id falls back to the rooms list, same as inspirations. */
  it("falls back to the rooms list when the room id cannot be read", () => {
    expect(parseSurfacePath("/rooms/%E0%A4%A")).toEqual({
      view: "rooms",
      entityId: null,
    });
    expect(buildSurfacePath({ view: "room", entityId: null })).toBe("/rooms");
  });

  it("builds paths that round-trip for every Surface view", () => {
    const routes = [
      { view: "wall" as const, entityId: null },
      { view: "capture" as const, entityId: null },
      { view: "archive" as const, entityId: null },
      { view: "signals" as const, entityId: null },
      { view: "rooms" as const, entityId: null },
      { view: "room" as const, entityId: "group-1" },
      { view: "inspiration" as const, entityId: "one / two" },
    ];

    for (const route of routes) {
      expect(parseSurfacePath(buildSurfacePath(route))).toEqual(route);
    }
  });
});
