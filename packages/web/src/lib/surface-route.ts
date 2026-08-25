/**
 * The surface is one composition, but its places still need URLs. This is the
 * whole of that mapping: every state addressable, each round-tripping back to
 * the state it came from so Back and Forward restore where the person
 * actually was.
 */
export type SurfaceView =
  | "wall"
  | "capture"
  | "archive"
  | "inspiration"
  | "signals"
  | "principles"
  | "rooms"
  | "room"
  /** The agents in this account: their keys, and the door to each one's mind. */
  | "agents"
  /** One profile's mind as a picture: principles over signals over experiences. */
  | "graph";

export interface SurfaceRoute {
  view: SurfaceView;
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

export function parseSurfacePath(pathname: string): SurfaceRoute {
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 0) return { view: "wall", entityId: null };
  if (segments.length === 1 && segments[0] === "capture") {
    return { view: "capture", entityId: null };
  }
  if (segments.length === 1 && segments[0] === "signals") {
    return { view: "signals", entityId: null };
  }
  if (segments.length === 1 && segments[0] === "principles") {
    return { view: "principles", entityId: null };
  }
  if (segments.length === 1 && segments[0] === "inspirations") {
    return { view: "archive", entityId: null };
  }
  if (segments.length === 1 && segments[0] === "rooms") {
    return { view: "rooms", entityId: null };
  }
  if (segments.length === 1 && segments[0] === "agents") {
    return { view: "agents", entityId: null };
  }
  /* /graph is the session's own mind; /graph/<profileId> is another profile
     the matrix lets this session read — an agent's, usually. */
  if (segments.length === 1 && segments[0] === "graph") {
    return { view: "graph", entityId: null };
  }
  if (segments.length === 2 && segments[0] === "graph") {
    const entityId = decodeSegment(segments[1]);
    return { view: "graph", entityId };
  }
  /*
    THE WALL NEEDS AN ADDRESS OF ITS OWN NOW.

    This view's only address used to be "/", because Surface was the whole
    product. The world took "/" when it landed, so the wall — the flat screen's
    top of mind — became the one view on the bottom bar that could not be
    linked to: following "/" leaves Surface entirely.

    "/" still parses to `wall` below, and must: `buildSurfacePath({view:"wall"})`
    returns "/", which is what the page's back affordance resolves to, and going
    back to the world is the intended way home. This is an ADDITIONAL address,
    not a replacement — it is how something outside Surface links INTO this
    view, which nothing could do before.
  */
  if (segments.length === 1 && segments[0] === "top-of-mind") {
    return { view: "wall", entityId: null };
  }
  if (segments.length === 2 && segments[0] === "rooms") {
    const entityId = decodeSegment(segments[1]);
    /* Same rule as a malformed inspiration id: fall back to the list. */
    return entityId ? { view: "room", entityId } : { view: "rooms", entityId: null };
  }
  if (segments.length === 2 && segments[0] === "inspirations") {
    const entityId = decodeSegment(segments[1]);
    /*
      A malformed id is not a fourth state. Falling back to the archive keeps
      an unopenable capture from stranding the person on a blank layer, and
      the list they were reaching for is one step behind it anyway.
    */
    return entityId
      ? { view: "inspiration", entityId }
      : { view: "archive", entityId: null };
  }

  return { view: "wall", entityId: null };
}

export function buildSurfacePath(input: SurfaceRoute): string {
  switch (input.view) {
    case "capture":
      return "/capture";
    case "principles":
      return "/principles";
    case "signals":
      return "/signals";
    case "archive":
      return "/inspirations";
    case "rooms":
      return "/rooms";
    case "agents":
      return "/agents";
    case "graph":
      return input.entityId ? `/graph/${encodeURIComponent(input.entityId)}` : "/graph";
    case "room":
      return input.entityId ? `/rooms/${encodeURIComponent(input.entityId)}` : "/rooms";
    case "inspiration":
      return input.entityId
        ? `/inspirations/${encodeURIComponent(input.entityId)}`
        : "/inspirations";
    case "wall":
    default:
      return "/";
  }
}
