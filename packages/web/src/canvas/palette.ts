import { type Ramp } from "../lib/appearance";
import { clamp } from "../lib/num";
import {
  GRAIN_AMP,
  GRAIN_PX,
  GRAIN_TILE,
  KEY_X,
  KEY_Y,
  NEB_PEAK,
  ditherAlpha,
  makeSprite,
  mix,
  parseColor,
  rasterBloom,
  rgbCss,
} from "./sprites";
import { OWNER_BEING, type Being } from "../character/body";
import { BODY_TIERS, COOL_BODY, coolRamp, rasterBody } from "../character/raster";

/** How many baked shapes a nebula chooses between, per tint pair. */
export const NEB_VARIANTS = 2;
/** The radius the nebula sprites are baked at; they are scaled at draw. */
const NEB_PX = 150;

/**
 * EVERY SPRITE THE WORLD OWNS, RASTERED ONCE.
 *
 * A `Palette` is the whole drawable inventory for one skin at one device pixel
 * ratio: the companion's aura, motes, nebulae, the seam, the grain, the
 * vignette, and the companion's baked bodies. `buildPalette` makes one; the
 * frame loop only ever reads it.
 *
 * One reason to exist: this is the boundary between work done once and work
 * done sixty times a second. `createRadialGradient`, `ctx.filter` and
 * `shadowBlur` appear in this file and must appear nowhere the loop can reach
 * — that is the performance discipline of the whole page, and putting every
 * such call behind one function is how it stays true.
 */
export interface Palette {
  dpr: number;
  ramp: Ramp;
  /**
   * The companion's four aura layers, each with a slightly different falloff
   * curve — four identical curves stacked at four radii is exactly how faint
   * banding becomes visible banding.
   */
  auraLayers: HTMLCanvasElement[];
  /** One tiny point; motes and background sparkles share it. */
  mote: HTMLCanvasElement;
  /** The lit seam that travels across the companion as it turns. */
  seam: HTMLCanvasElement;
  /** [variant] — a forming ambition's body, up in the sky. */
  nebulae: HTMLCanvasElement[];
  /**
   * THE FILM GRAIN LIVES ON A DOM LAYER, NOT IN THE CANVAS.
   *
   * `overlay` blends against its BACKDROP, and the canvas is transparent
   * wherever nothing was drawn — where alpha is zero the blend degenerates to
   * source-over, so a grain tile centred on mid-grey was laying a flat 7%
   * grey sheet over the whole frame, every frame. The image had no true black
   * anywhere and read as milky: the pass did the exact opposite of what its
   * own comment said it did.
   *
   * On a DOM layer above the canvas the backdrop is opaque, so overlay runs
   * its real response curve (peaking in the midtones, leaving black black);
   * the tile is sized in CSS pixels rather than device pixels; it covers the
   * TYPE as well as the world, so the poster wears the same emulsion as the
   * frame; and it costs no per-frame work at all. The grain belongs to the
   * LENS, not to the world — which is also why it must not ride the camera.
   */
  grainUrl: string | null;
  /** Baked once, stretched over the viewport: the photographic corner fall. */
  vignette: HTMLCanvasElement;
  /** [dimTier] — the OWNER's companion, matte and hand-made. */
  body: HTMLCanvasElement[];
  /**
   * The same emulsion, as a pattern, kept so a being baked later in the
   * session wears the identical film — with only its ORIGIN moved. Phase is
   * anti-cloning texture, never an identity signal.
   */
  bodyGrain: CanvasPattern | null;
  /**
   * Every other being in the world, baked once each on the wall's first wake
   * and held for the session. A wall never renders half-baked: the sprites
   * exist before the column is ever drawn.
   */
  beings: Map<string, BeingSprites>;
}

/** One being's whole appearance: four dim tiers of body, four aura layers. */

/**
 * A NEBULA: light that has not condensed yet.
 *
 * Three or four overlapping soft blooms in one tint pair, additive and very
 * faint, with a cloudy rather than circular edge. Baked twice per tint so a
 * skyful of candidates does not read as a row of identical clouds — and baked
 * ONCE, like everything else here: the frame loop never makes a gradient.
 */
function rasterNebula(ramp: Ramp, r: number, dpr: number, variant: number): HTMLCanvasElement {
  const D = Math.max(8, Math.ceil(r * 2 * dpr));
  const [c, g] = makeSprite(D);
  if (!g) return c;
  const R = r * dpr;
  const cx = D / 2;
  const cy = D / 2;
  /* fixed lobes, mirrored for the second variant — deterministic, so the two
     variants are stable across re-rasters (a DPR change). A candidate is the
     same light as everything else, spread out and not yet condensed. */
  const k0 = NEB_PEAK / 0.15;
  const lobes: Array<[number, number, number, number]> = [
    [0, 0, 0.92, 0.15 * k0],
    [0.2, -0.16, 0.66, 0.12 * k0],
    [-0.22, 0.14, 0.6, 0.1 * k0],
    [0.1, 0.24, 0.5, 0.08 * k0],
  ];
  const flip = variant === 0 ? 1 : -1;
  g.globalCompositeOperation = "lighter";
  for (let i = 0; i < lobes.length; i++) {
    const [ox, oy, k, peak0] = lobes[i];
    const lx = cx + ox * R * flip;
    const ly = cy + oy * R * flip;
    const lr = R * k;
    /* A cloud emits rather than reflects, so it gets no rim — but it is in
       the same room as everything else, and the side facing the key is the
       side that reads brighter. Agreement, not shading. */
    const facing = (ox * flip * KEY_X + oy * flip * KEY_Y) * 0.5;
    const peak = peak0 * (1 + clamp(facing, -0.3, 0.3));
    const rgb = i % 2 === 0 ? ramp.live : ramp.liveBloom;
    const grd = g.createRadialGradient(lx, ly, 0, lx, ly, lr);
    for (let stop = 0; stop <= 8; stop++) {
      const u = stop / 8;
      grd.addColorStop(u, rgbCss(rgb, Number((peak * Math.pow(1 - u, 2.4)).toFixed(4))));
    }
    g.fillStyle = grd;
    g.fillRect(0, 0, D, D);
  }
  /* and a soft mask so nothing ever reaches the sprite's edge */
  g.globalCompositeOperation = "destination-in";
  const mask = g.createRadialGradient(cx, cy, R * 0.18, cx, cy, R);
  mask.addColorStop(0, "rgba(0,0,0,1)");
  mask.addColorStop(0.7, "rgba(0,0,0,0.8)");
  mask.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = mask;
  g.fillRect(0, 0, D, D);
  g.globalCompositeOperation = "source-over";
  ditherAlpha(g, D);
  return c;
}

/**
 * A soft vertical band of light — the lit seam that drifts across the
 * companion as it turns, and the only thing that keeps the rotation legible
 * once the eyes have gone round the back. Baked once; the frame loop only
 * moves it.
 */
function rasterSeam(dpr: number): HTMLCanvasElement {
  const w = Math.max(8, Math.ceil(64 * dpr));
  const h = Math.max(2, Math.ceil(4 * dpr));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) return c;
  const grd = g.createLinearGradient(0, 0, w, 0);
  grd.addColorStop(0, "rgba(255,255,255,0)");
  grd.addColorStop(0.5, "rgba(255,255,255,1)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  return c;
}

/** A plain soft-edged dot, in the air's own colour. */
function rasterDot(
  dpr: number,
  px: number,
  falloff: number,
  rgb: [number, number, number] = [255, 255, 255],
): HTMLCanvasElement {
  const D = Math.ceil(px * dpr);
  const [c, g] = makeSprite(D);
  if (!g) return c;
  const grd = g.createRadialGradient(D / 2, D / 2, 0, D / 2, D / 2, D / 2);
  grd.addColorStop(0, rgbCss(rgb, 1));
  grd.addColorStop(Math.max(0, 1 - falloff), rgbCss(rgb, 1));
  grd.addColorStop(1, rgbCss(rgb, 0));
  g.fillStyle = grd;
  g.fillRect(0, 0, D, D);
  return c;
}

/**
 * TEXTURE, AND ENOUGH OF IT TO SEE.
 *
 * A tile of noise laid over the whole canvas every frame, as one fillRect with
 * a baked pattern — no filter, no per-frame noise. The previous pass ran it at
 * 0.05 alpha with a one-device-pixel cell, which is to say invisibly, and that
 * smooth vector cleanliness is a named cause of the look the founder rejected.
 * So each skin sets its own CELL SIZE (coarse grain is what you can actually
 * see), its own swing, and its own colour cast — grain that is purely
 * luminance reads as a filter, grain that carries the ground's own warmth
 * reads as the material.
 */
export function rasterGrain(cast: [number, number, number]): HTMLCanvasElement | null {
  /* ═══ THE FILM STAYS AT CSS RESOLUTION, AND THE REASON IS MEASURED ═══
     An attempt on 2026-10-12 baked this at `GRAIN_PX * dpr` to stop the
     browser magnifying it 3x on a phone. The magnification is real — a
     128px tile in a 128 CSS px box, measured at exactly 3.00x — and
     sharpening it measured +15% on the film in isolation. It was still
     wrong, and a review measured why.

     IT CANNOT BE THE BLUR ANYBODY SEES. The layer is `opacity: 0.035` at
     normal blend: composited over the ground it is a 9-out-of-255
     perturbation. A 96.5%-transparent additive dither cannot soften an
     edge beneath it. `claims.css` already names the threshold — "over
     ~0.05 it becomes texture" — so this is tuned below perceptibility on
     purpose.

     AND SHARPENING IT BREAKS WHAT IT IS FOR. This film exists to dissolve
     8-bit contour banding in the companion's glow. A hard 6-device-px cell
     guarantees six identical adjacent pixels, where the magnified cell's
     ramped edge broke a run almost every pixel: measured over 6 trials x
     24 scanlines, mean flat runs grew 2.21 -> 3.05 at dpr 3 and 1.69 ->
     2.36 at dpr 2 — a 38-40% WORSE dither at identical amplitude. The
     blurry tile was, by accident, the better one.

     It also coarsened the creature's matte — which `rasterBody` lays at
     14% over a light body, the one place this grain is actually visible —
     by 45-61% of its fine texture, and took the tile's backing store from
     64KB to 576KB.

     THE SELF-REFUTING PART, which is the lesson worth keeping: the
     sharpening was measured in Chromium at dpr 3, while the defect it
     claimed to fix does not reproduce in Chromium at dpr 3. Both cannot be
     true of one cause. ANY CANDIDATE THAT REPRODUCES HERE IS NOT THE
     FOUNDER'S SYMPTOM — four attempts have now died on that sentence. */
  const cell = GRAIN_PX;
  const cells = GRAIN_TILE;
  const D = cell * cells;
  const [c, g] = makeSprite(D);
  if (!g) return null;
  const img = g.createImageData(D, D);
  const px = img.data;
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      /* one value per CELL, not per pixel: this is what makes it visible */
      const n = (Math.random() - 0.5) * 255 * GRAIN_AMP;
      const r = 128 + n + (cast[0] - 128) * 0.16;
      const gr = 128 + n + (cast[1] - 128) * 0.16;
      const b = 128 + n + (cast[2] - 128) * 0.16;
      for (let y = 0; y < cell; y++) {
        const row = ((cy * cell + y) * D + cx * cell) * 4;
        for (let x = 0; x < cell; x++) {
          const i = row + x * 4;
          px[i] = r;
          px[i + 1] = gr;
          px[i + 2] = b;
          px[i + 3] = 255;
        }
      }
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * A photographic vignette: nothing in the middle, darkening to the corners.
 * Baked square and stretched over whatever viewport it finds — a vignette is
 * soft enough that the stretch is invisible, and this way a resize costs
 * nothing. Moonlight only; it is a photographic idea, not a page-wide one.
 */
function rasterVignette(dpr: number): HTMLCanvasElement {
  const D = Math.ceil(256 * dpr);
  const [c, g] = makeSprite(D);
  if (!g) return c;
  const grd = g.createRadialGradient(D / 2, D / 2, 0, D / 2, D / 2, D / 2);
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    grd.addColorStop(t, `rgba(0,0,0,${(Math.pow(t, 2.4)).toFixed(4)})`);
  }
  g.fillStyle = grd;
  g.fillRect(0, 0, D, D);
  ditherAlpha(g, D);
  return c;
}

/**
 * The WAKA companion: a drop of light that came to rest.
 *
 * Not Auwa's character — that is another brand's illustrated being by a named
 * artist. We take only the register (small, soft, luminous, matte, tiny dot
 * eyes on a dark ground) and draw WAKA's own silhouette: a rounded pebble-drop,
 * a wide slightly asymmetric oval with a generous dome and a flat-ish resting
 * base. No arms, no legs, no dome-head proportions.
 *
 * `tier` dims it toward quiet: at full inspiration it is warm off-white, and
 * with nothing alive in the jar it fades to a muted stone. That the companion
 * goes quiet when the jar does is the whole point.
 */

/**
 * THE RAMP, READ OFF THE ROOT — once, for the world's palette and for every
 * creature drawn off the world's canvas (a page's `Companion`, the walk to
 * the timeless page, a share card), so each is lit by the stylesheet rather
 * than by a copy of its values, and the warm/cold decision stays in one
 * place.
 *
 * Every colour the canvas paints with lives in jar.css beside the ones the
 * DOM paints with, so the surface is ONE block to read and one to change.
 */
export function rampFromCss(root: HTMLElement): Ramp {
  const cs = getComputedStyle(root);
  const v = (name: string, fallback: string) =>
    parseColor(cs.getPropertyValue(name).trim() || fallback);
  return {
    live: v("--jar-live", "#fff2dc"),
    liveEdge: v("--jar-live-edge", "#f7ead4"),
    liveBloom: v("--jar-live-bloom", "#ffedd0"),
    fade: v("--jar-fade", "#b9c4d1"),
    dorm: v("--jar-dorm", "#28323f"),
    dust: v("--jar-dust", "#cdd8e6"),
    /* These fallbacks MUST match jar.css's warm ivory. A cold fallback here
       deletes the one channel that tells an agent's body from yours —
       coolRamp() shifts an agent a step colder, and a companion that starts
       cold has nothing left to step. pal.body is baked once, so a single
       miss (stylesheet not yet applied, or a root outside `.jar`) would bake
       a cold companion for the whole session. */
    bodyLit: v("--jar-body-lit", "#f7f1e4"),
    bodyShade: v("--jar-body-shade", "#a49b8c"),
  };
}

export function buildPalette(
  root: HTMLElement,
  dpr: number,
  ctx: CanvasRenderingContext2D,
): Palette {
  const ramp = rampFromCss(root);
  const grainTile = rasterGrain(ramp.dorm);
  /* the same tile, as a pattern, for the one bake that genuinely has an
     opaque backdrop to blend against: the companion's own body */
  const bodyGrain = grainTile ? ctx.createPattern(grainTile, "repeat") : null;
  const bodyTiers: HTMLCanvasElement[] = [];
  for (let t = 0; t < BODY_TIERS; t++)
    bodyTiers.push(rasterBody(dpr, t, bodyGrain, ramp, OWNER_BEING));
  return {
    dpr,
    ramp,
    /* NO ORB SHEETS (2026-10-15). The discs, their blooms, the hued sheets for
       other people's memories and the focused orb's aura were baked here for
       every size and brightness, for the field painter. The painter and the
       balls are deleted, so the bake went with them. */
    auraLayers: [0, 1, 2, 3].map((i) =>
      rasterBloom(mix(ramp.liveBloom, ramp.live, i * 0.18), NEB_PX * 0.55, dpr, 2 + i * 0.2),
    ),
    mote: rasterDot(dpr, 16, 0.9, ramp.dust),
    seam: rasterSeam(dpr),
    nebulae: (() => {
      const out: HTMLCanvasElement[] = [];
      for (let i = 0; i < NEB_VARIANTS; i++) out.push(rasterNebula(ramp, NEB_PX, dpr, i));
      return out;
    })(),
    /* nothing tainted has ever touched this canvas — it is generated noise —
       so reading it back is safe */
    grainUrl: grainTile ? grainTile.toDataURL() : null,
    vignette: rasterVignette(dpr),
    body: bodyTiers,
    bodyGrain,
    beings: new Map(),
  };
}

/**
 * THE COMPANION, BAKED.
 *
 * `body.ts` beside this file says what a being IS — its proportions, its hue,
 * whether it is an agent. This says how one becomes pixels: the silhouette
 * (`bodyPath`), the four dim tiers of body sprite (`rasterBody`), the whole
 * appearance assembled once (`bakeBeing`), and the quantisation that makes an
 * agent read as machine-made (`pixelate`).
 *
 * One reason to exist: everything here runs at load, at a skin switch, or at a
 * DPR change — never inside a frame. The loop draws these sprites and never
 * makes one, and giving the baking its own file is what makes that rule
 * visible rather than merely intended.
 *
 * It lives under `character/` rather than `canvas/` because the subject decides
 * the home: `canvas/sprites.ts` bakes anything, this bakes a being. That also
 * settles what looked like a cycle — `buildPalette` calls `rasterBody` — since
 * the chain now runs canvas/palette -> character/raster -> canvas/sprites ->
 * lib, one direction only, with no signature changed to achieve it.
 */
export interface BeingSprites {
  body: HTMLCanvasElement[];
  aura: HTMLCanvasElement[];
}
/**
 * HOW COARSE A MACHINE'S FORM IS. Roughly how many cells the body is quantised
 * to across its width — low enough to be unmistakable at a glance on a phone,
 * high enough that the silhouette is still the same species.
 */
export const MACHINE_CELLS = 20;
/**
 * SNAP A BAKED FORM TO A GRID.
 *
 * An agent is not another individual, it is another KIND of mind, and the hash
 * ladders alone could never say that — they vary proportion, which reads as
 * "someone else", not as "something else". So a machine's body is baked once
 * through a grid: rendered small and blown back up with interpolation off, so
 * its edges are steps rather than curves.
 *
 * It happens HERE, at the bake, and that is the whole point — the sprite that
 * comes out is the same size as every other body sprite, so the draw pass
 * cannot tell the difference and the frame loop does no extra work at all.
 */
export function pixelate(src: HTMLCanvasElement, cells: number): HTMLCanvasElement {
  const small = Math.max(4, Math.round(cells));
  const [lo, lg] = makeSprite(small);
  if (!lg) return src;
  lg.imageSmoothingEnabled = true;
  lg.drawImage(src, 0, 0, small, small);
  const [out, og] = makeSprite(src.width);
  if (!og) return src;
  /* the step: no interpolation on the way back up, or the grid dissolves into
     exactly the smooth edge it exists to replace */
  og.imageSmoothingEnabled = false;
  og.drawImage(lo, 0, 0, src.width, src.height);
  return out;
}
/**
 * Bake a being. Called once per wall, never per frame — the frame loop has no
 * business making a gradient, and that rule does not soften because there is
 * more than one companion now.
 */
export function bakeBeing(
  pal: Palette,
  key: string,
  be: Being,
  cool: boolean,
  machine: boolean,
): BeingSprites {
  const got = pal.beings.get(key);
  if (got) return got;
  const ramp = coolRamp(pal.ramp, cool);
  let grain = pal.bodyGrain;
  if (grain && (be.grainPhase[0] !== 0 || be.grainPhase[1] !== 0)) {
    try {
      grain.setTransform(
        new DOMMatrix().translate(be.grainPhase[0], be.grainPhase[1]),
      );
    } catch {
      /* no DOMMatrix on this engine: the film is simply in phase, which costs
         nothing but a little anti-cloning texture */
    }
  }
  const body: HTMLCanvasElement[] = [];
  for (let t = 0; t < BODY_TIERS; t++) {
    const tier = rasterBody(pal.dpr, t, grain, ramp, be);
    body.push(machine ? pixelate(tier, MACHINE_CELLS) : tier);
  }
  if (grain) {
    try {
      grain.setTransform(new DOMMatrix());
    } catch {
      /* as above */
    }
  }
  /* THE AURA'S LAW IS UNTOUCHABLE — four layers, the same radii, the same
     alphas. Only its CORE temperature moves, and only for a being of colder
     light, which is the same one channel the body already spent. */
  const aura = [0, 1, 2, 3].map((i) => {
    const warm = mix(pal.ramp.liveBloom, pal.ramp.live, i * 0.18);
    return rasterBloom(
      cool ? mix(warm, pal.ramp.fade, COOL_BODY) : warm,
      NEB_PX * 0.55,
      pal.dpr,
      2 + i * 0.2,
    );
  });
  const made = { body, aura };
  pal.beings.set(key, made);
  return made;
}
