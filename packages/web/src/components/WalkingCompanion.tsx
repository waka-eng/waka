/**
 * ═══ A CREATURE THAT WALKS OVER TO YOURS ═════════════════════════════════
 *
 * Founder, of onboarding's "find your people": "we built animation of agent
 * walking to left/right. can we use that same animation here for the other
 * character to walk towards the main character?"
 *
 * So this is `CrossingCompanion`'s walk — the same beats from
 * `character/walk.ts`, drawn with the same `turnedPose` — except that here
 * the body actually TRAVELS: it starts `distance` px off to one side, turns to
 * face the way it is going, steps across while `travel` carries it, and turns
 * back to face you where it stops. Same grain, same aura as `Companion`.
 *
 * It plays once, when it mounts (a remount replays it). Under reduced motion
 * it does not walk: it stands where the walk would have ended, facing you.
 * It is a picture of someone else, so it takes no press.
 */
import { useEffect, useRef } from "react";

import type { Being } from "../character/body";
import { REST_BLEED, coolRamp, turnedPose } from "../character/raster";
import { WALK_HEADROOM, WALK_MS, placeStep, walkBeat } from "../character/walk";
import { renderScale } from "../canvas/scale";
import { rampFromCss, rasterGrain } from "../canvas/palette";

export function WalkingCompanion({ size, being, cool = false, distance, delayMs = 0, onArrived }: {
  size: number;
  being: Being;
  cool?: boolean;
  /** Where it starts, in px from where it ends: positive is to the right,
      and it walks toward the left. */
  distance: number;
  /** A beat before it sets off, so the page is seen before it moves. */
  delayMs?: number;
  onArrived?: () => void;
}): JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null);
  const holder = useRef<HTMLSpanElement>(null);
  const arrived = useRef(onArrived);
  arrived.current = onArrived;
  const pad = Math.ceil(size * (REST_BLEED + WALK_HEADROOM));
  const box = size + pad * 2;

  useEffect(() => {
    const node = canvas.current;
    const g = node?.getContext("2d");
    const place = (dx: number) => { if (holder.current) holder.current.style.transform = `translateX(${dx}px)`; };
    if (!node || !g) { place(0); arrived.current?.(); return undefined; }
    const dpr = renderScale(box, box);
    node.width = Math.ceil(box * dpr);
    node.height = Math.ceil(box * dpr);
    const ramp = coolRamp(rampFromCss(document.documentElement), cool);
    const tile = rasterGrain(ramp.dorm);
    const grain = tile ? g.createPattern(tile, "repeat") : null;
    const dir: 1 | -1 = distance > 0 ? -1 : 1;
    const draw = (w: number) => {
      const beat = walkBeat(w, dir, size);
      place(distance * (1 - beat.travel));
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, node.width, node.height);
      g.scale(dpr, dpr);
      placeStep(g, size, box, beat, beat.land);
      turnedPose(g, size, ramp, being, 1, dpr, beat.yaw, beat.stride, 0, grain);
    };
    const still = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still || typeof requestAnimationFrame !== "function") {
      draw(WALK_MS);
      arrived.current?.();
      return undefined;
    }
    draw(0);
    let frame = 0;
    let begun = 0;
    const step = (now: number) => {
      if (!begun) begun = now;
      const w = now - begun - delayMs;
      draw(Math.max(0, w));
      if (w < WALK_MS) frame = requestAnimationFrame(step);
      else arrived.current?.();
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [size, being, cool, distance, delayMs, box]);

  return (
    <span ref={holder} className="waka-companion waka-walking" aria-hidden="true"
      style={{ ["--waka-companion-size" as string]: `${box}px`, transform: `translateX(${distance}px)` }}>
      <canvas ref={canvas} className="waka-companion-body" style={{ width: box, height: box }} />
    </span>
  );
}
