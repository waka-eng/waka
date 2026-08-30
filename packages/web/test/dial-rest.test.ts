/**
 * THE TIMELINE IS NOT SWITCHED ON BY WHERE IN TIME YOU ARE.
 *
 * The founder asked, four separate times, for the hairline across the screen
 * to stop being there. It was hidden at rest, a gate was written that proved
 * it hidden at rest, screenshots were taken showing it hidden at rest — and
 * on their machine the line was still there.
 *
 * The reason was not a stray rule. `.jar-dial--live` was set on
 * `scrubbing || !atNow`, and `--live` was one of the ways the rail was
 * REVEALED. `atNow` goes false the moment you wind the wall back, and nothing
 * set it true again except scrubbing to within half a day of the present —
 * a target a few pixels wide at the end of a rail you could only see while
 * touching it. So the first drag turned the hairline on for the rest of the
 * session, and there was no gesture that turned it off.
 *
 * Every gate and every capture missed it for the same reason: they open the
 * page, look, and never touch the dial. `atNow` is true for the whole life of
 * such a run, so the rest state they measured was real and the state a person
 * who had actually used the instrument was living in was never measured at
 * all. A fixture that only ever looks is not a neutral fixture.
 *
 * WHAT THE RAIL IS NOW, AND WHY THIS FILE SURVIVED IT. The drag is gone
 * (founder, 2026-08-30: "instead of this draggable line, when clicking on now,
 * just show the major dates to make them clickable"), and with it the whole
 * reveal machinery — there is no longer a resting instrument to reveal,
 * because the dates are not rendered at all until the word is pressed. That
 * is a stronger form of the same rule, so the rule is restated rather than
 * retired: WHERE IN TIME YOU ARE STANDING MUST NEVER PUT THE INSTRUMENT ON
 * SCREEN. It is `.jar-when`, the word in the top-left, that carries that fact
 * — in light, at full ink, which is the whole reason the rail was allowed to
 * go.
 *
 * WHY THIS IS A SOURCE GATE. `e2e/measure.ts` opens a real engine and can
 * prove what a class DOES. What it cannot see is which classes the world
 * decides to hand it, or what it decides to mount — that is a line of TSX,
 * and in jsdom the world is a canvas that never lays out. So this reads the
 * expression and fails if being parked is ever wired back into it.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). Nothing. It reads two files off disk and
 * asserts about the text in them, exactly as `hq-pointer.test.ts` and
 * `contrast.test.ts` do, and for the same reason: the thing being protected is
 * invisible to every rendered suite in this package.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOME = readFileSync(resolve(HERE, "../src/pages/Home.tsx"), "utf8");
const CSS = readFileSync(resolve(HERE, "../src/styles/home.css"), "utf8");

/**
 * The condition the dial is mounted under, as written.
 *
 * Found by walking BACK from the element itself rather than forward from the
 * first `{dial &&` in the file — the word that summons the dial is guarded by
 * a condition of its own, it is written first, and the first version of this
 * helper read that one and reported on the wrong control.
 */
function dialMountCondition(): string {
  const el = HOME.indexOf("ref={dialRef}");
  if (el < 0) return "";
  const at = HOME.lastIndexOf("{dial &&", el);
  if (at < 0) return "";
  const end = HOME.indexOf("?", at);
  return end < 0 || end > el ? "" : HOME.slice(at, end);
}

/**
 * Source with its comments taken out. This file asserts that certain names do
 * not APPEAR, and the history of why they went is written in comments that
 * necessarily name them — so a prose gate that reads raw text fails on its own
 * explanation. Only what the compiler and the browser see is evidence here.
 */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}
const HOME_CODE = code(HOME);
const CSS_CODE = code(CSS);

/** every `.jar-dial { … }` rule in the stylesheet, bodies only */
function dialRules(): string[] {
  const out: string[] = [];
  let at = CSS.indexOf("\n.jar-dial {");
  while (at >= 0) {
    const end = CSS.indexOf("\n}", at);
    if (end < 0) break;
    out.push(CSS.slice(at, end));
    at = CSS.indexOf("\n.jar-dial {", end);
  }
  return out;
}

describe("the dial rests, whatever the archive's dates are", () => {
  it("still decides to mount from one condition this gate can read", () => {
    /* If this fails the dial was rewritten and the checks below are asserting
       about nothing — which is worse than no gate. */
    expect(
      dialMountCondition(),
      'the dial is no longer mounted from a `{dial && phase === "ready" …}` ' +
        "condition. Rewriting it is fine; leaving this gate pointing at a shape " +
        "that no longer exists is not. Repoint it at whatever decides it now.",
    ).not.toBe("");
  });

  it("is on screen because the word was pressed, and for no other reason", () => {
    const cond = dialMountCondition();
    expect(
      /timeOpen/.test(cond),
      "the dates are no longer mounted from `timeOpen`. Pressing the word is " +
        "the only way in — that is what the founder asked for, and it is also " +
        "what keeps this instrument off the page the rest of the time.",
    ).toBe(true);
    expect(
      /atNow|parkedAt/.test(cond),
      "where in time you are parked is back in the condition that puts the " +
        "dial on screen. That is the bug this file is named after: winding the " +
        "wall back would leave the instrument standing over the world with no " +
        "gesture that puts it away. Being parked is said by `.jar-when`, in " +
        "words, in the top-left.",
    ).toBe(false);
  });

  it("has no invisible strip left anywhere on the page", () => {
    /**
     * `.jar-dial-track` was a 44px-wide box running nearly half the height of
     * the screen, with no ink in it, mounted at all times and live to every
     * press. It swallowed presses meant for the walls list behind it — the
     * same shape of defect as the jar's mouth, found the same way, by a walk
     * that could not reach a control it could plainly see.
     *
     * The dates are buttons in a box that only exists while it is open, so
     * there is nothing here to reintroduce by accident — only on purpose, and
     * this is the sentence that would greet it.
     */
    expect(
      HOME_CODE.includes("jar-dial-track") || CSS_CODE.includes("jar-dial-track"),
      "`.jar-dial-track` is back. An interactive box with no ink in it, " +
        "standing over the world at rest, takes presses meant for whatever is " +
        "behind it — which is exactly what it did to the walls list.",
    ).toBe(false);
  });

  it("says where in time you are with a word, and lights it when it is news", () => {
    /* The replacement has to actually exist, or the fact went unsaid rather
       than being said better. */
    expect(
      /className=\{`jar-when jar-label\$\{/.test(HOME),
      "`.jar-when` is not rendered any more. It is the only thing telling a " +
        "person they are standing somewhere other than now.",
    ).toBe(true);
    expect(
      /jar-when--away/.test(HOME) && /\.jar-when--away\s*\{[^}]*color:/.test(CSS),
      "`.jar-when--away` no longer changes the word's colour. Being wound back " +
        "is carried in light and nothing else — that is what let the rail go.",
    ).toBe(true);
  });

  it("leaves the bottom edge entirely to the count", () => {
    /**
     * THE RAIL LEFT THE BOTTOM (founder, 2026-08-27: "move timeline slider
     * vertically under this instead", pointing at the word `now`) AND THE
     * DATES DID NOT GO BACK.
     *
     * This used to pin the rail 42px off the bottom edge so the count kept its
     * own 10px from the glass. The question it was really asking — does
     * anything crowd the count out of the edge that belongs to it — is now
     * answered more completely than the pin ever answered it: the instrument
     * hangs from the top-left beside its own word and is not at the bottom at
     * all. So the assertion is the intent rather than the old number.
     */
    const rules = dialRules();
    expect(rules.length, "`.jar-dial` has no rule").toBeGreaterThan(0);
    const all = rules.join("\n");
    expect(
      /top:\s*calc\(/.test(all),
      "`.jar-dial` has lost its top anchor — it hangs from the word that " +
        "summons it, and without a top it hangs from nothing.",
    ).toBe(true);
    for (const rule of rules) {
      const bottom = /bottom:\s*([^;]+);/.exec(rule);
      expect(
        bottom === null || bottom[1].trim() === "auto",
        "`.jar-dial` is anchored to the bottom again. It hangs from " +
          "`.jar-when` in the top-left and opens downward; the bottom edge " +
          "belongs to the count alone.",
      ).toBe(true);
    }
  });
});
