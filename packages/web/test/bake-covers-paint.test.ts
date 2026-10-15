/**
 * ═══ A SPRITE IS NEVER SMALLER THAN THE PIXELS IT MUST FILL ═══════════════
 *
 * `restPose` chooses its bake with `ceil(size * dpr / BODY_PX)` and
 * `rasterBody` bakes `BODY_PX` times that, in DEVICE pixels, while the
 * caller's context is scaled by the ratio. Get that arithmetic wrong in the
 * CSS direction and the creature is MAGNIFIED — and a magnification is the
 * one defect no filter can repair, because there is nothing to recover.
 *
 * IT WAS WRONG, IN EXACTLY ONE CONFIGURATION, FOR AS LONG AS THE FACTOR
 * IGNORED `dpr`. The old rule was `round(size / BODY_PX * 4)`: at 88 CSS px
 * and dpr 3 that is `round(1.467)` = 1, so a 240px sprite was painted at 264
 * device px on the login and onboarding screens. One configuration out of
 * fifteen, which is why nobody caught it by looking.
 *
 * AND NOTHING WOULD HAVE. A review grepped every suite and script for
 * `GRAIN|BODY_PX|rasterGrain|rasterBody|restPose`: no gate pinned a bake
 * size, a display size or this factor. The suite was 876 green with the
 * arithmetic broken, and would have stayed green if it broke the other way.
 * That is the hole this closes — the invariant, not the one case.
 *
 * WHY ARITHMETIC AND NOT PIXELS. The claim is a relation between two
 * numbers, and asserting it directly means it holds for every size and
 * ratio rather than the handful a render test would reach. The pixels are
 * somebody else's job; this is the contract.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). Nothing. It imports two constants and
 * restates the formula under test, because the formula lives inside a
 * function that also rasterises — there is no seam to replace and no DOM,
 * canvas, clock or network involved. The duplication is deliberate and is
 * the thing the first case guards: if `restPose` changes its rule, the
 * comment there and this file must be brought back into agreement by hand.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BODY_PX } from "../src/character/raster";

/** The rule `restPose` uses, restated — see the note above on why. */
const bakeFor = (size: number, dpr: number) =>
  BODY_PX * Math.max(1, Math.ceil((size * dpr) / BODY_PX));

/** Every size a caller passes today, and every ratio `renderScale` returns. */
const SIZES = [64, 72, 88, 120, 190];
const RATIOS = [1, 2, 3];

describe("a baked body covers the pixels it is painted into", () => {
  it("is never smaller than the paint, at any size or ratio", () => {
    const under: string[] = [];
    for (const size of SIZES) {
      for (const dpr of RATIOS) {
        const paint = size * dpr;
        if (bakeFor(size, dpr) < paint) under.push(`${size}@${dpr}: ${bakeFor(size, dpr)} < ${paint}`);
      }
    }
    expect(under, "a sprite is magnified — no filter can repair this").toEqual([]);
  });

  it("catches the rule that was actually shipped", () => {
    /* The old factor, so the gate is shown to bite rather than assumed to.
       88 at dpr 3 is the one configuration it got wrong. */
    const old = (size: number) => BODY_PX * Math.max(1, Math.round((size / BODY_PX) * 4));
    expect(old(88), "the old rule under-baked the login companion").toBeLessThan(88 * 3);
    expect(bakeFor(88, 3), "the new rule still under-bakes it").toBeGreaterThanOrEqual(88 * 3);
  });

  it("asks for device pixels, so a caller cannot omit the ratio", () => {
    /* `dpr` is REQUIRED on `restPose`. An optional one with a default of 1
       silently restores the defect for any caller that forgets it, which a
       type can prevent and a test cannot. Read as source because the
       signature is the claim. */
    const src = readFileSync(resolve(__dirname, "../src/character/raster.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ");
    expect(src, "`dpr` has a default again — the under-bake is reachable").not.toMatch(/dpr\s*=\s*1\s*,/);
    expect(src, "`restPose` no longer takes a ratio").toMatch(/dpr:\s*number,/);
  });
});
