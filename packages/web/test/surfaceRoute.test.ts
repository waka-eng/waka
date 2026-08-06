import { describe, expect, it } from "vitest";

import {
  buildSurfacePath,
  parseSurfacePath,
  resolveSurfaceRoom,
} from "../src/lib/surface-route";

/**
 * The surface's own navigation, reduced to the two lines that decide a path.
 * Mirrors `navigateSurface` in Surface.tsx: the room comes from wherever you
 * currently are unless the caller overrides it, and capture is the one view
 * that carries it in history state instead of the path.
 */
function step(
  at: { path: string; state: unknown },
  view: Parameters<typeof buildSurfacePath>[0]["view"],
): { path: string; state: unknown } {
  const room = resolveSurfaceRoom(parseSurfacePath(at.path), at.state);
  return {
    path: buildSurfacePath({ view, roomId: room, entityId: null }),
    state: view === "capture" && room ? { room } : null,
  };
}

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

  /*
    A save belongs to the person who made it. The create request carries no
    room, the API schema has no field for one, and the row is written with the
    session's user id — so a room-nested capture URL asserted a relationship
    that has never existed, and implied the save would reach that one room when
    sharing is a single flag every room reads.
  */
  describe("capture is not a room's", () => {
    it("never nests capture under a room, whatever room you opened it from", () => {
      expect(
        buildSurfacePath({ view: "capture", roomId: "room-1", entityId: null }),
      ).toBe("/capture");
      expect(
        buildSurfacePath({ view: "capture", roomId: null, entityId: null }),
      ).toBe("/capture");
    });

    it("still reads the old room-nested path, so open tabs survive", () => {
      expect(parseSurfacePath("/rooms/room-1/capture")).toEqual({
        view: "capture",
        roomId: "room-1",
        entityId: null,
      });
    });

    it("keeps every other view room-addressable", () => {
      // Capture is the exception, not a general un-nesting.
      for (const view of ["ask", "direction"] as const) {
        expect(
          buildSurfacePath({ view, roomId: "room-1", entityId: null }),
        ).toContain("/rooms/room-1");
      }
    });
  });

  /*
    Taking the room out of the path must not take it out of the experience.
    The composer opens in front of a wall that is still there, keeping its name
    and its cast, and closing it has to put you back at that wall rather than
    dropping you onto your own.
  */
  describe("the room you opened the composer from", () => {
    it("survives opening capture, and closing returns to it", () => {
      const room = { path: "/rooms/room-1", state: null };

      const capture = step(room, "capture");
      expect(capture.path).toBe("/capture");
      expect(resolveSurfaceRoom(parseSurfacePath(capture.path), capture.state)).toBe(
        "room-1",
      );

      expect(step(capture, "wall").path).toBe("/rooms/room-1");
    });

    it("carries the room to any view reached from the composer", () => {
      const capture = step({ path: "/rooms/room-1", state: null }, "capture");
      expect(step(capture, "ask").path).toBe("/rooms/room-1/inspirations");
      expect(step(capture, "direction").path).toBe("/rooms/room-1/direction");
    });

    it("leaves a solo capture solo, and closing stays on the solo wall", () => {
      const capture = step({ path: "/", state: null }, "capture");
      expect(capture.path).toBe("/capture");
      expect(capture.state).toBeNull();
      expect(step(capture, "wall").path).toBe("/");
    });

    it("has no room on a direct load of /capture", () => {
      // A pasted or bookmarked /capture: nobody is standing anywhere.
      expect(resolveSurfaceRoom(parseSurfacePath("/capture"), null)).toBeNull();
      expect(resolveSurfaceRoom(parseSurfacePath("/capture"), undefined)).toBeNull();
    });

    it("recovers the room from a legacy room-nested capture URL", () => {
      const legacy = { path: "/rooms/room-1/capture", state: null };
      expect(resolveSurfaceRoom(parseSurfacePath(legacy.path), legacy.state)).toBe(
        "room-1",
      );
      // And closing it lands on the room, then capture rebuilds unnested.
      expect(step(legacy, "wall").path).toBe("/rooms/room-1");
      expect(step(legacy, "capture").path).toBe("/capture");
    });

    it("ignores a malformed room in history state", () => {
      for (const bad of [{ room: 42 }, { room: "" }, {}, "nonsense"]) {
        expect(resolveSurfaceRoom(parseSurfacePath("/capture"), bad)).toBeNull();
      }
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
