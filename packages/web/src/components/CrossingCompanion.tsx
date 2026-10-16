/**
 * THE WALK BETWEEN NOW AND THE TIMELESS PLACE.
 *
 * Founder, 2026-10-15: "the transition from top of mind to principles should
 * have the motion of transition from NOW into a timeless zone. that means
 * character should stay in place and animate across the two transitions" —
 * and then, sharper: "clicking principle from now should make agent turn
 * right and move right (dont move it physically but motion shows it walking)
 * and the background makes it look like it's moving to that new timeless
 * space", and "when user is going from principles to now, do sth similar".
 *
 * SO THE CREATURE NEVER LEAVES ITS SPOT. The world stops painting its own
 * companion the moment a page is up (`asideRef` in Home), and this one is
 * drawn at exactly the place the world reported (`SimApi.creatureAt`), the
 * same body at the same size. It turns to its right with the same planet
 * turn the world uses for travel (`turnedPose`'s `yaw`), walks in place —
 * a bob per step and the nubs trading heights — while the sky streams past
 * behind it (`TimelessSky`'s `travel`), turns back to face you, and only
 * then glides to where the page keeps it. Going home is the same walk the
 * other way: it glides back to its spot first, turns left, walks, and faces
 * you as the world takes it back.
 *
 * MOTION EXPLAINS: the walk is the only thing that says "this is a different
 * place, and you were carried there". Under reduced motion it does not play
 * at all, and the page simply appears.
 */
import { useEffect, useRef } from "react";

import { OWNER_BEING } from "../character/body";
import { REST_BLEED, turnedPose } from "../character/raster";
import { renderScale } from "../canvas/scale";
import { clamp01, easeInOut as ease } from "../lib/num";
import { rampFromCss, rasterGrain } from "../canvas/palette";

export interface CreatureSpot { x: number; y: number; size: number }

/* The four beats, in milliseconds. A quarter turn is quick — the turn IS the
   acknowledgement — the walk is long enough for three steps, and the glide
   is what is left. The three beats are shared with the sky, which streams
   past for exactly the walk; the page waits on `onDone`, not on a clock. */
export const CROSS_TURN_MS = 240;
export const CROSS_WALK_MS = 900;
export const CROSS_GLIDE_MS = 720;
const CROSS_MS = CROSS_TURN_MS * 2 + CROSS_WALK_MS + CROSS_GLIDE_MS;
const STEPS = 3;

/* Past the mark and back: the last few pixels of a float that has weight. */
const easeOutBack = (t: number) => { const c1 = 1.15, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const smooth = (t: number) => { const x = clamp01(t); return x * x * (3 - 2 * x); };

export function CrossingCompanion({ from, to, dir, going, onDone }: {
  /** Where the walk happens: the world's spot on the way in, the page's on the way out. */
  from: CreatureSpot;
  /** Where it ends up. Absent means it stays where it walked. A function is
      asked when the glide begins, because on the way in the page's own
      creature has only just been laid out by then. */
  to: CreatureSpot | null | (() => CreatureSpot | null);
  /** +1 walks to its right (into Principles), -1 to its left (home to Now). */
  dir: 1 | -1;
  /** "in" walks then glides; "out" glides home first, then walks. */
  going: "in" | "out";
  onDone: () => void;
}): JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null);
  const done = useRef(onDone);
  done.current = onDone;

  /* The walk happens at the spot the world uses, so the drawing size is the
     world's; a glide to a smaller hero is a scale on top of it. */
  const fixedTo = typeof to === "function" ? null : to;
  const walkAt = going === "in" ? from : (fixedTo ?? from);
  const size = walkAt.size;
  const pad = Math.ceil(size * (REST_BLEED + 0.12));
  const box = size + pad * 2;

  useEffect(() => {
    const node = canvas.current;
    const g = node?.getContext("2d");
    /* THE WALK ALWAYS ENDS. The page behind it waits for `onDone` to come
       down (or for the world to take the creature back), so a canvas that
       cannot draw ends the walk at once, and a frame loop the browser stops
       running (a hidden tab) is ended by a timer a little after it should
       have finished on its own. */
    let ended = false;
    const finish = () => { if (!ended) { ended = true; done.current(); } };
    if (!node || !g) { finish(); return undefined; }
    const backstop = window.setTimeout(finish, CROSS_MS + 400);
    const dpr = renderScale(box, box);
    node.width = Math.ceil(box * dpr);
    node.height = Math.ceil(box * dpr);
    /* Always your own creature, in its own warm light: the walk is only ever
       taken from your Now. */
    const ramp = rampFromCss(document.documentElement);
    const tile = rasterGrain(ramp.dorm);
    const grain = tile ? g.createPattern(tile, "repeat") : null;
    const glideFirst = going === "out";
    const walkStart = glideFirst ? CROSS_GLIDE_MS : 0;
    const glideStart = glideFirst ? 0 : CROSS_TURN_MS * 2 + CROSS_WALK_MS;
    const start = performance.now();
    let frame = 0;
    let end: CreatureSpot | null | undefined = typeof to === "function" ? undefined : to;

    const place = (spot: CreatureSpot) => {
      node.style.transform = `translate(${spot.x - box / 2}px, ${spot.y - box / 2}px) scale(${spot.size / size})`;
    };

    const step = (now: number) => {
      const t = now - start;
      /* ═══ THE RISE (OR THE DESCENT) HAS A BODY IN IT ═════════════════
         Founder, 2026-10-15: "after moving, this character just kind of
         gets transported up ... make that also motion very natural. Like
         the character is looking up and kind of moving up." And: "same goes
         for the character moving down and moving left."
         So the glide is three beats, not a slide: it LOOKS where it is going
         first, gathers itself (a small crouch), then floats there —
         stretched a little by the speed, a touch past the mark and back —
         and its eyes come home as it lands. Down is the same, looking down. */
      const gp = clamp01((t - glideStart) / CROSS_GLIDE_MS);
      const gather = 0.22;
      const u = clamp01((gp - gather) / (1 - gather));
      const glideT = gp <= gather ? 0 : easeOutBack(u);
      /* Asked every frame of the glide, not once: the page is still sliding
         in while the creature lands, and a target read at the glide's first
         frame is a few pixels from where the page's creature ends up. */
      if (t >= glideStart && typeof to === "function") end = to() ?? end ?? null;
      const goal = end ?? from;
      const at = { x: from.x + (goal.x - from.x) * ease(u), y: from.y + (goal.y - from.y) * glideT, size: from.size + (goal.size - from.size) * ease(u) };
      place(at);
      const rising = Math.sign(goal.y - from.y);
      const gliding = t >= glideStart && t <= glideStart + CROSS_GLIDE_MS && Math.abs(goal.y - from.y) > 2;
      const look = gliding ? rising * smooth(gp / 0.18) * (1 - smooth((gp - 0.78) / 0.22)) : 0;
      const crouch = gliding && gp < gather ? Math.sin(Math.PI * (gp / gather)) * 0.08 : 0;
      const stretch = gliding && gp >= gather ? Math.sin(Math.PI * u) * 0.07 : 0;

      /* what it does there: turn, walk, turn back */
      const w = t - walkStart;
      const turnIn = ease(clamp01(w / CROSS_TURN_MS));
      const turnOut = ease(clamp01((w - CROSS_TURN_MS - CROSS_WALK_MS) / CROSS_TURN_MS));
      const yaw = dir * (Math.PI / 2) * (turnIn - turnOut);
      const walking = clamp01((w - CROSS_TURN_MS * 0.5) / (CROSS_WALK_MS + CROSS_TURN_MS * 0.5)) * (1 - turnOut);
      const phase = clamp01((w - CROSS_TURN_MS) / CROSS_WALK_MS) * STEPS * Math.PI;
      const inWalk = w > CROSS_TURN_MS && w < CROSS_TURN_MS + CROSS_WALK_MS;
      const bob = inWalk ? Math.abs(Math.sin(phase)) * size * 0.07 : 0;
      const stride = inWalk ? Math.sin(phase) : 0;
      const lean = dir * 0.07 * walking;

      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, node.width, node.height);
      g.scale(dpr, dpr);
      g.translate(box / 2, box / 2 - bob);
      g.rotate(lean);
      /* a little squash at each footfall: the body lands, then lifts — and
         the crouch before a rise and the stretch during it, all from its feet */
      const land = inWalk ? Math.pow(1 - Math.abs(Math.sin(phase)), 6) * 0.05 : 0;
      const squash = land + crouch - stretch;
      g.translate(0, size * 0.45);
      g.scale(1 + squash, 1 - squash);
      g.translate(-size / 2, -size / 2 - size * 0.45);
      turnedPose(g, size, ramp, OWNER_BEING, 1, dpr, yaw, stride, look, grain);

      if (t < CROSS_MS) frame = requestAnimationFrame(step);
      else finish();
    };
    place(from);
    frame = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(backstop); };
    /* One performance per mount: its inputs are read once, on purpose. */
  }, []);

  return (
    <canvas
      ref={canvas}
      className="waka-crossing-being"
      style={{ width: box, height: box }}
      aria-hidden="true"
    />
  );
}
