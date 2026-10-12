import { type Ramp } from "../lib/appearance";
import { KEY_X, KEY_Y, ditherAlpha, makeSprite, mix, rgbCss } from "../canvas/sprites";
import { type Being } from "./body";





/* ---------- the light, in numbers ----------
   A bright point through a night lens: the bloom is WIDE and THIN, nothing
   like a hot little flame. Reach first, then the alpha it peaks at, then how
   fast it falls away. */

/**
 * ═══ THE CREATURE'S GEOMETRY, IN ONE PLACE ═════════════════════════════
 *
 * These five numbers used to live in `Home.tsx` beside the frame loop that
 * draws with them, which was correct while the loop was the only thing that
 * ever drew a creature. It is not any more — see `restPose` at the foot of
 * this file — and two copies of "where the eyes sit" is how a product ends
 * up with two creatures that are almost the same.
 *
 * The LOOP still owns the creature's BEHAVIOUR: yaw, pitch, blink, gaze, the
 * machine-cell grid, the bob, the nubs swelling with the glow. None of that
 * belongs here. What belongs here is the anatomy those behaviours are
 * applied to, and it is imported by both.
 */
/** Where an eye sits, as a longitude on the turning form. The pair are ~1
    radian apart, which is what puts them where they have always sat when the
    companion is facing you. */
export const EYE_LON = 0.5;
/** The equator's radius as seen head-on, as a fraction of the body's width. */
export const FACE_R = 0.34;
/** An eye's radius, as a fraction of the body. */
export const EYE_R = 0.038;
/** The eyes' ink. Not `--ink`: it is a feature of the creature's own
    illustration, not interface text, and it is the same brown-black at every
    aliveness. */
export const EYE_INK = "#2b2822";
/** A nub's seat: a quarter turn either side, at this height on the body. */
export const NUB_LON = Math.PI / 2;
export const NUB_X = 0.42;
export const NUB_Y = 0.24;
/** How far a nub swells between a quiet archive and a full one. They are
    anatomy, so they are never absent — the light decides the size only. */
export const NUB_R_DIM = 0.062;
export const NUB_R_LIT = 0.1;
/**
 * HOW FAR THE CREATURE SPILLS PAST ITS OWN BOX, as a fraction of the size.
 *
 * Founder, of the companion standing over an empty chat: "the character is
 * cut off on the left and right."
 *
 * It was, and the arithmetic is exactly this line. A nub is seated at
 * `NUB_X` from the centre and swells to `NUB_R_LIT` at full light, so at
 * rest its outer edge sits at 0.52 of the size from the middle — two percent
 * beyond the half-box the body is drawn in. On the world that costs nothing,
 * because the canvas is the whole window. On a page the canvas is the
 * creature's own size, so the two percent is a flat edge on each side.
 *
 * DERIVED, NOT MEASURED. A caller that padded by an eyeballed "a couple of
 * pixels" would be a second opinion about the anatomy, and the first retune
 * of `NUB_R_LIT` would crop the creature again without failing anything.
 * `rest-pose.test.ts` holds this to the constants above it.
 */
export const REST_BLEED = NUB_X + NUB_R_LIT - 0.5;

/** A nub's own colour at those two ends. */
export const NUB_DIM: [number, number, number] = [166, 163, 156];
export const NUB_LIT: [number, number, number] = [214, 209, 197];

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


/**
 * ═══ THE REST POSE — the creature with nothing happening to it ══════════
 *
 * Founder: "do the rest pose so the creature can be on every screen."
 *
 * WHY THIS IS A SEPARATE FUNCTION AND NOT A CALL INTO THE LOOP. The world
 * draws the companion sixty times a second from live simulation state — yaw,
 * pitch, blink, gaze, bob, flare, the machine-cell grid, four drifting aura
 * layers. A page has none of that and should pay for none of it. What a page
 * needs is the creature as it looks when nothing is happening to it, which is
 * that same drawing with every behaviour set to zero:
 *
 *   yaw 0      both eyes forward, both nubs at the silhouette's widest
 *   pitch 0    the eyes on the equator
 *   blink 0    open
 *   bob 0      the body square, so bw and bh are both `size`
 *
 * SO THE ARITHMETIC BELOW IS THE LOOP'S ARITHMETIC WITH THE ZEROS SUBSTITUTED
 * IN, not a second opinion about where a face goes. Every number it uses is
 * imported from the block at the top of this file, which `Home.tsx` imports
 * too — so a change to the anatomy moves both, and `rest-pose.test.ts` fails
 * if `Home.tsx` grows its own copy of any of them back.
 *
 * WHAT IT DELIBERATELY DOES NOT DRAW: the aura. On the world that is four
 * drifting layers composited with `lighter`, because it has to interact with
 * what is alive in the field. On a page it is a fact rather than a reading,
 * and `.waka-companion` states it in one CSS gradient built from the same
 * `--jar-live` ivory — a radial gradient cannot be clipped out of step with
 * a canvas that holds only the body.
 *
 * `lit` is the one thing a caller chooses, and on a page it should be 1: the
 * world dims the creature to report how little is alive in your field, which
 * is a reading of your material. A page is not a reading of anything, so a
 * dimmed companion there would be saying something untrue about you.
 */
export function restPose(
  g: CanvasRenderingContext2D,
  size: number,
  ramp: Ramp,
  be: Being,
  lit = 1,
): void {
  const body = rasterBody(Math.max(1, Math.round(size / BODY_PX * 4)), BODY_TIERS - 1, null, ramp, be);
  const half = size / 2;

  /* THE NUBS GO FIRST AND THEY ARE BOTH IN FRONT, which is the loop's
     behaviour at yaw 0 rather than a simplification of it: its guard is
     `cos(a) < 0 !== behind`, and `Math.cos(Math.PI / 2)` is 6.1e-17 — not
     negative — so at rest the behind-pass draws neither and the front-pass
     draws both. They are painted before the body here for the same reason
     the loop paints the far one first: a nub protrudes, so the body's edge
     has to land on top of it rather than meet it. */
  const nubR = size * (NUB_R_DIM + (NUB_R_LIT - NUB_R_DIM) * lit);
  const nubRgb = mix(NUB_DIM, NUB_LIT, lit);
  g.fillStyle = rgbCss(nubRgb, 1);
  for (const lon of [-NUB_LON, NUB_LON]) {
    g.beginPath();
    g.arc(half + Math.sin(lon) * size * NUB_X, half + size * NUB_Y, nubR, 0, Math.PI * 2);
    g.fill();
  }

  g.drawImage(body, 0, 0, size, size);

  /* THE EYES, CLIPPED TO THE SILHOUETTE the same way the loop clips them —
     `bodyPath` is the one tracer, so the bake and the clip cannot drift. */
  g.save();
  g.translate(half, half);
  bodyPath(g, size, size, be);
  g.clip();
  g.fillStyle = EYE_INK;
  const er = size * EYE_R;
  /* `-size * 0.06` is the loop's `eyY` at latitude 0: the eyes sit a little
     above the equator, which is what makes the dome read as a forehead. */
  const eyY = -size * 0.06;
  for (const lon of [-EYE_LON, EYE_LON]) {
    const ca = Math.cos(lon);
    g.beginPath();
    g.ellipse(Math.sin(lon) * size * FACE_R, eyY, er * Math.max(ca, 0.2), er, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}
