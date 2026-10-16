/**
 * ═══ THE COMPANION, OFF THE WORLD'S CANVAS ══════════════════════════════
 *
 * Founder, of the home screen: "this is my only favorite screen of the
 * experience." And then: "do the rest pose so the creature can be on every
 * screen."
 *
 * WHAT MAKES THAT SCREEN THE FAVOURITE. It holds ONE object; the light on it
 * comes from INSIDE that object rather than from a gradient behind an empty
 * room; the one sentence is the brightest thing there; nothing is doing
 * bookkeeping. The first of those is the whole finding — this product is a
 * companion, and four of its five surfaces had sent it away. "Nothing here
 * feels 몽글몽글", said of an empty conversation, is the same observation
 * from the other side: a conversation with WAKA that has no WAKA in it.
 *
 * A PAGE DOES NOT RUN THE WORLD. The frame loop draws the creature sixty
 * times a second out of live simulation state — yaw, pitch, blink, gaze, a
 * bob, four drifting aura layers, a machine-cell grid. None of that is
 * wanted on a page somebody came to read, and a page cannot have it anyway.
 * `restPose` in `character/raster.ts` is that same drawing with every
 * behaviour set to zero, built from the anatomy both it and the loop import;
 * `rest-pose.test.ts` fails if either grows its own copy of a number.
 *
 * THE AURA IS CSS, AND THAT IS NOT THE CHEAP VERSION. On the world the
 * aura is composited into the frame because it interacts with what is alive
 * in the field. On a page there is no field, so it is a fact rather than a
 * reading — and a radial gradient states a fact without a canvas big enough
 * to hold its own falloff, which is what the first attempt at this got wrong
 * (the glow was clipped by the scroller it sat in).
 *
 * IT DOES NOT MOVE. There is no loop here and inventing one would be motion
 * nobody asked for. The founder's law stands: nothing moves unless the user
 * moved it.
 */
import { useEffect, useRef } from "react";

import { OWNER_BEING, type Being } from "../character/body";
import { REST_BLEED, coolRamp, restPose } from "../character/raster";
import { renderScale } from "../canvas/scale";
import { MACHINE_CELLS, pixelate, rampFromCss, rasterGrain } from "../canvas/palette";

export function Companion({ size = 72, being = OWNER_BEING, cool = false, pixel = false, label = "WAKA" }: {
  size?: number;
  /** Whose body. Your own by default; an agent's is `agentBeing(agentId)`. */
  being?: Being;
  /** An agent is the same creature in colder light (`coolRamp`). */
  cool?: boolean;
  /** And at a coarser resolution: the same `MACHINE_CELLS` step the world
      bakes an agent's body at, so the face beside a line is the face on the
      agent's wall. Founder, 2026-10-15: "bring the pixelated agent". */
  pixel?: boolean;
  label?: string;
}): JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    /* THROUGH `renderScale`, BECAUSE `devicePixelRatio` HAS ONE HOME.
       `render-scale.test.ts` holds that line and caught this on the way in:
       a second reader of the ratio is a second thing that can disagree with
       the world about how sharp the creature should be. */
    /* ROOM FOR THE PARTS THAT STICK OUT. Founder: "the character is cut off
       on the left and right." A nub reaches `REST_BLEED` of the size past
       the box the body is drawn in — see the constant, which derives it from
       the anatomy rather than restating it — so the canvas is that much
       larger on every side and the drawing is moved into the middle of it.
       Rounded up to a whole pixel so the translate never lands on a half. */
    const pad = Math.ceil(size * REST_BLEED);
    const box = size + pad * 2;
    const dpr = renderScale(box, box);
    node.width = Math.ceil(box * dpr);
    node.height = Math.ceil(box * dpr);
    const g = node.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, node.width, node.height);
    g.scale(dpr, dpr);
    g.translate(pad, pad);
    /* FULLY LIT, ALWAYS. The world dims the creature to report how little is
       alive in your field — a reading of your material. A page is not a
       reading of anything, so a dim companion there would be saying
       something untrue about you. */
    const ramp = coolRamp(rampFromCss(document.documentElement), cool);
    /* THE WORLD'S FILM ON THE BODY. Founder, 2026-10-15, of the waiting
       page's creature beside the home screen's: "use exact same code". The
       world bakes its creature with this grain; without it a page's creature
       is the same shape in a smoother, whiter material. */
    const tile = rasterGrain(ramp.dorm);
    const grain = tile ? g.createPattern(tile, "repeat") : null;
    if (!pixel) {
      restPose(g, size, ramp, being, 1, dpr, grain);
      return;
    }
    /* Drawn whole, then stepped: the world quantises the BODY sprite, so the
       cells here are counted across the body, not across the padded box. */
    const sharp = document.createElement("canvas");
    sharp.width = node.width;
    sharp.height = node.height;
    const sg = sharp.getContext("2d");
    if (!sg) return;
    sg.scale(dpr, dpr);
    sg.translate(pad, pad);
    restPose(sg, size, ramp, being, 1, dpr, grain);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(pixelate(sharp, MACHINE_CELLS * (box / size)), 0, 0);
  }, [size, being, cool, pixel]);

  /* The element is the padded box too, so the drawing is not squashed back
     into `size` by CSS — which would reintroduce the crop as a scale. */
  const pad = Math.ceil(size * REST_BLEED);
  const box = size + pad * 2;
  return (
    <span className="waka-companion" style={{ ["--waka-companion-size" as string]: `${box}px` }}>
      <canvas
        ref={canvas}
        className="waka-companion-body"
        style={{ width: box, height: box }}
        /* The world's canvas is unlabelled by a standing founder decision
           because it is a whole scene. This is one fixed illustration of one
           thing, so it can say what it is in a word, and does. */
        role="img"
        aria-label={label}
      />
    </span>
  );
}
