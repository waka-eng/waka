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

/** The scale for the window the product is actually running in. */
export function renderScale(w: number, h: number): number {
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio;
  return dprOf(w, h, dpr);
}
