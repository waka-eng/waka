/**
 * THE WORLD IS DRAWN AT THE SCREEN'S OWN RESOLUTION.
 *
 * The defect this holds shut, measured on 2026-09-08: a 393x852 phone at
 * devicePixelRatio 3 was given a 786x1704 backing store, so the compositor
 * upscaled every drawn pixel by half again on the way to the glass. The
 * founder read it off the character — "super broken and blurry" — which is
 * where a 1.5x resample first becomes visible, but it was the whole world.
 *
 * The three cases below are the three that matter: the phone that reported
 * it, the desktop that must not be made softer by the fix, and the ceiling
 * that keeps the fix from being a licence for an unbounded backing store.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). Nothing. `dprOf` takes the ratio as an
 * argument precisely so this arithmetic can be checked without a browser to
 * pretend to be one.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CEILING, FLOOR, MAX_SCALE, dprOf } from "../src/canvas/scale";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");

describe("render scale", () => {
  /**
   * THE ARITHMETIC IS NOT THE GATE — the call sites are.
   *
   * Everything else in this file exercises the pure helper, which means all of
   * it stays green if somebody writes `Math.min(window.devicePixelRatio, 2)`
   * back into `Home.tsx` tomorrow. That is precisely the defect this change
   * exists to remove, so the rule is stated where it can be broken: the
   * device's own ratio is read in ONE file, and the world's three canvas
   * sites go through it.
   */
  it("reads devicePixelRatio in one place, and the world goes through it", () => {
    const offenders: string[] = [];
    const walk = (dir: string): string[] => {
      const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
      const out: string[] = [];
      for (const name of readdirSync(dir)) {
        const full = resolve(dir, name);
        if (statSync(full).isDirectory()) out.push(...walk(full));
        else if (/\.tsx?$/.test(name)) out.push(full);
      }
      return out;
    };
    for (const file of walk(SRC)) {
      if (file.endsWith(`canvas${"/"}scale.ts`)) continue;
      const text = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/\/\/[^\n]*/g, " ");
      if (/devicePixelRatio/.test(text)) offenders.push(file.slice(SRC.length + 1));
    }
    expect(offenders, `devicePixelRatio belongs to canvas/scale.ts: ${offenders.join(", ")}`).toEqual(
      [],
    );
    /* TWO, and it was three until the orbs stopped carrying photographs.
       The third site baked an attachment's og:image into circle-clipped
       sprites, and that whole path went out with the LinkedIn logo — so the
       canvas sites are now the palette bake and the resize. Lowered rather
       than loosened: the number is the count of places that ask the device
       how sharp it is, and it should be checked, not waved at. */
    /* THE TWO SITES ARE IN TWO FILES SINCE 2026-10-12 and are the same two
       calls: the frame effect left `pages/Home.tsx` for `canvas/simulation.ts`
       (the review's finding 7 cut) and took the RESIZE site with it, leaving
       the palette bake behind. Counted over both, because the claim is about
       how many places ask the device how sharp it is — not about which file
       they sit in. Pinning it to one file would have let the other grow a
       `Math.min(window.devicePixelRatio, 2)` with this gate still green, which
       is the whole defect it exists to stop. */
    const sites = ["pages/Home.tsx", "canvas/simulation.ts"]
      .map((f) => readFileSync(resolve(SRC, f), "utf8").match(/renderScale\(/g)?.length ?? 0)
      .reduce((a, b) => a + b, 0);
    expect(sites).toBeGreaterThanOrEqual(2);
  });

  it("gives a phone its own three, which is the bug that was reported", () => {
    expect(dprOf(393, 852, 3)).toBe(3);
    /* and the backing store that follows from it is smaller than what a
       retina laptop has always drawn — the old cap was not protecting
       anything, it was only costing sharpness */
    const phone = 393 * 852 * 3 * 3;
    const laptop = 1440 * 900 * 2 * 2;
    expect(phone).toBeLessThan(laptop);
  });

  it("changes nothing for a screen that was already sharp", () => {
    /* every one of these renders at its own ratio today and must keep it */
    expect(dprOf(1100, 780, 1)).toBe(1);
    expect(dprOf(1100, 780, 2)).toBe(2);
    expect(dprOf(1440, 900, 2)).toBe(2);
    expect(dprOf(2560, 1440, 2)).toBe(2);
  });

  it("stops at three, however much a device claims", () => {
    expect(dprOf(393, 852, 4)).toBe(MAX_SCALE);
    expect(dprOf(393, 852, 8)).toBe(MAX_SCALE);
  });

  it("never trusts a ratio that is not a number", () => {
    expect(dprOf(393, 852, 0)).toBe(1);
    expect(dprOf(393, 852, -2)).toBe(1);
    expect(dprOf(393, 852, Number.NaN)).toBe(1);
    /* Infinity is not a big ratio, it is a broken one — it reads as "no
       answer" and takes the floor, not the ceiling */
    expect(dprOf(393, 852, Number.POSITIVE_INFINITY)).toBe(1);
  });

  /**
   * THE PROPERTY THAT MAKES THIS FILE SAFE, and the one the first version
   * shipped without.
   *
   * `CEILING` on its own made a DPR-2 window softer as soon as its CSS area
   * passed ~4Mpx: a Pro Display XDR at its default 3008x1692 went 2.000 ->
   * 1.773, an 8K desktop 2.000 -> 1.389. That is the founder's phone defect
   * relocated to a desk. Caught in review, not by a test — so it gets a test,
   * and the test is a property over a table of real displays rather than one
   * more example.
   */
  it("is never softer than the rule it replaced, on any surface", () => {
    const SURFACES: Array<[string, number, number, number]> = [
      ["MacBook Air 13", 1440, 900, 2],
      ["MacBook Pro 14", 1512, 982, 2],
      ["iMac 5K, default", 2560, 1440, 2],
      ["Studio Display, More Space", 3200, 1800, 2],
      ["Pro Display XDR, default", 3008, 1692, 2],
      ["8K desktop", 3840, 2160, 2],
      ["a low-dpi laptop", 1440, 900, 1],
      ["the phone that reported it", 393, 852, 3],
      ["a tablet", 768, 1024, 2],
    ];
    for (const [name, w, h, dpr] of SURFACES) {
      const was = Math.min(dpr, FLOOR);
      expect(dprOf(w, h, dpr), `${name} got softer`).toBeGreaterThanOrEqual(was);
      expect(dprOf(w, h, dpr), `${name} exceeds its own screen`).toBeLessThanOrEqual(dpr);
    }
  });

  it("bounds growth, and only growth", () => {
    /* the ceiling still bites where it is meant to — above FLOOR, on a
       surface asking for more than it can hold */
    expect(dprOf(4000, 3000, 3)).toBeLessThan(MAX_SCALE);
    expect(dprOf(4000, 3000, 3)).toBe(FLOOR);
    /* and it can never bite BELOW the floor, however absurd the surface */
    expect(dprOf(40000, 30000, 3)).toBe(FLOOR);
    expect(CEILING).toBeGreaterThan(2560 * 1440 * 2 * 2 / 1_000_000);
  });

  it("steps down rather than allocating a surface nothing can hold", () => {
    /* a hypothetical 4000x3000 window at 3 would ask for 108 megapixels */
    const huge = dprOf(4000, 3000, 3);
    expect(huge).toBeLessThan(MAX_SCALE);
    /* and it never goes below the rule it replaced, which is a stronger
       promise than "never below CSS resolution" and the one that matters */
    expect(dprOf(40000, 30000, 3)).toBe(FLOOR);
  });
});
