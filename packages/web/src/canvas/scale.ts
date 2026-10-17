/**
 * HOW MANY REAL PIXELS THE WORLD IS DRAWN AT — asked in one place.
 *
 * Founder, 2026-09-08, from a phone: "the quality of the agent is super broken
 * and blurry. Like the character I mean."
 *
 * MEASURED, on a 393x852 phone at devicePixelRatio 3: the canvas element's
 * backing store was 786x1704. A ratio of 2 against a 393-wide box, on a screen
 * whose ratio is 3 — so the compositor took every pixel the world drew and
 * stretched it by half again on the way to the glass. Not the character alone:
 * every orb, every gradient, every edge in the product. The character is
 * simply the largest smoothly-shaded thing on screen, so it is where a
 * one-and-a-half-times upscale becomes visible as blur.
 *
 * WHERE THE 2 CAME FROM. Three call sites in `Home.tsx` each said
 * `Math.min(window.devicePixelRatio || 1, 2)` — the palette bake, the image
 * sprites, and the canvas resize. A cap written to bound how much fill the
 * frame loop pays for.
 *
 * WHY IT BOUNDED NOTHING. The cost of a frame is backing-store PIXELS, and a
 * bare DPR cap does not bound those — the viewport does. Under the old rule a
 * 1440x900 laptop at DPR 2 was already drawing 5.2 megapixels a frame and had
 * been for the product's whole life. The phone the founder was holding was
 * held to 1.3 — a quarter of the laptop's work — though its own ratio asks
 * for only 3.0. The cap was not protecting the phone from doing too much
 * work; it was stopping it from doing a quarter as much as a laptop does, and
 * charging it the blur for the privilege.
 *
 * SO THE RULE IS THE DEVICE'S OWN SCALE, WITH A CEILING ON PIXELS.
 *
 *   - Draw at `devicePixelRatio`, which is what "sharp" means: one drawn pixel
 *     per physical pixel, no resample anywhere in the path.
 *   - Never above 3. Above that the returns are invisible and the fill is not:
 *     3 is where every shipping phone tops out, and a device claiming 4 is
 *     asking for 78% more fill than 3 to place detail below the eye's floor.
 *   - And never past `CEILING` megapixels — EXCEPT that the ceiling may never
 *     lower a surface below the scale the old rule already gave it. That
 *     exception is the whole correctness of this file and it was missing from
 *     the first version, which is worth writing down: `CEILING` alone made a
 *     DPR-2 window softer as soon as it grew past ~4Mpx of CSS area, so a Pro
 *     Display XDR at its default 3008x1692 went from 2.000 to 1.773 and an 8K
 *     desktop to 1.389. That is the founder's phone defect relocated to a
 *     desk — the same blur, bought with the same reasoning. The floor of
 *     `min(dpr, 2)` makes the guarantee real: this file can only ever hand
 *     back a scale greater than or equal to what shipped before it.
 *
 * `dprOf` takes the ratio as an argument rather than reading `window` so the
 * arithmetic can be tested without a browser; `renderScale` is the one every
 * call site uses.
 */

/** Above this, more pixels buy nothing an eye can find. */
export const MAX_SCALE = 3;

/**
 * The most backing-store pixels one canvas may hold, in megapixels — a
 * ceiling on GROWTH, never a reason to shrink below what already shipped.
 *
 * 16 sits above a 5K desktop at DPR 2 (14.7Mpx) and below a 6K one (20.4Mpx),
 * so on its own it WOULD step a 6K window down. `FLOOR` is what stops that:
 * the ceiling only ever bounds the extra scale this file is willing to hand
 * out, and the old rule's answer is the worst any surface can be given.
 */
export const CEILING = 16;

/**
 * The scale this file may never go below — the rule it replaced.
 *
 * Every surface that renders sharp today does so at `min(dpr, 2)`. Making any
 * of them softer would be a regression dressed as a budget, so the ceiling is
 * clamped up to this before it is applied.
 */
export const FLOOR = 2;

/**
 * The scale to draw a `w`x`h` CSS-pixel surface at, given a device ratio.
 *
 * @param w   surface width in CSS pixels
 * @param h   surface height in CSS pixels
 * @param dpr the device's own ratio; a missing or nonsense value reads as 1
 */
export function dprOf(w: number, h: number, dpr: number): number {
  const asked = Number.isFinite(dpr) && dpr > 0 ? Math.min(dpr, MAX_SCALE) : 1;
  const area = Math.max(w, 1) * Math.max(h, 1);
  /* the largest scale whose backing store still fits under the ceiling */
  const fits = Math.sqrt((CEILING * 1_000_000) / area);
  /* THE CEILING MAY BOUND GROWTH AND NOTHING ELSE. Clamped up to FLOOR, so a
     surface the old rule drew at 2 is never handed less than 2 — see the
     header. Then never below 1: a world drawn under CSS resolution is a bug,
     not a budget. */
  return Math.max(1, Math.min(asked, Math.max(FLOOR, fits)));
}

/**
 * ═══ AND THE ZOOM, WHICH THE RATIO DOES NOT REPORT ═══════════════════════
 *
 * Founder, 2026-10-17: "the 화질 of the character breaks in mobile setting."
 * A phone's pinch — and the zoom iOS applies by itself when a small field
 * takes focus — magnifies the composited page while `devicePixelRatio` and
 * layout stay exactly where they were. Text re-rasterises at the new scale;
 * a canvas is a bitmap and is simply stretched. Measured in Chromium at
 * 390x844 DPR 3 with the page zoomed 1.067x, the steepest luminance step
 * across the creature's silhouette fell 153 -> 96. A desktop's ctrl-plus
 * changes the ratio itself, which is why this was only ever a phone's defect.
 *
 * So the zoom, `visualViewport.scale`, multiplies the scale — only when it is
 * above 1 (zoomed OUT is no reason to draw less than the screen asks for),
 * and only on top of what `dprOf` already gives, so nothing at rest moves.
 *
 * THE CAP IS THE SAME `CEILING`, AND ON A PHONE IT IS GENEROUS ON PURPOSE.
 * A 390x844 world is 2.96Mpx at DPR 3; at zoom 2 it is 11.8Mpx, four times
 * the fill and still under 16. Past that the zoom buys pixels the screen
 * cannot show — at zoom 3 it shows a ninth of the canvas — so growth stops at
 * `CEILING` (64MB of backing store, well inside what iOS allows a page) and
 * the deepest zooms are slightly soft rather than a phone out of memory. The
 * extra fill is paid only while the person is zoomed in, which is a moment
 * they chose, not a resting state. And it never goes below `dprOf`'s answer:
 * the ceiling bounds the growth the zoom asks for, exactly as it bounds the
 * ratio's.
 *
 * @param zoom `visualViewport.scale`; a missing, nonsense or sub-1 value is 1
 */
export function scaleOf(w: number, h: number, dpr: number, zoom: number): number {
  const base = dprOf(w, h, dpr);
  if (!Number.isFinite(zoom) || zoom <= 1) return base;
  const fits = Math.sqrt((CEILING * 1_000_000) / (Math.max(w, 1) * Math.max(h, 1)));
  return Math.max(base, Math.min(base * zoom, fits));
}

/**
 * The zoom, quantised UP to a quarter. A pinch reports a continuous scale and
 * every change of render scale re-bakes the world's sprites, so the scale
 * moves in steps nobody can tell apart — and up, so a step is never softer
 * than the zoom it stands for.
 */
const ZOOM_STEP = 0.25;
export function zoomStep(z: number): number {
  return Number.isFinite(z) && z > 1 ? Math.ceil(z / ZOOM_STEP - 1e-6) * ZOOM_STEP : 1;
}
function zoomNow(): number {
  return typeof window === "undefined" ? 1 : zoomStep(window.visualViewport?.scale ?? 1);
}

/** The scale for the window the product is actually running in. */
export function renderScale(w: number, h: number): number {
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio;
  return scaleOf(w, h, dpr, zoomNow());
}

/**
 * How long a pinch has to rest before the canvases re-size for it. A pinch
 * fires `resize` on every frame of the gesture, and a re-size is a new
 * backing store and a re-bake; doing that mid-gesture would stutter the very
 * motion the person is making, for pixels they cannot see yet.
 */
const ZOOM_SETTLE_MS = 160;

/**
 * Calls `onChange` once the zoom has settled on a different step, and returns
 * the unsubscribe. Only `visualViewport` reports a pinch — the window does not
 * resize — and every real resize is already the `ResizeObserver`'s.
 */
export function onZoomChange(onChange: () => void): () => void {
  const vv = typeof window === "undefined" ? null : window.visualViewport;
  if (!vv) return () => {};
  let last = zoomNow();
  let timer = 0;
  const settle = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const now = zoomNow();
      if (now === last) return;
      last = now;
      onChange();
    }, ZOOM_SETTLE_MS);
  };
  vv.addEventListener("resize", settle);
  return () => {
    window.clearTimeout(timer);
    vv.removeEventListener("resize", settle);
  };
}
