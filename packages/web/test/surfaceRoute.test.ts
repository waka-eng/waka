import { describe, expect, it } from "vitest";

import { buildSurfacePath, parseSurfacePath } from "../src/lib/surface-route";

describe("Surface routes", () => {
  it("keeps solo views addressable", () => {
    expect(parseSurfacePath("/")).toEqual({
      view: "wall",
      roomId: null,
      entityId: null,
    });
    expect(parseSurfacePath("/capture").view).toBe("capture");
    expect(parseSurfacePath("/inspirations").view).toBe("ask");
    expect(parseSurfacePath("/inspirations/signal-1")).toMatchObject({
      view: "save",
      entityId: "signal-1",
    });
  });

  it("keeps room context through nested views", () => {
    expect(parseSurfacePath("/rooms/room-1")).toEqual({
      view: "wall",
      roomId: "room-1",
      entityId: null,
    });
    expect(parseSurfacePath("/rooms/room-1/direction").view).toBe("direction");
    expect(parseSurfacePath("/rooms/room-1/readings/read-1")).toEqual({
      view: "reading",
      roomId: "room-1",
      entityId: "read-1",
    });
  });

  it("builds paths that round-trip for every Surface view", () => {
    const routes = [
      { view: "wall" as const, roomId: null, entityId: null },
      { view: "capture" as const, roomId: null, entityId: null },
      { view: "ask" as const, roomId: "room / one", entityId: null },
      { view: "save" as const, roomId: "room-1", entityId: "signal / one" },
      { view: "reading" as const, roomId: "room-1", entityId: "read-1" },
      { view: "direction" as const, roomId: "room-1", entityId: null },
    ];

    for (const route of routes) {
      expect(parseSurfacePath(buildSurfacePath(route))).toEqual(route);
    }
  });
});
