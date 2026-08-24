/**
 * THE SKY'S LINE DOWN TO THE GROUND, AND THE ONE CASE IT EXISTS FOR.
 *
 * goal: no-quiet-corners, Phase 8 — "the drawn sky→field root lines", built on
 * the founder's ruling that a sky→field root is a different sentence from the
 * orb-to-orb connections they struck out ("sky-to-field is different",
 * 2026-08-24).
 *
 * The case that matters is the one a naive cull deletes. A root spends almost
 * all of its life with the cloud far above the viewport and the memory far
 * below it — that is the NORMAL case, because the sky and the field are a
 * screen apart and the line's whole job is to be the thing crossing between
 * them. Cull by "is either end on screen" and every root that matters
 * disappears while the harmless ones survive, and the feature looks like it
 * works from headquarters and does nothing anywhere else.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): the 2D context, and nothing else.
 * `paintRoots` is pure paint — every position, colour and easing value is
 * handed to it — so the only thing between it and an assertion is the canvas
 * API. The stub records the calls rather than pretending to rasterize, because
 * what is being claimed here is which geometry was submitted and under which
 * compositing mode; a real canvas would answer the same questions in pixels
 * that a jsdom canvas does not produce anyway. Nothing else in the file is
 * replaced: the ramp is a real ramp shape and the module under test is
 * imported directly.
 *
 * WHAT IT DELIBERATELY DOES NOT CLAIM. Whether a root READS as light rather
 * than as a wire is the founder's eye, and Phase 8's gate says so. This file
 * holds the geometry and the compositing; it does not grade the picture.
 */
import { describe, expect, it } from "vitest";

import { type Ramp } from "../src/lib/appearance";
import {
  paintRoots,
  ROOT_FLOOR,
  ROOT_PEAK_ALPHA,
  type RootTarget,
} from "../src/space/signal/roots-paint";

const RAMP: Ramp = {
  live: [255, 242, 220],
  liveEdge: [247, 234, 212],
  liveBloom: [255, 237, 208],
  fade: [185, 196, 209],
  dorm: [40, 50, 63],
  dust: [205, 216, 230],
  bodyLit: [230, 230, 230],
  bodyShade: [120, 120, 120],
};

interface Stroke {
  from: [number, number];
  to: [number, number];
  width: number;
  composite: string;
  stops: Array<[number, string]>;
}

/** A context that remembers what it was asked to draw. */
function recorder() {
  const strokes: Stroke[] = [];
  let composite = "source-over";
  let width = 1;
  let path: Array<[number, number]> = [];
  let stops: Array<[number, string]> = [];
  const ctx = {
    get globalCompositeOperation() {
      return composite;
    },
    set globalCompositeOperation(v: string) {
      composite = v;
    },
    get lineWidth() {
      return width;
    },
    set lineWidth(v: number) {
      width = v;
    },
    lineCap: "butt",
    globalAlpha: 1,
    fillStyle: null as unknown,
    strokeStyle: null as unknown,
    save() {},
    restore() {
      composite = "source-over";
    },
    createLinearGradient() {
      const mine: Array<[number, string]> = [];
      stops = mine;
      return {
        addColorStop(offset: number, color: string) {
          mine.push([offset, color]);
        },
      };
    },
    beginPath() {
      path = [];
    },
    moveTo(x: number, y: number) {
      path.push([x, y]);
    },
    lineTo(x: number, y: number) {
      path.push([x, y]);
    },
    stroke() {
      strokes.push({
        from: path[0] ?? [NaN, NaN],
        to: path[1] ?? [NaN, NaN],
        width,
        composite,
        stops: [...stops],
      });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, strokes };
}

const VIEW = { w: 1000, h: 800, reduced: false };
const CAM = { x: 0, y: 0 };
const target = (x: number, y: number, alivePow = 1): RootTarget => ({ x, y, alivePow });

/** The alpha of a stop, parsed back out of the rgba string it was written as. */
const alphaOf = (stop: string): number => Number(stop.slice(stop.lastIndexOf(",") + 1, -1));

describe("a pattern's roots", () => {
  it("draws one line per memory it stands on", () => {
    const { ctx, strokes } = recorder();
    paintRoots({
      ctx,
      ramp: RAMP,
      from: { x: 500, y: 100, r: 40 },
      to: [target(300, 600), target(700, 650), target(500, 700)],
      cam: CAM,
      view: VIEW,
      ease: 1,
    });
    expect(strokes.length).toBe(3);
  });

  it("keeps the line that crosses the frame with BOTH ends outside it", () => {
    /* THE CASE THE FEATURE IS FOR. Reading a pattern from the sky puts the
       cloud above the top edge and the memory below the bottom one, and a cull
       that asks "is either end visible" throws away exactly this line while
       keeping every line that did not need drawing. */
    const { ctx, strokes } = recorder();
    paintRoots({
      ctx,
      ramp: RAMP,
      from: { x: 500, y: -900, r: 40 },
      to: [target(520, 1700)],
      cam: CAM,
      view: VIEW,
      ease: 1,
    });
    expect(
      strokes.length,
      "a root from a cloud above the frame to a memory below it is the normal " +
        "case, not an edge case — culling it is the feature not working",
    ).toBe(1);
  });

  it("drops a line whose whole length is off one edge — and only then", () => {
    /* The cull is deliberately the weakest one that is still correct: BOTH
       ends past the SAME edge. Anything stronger throws away a line that
       crosses the frame diagonally, which is most of them once the camera is
       between the two layers rather than at one of them. */
    const above = recorder();
    paintRoots({
      ctx: above.ctx,
      ramp: RAMP,
      from: { x: 500, y: -900, r: 40 },
      to: [target(520, -400)],
      cam: CAM,
      view: VIEW,
      ease: 1,
    });
    expect(above.strokes.length, "cloud and memory both above the frame").toBe(0);

    const left = recorder();
    paintRoots({
      ctx: left.ctx,
      ramp: RAMP,
      from: { x: -700, y: 100, r: 40 },
      to: [target(-800, 300)],
      cam: CAM,
      view: VIEW,
      ease: 1,
    });
    expect(left.strokes.length, "both off the left edge").toBe(0);

    const across = recorder();
    paintRoots({
      ctx: across.ctx,
      ramp: RAMP,
      from: { x: 500, y: -900, r: 40 },
      to: [target(-800, 300), target(2000, 300)],
      cam: CAM,
      view: VIEW,
      ease: 1,
    });
    expect(
      across.strokes.length,
      "a diagonal from above the frame to beside it still passes THROUGH it, " +
        "and dropping it is the over-eager cull this case exists to forbid",
    ).toBe(2);
  });

  it("leaves the cloud at its edge, not from inside its body", () => {
    /* A line that begins at the centre is drawn ON the cloud, which reads as
       something painted over it rather than as something leaving it. */
    const { ctx, strokes } = recorder();
    const r = 40;
    paintRoots({
      ctx,
      ramp: RAMP,
      from: { x: 500, y: 100, r },
      to: [target(500, 700)],
      cam: CAM,
      view: VIEW,
      ease: 1,
    });
    expect(strokes[0]?.from[0]).toBeCloseTo(500, 6);
    expect(strokes[0]?.from[1], "straight down, so the start is exactly r below").toBeCloseTo(
      100 + r,
      6,
    );
  });

  it("draws in WORLD space and culls in screen space — the two are not the same", () => {
    /* THE BUG THIS CASE WAS WRITTEN AFTER, and it was in this file too.
       The canvas already carries the camera: the frame clears with
       `clearRect(cam.x, cam.y, w, h)` and the mote pass ADDS the camera to
       place a mote. So a world coordinate is drawn as it stands. Subtracting
       the camera here put every line one whole viewport away from where it
       belonged — and the first version of this test asserted the subtraction,
       so it agreed with the bug and stayed green while the browser showed
       nothing at all. Only the cull converts, because only the cull is asking
       a question about the screen. */
    const { ctx, strokes } = recorder();
    paintRoots({
      ctx,
      ramp: RAMP,
      from: { x: 500, y: 100, r: 0 },
      to: [target(500, 700)],
      cam: { x: 120, y: 60 },
      view: VIEW,
      ease: 1,
    });
    expect(strokes[0]?.from, "the cloud, where the cloud is").toEqual([500, 100]);
    expect(strokes[0]?.to, "the memory, where the memory is").toEqual([500, 700]);

    /* and the cull still reads the camera: park it so both ends are off the
       same edge of the SCREEN while their world coordinates are unchanged */
    const off = recorder();
    paintRoots({
      ctx: off.ctx,
      ramp: RAMP,
      from: { x: 500, y: 100, r: 0 },
      to: [target(500, 700)],
      cam: { x: 0, y: 900 },
      view: VIEW,
      ease: 1,
    });
    expect(
      off.strokes.length,
      "with the camera nine hundred below, both ends are above the frame",
    ).toBe(0);
  });

  it("states its own alpha instead of inheriting the pass before it", () => {
    /* THE REASON THE WHOLE PASS WAS INVISIBLE WHILE EVERY NUMBER SAID IT WAS
       WORKING. The mote pass immediately before this one sets `globalAlpha`
       per mote and never puts it back, and `save()` preserves what it
       inherited rather than resetting it — so these lines were stroked at
       whatever fraction the last mote happened to want. */
    const { ctx } = recorder();
    (ctx as unknown as { globalAlpha: number }).globalAlpha = 0.02;
    paintRoots({
      ctx,
      ramp: RAMP,
      from: { x: 500, y: 100, r: 10 },
      to: [target(500, 700)],
      cam: CAM,
      view: VIEW,
      ease: 1,
    });
    expect((ctx as unknown as { globalAlpha: number }).globalAlpha).toBe(1);
  });

  it("is additive light rather than a stroke laid over the world", () => {
    const { ctx, strokes } = recorder();
    paintRoots({
      ctx,
      ramp: RAMP,
      from: { x: 500, y: 100, r: 10 },
      to: [target(500, 700)],
      cam: CAM,
      view: VIEW,
      ease: 1,
    });
    expect(strokes[0]?.composite).toBe("lighter");
    expect(
      strokes[0]?.width,
      "one device pixel: wider and it stops being light and starts being a rule " +
        "drawn on the world, thinner and the anti-aliasing spends most of an " +
        "already low alpha on nothing",
    ).toBeLessThanOrEqual(1);
  });

  it("falls away from the cloud — the line says which way, the orb says how much", () => {
    const { ctx, strokes } = recorder();
    paintRoots({
      ctx,
      ramp: RAMP,
      from: { x: 500, y: 100, r: 10 },
      to: [target(500, 700)],
      cam: CAM,
      view: VIEW,
      ease: 1,
    });
    const stops = strokes[0]!.stops;
    expect(stops.length).toBeGreaterThan(2);
    const alphas = stops.map(([, color]) => alphaOf(color));
    for (let i = 1; i < alphas.length; i += 1) {
      expect(
        alphas[i],
        "a root that arrived at full strength would draw a second ring around " +
          "a memory the field has already answered for",
      ).toBeLessThan(alphas[i - 1]!);
    }
    expect(alphas[0]).toBeCloseTo(ROOT_PEAK_ALPHA, 6);
  });

  it("dims a root that carries less, and never puts it out", () => {
    const bright = recorder();
    const dim = recorder();
    const shared = {
      ramp: RAMP,
      from: { x: 500, y: 100, r: 10 },
      cam: CAM,
      view: VIEW,
      ease: 1,
    };
    paintRoots({ ...shared, ctx: bright.ctx, to: [target(500, 700, 1)] });
    paintRoots({ ...shared, ctx: dim.ctx, to: [target(500, 700, 0)] });

    const head = (r: ReturnType<typeof recorder>) => alphaOf(r.strokes[0]!.stops[0]![1]);
    expect(head(dim)).toBeLessThan(head(bright));
    expect(
      head(dim),
      "fading never deletes: a dormant memory's root is dimmer and still there",
    ).toBeCloseTo(ROOT_PEAK_ALPHA * ROOT_FLOOR, 6);
  });

  it("says nothing while the reading is closed", () => {
    const { ctx, strokes } = recorder();
    const shared = {
      ramp: RAMP,
      from: { x: 500, y: 100, r: 10 },
      cam: CAM,
      view: VIEW,
    };
    paintRoots({ ...shared, ctx, to: [target(500, 700)], ease: 0 });
    expect(strokes.length, "no reading, no roots").toBe(0);
    paintRoots({ ...shared, ctx, to: [], ease: 1 });
    expect(strokes.length, "a pattern standing on nothing draws nothing").toBe(0);
  });

  it("comes up with the reading rather than switching on", () => {
    const part = recorder();
    const whole = recorder();
    const shared = {
      ramp: RAMP,
      from: { x: 500, y: 100, r: 10 },
      to: [target(500, 700)],
      cam: CAM,
      view: VIEW,
    };
    paintRoots({ ...shared, ctx: part.ctx, ease: 0.4 });
    paintRoots({ ...shared, ctx: whole.ctx, ease: 1 });
    const head = (r: ReturnType<typeof recorder>) => alphaOf(r.strokes[0]!.stops[0]![1]);
    expect(head(part)).toBeCloseTo(head(whole) * 0.4, 6);
  });
});
