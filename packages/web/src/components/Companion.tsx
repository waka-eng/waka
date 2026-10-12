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

import { OWNER_BEING } from "../character/body";
import { restPose } from "../character/raster";
import { renderScale } from "../canvas/scale";
import { parseColor } from "../canvas/sprites";
import type { Ramp } from "../lib/appearance";

/**
 * The ramp the drawing needs, read off the root exactly the way
 * `buildPalette` reads it — so a page's creature is lit by the stylesheet
 * rather than by a copy of its values kept here, and the warm/cold decision
 * stays in one place. The fallbacks match `home.css`; a cold one would draw
 * a cold companion, which is the failure the palette note in
 * `canvas/palette.ts` warns about.
 */
function rampFromCss(root: HTMLElement): Ramp {
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
    bodyLit: v("--jar-body-lit", "#f7f1e4"),
    bodyShade: v("--jar-body-shade", "#a49b8c"),
  };
}

export function Companion({ size = 72 }: { size?: number }): JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    /* THROUGH `renderScale`, BECAUSE `devicePixelRatio` HAS ONE HOME.
       `render-scale.test.ts` holds that line and caught this on the way in:
       a second reader of the ratio is a second thing that can disagree with
       the world about how sharp the creature should be. */
    const dpr = renderScale(size, size);
    node.width = Math.ceil(size * dpr);
    node.height = Math.ceil(size * dpr);
    const g = node.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, node.width, node.height);
    g.scale(dpr, dpr);
    /* FULLY LIT, ALWAYS. The world dims the creature to report how little is
       alive in your field — a reading of your material. A page is not a
       reading of anything, so a dim companion there would be saying
       something untrue about you. */
    restPose(g, size, rampFromCss(document.documentElement), OWNER_BEING, 1);
  }, [size]);

  return (
    <span className="waka-companion" style={{ ["--waka-companion-size" as string]: `${size}px` }}>
      <canvas
        ref={canvas}
        className="waka-companion-body"
        style={{ width: size, height: size }}
        /* The world's canvas is unlabelled by a standing founder decision
           because it is a whole scene. This is one fixed illustration of one
           thing, so it can say what it is in a word, and does. */
        role="img"
        aria-label="WAKA"
      />
    </span>
  );
}
