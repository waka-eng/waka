/**
 * The surface is one composition, but its places still need URLs. This is the
 * whole of that mapping: five states, each addressable, each round-tripping
 * back to the state it came from so Back and Forward restore where the person
 * actually was.
 */
export type SurfaceView =
  | "wall"
  | "capture"
  | "archive"
  | "inspiration"
  | "signals";

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
  if (segments.length === 1 && segments[0] === "inspirations") {
    return { view: "archive", entityId: null };
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
    case "signals":
      return "/signals";
    case "archive":
      return "/inspirations";
    case "inspiration":
      return input.entityId
        ? `/inspirations/${encodeURIComponent(input.entityId)}`
        : "/inspirations";
    case "wall":
    default:
      return "/";
  }
}
