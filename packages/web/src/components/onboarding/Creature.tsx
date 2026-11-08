/**
 * THE ONBOARDING CREATURE IS THE APP'S OWN CREATURE.
 *
 * Founder, on the first build: "why this character instead of my [real one]".
 * The first pass redrew the prototype frames' flat CSS creature; this is the
 * grain-textured rest pose every other page shows (`Companion`, the same body
 * the door shows at 88px), with its own aura.
 *
 * THE FRAMES' MOTION MOVES A WRAPPER, never the drawing: the box below is the
 * frame's own footprint for the creature, so `onb-catch`, `onb-lift`,
 * `onb-lean` and `onb-arrive` transform it from the frame's own origin, and
 * the body is centred in it. The frames' raised hands are not drawn — the
 * rest pose's nubs do not move, and a second drawing to fake it is exactly
 * what the founder objected to. Closed eyes ARE drawn, by the rest pose
 * itself (`eyes: "shut"`, from the loop's own blink floor).
 */
import type { CSSProperties } from "react";

import { OWNER_BEING } from "../../character/body";
import { Companion } from "../Companion";

type Size = "tiny" | "small" | "medium" | "large";

/** The frame's footprint for the creature, and the body's width inside it. */
const GEOMETRY: Record<Size, { w: number; h: number; body: number }> = {
  tiny: { w: 40, h: 32, body: 34 },
  small: { w: 76, h: 56, body: 66 },
  medium: { w: 100, h: 76, body: 88 },
  large: { w: 116, h: 86, body: 100 },
};

/* The other person in "find your people" is the SAME round body as yours —
   founder: "the walking character was better shaped ... it felt more round" —
   told apart only by colder light (`cool`). */

export function Creature({
  size = "large", eyes = "open", other = false, className = "", style, bodyClassName = "",
}: {
  size?: Size;
  eyes?: "open" | "closed";
  /** Somebody else's creature rather than yours. */
  other?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Motion on the body itself (the light passing in frame D). */
  bodyClassName?: string;
}): JSX.Element {
  const g = GEOMETRY[size];
  return (
    <span aria-hidden={other ? true : undefined} className={`onb-creature ${className}`.trim()} style={{ width: g.w, height: g.h, ...style }}>
      <span className={`onb-creature-real ${bodyClassName}`.trim()}>
        {/* Yours lights when pressed, as everywhere; somebody else's is a
            picture of a person you have not met yet. */}
        <Companion size={g.body} eyes={eyes === "closed" ? "shut" : "open"}
          being={OWNER_BEING} cool={other} pressable={!other} />
      </span>
    </span>
  );
}

/** The three glyphs the bar answers with, drawn as the frames draw them. */
export function Glyph({ kind, size = 20 }: { kind: "write" | "photo" | "voice" | "close" | "down"; size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={kind === "close" ? 1.8 : 1.6} aria-hidden="true" focusable="false">
      {kind === "write" ? <path d="M4 6h16M4 12h16M4 18h10" /> : null}
      {kind === "photo" ? <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M21 16l-5-5-8 8" /></> : null}
      {kind === "voice" ? <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></> : null}
      {kind === "close" ? <path d="M6 6l12 12M18 6L6 18" /> : null}
      {kind === "down" ? <path d="M12 5v14M6 13l6 6 6-6" /> : null}
    </svg>
  );
}

/** Progress as dots — states render, numerals never. */
export function Dots({ count, on, className = "" }: { count: number; on: number; className?: string }): JSX.Element {
  return (
    <span className={`onb-dots ${className}`.trim()} aria-hidden="true">
      {Array.from({ length: count }, (_, at) => (
        <span key={at} className={`onb-dot${at < on ? " onb-dot--on" : ""}`} />
      ))}
    </span>
  );
}
