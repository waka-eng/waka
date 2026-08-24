/**
 * THE ROOTS OF WHAT YOU ARE READING — the sky's one line down to the ground.
 *
 * goal: no-quiet-corners, Phase 8, "the drawn sky→field root lines".
 *
 * WHY THIS EXISTS WHEN CONNECTION LINES WERE RULED OUT. The founder killed
 * orb-to-orb connections and said why: "I don't want the connections with the
 * other balls to appear. It's confusing. And everything should dim except for
 * that one." That ruling is about the FIELD — lines between memories, drawn
 * across one plane, saying that two of your captures are somehow related. It
 * has no subject: a person cannot read a mesh, and the relation those lines
 * drew was never one the product could name in words either.
 *
 * A root line is a different sentence, and the founder settled it as one:
 * this pattern is standing on THAT memory. It is directed, it crosses the
 * two layers rather than tangling one of them, it is the same fact the
 * reading panel prints as a row of text, and there is never a mesh of it —
 * one cloud, its own roots, and nothing else on screen lit at all.
 *
 * IT IS LIGHT, NOT A DIAGRAM. The founder's law is that light is the only
 * meaning channel, so this is not a wire with a stroke weight and a join
 * style: it is the cloud's own colour, additive, falling away from the
 * source. Nothing about it is readable as a UI element you could click, and
 * it never carries a label, an arrowhead, or a count.
 *
 * WHAT IT SOLVES THAT LIGHTING THE FIELD DOES NOT. Focusing a pattern already
 * lights exactly the memories it cites and sinks the rest — but only if you
 * are standing where you can SEE them. Read a pattern from the sky and the
 * field is a screen and a half below the bottom edge, so the world's answer
 * happens somewhere you are not. The line leaves the cloud and goes down out
 * of frame, which is the same vocabulary the field already uses at the other
 * edge: the ground is cut by the bottom of the viewport and "there is more
 * down there" needs no words. Travel down it and the far end resolves onto
 * the orbs that were lit the whole time.
 *
 * It draws between the sky and the ground on purpose — under every orb and
 * under the cloud's own body — so nothing it says is ever ON a memory.
 */

import { type Ramp } from "../../lib/appearance";
import { clamp01 } from "../../lib/num";

/** Where the light comes from: the focused cloud's live centre. */
export interface RootSource {
  x: number;
  y: number;
  /** the cloud's radius, so the line starts at its edge rather than its middle */
  r: number;
}

/** One memory the pattern stands on, where it currently is. */
export interface RootTarget {
  x: number;
  y: number;
  /** the memory's own aliveness, curved — a root that carries more is brighter */
  alivePow: number;
}

export interface RootsCam {
  x: number;
  y: number;
}

export interface RootsView {
  w: number;
  h: number;
  reduced: boolean;
}

export interface RootsPaint {
  ctx: CanvasRenderingContext2D;
  ramp: Ramp;
  from: RootSource;
  to: RootTarget[];
  cam: RootsCam;
  view: RootsView;
  /** 0 to 1 as the reading opens and closes; light arrives, it does not pop */
  ease: number;
}

/**
 * The brightest a root ever gets, at the cloud end, for the most load-bearing
 * memory there is. Deliberately below what a mote is worth: this is the world
 * saying where to look, not a thing to look at.
 */
export const ROOT_PEAK_ALPHA = 0.55;
/** How much of the line's length keeps the cloud's full strength. */
export const ROOT_HOLD = 0.12;
/**
 * WHAT IS LEFT WHERE THE LINE ARRIVES, and the number this was built wrong on.
 *
 * The first version fell to a tenth of peak at the memory, on the reasoning
 * that the orb is already lit by its own light and a root arriving at full
 * strength would draw a second ring around something the field has already
 * answered for. That reasoning is sound and it solved the wrong end.
 *
 * Measured in the browser at 1440x900, standing between the two layers with
 * the pattern read and two real roots on screen: the cloud was above the top
 * edge, so the only part of each line anyone could see was its last stretch —
 * the faintest part, a sub-pixel width at three hundredths alpha on a
 * near-black ground. The loop reported `targets: 2, ease: 1` and the
 * photograph showed nothing at all. A line whose visible portion is its
 * dimmest is a line drawn for a viewer standing where nobody stands.
 *
 * So it still falls — the orb is still the thing that says HOW MUCH — but it
 * arrives legible, because arriving is the whole sentence.
 */
export const ROOT_ARRIVAL = 0.5;
/** A root of a dormant memory still draws — dimmer, never absent. */
/**
 * How far down a root its origin may be pushed by the cloud's radius.
 *
 * The origin sits on the cloud's edge, which is right whenever the memory is
 * further away than the cloud is wide. When it is not — a memory inside the
 * body — the offset has to yield, or the line reverses. Seven tenths keeps a
 * visible run of line in the worst case while leaving the ordinary case
 * (`from.r` far smaller than the distance) completely untouched.
 */
export const ROOT_MAX_ORIGIN_SHARE = 0.7;

export const ROOT_FLOOR = 0.35;

const rgb = (c: [number, number, number]): string => `${c[0]}, ${c[1]}, ${c[2]}`;

/**
 * Draw one pattern's roots. Pure paint: every position is handed in, so this
 * has no opinion about which pattern is focused or what "cited" means.
 */
export function paintRoots(p: RootsPaint): void {
  const { ctx, ramp, from, to, cam, view, ease } = p;
  if (ease <= 0.004 || to.length === 0) return;

  /* THE CANVAS IS IN WORLD SPACE, AND THIS PASS WAS WRITTEN AS IF IT WERE NOT.
     The frame clears with `clearRect(cam.x, cam.y, w, h)` and the mote pass
     ADDS the camera to place a mote — both only make sense if the context
     already carries the camera, which it does. So a world coordinate is drawn
     as it stands, and it is the CULL that has to convert.
     Subtracting the camera here put every line one whole viewport away from
     where it belonged: the loop reported two targets and a full ease, the
     guard passed, the painter ran, and a six-pixel magenta probe rectangle
     drawn at the top of this function photographed as nothing — because it,
     too, was being drawn nine hundred pixels below the fold. Diagnosed by
     printing the numbers the painter was actually handed. */
  const sxOn = from.x - cam.x;
  const syOn = from.y - cam.y;

  ctx.save();
  /* Additive, like every other light in this world: two roots crossing get
     brighter where they meet rather than painting over one another, which is
     what light does and what a wire does not. */
  ctx.globalCompositeOperation = "lighter";
  /* AND STATE THE ALPHA, which is the bug that made this whole pass invisible
     while every number said it was working.

     The pass immediately before this one draws the motes, and it sets
     `globalAlpha` per mote and never puts it back — correctly, because the
     pass after it has always set its own. A canvas context is one long-lived
     bag of mutable state and `save()` preserves whatever it inherited rather
     than resetting it, so these lines were being stroked at whatever fraction
     the last mote happened to want. Diagnosed by drawing a six-pixel magenta
     line and still photographing nothing, with the loop reporting two real
     targets and a full ease: the geometry was right the whole time and the
     paint was multiplied to nothing. */
  ctx.globalAlpha = 1;
  ctx.lineCap = "round";

  for (const target of to) {
    const txOn = target.x - cam.x;
    const tyOn = target.y - cam.y;

    /* CULL WHAT CANNOT BE SEEN, and cull it by the SEGMENT rather than by its
       ends. A root spends most of its life with one end far above the
       viewport and the other far below it — that is the normal case, not the
       exceptional one — so testing whether either endpoint is on screen would
       drop precisely the lines that matter. Both ends off the same edge is
       the only honest way to know the whole line missed. */
    if ((syOn < 0 && tyOn < 0) || (syOn > view.h && tyOn > view.h)) continue;
    if ((sxOn < 0 && txOn < 0) || (sxOn > view.w && txOn > view.w)) continue;

    const dx = target.x - from.x;
    const dy = target.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;

    /* Start at the cloud's EDGE, not its centre: a line emerging from inside
       the body would read as something drawn on top of the cloud rather than
       as something leaving it.

       Clamped, because a memory can sit CLOSER to the cloud's centre than the
       cloud's own radius — a dense field puts one inside the body — and an
       unclamped offset would then land the origin past the memory and draw
       the gradient backwards: brightest at the memory, faint at the cloud,
       which states the opposite of what the line means. The clamp keeps the
       origin short of the target, so a root that starts inside the body
       still runs the right way. */
    const reach = Math.min(from.r, len * ROOT_MAX_ORIGIN_SHARE);
    const ox = from.x + (dx / len) * reach;
    const oy = from.y + (dy / len) * reach;

    const carry = ROOT_FLOOR + (1 - ROOT_FLOOR) * clamp01(target.alivePow);
    const peak = ROOT_PEAK_ALPHA * carry * ease;

    const grad = ctx.createLinearGradient(ox, oy, target.x, target.y);
    /* THE FALL-OFF IS THE WHOLE POINT. Full at the cloud, still strong a
       little way down, and nearly gone by the time it reaches the memory —
       because the memory is already lit by its own light and a line that
       arrived at full strength would draw a second ring around something the
       field has already answered for. The line says WHICH WAY; the orb at the
       end of it says how much. */
    grad.addColorStop(0, `rgba(${rgb(ramp.dust)}, ${peak})`);
    grad.addColorStop(ROOT_HOLD, `rgba(${rgb(ramp.dust)}, ${peak * 0.88})`);
    grad.addColorStop(0.62, `rgba(${rgb(ramp.fade)}, ${peak * 0.66})`);
    grad.addColorStop(1, `rgba(${rgb(ramp.live)}, ${peak * ROOT_ARRIVAL})`);
    ctx.strokeStyle = grad;
    /* One device pixel, and the gradient does every bit of the tapering. Wider
       than this and it stops being light and starts being a rule drawn on the
       world; thinner — the 0.9 it was — and the anti-aliasing spends most of
       an already low alpha on nothing. */
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
  }

  ctx.restore();
}
