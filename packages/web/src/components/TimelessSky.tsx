/**
 * TIME, MADE VISIBLE, AS YOU STEP INTO YOUR PRINCIPLES.
 *
 * Founder, 2026-10-15: "maybe when clicking on principles, the background
 * does a time travel effect to show these are timeless principles."
 *
 * The image is the long exposure of a night sky: leave a camera open for
 * hours and every point of light draws an arc around one still pole. It is
 * the one photograph everybody already reads as "a great deal of time
 * passed here" — and the pole that does not move is the principle.
 *
 * So on the day's first arrival the points sweep into arcs over a little
 * under two seconds, fast in the middle and slowing at the end, and then
 * the trails stay,
 * quieter, as the ground the principles sit on. The motion happens once,
 * because the person moved (they opened the page); after that nothing
 * moves. Under reduced motion the settled trails are drawn at once.
 */
import { useEffect, useRef } from "react";

import { renderScale } from "../canvas/scale";
import { prefersStillness } from "../lib/motion";
import { easeInOut } from "../lib/num";
import { CROSS_GLIDE_MS, CROSS_TURN_MS, CROSS_WALK_MS } from "./CrossingCompanion";

const STARS = 170;
const SWEEP = 0.95; /* radians of sky turned during the arrival */
const ARRIVE_MS = 1700;
const REST_ALPHA = 0.26;

/* SOFT AT THE EDGES (2026-10-15, "make it a lot prettier and matching the
   design of our thing"): the trails are brightest in a ring near the pole and
   fall away toward the page's edges, so the sky wells up around the
   principles instead of filling the screen evenly. `ring` is a star's
   distance from the pole as a share of the sky's reach. */
function falloff(ring: number): number {
  return Math.max(0, 1 - Math.pow(Math.max(0, ring - 0.18) / 0.82, 1.6));
}

function unit(i: number, salt: number): number {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * ONCE A DAY. Founder, 2026-10-15, approved: the sweep means "a great deal
 * of time has passed here", which is true after a day away and false a few
 * minutes later — and anything that replays on every visit stops being a
 * moment and starts being a loading screen. So the first visit of the day
 * (the person's own local day) plays it; every later one opens on the
 * settled trails, which keep the timeless look without pretending.
 * Device-local and best-effort: storage that cannot be read just plays it.
 */
const PLAYED_KEY = "waka.timeless.played";

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

function playedToday(): boolean {
  try {
    return window.localStorage?.getItem(PLAYED_KEY) === today();
  } catch {
    return false;
  }
}

function markPlayed(): void {
  try {
    window.localStorage?.setItem(PLAYED_KEY, today());
  } catch {
    /* the next visit plays it again, which is the safe direction */
  }
}

/**
 * THE SKY MOVES WHILE THE CREATURE WALKS. Founder, 2026-10-15: "the
 * background makes it look like it's moving to that new timeless space."
 * `travel` is the crossing: on the way in the stars arrive from the side the
 * creature is walking toward, streaked by their speed, and slow into place
 * as it stops; on the way out they slide away the other way and go dark as
 * the world takes over. The walk itself is `CrossingCompanion`'s.
 */
export function TimelessSky({ travel = null }: { travel?: { dir: 1 | -1; going: "in" | "out" } | null } = {}) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const node = canvas.current;
    const g = node?.getContext("2d");
    if (!node || !g) return undefined;
    const width = node.clientWidth || window.innerWidth;
    const height = node.clientHeight || window.innerHeight;
    const dpr = renderScale(width, height);
    node.width = Math.ceil(width * dpr);
    node.height = Math.ceil(height * dpr);
    g.scale(dpr, dpr);

    const css = getComputedStyle(document.documentElement);
    const light = css.getPropertyValue("--jar-live").trim() || "#fff2dc";
    /* The pole sits above the page's first line, so the arcs ring the
       principles rather than cross them. */
    const pole = { x: width / 2, y: height * 0.12 };
    const reach = Math.hypot(Math.max(pole.x, width - pole.x), height - pole.y);
    const stars = Array.from({ length: STARS }, (_, i) => ({
      r: Math.sqrt(unit(i, 1)) * reach,
      a: unit(i, 2) * Math.PI * 2,
      bright: 0.25 + unit(i, 3) * 0.75,
      w: unit(i, 4) < 0.08 ? 1.1 : 0.6,
    }));

    /* Where a crossing has the sky: `shift` slides it sideways, `streak` is
       how fast it is going, drawn as a tail behind each star. */
    const drawTravel = (shift: number, streak: number, alpha: number) => {
      g.clearRect(0, 0, width, height);
      g.strokeStyle = light;
      g.lineCap = "round";
      for (const star of stars) {
        if (star.r < 6) continue;
        const x = pole.x + Math.cos(star.a) * star.r + shift;
        const y = pole.y + Math.sin(star.a) * star.r;
        g.globalAlpha = star.bright * alpha * Math.max(falloff(star.r / reach), 0.35);
        g.lineWidth = star.w;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + streak, y);
        g.stroke();
      }
      g.globalAlpha = 1;
    };
    const draw = (sweep: number, alpha: number) => {
      g.clearRect(0, 0, width, height);
      g.strokeStyle = light;
      g.lineCap = "round";
      for (const star of stars) {
        if (star.r < 6) continue;
        g.globalAlpha = star.bright * alpha * falloff(star.r / reach);
        g.lineWidth = star.w;
        g.beginPath();
        g.arc(pole.x, pole.y, star.r, star.a, star.a + Math.max(sweep, 0.004));
        g.stroke();
      }
      g.globalAlpha = 1;
    };

    if (travel && !prefersStillness()) {
      /* The scenery moves against the walk: walking right, it streams left. */
      const away = -travel.dir;
      const walkFrom = travel.going === "in" ? CROSS_TURN_MS * 0.5 : CROSS_GLIDE_MS + CROSS_TURN_MS * 0.5;
      const walkFor = CROSS_WALK_MS + CROSS_TURN_MS;
      const reachX = width * 0.55;
      let travelFrame = 0;
      const begin = performance.now();
      const fly = (now: number) => {
        const t = Math.min(1, Math.max(0, (now - begin - walkFrom) / walkFor));
        if (travel.going === "out" && now - begin < walkFrom) {
          travelFrame = requestAnimationFrame(fly);
          return;
        }
        /* THE SAME SKY BOTH WAYS. Founder, 2026-10-15: "i like the
           background that appears when the character is walking from now to
           principle. Also have the same background when moving from
           principle to now." So the walk home streams the same field of
           streaked stars past — arriving from the side it walks toward and
           slowing as it goes — only mirrored, and on the way out it fades in
           its last quarter as the world takes the creature back, where the
           way in settles into the trails. The streak is the speed, so it is
           longest where the motion is fastest. */
        const arriving = travel.going === "in";
        const p = 1 - Math.pow(1 - t, 3);
        const speed = 3 * Math.pow(1 - t, 2);
        const shift = -away * reachX * (1 - p);
        const streak = -away * speed * 26;
        const envelope = Math.min(1, t * 4) * (REST_ALPHA + (1 - REST_ALPHA) * 0.6 * Math.sin(Math.PI * t));
        const alpha = arriving ? envelope : envelope * Math.min(1, (1 - t) / 0.25);
        if (t >= 1) {
          if (arriving) draw(SWEEP, REST_ALPHA);
          else g.clearRect(0, 0, width, height);
          return;
        }
        drawTravel(shift, streak, alpha);
        travelFrame = requestAnimationFrame(fly);
      };
      /* Out, the trails hold until the creature starts walking home. */
      if (travel.going === "out") draw(SWEEP, REST_ALPHA);
      else drawTravel(-away * reachX, 0, 0);
      travelFrame = requestAnimationFrame(fly);
      return () => cancelAnimationFrame(travelFrame);
    }
    if (prefersStillness() || playedToday()) {
      draw(SWEEP, REST_ALPHA);
      return undefined;
    }

    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ARRIVE_MS);
      /* ease in-out: the hours rush through the middle and settle */
      const eased = easeInOut(t);
      /* brighter while time is moving, quieter once it has passed */
      const alpha = REST_ALPHA + (1 - REST_ALPHA) * Math.sin(Math.PI * Math.min(1, t * 1.05)) * 0.9;
      draw(SWEEP * eased, t >= 1 ? REST_ALPHA : alpha);
      /* RECORDED WHEN IT HAS PLAYED, not when it starts: a page left
         mid-sweep — or mounted twice, which React does on purpose in
         development and which made the first version skip itself — plays
         it again rather than losing the day's one sweep. */
      if (t < 1) frame = requestAnimationFrame(step);
      else markPlayed();
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [travel?.dir, travel?.going]);

  return <canvas ref={canvas} className="waka-timeless" aria-hidden="true" />;
}
