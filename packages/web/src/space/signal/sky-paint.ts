/**
 * LAYER TWO, PAINTED — how the sky is put on the canvas, taken out of the page.
 *
 * `sky.ts` says what the sky IS, `sky-engine.ts` says what happens to it over
 * time, and this says what it LOOKS like once both have run. The three of them
 * are the whole of layer two, and this was the last piece still living inside a
 * 531-line `draw` in `pages/Home.tsx`.
 *
 * WHY THIS ONE COULD LEAVE AND THE COMPANION BESIDE IT COULD NOT.
 *
 * The same gate `sky-engine.ts` was measured against: a candidate needing FOUR
 * OR MORE of the frame loop's eleven state objects is not a module, it is a
 * slice of the loop wearing a new file name. `scripts/measure-groups.mjs` puts
 * `draw` as a whole at seven, which fails — but a painter decomposes by WHAT IT
 * PAINTS, and measured pass by pass the sky needs three: `cam`, `sky`, `view`.
 * The companion pass needs four (`cam`, `companion`, `stir`, `view`) plus the
 * crossing scalar, so it stayed in the page. Nothing was argued into or out of
 * this file; every number is in the commit message.
 *
 * WHAT IT IS NOT ALLOWED TO KNOW. No React, no network, no frame scheduling and
 * no state of its own — it reads the three groups and writes only to the canvas.
 * `grid` arrives as a function rather than as a number because it closes over
 * the page's live crossing scalar: passing the FUNCTION keeps it live, where
 * passing a result would have frozen the sky at whatever was true when the
 * frame began. That freezing is the exact failure mode this split was warned
 * about, and it is silent — the picture keeps drawing, just at a stale value.
 *
 * WHY THE BODY STILL SAYS `ctx!`. It was moved from the page unchanged, to the
 * byte, so that the move could be PROVEN rather than asserted: extract the body
 * from both sides, dedent by the four spaces it lost, diff, and the answer is
 * zero differences. In the page `ctx` was nullable; here it is a parameter that
 * cannot be null, so every `!` is a no-op the compiler accepts and ignores.
 * They are left in deliberately — deleting a hundred of them would have traded
 * that proof for tidiness, and this is the file where the picture lives.
 * Stripping them is a one-line change anyone can make and re-verify later.
 *
 * THE CANVAS IS SHARED STATE AND THE ORDER IS LOAD-BEARING. This runs between
 * two other passes that also set `globalCompositeOperation` and `globalAlpha`,
 * and it deliberately does not restore what it found. The trailing "lighter" on
 * its last line is redundant today — the field pass sets it again as its first
 * act — and it is kept anyway, because deleting it would have made this a
 * rewrite instead of a move. A redundant assignment is a cheaper thing to carry
 * than an unproven one.
 */
import type { Palette } from "../../canvas/palette";
import { BLOOM_PEAK, BLOOM_R, bloomAlpha, ORB_PAD } from "../../canvas/sprites";
import { clamp01, lerp } from "../../lib/num";
import { tierOf } from "../inspiration/field";
import type { Neb } from "./sky";
import { EMERGE_SCALE, FOCUS_DIM, FOCUS_POP, SAT_R, type SkyState } from "./sky-engine";

/**
 * Passing BEHIND its candidate a satellite dims by this much and draws before
 * the cloud's blooms; in front it draws after them. Occlusion only — nothing
 * that exists ever pops out of existence.
 */
const ORBIT_BEHIND = 0.18;

/** Where the world is being looked at from — the two facts the sky is culled by. */
export interface CamPos {
  x: number;
  y: number;
}

/** What the world is drawn into — the three facts the sky is painted by. */
export interface PaintView {
  reduced: boolean;
  w: number;
  h: number;
}

/**
 * Everything one frame of sky needs, said once.
 *
 * An object rather than nine positional arguments because four of them are
 * bare numbers and functions, and a transposed pair there would be a silent
 * wrong picture rather than a type error. It costs one small allocation per
 * frame, which is strictly less than the page paid before: `draw` built the
 * satellite, bloom, orb and nub closures fresh on every single frame, and
 * three of those four are gone now.
 */
export interface SkyPaint {
  ctx: CanvasRenderingContext2D;
  pal: Palette;
  sky: SkyState;
  cam: CamPos;
  view: PaintView;
  /** the frame's seconds — the page computes it once for every pass to share */
  t: number;
  /** snap a coordinate to the machine's grid, by however machine it is */
  grid: (v: number) => number;
}

export function paintSky(p: SkyPaint) {
  const { ctx, pal, sky, cam, view, t, grid } = p;
  /* pass 0b — the sky. Nebulae are additive light like everything else
     here, and the memories they are made of ORBIT them: real orbs, drawn
     from the field's own baked sprites, so a candidate's provenance is
     legible rather than implied.

     A satellite on the far side of its orbit draws BEFORE the cloud's
     blooms and dims; on the near side it draws after them. That is
     occlusion, not visibility: nothing that exists ever pops out of
     existence. */
  const satPass = (n: Neb, near: boolean, ground: number) => {
    /* placeSats left this far-to-near; satAt walks the same array
       backwards, so the one whose pixels are on top is the one that
       answers a tap */
    for (let k = 0; k < n.satOrd.length; k++) {
      const s = n.sats[n.satOrd[k]];
      if ((s.front > 0) !== near) continue;
      /* AT REST THERE IS NOTHING HERE. `em` is the emergence: zero until
         the candidate is the subject, and back to zero as it retracts —
         so the sky at rest is sentences and bodies, and this pass costs
         one comparison per satellite. */
      if (s.em <= 0.004) continue;
      const base = ground * s.em * (near ? 1 : 1 - ORBIT_BEHIND) * lerp(1, 0.2, s.dim);
      if (base <= 0.01) continue;
      /* the memory's own light, live where the memory is the viewer's own */
      const pow = s.ball ? s.ball.alivePow : s.alivePow;
      /* the memory's own bloom, with the same floor under it the field
         puts under a focused orb: the disc no longer flatters a dormant
         memory, so the light around it is what has to carry attention */
      const bloom = Math.max(
        bloomAlpha(pow) * base * (1 + s.glow * 0.7),
        0.32 * s.glow * base,
      );
      /* AND THE SAME LIE, DELETED HERE TOO. A satellite IS a memory — the
         very one the field draws a section below — so pinning a selected
         one at the top tier said "fully alive" about something dormant,
         in the one place a person looks hardest: the evidence under a
         claim. The field's own orb pass had this deleted already; the
         orbits kept it, so the same memory read as two different
         alivenesses depending on which of the two you were looking at. */
      const tier = s.ball ? tierOf(s.ball) : s.tier;
      if (bloom > 0.004) {
        ctx!.globalCompositeOperation = "lighter";
        const hr = s.dr * BLOOM_R;
        ctx!.globalAlpha = Math.min(bloom, BLOOM_PEAK);
        ctx!.drawImage(pal.blooms[s.sizeIdx][tier], s.x - hr, s.y - hr, hr * 2, hr * 2);
      }
      ctx!.globalCompositeOperation = "source-over";
      /* the same emergence the position carries: it comes out of the
         sentence small and arrives whole, one movement */
      /* and the selection swell deleted here too, for the same reason the
         tier lie was: a satellite IS a memory, so the disc must answer to
         the same law on both walls. The EMERGE_SCALE term stays — that is
         arrival, the memory coming out of the sentence, not feedback. */
      const ex = (s.r + ORB_PAD) * SAT_R * (view.reduced ? 1 : lerp(EMERGE_SCALE, 1, s.em));
      ctx!.globalAlpha = base;
      ctx!.drawImage(pal.orbs[s.sizeIdx][tier], s.x - ex, s.y - ex, ex * 2, ex * 2);
    }
  };
  for (const n of sky.nebs) {
    if (n.gone >= 1) continue;
    const sx = n.x - cam.x;
    if (sx < -n.r * 2.4 || sx > view.w + n.r * 2.4) continue;
    const sy = n.y - cam.y;
    if (sy < -n.r * 2.4 || sy > view.h + n.r * 2.4) continue;
    const breath = view.reduced ? 1 : 1 + Math.sin(t * n.breathRate + n.breathPhase) * 0.055;
    /* dispersing: it thins AND spreads, which is what dispersing means —
       and the subject sits a little nearer, body and words together */
    const rr = n.r * breath * n.condense * (1 + n.gone * 0.5) * (1 + FOCUS_POP * n.focus);
    /* while one candidate is the subject, every other one sinks — the
       field's own focus law, applied to the sky's bodies */
    const a =
      (1 - n.gone) *
      (n.dragging ? 1.25 : 1) *
      /* the one it would join, answering — the drop target is a rise in
         light and nothing else, which is the only channel this layout has
         and the only one it needs */
      (n.joining ? 1.4 : 1) *
      /* and, at rest, a pair that COULD be joined leans toward each other
         — the invitation, held perfectly still */
      (n.pairable && !n.dragging ? 1.15 : 1) *
      (n.kind === "draft" ? 1.4 : 1) *
      lerp(1, FOCUS_DIM, n.dimN);
    /* the satellites vanish with their candidate, over the same beat */
    const satGround = (1 - n.gone) * n.condense;
    if (n.sats.length > 0) satPass(n, false, satGround);
    ctx!.globalCompositeOperation = "lighter";
    ctx!.globalAlpha = clamp01(a);
    ctx!.drawImage(pal.nebulae[n.variant], grid(n.haloX) - rr, grid(n.haloY) - rr, rr * 2, rr * 2);
    if (n.sats.length > 0) satPass(n, true, satGround);
  }
  ctx!.globalCompositeOperation = "lighter";
}
