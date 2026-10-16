/**
 * BAKED LIGHT — the sprites the canvas draws, and nothing that knows what they
 * mean.
 *
 * The machinery half of the world. It knows light, grain, dither and colour
 * temperature; it does not know what an inspiration is, or a signal, or a
 * group. Every function here is a pure function of a `Ramp` and a size — call
 * it twice with the same arguments and you get the same canvas back — which is
 * what makes the results safe to cache and the code safe to move.
 *
 * PASS ONE OF TWO, and the seam is where the companion begins. `bodyPath`,
 * `rasterBody`, `bakeBeing` and the `Palette` that caches them stay in the
 * page for now: `buildPalette` bakes the creature, so moving them here would
 * make this module and `character/` a hard runtime cycle. Untying that is its
 * own change and the primitives underneath it do not have to wait for it.
 *
 * The orb bakers that lived here (`rasterOrb`, `rasterOrbPixel`,
 * `orbsForHue`) went on 2026-10-15 with the balls they drew.
 */

import { lerp } from "../lib/num";

/**
 * THE KEY LIGHT — one source, and the whole world agrees about it.
 *
 * This REVERSES AN EARLIER FOUNDER RULING, deliberately and with approval.
 * That ruling ("no rim, no terminator, no contact shadow — these are lit from
 * within and float") came from a reference image of flat pastel gradient
 * orbs, and it was right for that world. This world is night photography, and
 * in night photography things have SURFACES: a dormant orb measured as a
 * mathematically flat disc — sixty-one, sixty-one, sixty-one all the way
 * across — which is a fill, not an object, and a large part of why the frame
 * read as drawn rather than photographed.
 *
 * So: one motivated source, high and to the upper left, stated once here and
 * obeyed by the clouds and the companion alike (and by the orbs, while
 * they were drawn). Everything in a
 * frame agreeing about where the light is is most of what "one place" means.
 *
 * It is NIGHT-PHOTOGRAPHY SUBTLE. If it reads as a shiny 3D ball it has
 * overshot: this is a surface catching a little light, at the threshold of
 * noticing. And it introduces NO hue — the rim is the same warm-white the
 * ramp already has, the shadow is the ground's own colour, and the counter-
 * rim is the cool end. Temperature and luminance only, always.
 */
export const KEY_X = -0.62;
export const KEY_Y = -0.78;
/**
 * FILM GRAIN, AND IT HAS TO BE VISIBLE. One noise value per CELL rather than
 * per device pixel — a one-device-pixel cell on a retina display is half a CSS
 * pixel, which is to say invisible, and invisible texture is what made the
 * previous surface read as vector-clean. Two device px is fine film and still
 * perceptible at 100%.
 */
export const GRAIN_PX = 2;
/** The tile is GRAIN_TILE cells square, in CSS pixels. */
export const GRAIN_TILE = 64;
/**
 * FULL RANGE, BECAUSE IT IS A DITHER NOW AND NOT A TEXTURE.
 *
 * 0.09 was tuned when the film layer blended with `overlay`, where the point
 * was to lift midtones and leave the blacks alone. That is the opposite of
 * what this screen needs: the banding lives IN the blacks — the companion's
 * glow falls off across two hundred and fifty pixels of near-black, and an
 * 8-bit ramp that shallow quantises into flat bands up to 26px wide.
 *
 * The amplitude has to clear one least-significant bit to dissolve a contour
 * step. At 0.09 and the layer's opacity the perturbation was 0.23 LSB —
 * a quarter of the way to doing anything. At full range it is 2.6 LSB, which
 * dissolves the step without reading as grain.
 */
export const GRAIN_AMP = 1;
/* The strength lives in jar.css with the layer that carries it: opacity on a
   real element, blended against an opaque backdrop. */
/** The corners fall away. A photographic idea, so it is kept photographic. */
export const VIGNETTE = 0.34;
/** A candidate's unformed light: the same ramp, spread out and faint. */
export const NEB_PEAK = 0.12;

/**
 * THE RADII A FIELD ORB SNAPS TO. They were the sizes its disc was baked at;
 * the orbs are not drawn any more, but `fitField` still snaps every radius to
 * this table and the radius still spaces the field, so the table stays. Its
 * history, from when the bakes were real:
 *
 * There were three, at 25 / 28.5 / 32, chosen for the meaningless per-orb
 * radius jitter. But the field FITS its orbs to the band: crowd it and the
 * radius falls all the way to ORB_R_MIN, six. A six-pixel orb was being drawn
 * from a sprite baked for twenty-five and scaled down four times over, and a
 * bilinear downscale of that depth turns a crisp rim and a small specular into
 * a smear. Every sphere term above was being destroyed at draw time.
 *
 * Nine steps across the whole real range, spaced closer at the small end where
 * a given percentage error is most visible. Any drawn radius now lands within
 * a few percent of a sprite baked for it.
 */
export const SIZE_R = [6, 8.5, 11.5, 15, 19, 23, 26.5, 29.5, 32];

/**
 * WHICH SIZE A GIVEN RADIUS SNAPS TO — one rule, in one place. (While orbs
 * were drawn, the baked disc it was drawn from.)
 *
 * `SIZE_R` grew from three sizes to nine so that nothing would be scaled at
 * draw time. `fitField` was taught the new table; the two places that BUILD a
 * ball were not, and kept a hand-written three-way test — `r < 26.5 ? 0 :
 * r < 29.8 ? 1 : 2` — whose indices now mean 6px, 8.5px and 11.5px. So every
 * orb that had not been through a fit was drawn from one of the three
 * SMALLEST discs, blown up three to five times: a soft blob where the sphere's
 * rim and specular used to be. The six larger bakes were never reached at all.
 *
 * That was every orb on a wall you are not standing on, every orb in a
 * room's ground while rooms existed, and every orb in the beat between
 * arriving and the next fit — which
 * is exactly the set the founder saw and asked about ("why are some balls
 * blurry? they should all be sharp").
 *
 * DOWN, NEVER UP, on a tie or an overshoot. The radius handed in is what the
 * band could FIT; rounding up would hand a crowded field a few extra pixels
 * per orb at the moment that matters most, and the fit would quietly stop
 * holding. The smallest bake is the floor.
 */
export function sizeIdxFor(r: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < SIZE_R.length; i += 1) {
    const d = Math.abs((SIZE_R[i] as number) - r);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  if ((SIZE_R[best] as number) > r && best > 0) best -= 1;
  return best;
}

/* the per-member hue system lives in lib/appearance.ts — see the note
   there for why, and docs/architecture.md for the seams generally */


export function makeSprite(px: number): [HTMLCanvasElement, CanvasRenderingContext2D | null] {
  const c = document.createElement("canvas");
  c.width = px;
  c.height = px;
  return [c, c.getContext("2d")];
}

export const rgbCss = (c: [number, number, number], a: number) =>
  `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

export function mix(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/**
 * Break the 8-bit contour rings out of a baked falloff.
 *
 * A soft radial gradient laid on a near-black ground quantises to whole alpha
 * levels, and the eye reads those level boundaries as concentric "microlines"
 * — the more so when four aura layers stack their rings on top of each other.
 * One level of random alpha jitter per pixel scatters each boundary into a
 * dither pattern the eye cannot assemble into a ring. It costs nothing at
 * runtime: this happens once, at bake, like every other pixel in this file.
 */
export function ditherAlpha(g: CanvasRenderingContext2D, d: number): void {
  let img: ImageData;
  try {
    img = g.getImageData(0, 0, d, d);
  } catch {
    return; /* never tainted in practice; if it ever is, skip silently */
  }
  const px = img.data;
  for (let i = 3; i < px.length; i += 4) {
    const a = px[i];
    /* only the ramp: the solid middle and the empty outside have no bands */
    if (a === 0 || a === 255) continue;
    px[i] = a + (Math.random() < 0.5 ? -1 : 1);
  }
  g.putImageData(img, 0, 0);
}

/**
 * The diffuse outer bloom. Additive, so a dense pile glows hotter for free.
 *
 * Ten stops sampled off a smooth curve rather than two or three, so the ramp
 * has no straight segments to band along; it reaches nothing at 92% of the
 * sprite rather than at its edge, so no falloff is ever clipped into a seam;
 * and the whole thing is dithered afterwards. `exp` varies the curve between
 * the companion's stacked aura layers so residual bands cannot align.
 */
export function rasterBloom(
  rgb: [number, number, number],
  radius: number,
  dpr: number,
  exp = 2.6,
): HTMLCanvasElement {
  const d = Math.max(8, Math.ceil(radius * 2 * dpr));
  const [c, g] = makeSprite(d);
  if (!g) return c;
  const grd = g.createRadialGradient(d / 2, d / 2, 0, d / 2, d / 2, d / 2);
  /* brightest in the middle, nothing left well inside the sprite's edge */
  const END = 0.92;
  for (let i = 0; i <= 9; i++) {
    const t = i / 9;
    grd.addColorStop(t * END, rgbCss(rgb, Number(Math.pow(1 - t, exp).toFixed(4))));
  }
  grd.addColorStop(1, rgbCss(rgb, 0));
  g.fillStyle = grd;
  g.fillRect(0, 0, d, d);
  ditherAlpha(g, d);
  return c;
}

/**
 * The companion's SILHOUETTE, traced in draw space about its own centre — the
 * same normalised pebble-drop rasterBody bakes. Everything that lives ON the
 * turning form (the seam, the shading, the eyes) is clipped to this, so no
 * feature ever floats outside the outline.
 */

export function parseColor(input: string): [number, number, number] {
  const s = input.trim();
  if (s.startsWith("#")) {
    const hex = s.slice(1);
    const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
    const n = parseInt(full.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = /rgba?\(([^)]+)\)/.exec(s);
  if (m) {
    const parts = m[1].split(",").map((p) => parseFloat(p));
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
  }
  return [128, 128, 128];
}
