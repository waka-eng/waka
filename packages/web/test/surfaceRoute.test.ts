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
