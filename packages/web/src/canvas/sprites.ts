/**
 * BAKED LIGHT — the sprites the canvas draws, and nothing that knows what they
 * mean.
 *
 * The machinery half of the world. It knows orbs, bloom, dither and colour
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
 * `orbsForHue` is the one function here that reaches a product idea — it takes
 * a member's hue slot, because it is the only sprite function that knows two
 * people can stand in the same field. It types its argument STRUCTURALLY
 * (`HuedPalette` below) rather than importing `Palette` from the page, so this
 * module has no edge back into the thing it was extracted from.
 */

import { tintRamp, type Ramp } from "../lib/appearance";
import { lerp, TAU } from "../lib/num";

/**
 * What `orbsForHue` needs from a palette, and no more. The page's `Palette`
 * satisfies this structurally, so neither file has to know about the other.
 */
export interface HuedPalette {
  ramp: Ramp;
  dpr: number;
  hued: Map<string, HTMLCanvasElement[][]>;
}

export const BLOOM_R = 2.2;
export const BLOOM_PEAK = 0.2;
export const BLOOM_EXP = 2.2;
/**
 * How much of the disc's radius is feather.
 *
 * This said "Crisp: this is photography" over a value of 0.07 — seven percent
 * of the radius, about three and a half device pixels of gradient on every
 * perimeter. Nothing with that much feather reads as an object; it reads as a
 * smudge, and with the bloom sitting under it the orb dissolved into its own
 * light. The whole sphere treatment above — terminator, rim, counter-rim,
 * specular — was being spent on something with no edge to hold it.
 *
 * Two point two percent is under one device pixel: enough to kill the jaggies
 * a hard circle would show, and nothing beyond that.
 */
export const EDGE_SOFT = 0.022;
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
 * obeyed by the orbs, the clouds and the companion alike. Everything in a
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
 * THE SURFACE, TURNED UP UNTIL IT IS ACTUALLY A SURFACE.
 *
 * Every one of these terms was already written and every one was set so faint
 * that none of it survived the bloom underneath — the orbs read as flat cream
 * blobs, which is exactly what they were being drawn as. A sphere is not a
 * gradient; it is a bright grazing rim, a dark terminator, a cold bounce on
 * the far edge and one small specular, and all four have to be strong enough
 * to be seen through the light the orb is sitting in.
 *
 * They still encode nothing. Aliveness is temperature and luminance; this is
 * form, and form is the same on a bright memory and a dark one — which is the
 * whole reason a cooled coal still looks like an object.
 */
export const KEY_SHADE = 0.46;
export const KEY_RIM = 0.5;
export const KEY_COUNTER = 0.17;
export const KEY_SPEC = 0.42;
/** The broad wrap across the lit third — the old sheen, now motivated. */
export const SHEEN = 0.26;
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
export const GRAIN_AMP = 0.09;
/* The strength lives in jar.css with the layer that carries it: opacity on a
   real element, blended against an opaque backdrop. */
/** The corners fall away. A photographic idea, so it is kept photographic. */
export const VIGNETTE = 0.34;
/** A candidate's unformed light: the same ramp, spread out and faint. */
export const NEB_PEAK = 0.12;

/** Size buckets the orb + halo sprites are rastered at (radius is 24-32). */
/**
 * THE SIZES A DISC IS ACTUALLY BAKED AT — and they have to cover the range the
 * field really draws at, which these did not.
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
 * a few percent of a sprite baked for it. Nine sizes × four tiers is thirty-six
 * discs baked once at load — nothing per frame, which is the standing rule.
 */
export const SIZE_R = [6, 8.5, 11.5, 15, 19, 23, 26.5, 29.5, 32];
/** Sprite bleed so the rim arc's outer antialiasing is never clipped. */
export const ORB_PAD = 2;

export const TIERS = 5;

/* the per-member hue system lives in lib/appearance.ts — see the note
   there for why, and docs/architecture.md for the seams generally */

/**
 * HOW COARSE A MACHINE'S MEMORY IS. Four device pixels to one of the orb's
 * own, which at the smallest baked size still leaves roughly a dozen steps
 * across the disc — enough that the edge reads as stepped rather than as a
 * blurry circle, and few enough that it reads as a resolution rather than as
 * a texture.
 */
export const PIXEL_STEP = 4;

/**
 * AN AGENT'S MEMORY IS THE SAME LIGHT AT A COARSER RESOLUTION.
 *
 * Not a different colour, not a different size, not a different shape: the
 * identical disc, the identical ramp, the identical aliveness tier — rendered
 * on a grid a quarter as fine and scaled up without smoothing. Everything the
 * light says still says it; what changes is how finely the thing can be
 * described, which is the honest difference between a memory somebody had and
 * a memory something recorded.
 *
 * This is the same sentence the rest of the world already speaks: the machine
 * hand on an agent's poster, the quantized positions when you cross into an
 * agent's wall, the stepped tick that replaces the companion's float. One
 * grammar, said again in the one place it had not been said yet.
 */
export function rasterOrbPixel(ramp: Ramp, r: number, dpr: number, tier: number): HTMLCanvasElement {
  /* the small render: the real orb, drawn at a fraction of the resolution */
  const small = rasterOrb(ramp, r, dpr / PIXEL_STEP, tier);
  const D = Math.max(8, Math.ceil((r + ORB_PAD) * 2 * dpr));
  const [c, g] = makeSprite(D);
  if (!g) return small;
  /* nearest-neighbour on the way up — this is the whole effect, and doing it
     at bake time means the frame loop never touches a smoothing flag */
  g.imageSmoothingEnabled = false;
  g.drawImage(small, 0, 0, D, D);
  return c;
}

/**
 * A sprite sheet for one (hue, resolution) pair, baked the first time such a
 * memory is about to be drawn and held for the life of the palette. Called
 * from inside the frame loop, which is normally forbidden — but only ever on
 * the frame a combination first appears, and there are at most a handful, so
 * this is a bounded one-off rather than per-frame work.
 */
export function orbsForHue(pal: HuedPalette, hue: number, pixel: boolean): HTMLCanvasElement[][] {
  const key = `${hue}:${pixel ? "p" : "s"}`;
  const got = pal.hued.get(key);
  if (got) return got;
  const ramp = hue >= 0 ? tintRamp(pal.ramp, hue) : pal.ramp;
  const tiers = Array.from({ length: TIERS }, (_, i) => i);
  const bake = pixel ? rasterOrbPixel : rasterOrb;
  const made = SIZE_R.map((r) => tiers.map((t) => bake(ramp, r, pal.dpr, t)));
  pal.hued.set(key, made);
  return made;
}

/**
 * WHAT AN UNDATED MEMORY LOOKS LIKE.
 *
 * Aliveness is a claim about WHEN something was saved and how it has been
 * returned to since. A room's proposal names no per-save date, so there is no
 * such claim to make about the memories it cites — and lighting them from the
 * newest edge of the declared span would print a number nobody measured, in
 * the one channel this page reserves for meaning.
 *
 * So an undated memory declares itself undated instead: one fixed tier, one
 * fixed power, the same for every satellite in that ring including any the
 * viewer saved themselves. A ring then says one kind of thing throughout,
 * which is the only honest thing it can say. The panel already prints who and
 * no when for these.
 */
export const UNDATED_TIER = Math.round((TIERS - 1) / 2);
export const UNDATED_POW = 0.5;

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
 * WHERE A TIER SITS ON THE RAMP — and the law this whole surface is built on.
 *
 * THE ONLY WARM THING ON SCREEN IS WHAT IS MOST ALIVE.
 *
 * Colour TEMPERATURE is the aliveness signal and luminance is the second
 * channel, and nothing else varies at all:
 *
 *   alive   — a slightly warm white, the single warm note in a cold frame
 *   fading  — through neutral, then cool: a silver that has lost its warmth
 *   dormant — cold and near-invisible, barely separated from the ground
 *
 * Read down a field of these and the warm ones are the live ones; that is the
 * entire readout, and it works at a glance and at a distance because warmth
 * against cold is pre-attentive in a way that six pastel hues never were.
 *
 * HUE-PER-THEME IS DELETED FOREVER. It said which theme an id happened to hash
 * to — unreadable by anyone, and a direct contradiction of the page's own law
 * that light is the only meaning channel. Do not reintroduce a colour that
 * encodes a category: if something needs to be told apart from its neighbour,
 * it is either alive or it is not.
 *
 * Below the half-way point a tier walks from dormant up to fading, above it
 * from fading up to alive — one continuum, quantised only because the sprites
 * are baked.
 */
export function rampAt(ramp: Ramp, life: number): {
  core: [number, number, number];
  edge: [number, number, number];
  bloom: [number, number, number];
} {
  const core =
    life < 0.5 ? mix(ramp.dorm, ramp.fade, life * 2) : mix(ramp.fade, ramp.live, (life - 0.5) * 2);
  const edge =
    life < 0.5
      ? mix(ramp.dorm, ramp.fade, life * 2)
      : mix(ramp.fade, ramp.liveEdge, (life - 0.5) * 2);
  /* a dormant orb's bloom is its own cold colour, which additively is very
     nearly nothing — it stops glowing without ever leaving the field */
  return { core, edge, bloom: mix(ramp.dorm, ramp.liveBloom, Math.pow(life, 1.2)) };
}

/**
 * The orb: a disc of light with a diffuse bloom. No rim light, no terminator,
 * no contact shadow — these are lit from within and they float, so nothing
 * about them implies an outside source.
 *
 * What varies from orb to orb is ALIVENESS and nothing else. `tier` walks that
 * continuum: 0 is dormant — dim, cold and nearly colourless, still holding its
 * place in the field — and TIERS-1 is fully alive, the brightest and warmest
 * the skin has.
 *
 * The edge is built rather than gradient-masked, because one skin needs it to
 * be IMPERFECT: the mask is a stack of rim paths from R down to R(1-soft),
 * each laid at 1/K alpha under `lighter`, which sums to a linear feather that
 * follows whatever silhouette the rim traced. A perfect circle is what reads
 * as digital, and hanji is the argument against it.
 */
export function rasterOrb(ramp: Ramp, r: number, dpr: number, tier: number): HTMLCanvasElement {
  const D = Math.max(8, Math.ceil((r + ORB_PAD) * 2 * dpr));
  const [c, g] = makeSprite(D);
  if (!g) return c;
  const R = r * dpr;
  const cx = D / 2;
  const cy = D / 2;
  const life = tier / (TIERS - 1);
  const at = rampAt(ramp, life);
  const ca = at.core;
  const cb = at.edge;

  /* the disc: a 135-degree ramp, top-left to bottom-right. Both ends are the
     same light at the same aliveness — this is shading, not two colours */
  const k = R * 0.72;
  const disc = g.createLinearGradient(cx - k, cy - k, cx + k, cy + k);
  disc.addColorStop(0, rgbCss(ca, 1));
  disc.addColorStop(1, rgbCss(cb, 1));
  g.fillStyle = disc;
  g.fillRect(0, 0, D, D);

  /* ---- THE SURFACE. All of it baked, all of it agreeing with KEY_X/KEY_Y,
     and none of it costing a single instruction at draw time. ----

     A dormant orb keeps a surface too: it is the SPECULAR and the wrap that
     belong to its own light and fade with it, while the terminator and the
     counter-rim belong to the WORLD's light and are there whatever the memory
     has left. That is why a dead coal still looks like an object. */
  const lx = cx + KEY_X * R;
  const ly = cy + KEY_Y * R;

  /* the terminator: the form falling away from the key, into the ground's own
     colour so the dark side sinks into the layout rather than going grey */
  const shade = g.createRadialGradient(lx, ly, R * 0.2, cx - KEY_X * R * 0.3, cy - KEY_Y * R * 0.3, R * 1.6);
  shade.addColorStop(0, "rgba(6,8,13,0)");
  shade.addColorStop(0.55, `rgba(6,8,13,${(KEY_SHADE * 0.35).toFixed(3)})`);
  shade.addColorStop(1, `rgba(6,8,13,${KEY_SHADE.toFixed(3)})`);
  g.fillStyle = shade;
  g.fillRect(0, 0, D, D);

  /* the rim: a soft arc where the key grazes the edge */
  const rimX = cx + KEY_X * R * 0.94;
  const rimY = cy + KEY_Y * R * 0.94;
  const rim = g.createRadialGradient(rimX, rimY, 0, rimX, rimY, R * 0.62);
  rim.addColorStop(0, `rgba(255,252,246,${(KEY_RIM * (0.42 + 0.58 * life)).toFixed(3)})`);
  rim.addColorStop(0.5, `rgba(255,252,246,${(KEY_RIM * 0.22 * (0.42 + 0.58 * life)).toFixed(3)})`);
  rim.addColorStop(1, "rgba(255,252,246,0)");
  g.fillStyle = rim;
  g.fillRect(0, 0, D, D);

  /* the counter-rim: the cold bounce off everything else in the room, on the
     opposite edge and much weaker — this is the term that reads as "night" */
  const ccx = cx - KEY_X * R * 0.9;
  const ccy = cy - KEY_Y * R * 0.9;
  const counter = g.createRadialGradient(ccx, ccy, 0, ccx, ccy, R * 0.75);
  counter.addColorStop(0, `rgba(176,196,222,${KEY_COUNTER.toFixed(3)})`);
  counter.addColorStop(1, "rgba(176,196,222,0)");
  g.fillStyle = counter;
  g.fillRect(0, 0, D, D);

  /* the broad wrap across the lit side — the old sheen, now pointed at a
     source that exists */
  if (life > 0.05) {
    const sheen = g.createLinearGradient(lx, ly, cx - KEY_X * k, cy - KEY_Y * k);
    sheen.addColorStop(0, `rgba(255,255,255,${(SHEEN * life).toFixed(3)})`);
    sheen.addColorStop(0.45, `rgba(255,255,255,${(SHEEN * 0.33 * life).toFixed(3)})`);
    sheen.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = sheen;
    g.fillRect(0, 0, D, D);
  }

  /* and the specular: small, soft, well inside the rim, and it belongs to the
     memory's own light — a dormant one barely catches anything */
  const spX = cx + KEY_X * R * 0.46;
  const spY = cy + KEY_Y * R * 0.46;
  /* smaller and tighter: a big soft specular is a haze, a small one is glass */
  const spR = R * 0.19;
  const spec = g.createRadialGradient(spX, spY, 0, spX, spY, spR);
  spec.addColorStop(0, `rgba(255,255,255,${(KEY_SPEC * (0.25 + 0.75 * life)).toFixed(3)})`);
  spec.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = spec;
  g.fillRect(0, 0, D, D);

  /* THE EDGE. A stack of discs, R down to R(1−soft), each at 1/K alpha under
     `lighter` so they sum to a linear feather — the perimeter is never a
     cut-out, and the disc melts into its own bloom. */
  const [mc, mg] = makeSprite(D);
  if (!mg) return c;
  const K = 12;
  /* ONE DEVICE PIXEL, AND THE FLOOR MUST BE IN THE SAME UNITS AS R.
     This read `(2 * dpr) / R`, but R is ALREADY in device pixels — so the
     dpr multiply was applied twice and the floor came out at four device
     pixels of feather on a retina screen. It overrode EDGE_SOFT entirely at
     every size, which is why the perimeter stayed a smudge no matter what
     that constant said. One over R is exactly one device pixel: enough to
     antialias the circle and not one step more. */
  const soft = Math.max(EDGE_SOFT, 1 / Math.max(R, 1));
  mg.globalCompositeOperation = "lighter";
  mg.fillStyle = `rgba(255,255,255,${(1 / K).toFixed(4)})`;
  for (let i = 0; i < K; i++) {
    mg.beginPath();
    mg.arc(cx, cy, R * (1 - soft * (i / (K - 1))), 0, TAU);
    mg.fill();
  }
  g.globalCompositeOperation = "destination-in";
  g.drawImage(mc, 0, 0);
  g.globalCompositeOperation = "source-over";
  return c;
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
