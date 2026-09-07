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
 * capped at 3.0. The cap was not protecting the phone from doing too much
 * work; it was stopping the phone from doing a third as much work as a laptop
 * does, and charging it the blur for the privilege.
 *
 * SO THE RULE IS THE DEVICE'S OWN SCALE, WITH A CEILING ON PIXELS.
 *
 *   - Draw at `devicePixelRatio`, which is what "sharp" means: one drawn pixel
 *     per physical pixel, no resample anywhere in the path.
 *   - Never above 3. Above that the returns are invisible and the fill is not:
 *     3 is where every shipping phone tops out, and a device claiming 4 is
 *     asking for 78% more fill than 3 to place detail below the eye's floor.
 *   - And never past `CEILING` megapixels, whatever the ratio. This is the
 *     bound the old rule was reaching for and missed. It is set ABOVE what a
 *     5K desktop at DPR 2 already draws (14.7Mpx), so no surface that renders
 *     sharp today is made softer by this file — the ceiling only catches
 *     surfaces nothing has ever rendered, where a step down beats a stall.
 *
 * `dprOf` takes the ratio as an argument rather than reading `window` so the
 * arithmetic can be tested without a browser; `renderScale` is the one every
 * call site uses.
 */

/** Above this, more pixels buy nothing an eye can find. */
export const MAX_SCALE = 3;

/**
 * The most backing-store pixels one canvas may hold, in megapixels.
 *
 * 16 is chosen against what already ships, not against a benchmark: a 2560x1440
 * display at DPR 2 draws 14.7Mpx today and always has. A ceiling below that
 * would make a real desktop blurrier to fix a phone, which is a trade nobody
 * asked for. Above 16 the surface is larger than any display this product has
 * been opened on, and stepping down is the kinder failure.
 */
export const CEILING = 16;

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
  /* never below 1: a world drawn at less than CSS resolution is a bug, not a
     budget, and every viewport this product opens in is far inside the
     ceiling anyway */
  return Math.max(1, Math.min(asked, fits));
}

/** The scale for the window the product is actually running in. */
export function renderScale(w: number, h: number): number {
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio;
  return dprOf(w, h, dpr);
}
