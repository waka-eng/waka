import { type Ramp } from "../lib/appearance";
import { KEY_X, KEY_Y, ditherAlpha, makeSprite, mix, rgbCss } from "../canvas/sprites";
import { type Being } from "./body";





/* ---------- the light, in numbers ----------
   A bright point through a night lens: the bloom is WIDE and THIN, nothing
   like a hot little flame. Reach first, then the alpha it peaks at, then how
   fast it falls away. */

/** Dim tiers the character's body is baked at. */
export const BODY_TIERS = 4;
/** The character's baked sprite size in logical px; it is scaled at draw. */
export const BODY_PX = 240;

/** How many aliveness tiers the orb sprites are baked at. */
export function bodyPath(g: CanvasRenderingContext2D, bw: number, bh: number, be: Being): void {
  /* MASS IS CONSTANT, ASPECT IS NOT. w·h is the same number at every aspect —
     a wide being is not a big being — and at aspect 1.15 this reduces to the
     canonical geometry byte for byte. At the extremes W runs 0.810 → 0.921 of
     the sprite, so nothing ever clips. */
  const K = Math.sqrt(be.aspect / 1.15);
  const W = 0.86 * K;
  const H = W / be.aspect;
  const A = be.asym;
  const F = be.base;
  const cy = 0.5 + H * 0.04;
  const l = 0.5 - W / 2;
  const r = 0.5 + W / 2;
  const top = cy - H / 2;
  const bot = cy + H / 2;
  const X = (u: number) => (u - 0.5) * bw;
  const Y = (v: number) => (v - 0.5) * bh;
  g.beginPath();
  g.moveTo(X(l), Y(cy + H * 0.1));
  /* the dome. Its APEX tilt (r − W·0.06) is canonical for every being: an
     off-centre apex is what exposes the planet fiction under yaw. */
  g.bezierCurveTo(
    X(l),
    Y(top - H * be.dome[0]),
    X(r - W * 0.06),
    Y(top - H * be.dome[1]),
    X(r),
    Y(cy + H * 0.04),
  );
  /* right shoulder down into the resting curve, then the flat-ish base */
  g.bezierCurveTo(X(r + W * A), Y(cy + H * 0.32), X(r - W * F), Y(bot), X(0.5 + W * A), Y(bot));
  g.bezierCurveTo(X(l + W * (F - A)), Y(bot), X(l - W * A), Y(cy + H * 0.34), X(l), Y(cy + H * 0.1));
  g.closePath();
}


/**
 * COLDER LIGHT IS THE ONE THING AN AGENT'S BODY MAY CHANGE.
 *
 * Invariant 4 says two beings at the same aliveness are the same colour. This
 * shifts an agent's BODY a step down the temperature channel and nothing else
 * — and it does not break the law, because the warm end still belongs to what
 * is most alive, and on an agent's wall that is the memories in its peek row,
 * which stay exactly as warm as they are anywhere. What it says is that YOUR
 * companion is the warmest body on any wall in the world, and an agent's is a
 * creature of the same species made of colder light. One channel, no badge,
 * read before you read a word.
 */
export const COOL_BODY = 0.42;
export function coolRamp(ramp: Ramp, cool: boolean): Ramp {
  if (!cool) return ramp;
  return {
    ...ramp,
    bodyLit: mix(ramp.bodyLit, ramp.fade, COOL_BODY),
    bodyShade: mix(ramp.bodyShade, ramp.dorm, COOL_BODY * 0.5),
  };
}

export function rasterBody(
  dpr: number,
  tier: number,
  grain: CanvasPattern | null,
  ramp: Ramp,
  be: Being,
): HTMLCanvasElement {
  const D = Math.ceil(BODY_PX * dpr);
  const [c, g] = makeSprite(D);
  if (!g) return c;
  const life = tier / (BODY_TIERS - 1);
  /* The companion belongs to the same light as everything else: it is the
     brightest thing in an ember room, a cool silver form under moonlight, and
     lantern-warm on hanji. With nothing alive in the jar it fades toward the
     the ground's own shadow — that it goes quiet when the field does is the
     point. */
  const lit = mix(ramp.bodyShade, ramp.bodyLit, life);
  const shade = mix(mix(ramp.bodyShade, ramp.dorm, 0.45), ramp.bodyShade, life);

  /* the pebble-drop, at THIS being's proportions. The silhouette is traced by
     the one tracer the draw pass clips its features to, so the bake and the
     clip can never drift apart. */
  const K = Math.sqrt(be.aspect / 1.15);
  const w = D * 0.86 * K;
  const h = w / be.aspect;
  const cx = D / 2;
  const cy = D / 2 + h * 0.04;
  const bot = cy + h / 2;
  g.save();
  g.translate(cx, D / 2);
  bodyPath(g, D, D, be);
  g.restore();
  g.clip();

  /* THE SAME KEY. It used to be lit straight down, which is a different light
     from the one every orb in the frame obeys — and a frame with two lights in
     it is a frame that was drawn, not photographed. */
  const body = g.createLinearGradient(
    cx + KEY_X * w * 0.6,
    cy + KEY_Y * h * 0.7,
    cx - KEY_X * w * 0.5,
    bot,
  );
  body.addColorStop(0, rgbCss(lit, 1));
  body.addColorStop(0.55, rgbCss(mix(lit, shade, 0.25), 1));
  body.addColorStop(1, rgbCss(shade, 1));
  g.fillStyle = body;
  g.fillRect(0, 0, D, D);

  /* its own rim, on the key side, and the cold bounce opposite */
  const bRimX = cx + KEY_X * w * 0.46;
  const bRimY = cy + KEY_Y * h * 0.5;
  const bRim = g.createRadialGradient(bRimX, bRimY, 0, bRimX, bRimY, w * 0.5);
  bRim.addColorStop(0, `rgba(255,252,246,${(0.16 * (0.4 + 0.6 * life)).toFixed(3)})`);
  bRim.addColorStop(1, "rgba(255,252,246,0)");
  g.fillStyle = bRim;
  g.fillRect(0, 0, D, D);
  const bCx = cx - KEY_X * w * 0.44;
  const bCy = cy - KEY_Y * h * 0.42;
  const bCounter = g.createRadialGradient(bCx, bCy, 0, bCx, bCy, w * 0.55);
  bCounter.addColorStop(0, "rgba(176,196,222,0.09)");
  bCounter.addColorStop(1, "rgba(176,196,222,0)");
  g.fillStyle = bCounter;
  g.fillRect(0, 0, D, D);

  /* a faint darker underside so it reads as volume, not a sticker */
  const under = g.createLinearGradient(0, cy + h * 0.1, 0, bot);
  under.addColorStop(0, "rgba(90,86,78,0)");
  under.addColorStop(1, "rgba(90,86,78,0.22)");
  g.fillStyle = under;
  g.fillRect(0, 0, D, D);

  /* matte and handmade: the same grain the rest of the page wears */
  if (grain) {
    g.globalCompositeOperation = "overlay";
    g.globalAlpha = 0.14;
    g.fillStyle = grain;
    g.fillRect(0, 0, D, D);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
  ditherAlpha(g, D);
  return c;
}

