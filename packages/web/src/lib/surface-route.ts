export type SurfaceView =
  | "wall"
  | "reading"
  | "save"
  | "ask"
  | "capture"
  | "direction";

export type SurfaceRoomId = string | null;

export interface SurfaceRoute {
  view: SurfaceView;
  roomId: SurfaceRoomId;
  entityId: string | null;
}

function decodeSegment(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * The Surface is one visual composition, but its meaningful places still
 * need URLs. This parser keeps room context in every nested view so browser
 * Back and Forward can restore where the member actually was.
 */
export function parseSurfacePath(pathname: string): SurfaceRoute {
  const segments = pathname.split("/").filter(Boolean);
  let roomId: SurfaceRoomId = null;
  let rest = segments;

  if (segments[0] === "rooms") {
    roomId = decodeSegment(segments[1]);
    if (!roomId) return { view: "wall", roomId: null, entityId: null };
    rest = segments.slice(2);
  }

  if (rest.length === 0) return { view: "wall", roomId, entityId: null };
  if (rest.length === 1 && rest[0] === "capture") {
    return { view: "capture", roomId, entityId: null };
  }
  if (rest.length === 1 && rest[0] === "inspirations") {
    return { view: "ask", roomId, entityId: null };
  }
  if (rest.length === 2 && rest[0] === "inspirations") {
    const entityId = decodeSegment(rest[1]);
    return entityId
      ? { view: "save", roomId, entityId }
      : { view: "ask", roomId, entityId: null };
  }
  if (rest.length === 2 && rest[0] === "readings") {
    const entityId = decodeSegment(rest[1]);
    return entityId
      ? { view: "reading", roomId, entityId }
      : { view: "wall", roomId, entityId: null };
  }
  if (roomId && rest.length === 1 && rest[0] === "direction") {
    return { view: "direction", roomId, entityId: null };
  }

  return { view: "wall", roomId, entityId: null };
}

export function buildSurfacePath(input: SurfaceRoute): string {
  const base = input.roomId
    ? `/rooms/${encodeURIComponent(input.roomId)}`
    : "";

  switch (input.view) {
    case "capture":
      return `${base}/capture`;
    case "ask":
      return `${base}/inspirations`;
    case "save":
      return input.entityId
        ? `${base}/inspirations/${encodeURIComponent(input.entityId)}`
        : `${base}/inspirations`;
    case "reading":
      return input.entityId
        ? `${base}/readings/${encodeURIComponent(input.entityId)}`
        : base || "/";
    case "direction":
      return input.roomId ? `${base}/direction` : "/";
    case "wall":
    default:
      return base || "/";
  }
}
