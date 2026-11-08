/**
 * The onboarding creature, drawn exactly as the approved frames draw it: a
 * warm body lit from inside, two round hands, two eyes. Four sizes because the
 * frames use four (the small one beside the pile, the large one that asks,
 * the pair in "find your people", the tiny one beside a photo).
 */
import type { CSSProperties } from "react";

type Size = "tiny" | "small" | "medium" | "large";

const GEOMETRY: Record<Size, {
  w: number; h: number;
  body: { l: number; w: number; h: number; r: string };
  arm: { size: number; top: number; inset: number } | null;
  eye: { w: number; h: number; top: number; at: [number, number]; atLeft?: [number, number] };
  closed: { w: number; top: number; at: [number, number] };
}> = {
  tiny: { w: 40, h: 32, body: { l: 3, w: 34, h: 30, r: "18px 18px 15px 15px" }, arm: null,
    eye: { w: 3, h: 4, top: 11, at: [15, 22] }, closed: { w: 5, top: 12, at: [14, 21] } },
  small: { w: 76, h: 56, body: { l: 5, w: 66, h: 54, r: "33px 33px 27px 27px" }, arm: { size: 17, top: 34, inset: 0 },
    eye: { w: 5, h: 6, top: 16, at: [27, 41] }, closed: { w: 8, top: 18, at: [26, 40] } },
  medium: { w: 100, h: 76, body: { l: 6, w: 88, h: 74, r: "44px 44px 37px 37px" }, arm: { size: 23, top: 44, inset: 0 },
    eye: { w: 7, h: 8, top: 28, at: [46, 63], atLeft: [30, 47] }, closed: { w: 10, top: 31, at: [38, 54] } },
  large: { w: 116, h: 86, body: { l: 8, w: 100, h: 84, r: "50px 50px 42px 42px" }, arm: { size: 26, top: 50, inset: 0 },
    eye: { w: 8, h: 9, top: 30, at: [44, 64] }, closed: { w: 12, top: 34, at: [44, 62] } },
};

export function Creature({
  size = "large", eyes = "open", look = "ahead", hands = "down", cool = false, glow = 60, eyeTop,
  className = "", style, bodyClassName = "",
}: {
  size?: Size;
  eyes?: "open" | "closed";
  /** Medium only: the left creature looks right, the right one looks left. */
  look?: "ahead" | "left";
  /** "up" is the frame where it holds what it read. */
  hands?: "down" | "up";
  cool?: boolean;
  /** Reach of the inner light, px — the frames vary it by moment. */
  glow?: number;
  eyeTop?: number;
  className?: string;
  style?: CSSProperties;
  bodyClassName?: string;
}): JSX.Element {
  const g = GEOMETRY[size];
  const alpha = glow >= 80 ? 0.35 : glow >= 70 ? 0.32 : glow >= 50 ? 0.25 : 0.22;
  const eyeAt = look === "left" && g.eye.atLeft ? g.eye.atLeft : g.eye.at;
  return (
    <span aria-hidden="true" className={`onb-creature${cool ? " onb-creature--cool" : ""} ${className}`.trim()}
      style={{ width: g.w, height: g.h, ...style }}>
      <span className={`onb-creature-body ${bodyClassName}`.trim()} style={{
        left: g.body.l, top: 0, width: g.body.w, height: g.body.h, borderRadius: g.body.r,
        boxShadow: `0 0 ${glow}px rgba(236,230,218,${alpha})`,
      }} />
      {g.arm ? (
        <>
          <span className="onb-creature-arm" style={{ left: hands === "up" ? 4 : g.arm.inset, top: hands === "up" ? 20 : g.arm.top, width: g.arm.size, height: g.arm.size }} />
          <span className="onb-creature-arm" style={{ right: hands === "up" ? 4 : g.arm.inset, top: hands === "up" ? 20 : g.arm.top, width: g.arm.size, height: g.arm.size }} />
        </>
      ) : null}
      {eyes === "open" ? eyeAt.map((left) => (
        <span key={left} className="onb-creature-eye" style={{ left, top: eyeTop ?? g.eye.top, width: g.eye.w, height: g.eye.h }} />
      )) : g.closed.at.map((left) => (
        <span key={left} className="onb-creature-eye onb-creature-eye--closed" style={{ left, top: g.closed.top, width: g.closed.w, height: 3 }} />
      ))}
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
