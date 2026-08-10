export type SurfaceView =
  | "wall"
  | "reading"
  | "save"
  | "ask"
  | "capture"
  | "sit"
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
  /*
    `/rooms/:id/capture` is no longer built, but it is still read: an open tab,
    a bookmark or a Back button from before this change should land on the
    composer with that room still under it rather than on a dead route. The
    room is carried through as the place to return to, which is all it ever
    meant here.
  */
  if (rest.length === 1 && rest[0] === "capture") {
    return { view: "capture", roomId, entityId: null };
  }
  /*
    Sitting with today's saves is a solo act — reflection happens beside your
    own heart, not in front of a room — so the path never carries a room and
    a room-nested variant is not read either.
  */
  if (!roomId && rest.length === 1 && rest[0] === "sit") {
    return { view: "sit", roomId: null, entityId: null };
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

/**
 * Which room the member is standing in, given the route and history state.
 *
 * Capture is the one view whose path carries no room, so for capture — and
 * only capture — the room arrives in history state instead. Everything that
 * depends on "which wall is behind this" reads through here: the room's name
 * and cast in the head, which status gets re-polled after a save, and where
 * closing the composer puts you back.
 *
 * A direct load of `/capture` has no state and therefore no room, which is
 * correct: nobody is standing anywhere, and the save is unaffected either way.
 */
export function resolveSurfaceRoom(
  route: SurfaceRoute,
  historyState: unknown,
): SurfaceRoomId {
  if (route.view !== "capture") return route.roomId;
  if (route.roomId) return route.roomId; // legacy /rooms/:id/capture
  const carried = (historyState as { room?: unknown } | null | undefined)?.room;
  return typeof carried === "string" && carried ? carried : null;
}

export function buildSurfacePath(input: SurfaceRoute): string {
  const base = input.roomId
    ? `/rooms/${encodeURIComponent(input.roomId)}`
    : "";

  switch (input.view) {
    /*
      Capture is never nested under a room, whatever room you opened it from.

      A save belongs to the person who made it and to nothing else: the create
      request carries no room, the API schema has no field for one, and the row
      is written with the session's own user id. `/rooms/:id/capture` claimed a
      relationship the database has never had — and worse, it implied the save
      would reach THAT room, when sharing is a single per-signal flag that every
      room you are in reads.

      Which room you were standing in when you opened the composer is still
      worth knowing — it is where closing the composer puts you back. That
      travels in history state, where context belongs, rather than in the path,
      where it reads as ownership.
    */
    case "capture":
      return "/capture";
    // Solo like capture, and for the same reason: the act belongs to the
    // person, whatever room they were standing in when they reached for it.
    case "sit":
      return "/sit";
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
