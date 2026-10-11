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
    /* `.jar-star-act::before`, not `.jar-star`. The star became a labelled
       verb and the bare-glyph class was left behind styled, gated and worn
       by nothing — so this suite was passing about an element that no
       longer rendered. Found by `e2e:dead-css`. */
    const rule = CSS.match(/\.jar-star-act::before\s*\{([^}]*)\}/);
    expect(rule, ".jar-star-act::before has no rule").not.toBeNull();
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
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^{]*\.jar-star-act::before\s*\{([^}]*)\}/,
    );
    expect(reduced, "no reduced-motion rule for the star").not.toBeNull();
    expect(reduced![1]!).toContain("animation: none");
  });
});

/**
 * ═══ A DESTINATION DOES NOT FADE IN OVER THE WORLD ═════════════════════
 *
 * Founder, with a screen recording: "stop blinking to show the now page
 * every time I move tabs."
 *
 * A fade-in was added to `.waka-page` on the reasoning that a destination
 * should arrive rather than appear. Measured on the move from Inspirations
 * to Chats, the incoming page sat at opacity 0, 0.21, 0.48, 0.73, reaching
 * 1 at 225ms — and a page at opacity 0 is a window onto whatever is behind
 * it, which for every destination is the WORLD. So the fade was not
 * softening an arrival, it was showing the Now screen for a fifth of a
 * second on every move between tabs.
 *
 * THERE IS NO SAFE VERSION OF IT, which is why this is a gate and not a
 * tuned duration: the only thing a destination can fade in from is the
 * world, so any entry animation that starts transparent reintroduces the
 * blink. The surfaces are listed by name because the next one added will
 * inherit the same ground and the same temptation.
 */
const CHROME = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../src/styles/chrome.css"),
  "utf8",
);

describe("moving between places", () => {
  it("never shows the world through an arriving page", () => {
    /* Every rule that names a page ground, with its declarations. */
    const grounds = [...CHROME.matchAll(/\.(waka-page|login-shell|waka-public)\b[^{]*\{([^}]*)\}/g)];
    expect(grounds.length, "no page-ground rules found — has a class been renamed?")
      .toBeGreaterThanOrEqual(2);
    const fading = grounds
      .filter(([, , body]) => /animation(-name)?\s*:/.test(body!) && !/animation\s*:\s*none/.test(body!))
      .map(([, name]) => `.${name}`);
    expect(
      fading,
      "a page ground has an entry animation again. Whatever it fades in " +
        "from is the world, so it will show the Now screen on every move " +
        "between tabs — which is what the founder recorded. If a surface " +
        "genuinely needs to animate, animate something INSIDE it that is " +
        "not the thing covering the world.",
    ).toEqual([]);
  });
});
