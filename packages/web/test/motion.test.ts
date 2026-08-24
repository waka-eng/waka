/**
 * MOTION EXPLAINS, NEVER DECORATES — the pinnable half.
 *
 * goal: no-quiet-corners, Phase 8. Whether the star's turn FEELS right is
 * the founder's call, live on their own machine — taste is not delegable,
 * and the phase holds at that gate. What a test can hold is the envelope
 * the founder's law states: the turn runs once on appearance (never loops),
 * lands inside the 0.4–0.8 second band, and stays home entirely under
 * prefers-reduced-motion while the state change itself still shows.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing — the stylesheet is read as
 * text, because the claim is about what the stylesheet commits to.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const CSS = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../src/styles/home.css"),
  "utf8",
);

describe("the star's turn", () => {
  it("runs once, inside the founder's band, and never loops", () => {
    const rule = CSS.match(/\.jar-star\s*\{([^}]*)\}/);
    expect(rule, ".jar-star has no rule").not.toBeNull();
    const animation = rule![1]!.match(/animation:\s*([^;]+);/);
    expect(animation, "the star does not turn").not.toBeNull();

    const value = animation![1]!;
    const duration = value.match(/([\d.]+)s/);
    expect(duration).not.toBeNull();
    const seconds = Number.parseFloat(duration![1]!);
    expect(seconds).toBeGreaterThanOrEqual(0.4);
    expect(seconds).toBeLessThanOrEqual(0.8);
    expect(value.includes("infinite"), "motion explains once; looping is decoration").toBe(
      false,
    );
    expect(CSS.includes("@keyframes jar-star-turn"), "the named turn exists").toBe(true);
  });

  it("stays home under prefers-reduced-motion", () => {
    const reduced = CSS.match(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^{]*\.jar-star\s*\{([^}]*)\}/,
    );
    expect(reduced, "no reduced-motion rule for the star").not.toBeNull();
    expect(reduced![1]!).toContain("animation: none");
  });
});
