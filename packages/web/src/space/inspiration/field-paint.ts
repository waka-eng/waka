/**
 * LAYER ONE, PAINTED — how the ground is put on the canvas, taken out of the page.
 *
 * `orb.ts` says what a saved memory IS on screen, `field.ts` says how the ground
 * arranges and lights one, and this says what the two of them look like once a
 * frame has run. It was two passes inside a 531-line `draw` in `pages/Home.tsx`.
 *
 * WHY THE TWO PASSES MOVED TOGETHER, WHICH IS THE WHOLE POINT.
 *
 * They are one idea wearing two loops: every orb's diffuse bloom is laid down
 * first in additive light, then every orb's disc is drawn over it in source-
 * over. That order is the effect — the disc appears lit from within because its
 * own bloom is already under it — and the two loops share the culling, the
 * aliveness tier and the focus law line for line. Measured apart, the disc pass
 * needs two state groups and the bloom pass four, so moving only the disc pass
 * would have cleared the gate on paper while splitting one appearance across
 * two files. Measured together they need two — `cam` and `view` — because the
 * bloom pass's other two are not state objects at all: `pour` is read only at
 * the call site (it always was, as `bloomPass(list, pour.active)`) and `mech` is
 * a bare number. So the honest unit is both passes, and it passes the gate.
 *
 * TWO THINGS A READER WILL TRIP ON, AND WHY THEY ARE THAT WAY. The body was
 * moved from the page unchanged apart from two lines, so that the move could be
 * PROVEN rather than asserted: extract it from both sides, dedent by the four
 * spaces it lost, diff, and exactly two lines differ — the two named below.
 * That is why `ctx!` survives on a parameter that cannot be null (every `!` is
 * a no-op here), and why the inner `bloomPass` still takes an argument called
 * `still` that shadows the outer one of the same name. Both are cosmetic, both
 * are a one-line change anyone can make and re-verify, and neither was worth
 * trading the proof for.
 *
 * THE TWO LINES THAT DID CHANGE, both at the seam and both semantics-preserving:
 * `panelOpenRef.current` became `panelOpen()`, the accessor described below, and
 * `bloomPass(list, pour.active)` became `bloomPass(list, still)`, where the page
 * now passes `still: pour.active` at the call. Same reads, same frame, same
 * values.
 *
 * WHAT IT IS NOT ALLOWED TO KNOW. No React, no network, no frame scheduling and
 * no state of its own. Two things arrive as FUNCTIONS rather than as values, and
 * both would be silent bugs the other way round: `grid` closes over the page's
 * live crossing scalar, and `panelOpen` reads a React ref that is re-pointed
 * while the loop is still running. A value captured once would freeze, the
 * picture would keep drawing, and nothing would report it.
 */
import type { Palette } from "../../canvas/palette";
import { BLOOM_PEAK, BLOOM_R, bloomAlpha, ORB_PAD, orbsForHue } from "../../canvas/sprites";
import { clamp01, lerp } from "../../lib/num";
import { sortByDepth, tierOf } from "./field";
import type { Ball } from "./orb";

/**
 * How far past the edge a bloom and a disc still count as visible.
 *
 * Two numbers because the two sprites are not the same size, and getting this
 * wrong is expensive in opposite directions: the bloom's real half-extent is
 * 32 x BLOOM_R x 1.12, about 79px, so the old shared 300 was additively
 * blending whole screenfuls of orbs below the fold, while anything under 79
 * would pop a bloom off at the edge of the screen.
 */
const CULL_BLOOM = 82;
const CULL_ORB = 40;

/** Where the ground is being looked at from — the two facts it is culled by. */
export interface FieldCam {
  x: number;
  y: number;
}

/**
 * What the ground is drawn into. Deliberately narrower than the page's own
 * `view`: this is a written-down claim about what the painter may touch, so
 * anything the page adds to that object is, by construction, none of its
 * business. It is a field wider than the sky painter's because the ground
 * alone reads the device ratio (to pick a photo's sprite size) and where the
 * field begins (to fade an orb by depth).
 */
export interface FieldView {
  reduced: boolean;
  w: number;
  h: number;
  dpr: number;
  layout: { fieldTop: number };
}

/**
 * Everything one frame of ground needs, said once.
 *
 * An object rather than thirteen positional arguments: five of them are bare
 * numbers, booleans and functions, and a transposed pair there would be a
 * silently wrong picture rather than a type error.
 */
export interface FieldPaint {
  ctx: CanvasRenderingContext2D;
  pal: Palette;
  /** every orb on every visible wall, and the painter's depth order over it */
  list: Ball[];
  order: number[];
  cam: FieldCam;
  view: FieldView;
  /** the frame's seconds — the page computes it once for every pass to share */
  t: number;
  /** how tall the field is, so an orb can be dimmed by how deep in it it sits */
  depthSpan: number;
  /** which memory is focused, or null; it is the one thing that stays lit */
  selId: string | null;
  /** a pour is arriving, so the breath holds still until the orbs have landed */
  still: boolean;
  /** how far into a machine's wall the camera stands: 0 yours, 1 an agent's */
  mech: number;
  /** snap a coordinate to the machine's grid, by however machine it is */
  grid: (v: number) => number;
  /** live, not captured — the panel opens and closes while this loop runs */
  panelOpen: () => boolean;
}

export function paintField(p: FieldPaint) {
  const { ctx, pal, list, order, cam, view, t, depthSpan, selId, still, mech, grid, panelOpen } = p;
  /**
   * A MACHINE'S MEMORY IS COARSE, NOT SOFT — and it was being served soft.
   *
   * Founder, 2026-09-08: an agent's orbs "look blurry and pixelated in a
   * weird way" where the intent (which they endorse) is a visibly coarser
   * resolution. Both halves of that sentence were true, and the reason is one
   * flag. `rasterOrbPixel` bakes the coarse disc with `imageSmoothingEnabled
   * = false` — correct, and it is why the sprite ITSELF has hard four-pixel
   * blocks. But the frame then draws that sprite at the ball's LIVE radius,
   * which is never the baked radius, and the frame's context had smoothing
   * ON. So every block was bilinearly resampled on its way to the screen:
   * hard steps, soft edges, which is exactly "pixelated in a weird way".
   *
   * Tracked rather than assigned per orb because the field draws hundreds of
   * them and only a handful of the flips are real.
   */
  let smoothing = true;
  /* pass 1 — the diffuse blooms. Additive on dusk, so a dense pile glows
     hotter for free; a soft multiply wash on paper. This is what makes
     the orbs feel lit from within rather than filled in. One pass per
     visible column: the personal field, then any room in view. */
  ctx!.globalCompositeOperation = "lighter";
  const bloomPass = (arr: Ball[], still: boolean) => {
    for (const b of arr) {
      if (!b.active) continue;
      /* Cull at the sprite's REAL extent. The widest bloom is
         32 × BLOOM_R × 1.12 ≈ 79px of half-extent, so ±300/±260 was
         additively blending whole screenfuls of orbs below the fold. */
      const sxb = b.x - cam.x;
      if (sxb < -CULL_BLOOM || sxb > view.w + CULL_BLOOM) continue;
      const sy = b.y - cam.y;
      if (sy < -CULL_BLOOM || sy > view.h + CULL_BLOOM) continue;
      const depth = clamp01((b.y - view.layout.fieldTop) / depthSpan);
      /* A MACHINE'S MEMORY DOES NOT BREATHE, IT CYCLES.
         The bloom's breath is a sine — the single most organic thing on
         screen, and it was running identically under an agent's memories
         while everything around them was stepping. Quantizing the sine
         rather than removing it keeps the amplitude, the rate and the
         phase exactly as they were: same rhythm, fewer states in it. */
      const breathRaw = Math.sin(t * b.breathRate + b.breathPhase);
      const breathQ =
        mech < 0.02 ? breathRaw : Math.round(breathRaw * (5 - mech * 3)) / (5 - mech * 3);
      const breath =
        view.reduced || still ? 1 : 1 + breathQ * (0.04 + 0.05 * b.alive);
      /* the founder's continuum law, unchanged */
      let alpha = bloomAlpha(b.alivePow) * breath * lerp(1, 0.72, depth);
      alpha *= (1 - b.gone) * lerp(1, 0.12, b.dim) * (1 + b.glow * 0.7 + b.relight * 0.9);
      /* The focused orb is the only lit thing on screen, so it gets a floor
         under its bloom: a dormant memory is dim at rest, but attention
         still has to land on it. */
      if (b.id === selId) alpha = Math.max(alpha, 0.32 * b.glow);
      /* THE FINGER IS ON THIS ONE. Juice lives in the bloom: the disc's
         tier never moves, the radius never moves, nothing about what this
         memory IS changes because it is being touched. Only the light
         around it says so. */
      alpha += 0.3 * b.press;
      if (alpha <= 0.004) continue;
      const hr = b.r * BLOOM_R * (1 + b.glow * 0.12);
      ctx!.globalAlpha = Math.min(alpha, BLOOM_PEAK + 0.14 * b.press);
      ctx!.drawImage(pal.blooms[b.sizeIdx][tierOf(b)], b.x - hr, b.y - hr, hr * 2, hr * 2);
      /* The focused orb wears a second, much wider and dimmer ring — but
         not while its panel is open: a ring that wide reaches under the
         card, and light must live BEHIND the panel, never on it. */
      if (b.glow > 0.02 && b.id === selId && !panelOpen()) {
        const ar = b.r * 4.2;
        ctx!.globalAlpha = 0.1 * b.glow;
        ctx!.drawImage(pal.aura, b.x - ar, b.y - ar, ar * 2, ar * 2);
      }
    }
  };
  bloomPass(list, still);

  /* pass 2 — the orbs. A pastel gradient disc with a soft edge that melts
     into its own bloom: no rim light, no terminator, no contact shadow,
     because these are lit from within and float. Aliveness picks the
     baked tier — full gradient when alive, desaturating toward slate as it
     fades, a dim slate disc when dormant. It never disappears. */
  ctx!.globalCompositeOperation = "source-over";
  const orbPass = (arr: Ball[], ord: number[]) => {
  sortByDepth(arr, ord);
  for (const oi of ord) {
    const b = arr[oi];
    if (!b.active) continue;
    /* and the disc at its own: 32 + ORB_PAD = 34px */
    const sxb = b.x - cam.x;
    if (sxb < -CULL_ORB || sxb > view.w + CULL_ORB) continue;
    const sy = b.y - cam.y;
    if (sy < -CULL_ORB || sy > view.h + CULL_ORB) continue;
    let a = 1 - b.gone;
    /* focus dims EVERYTHING else, uniformly — there is exactly one lit
       thing on the screen (founder ruling, explicit) */
    a *= lerp(1, 0.2, b.dim);
    if (a <= 0.01) continue;

    const rx = b.r;
    const ry = b.r;
    const cyv = b.y;
    /* a scrubbed-away orb also shrinks slightly as it fades in place */
    const shrink = 1 - b.gone * 0.06;
    /* JUICE LIVES IN THE BLOOM, AND THAT INCLUDES SIZE. Selection used to
       swell the disc eight percent — feedback moving geometry, which the
       law rejects outright, and which contradicted `hold`'s own contract
       ("Never a position target — light only") twenty lines after a
       comment swearing the radius never moves. It was not gated on
       `reduced` either, so a person who asked for less movement got the
       swell anyway. Selection reads entirely through the bloom now: the
       0.32 alpha floor, the ×1.7 glow gain, the widened bloom radius and
       the second wide aura ring. `shrink` stays — it is the gone-fade,
       the memory leaving, not the layout answering a touch. */
    const pop = shrink;
    const ex = (rx + ORB_PAD) * pop;
    const ey = (ry + ORB_PAD) * pop;

    ctx!.globalAlpha = a;
    {
      /* THE DISC TELLS THE TRUTH, INCLUDING WHILE YOU ARE READING IT.
         This used to pin a selected orb at the top tier, which meant a
         dormant memory rendered as fully alive the moment you tapped it —
         the product's own thesis running backwards. You could not watch a
         reflection re-light it (the disc was already at maximum), and the
         orb you had just brought back was DIMMER after you closed the
         panel than while you read it. Attention is carried by the bloom,
         which has a floor under it; the disc is what the memory IS. */
      const tier = tierOf(b);
      /* stepped as you cross into a machine's wall: the same disc, landing
         on a grid instead of anywhere */
      /* Two facts, two channels, resolved to one sheet: WHOSE it is picks
         the hue, WHAT KIND OF MIND kept it picks the resolution. Your own
         smooth untinted memories are the common case and skip the cache
         entirely. */
      const machine = b.origin === "agent";
      /* ONE FACT, NOT TWO. This used to resolve a hue and a resolution into
         one sheet; the hue half had no writer left (see `Ball` in orb.ts), so
         `hue < 0` was always true and only WHAT KIND OF MIND kept it decides.
         Your own smooth memories are the common case and skip the cache. */
      const sheet = machine ? orbsForHue(pal, true) : pal.orbs;
      if (smoothing === machine) {
        smoothing = !machine;
        ctx!.imageSmoothingEnabled = smoothing;
      }
      if (machine) {
        /* AND THE BLOCKS LAND ON DEVICE PIXELS. Nearest-neighbour still
           smears if the destination edge falls mid-pixel: the sampler has to
           choose, and the choice differs along the edge, which reads as a
           ragged block rather than a square one. The transform is
           `setTransform(dpr, ...)`, so one unit here is `dpr` device pixels
           and snapping means rounding to `1 / dpr`. Position is already
           quantized by `grid`; this is the SIZE, which nothing snapped. */
        const step = 1 / view.dpr;
        const x0 = Math.round((grid(b.x) - ex) / step) * step;
        const y0 = Math.round((grid(cyv) - ey) / step) * step;
        const w = Math.max(Math.round((ex * 2) / step) * step, step);
        const h = Math.max(Math.round((ey * 2) / step) * step, step);
        ctx!.drawImage(sheet[b.sizeIdx][tier], x0, y0, w, h);
      } else {
        ctx!.drawImage(sheet[b.sizeIdx][tier], grid(b.x) - ex, grid(cyv) - ey, ex * 2, ey * 2);
      }
    }
    /* Brightness already says how alive this memory is; it cannot also say
       whether a person answered a reflection. A small mark stays attached
       to the orb in a dense field, while the visible ground key names it in
       plain words. Reflections belong to the person's own ground, not to
       another member's room-facing memory. */
    if (b.reflections > 0 && b.col === undefined) {
      ctx!.save();
      ctx!.globalAlpha = Math.min(a, 0.95);
      const markX = grid(b.x) + rx * 0.68;
      const markY = cyv - ry * 0.68;
      ctx!.fillStyle = "#0b0e14";
      ctx!.beginPath();
      ctx!.arc(markX, markY, 7, 0, Math.PI * 2);
      ctx!.fill();
      ctx!.fillStyle = "#f7f1e4";
      ctx!.beginPath();
      ctx!.arc(markX, markY, 3.5, 0, Math.PI * 2);
      ctx!.fill();
      ctx!.restore();
    }
    /* NO RING. The frontier was drawn as an open arc outside the disc and
       it read as decoration nobody could name — "what are these outlines
       for" was the whole verdict. The opacity already carries it: a memory
       nothing rests on has no cited-bonus under its light, so it sits
       dimmer than its neighbours on its own. The fact is still computed
       and the companion still speaks it; it just is not drawn twice. */
  }
  };
  orbPass(list, order);
  /* LEAVE THE CONTEXT AS WE FOUND IT. The flag is canvas state, not a
     per-draw argument: if the last orb painted was a machine's, everything
     drawn after this pass — glows, the grain, the panels — would inherit
     nearest-neighbour and go crunchy for reasons nothing near it explains. */
  if (!smoothing) ctx!.imageSmoothingEnabled = true;
}
