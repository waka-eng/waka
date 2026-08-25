/**
 * EVERY CONTROL IN HEADQUARTERS CAN TAKE A PRESS.
 *
 * `.jar-hq` carries `pointer-events: none` so the world underneath stays
 * draggable through it. `pointer-events` INHERITS, so every control inside
 * that layer is unclickable until something says otherwise — and this
 * stylesheet has been bitten by exactly that three times:
 *
 *   - `.jar-edge`, the ways out, at opacity 0 behind a `:hover` that could
 *     never fire on a layer that takes no pointer (finding 14);
 *   - `.jar-board-acts`, found a day later, on the same selector, because the
 *     first fix did not sweep the file;
 *   - THE POSTER, found on 2026-08-25 by an end-to-end walk. The poster is a
 *     control — the sentence is what you press to ask where it came from, and
 *     there is no button beside it by design — and a press fell straight
 *     through to the canvas and opened whatever memory happened to be under
 *     the words.
 *
 * WHY THIS IS A SOURCE-LEVEL GATE AND NOT A RENDERED ONE. The world's tests
 * run in jsdom, which loads no stylesheet and does not resolve inherited
 * `pointer-events` — so a rendered assertion here would pass on a layer whose
 * controls are all dead, which is the failure this exists to catch, wearing a
 * green tick. Reading the rule is the only honest check available, and it
 * fails loudly if the rule moves.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). Nothing, and nothing needs replacing.
 * This suite reads one file off disk — `src/styles/home.css` — and asserts
 * about the text in it. There is no world to stand up, no request to answer
 * and no seam to choose, which is exactly why it can catch what a rendered
 * suite cannot: jsdom loads no stylesheet, so the very rule this protects is
 * invisible to every other test in this package. `contrast.test.ts` and
 * `motion.test.ts` read the same file for the same reason.
 *
 * WHAT IT PINS is the shape that stops a fourth occurrence: ONE rule for the
 * whole layer rather than a line remembered per control. The next interactive
 * thing added inside headquarters will not be named `.jar-edge` either, and it
 * should not have to know about any of this.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const CSS = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../src/styles/home.css"),
  "utf8",
);

/** The declaration block for a selector, or null when it has no rule. */
function block(selector: string): string | null {
  const at = CSS.indexOf(`\n${selector} {`);
  if (at < 0) return null;
  const open = CSS.indexOf("{", at);
  const close = CSS.indexOf("}", open);
  return close < 0 ? null : CSS.slice(open + 1, close);
}

describe("headquarters takes no pointer, and its controls take it back", () => {
  it("still declares the layer itself untouchable — the rule below is load-bearing", () => {
    const hq = block(".jar-hq");
    expect(hq, "`.jar-hq` has no rule at all").not.toBeNull();
    expect(
      /pointer-events:\s*none/.test(hq ?? ""),
      "`.jar-hq` no longer refuses the pointer. If that was deliberate the rule " +
        "below is dead weight and this whole gate should be reconsidered — but " +
        "the world underneath is meant to stay draggable through this layer.",
    ).toBe(true);
  });

  it("gives the pointer back to every kind of control, in one rule", () => {
    /* The selector list as written, so a control kind that is dropped from it
       fails here rather than in somebody's hands. */
    const wanted = [
      ".jar-hq button",
      ".jar-hq label",
      ".jar-hq input",
      ".jar-hq textarea",
      '.jar-hq [role="button"]',
    ];
    for (const selector of wanted) {
      expect(
        CSS.includes(`${selector},`) || CSS.includes(`${selector} {`),
        `nothing in home.css gives \`${selector}\` the pointer back. Inside ` +
          "`.jar-hq` that means it cannot be pressed at all, and a press on it " +
          "falls through to the world underneath.",
      ).toBe(true);
    }

    /* And they share one block, which is the property that stops a fourth
       occurrence: a per-control line is a thing to remember, and this file's
       history is three separate failures to remember it. */
    const joined = wanted.join(",\\s*");
    expect(
      new RegExp(joined.replace(/[.[\]"]/g, (c) => `\\${c}`)).test(CSS),
      "the control kinds are no longer one rule. Split across the file they " +
        "become five things to remember instead of one, which is how the last " +
        "three occurrences happened.",
    ).toBe(true);
  });

  it("says the poster is pressable before it is pressed", () => {
    const poster = block('.jar-poster[role="button"]');
    expect(
      poster && /cursor:\s*pointer/.test(poster),
      "the poster is the only control in this layout with no button beside it " +
        "— the sentence IS the control — so the pointer is the only thing that " +
        "can say so before somebody presses it.",
    ).toBe(true);
  });
});
