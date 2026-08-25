/**
 * ONE TYPE SCALE, AND A RATCHET THAT ONLY TURNS ONE WAY.
 *
 * Founder, 2026-08-25: "ensure font and text style used is also consistent and
 * feel like we built it from an official design system instead of using random
 * font and sizes and spacing here and there."
 *
 * Measured that day, before anything was moved: FIFTY-THREE distinct
 * `font-size` values across six stylesheets, forty-five of them raw literals.
 * Seven were half-pixel — `6.5px`, `7.5px`, `8.5px`, `10.5px`, `12.5px`,
 * `13.5px`, `14.5px` — which is not a scale anybody chose. It is what happens
 * when a size is nudged at the call site until it looks right, and then the
 * nudge ships.
 *
 * The register a person sees most often had no name at all: `10px`, tracked
 * and uppercased, is every signpost, eyebrow and quiet verb row in the
 * product, written as a bare literal in twenty-one places and referenced by
 * nothing.
 *
 * ── WHY A RATCHET AND NOT A BAN ────────────────────────────────────────────
 *
 * A gate that forbids every literal would have to ship with an allowlist
 * holding the ninety-five sites that existed when it was written, and an
 * allowlist that large is not a gate — it is a list of things the gate has
 * agreed not to look at.
 *
 * So this counts instead. Sixty-six sites moved onto named steps the day it
 * was written, with no visual change: each one already matched a step exactly.
 * What is left is recorded as a CEILING. A new literal pushes the count over
 * and fails; converting one lowers it, and the ceiling is meant to be lowered
 * with it. The number only goes down.
 *
 * ── THE ONE THING THAT IS BANNED OUTRIGHT ──────────────────────────────────
 *
 * Half-pixel sizes. There is no reading of the scale in which `13.5px` is a
 * deliberate step, and every one of them got there the same way.
 *
 * ── WHAT IS NOT COVERED, AND WHY ───────────────────────────────────────────
 *
 * `surface.css` is exempt. It is the flat screens' stylesheet and it is slated
 * for deletion by `one-product-one-system.md` Phase 6 — converting 2,093 lines
 * on their way to being removed is work spent twice. The exemption is written
 * here rather than assumed, so that when the file is deleted this line is what
 * tells the next person the exemption can go too. If the flat screens are ever
 * kept instead, this exemption becomes a bug.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). Nothing. It reads stylesheets off disk
 * and counts, exactly as `contrast.test.ts` and `hq-pointer.test.ts` do.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const STYLES = resolve(HERE, "../src/styles");

/** The stylesheets the product is keeping. `surface.css` is exempt — see above. */
const GOVERNED = ["home.css", "chrome.css", "global.css"] as const;

/**
 * THE CEILING, and it is a number to be lowered.
 *
 * 2026-08-25: ninety-five literal sites, cut to twenty-one in one pass by
 * converting every size that already matched a named step. What remains is
 * `16px`, `17px`, `9px`, and the display-cluster one-offs (`20`–`44px`) that
 * belong to headings nobody has decided the scale for yet.
 */
const CEILING = 21;

/**
 * READ THE RULES, NOT THE PROSE.
 *
 * These stylesheets carry long block comments that quote CSS — `home.css` has
 * a comment describing a rule "at f4e0f93: `font-size: 15px`, `border-bottom:
 * 1px solid`" — and the first version of this gate counted that sentence as a
 * twenty-second literal. A gate that reads its own documentation as evidence
 * will report work that was never done and demand work that is not needed.
 * `check-seams.mjs` learned this the same way and for the same reason.
 */
const commentsBlanked = (css: string): string =>
  css.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));

const read = (file: string): string =>
  commentsBlanked(readFileSync(resolve(STYLES, file), "utf8"));

/** Every `font-size` value as written, per governed file. */
function sizesIn(file: string): string[] {
  const out: string[] = [];
  for (const m of read(file).matchAll(/font-size:\s*([^;]+);/g)) out.push(m[1]!.trim());
  return out;
}

/** A value the scale accounts for: a token, a fluid display step, or inherited. */
function onTheScale(value: string): boolean {
  return value.startsWith("var(") || value.startsWith("clamp(") || value === "inherit";
}

describe("the type scale is one scale", () => {
  it("declares every step it claims, in one place", () => {
    /* If a step is renamed or dropped, the call sites below are pointing at
       nothing and the browser silently falls back to an initial value — which
       is exactly how the first version of this migration turned the four
       signposts from 10px into 16px without any rule looking wrong. */
    const system = read("system.css");
    for (const step of [
      "--t-display",
      "--t-reading",
      "--t-lead",
      "--t-body",
      "--t-note",
      "--t-ui",
      "--t-fine",
      "--t-meta",
      "--t-label",
      "--t-micro",
    ]) {
      expect(
        new RegExp(`(?<![\\w-])${step}:`).test(system),
        `\`${step}\` is no longer declared in system.css. Every call site that ` +
          "names it now resolves to nothing and falls back to an initial value, " +
          "which does not look like a broken rule anywhere — it looks like type " +
          "that quietly changed size.",
      ).toBe(true);
    }
  });

  it("never sets a size in half pixels", () => {
    const offenders: string[] = [];
    for (const file of GOVERNED) {
      for (const v of sizesIn(file)) if (/\d+\.\d+px/.test(v)) offenders.push(`${file}: ${v}`);
    }
    expect(
      offenders,
      "a half-pixel size is back. There is no reading of the scale in which " +
        "13.5px is a deliberate step — it is a call-site nudge, and seven of " +
        "them had shipped by the time anyone counted. Pick the step above or " +
        "below it.",
    ).toEqual([]);
  });

  it("keeps the count of un-tokenised sizes at or under the ceiling", () => {
    const loose: string[] = [];
    for (const file of GOVERNED) {
      for (const v of sizesIn(file)) if (!onTheScale(v)) loose.push(`${file}: ${v}`);
    }
    expect(
      loose.length,
      `${loose.length} literal font sizes, and the ceiling is ${CEILING}.\n` +
        `  ${loose.join("\n  ")}\n` +
        "A new literal means a size was chosen at a call site instead of taken " +
        "from the scale. Either it is one of the named steps — use the token — " +
        "or it is a step the scale is missing, in which case name it in " +
        "system.css and say why, the way `--t-note` and `--t-fine` were named.",
    ).toBeLessThanOrEqual(CEILING);
  });

  it("has a ceiling that is still worth having", () => {
    /* A ratchet whose ceiling has drifted far above the real count has stopped
       ratcheting: it would take a dozen new literals before it complained. If
       this fails, the work is done — lower `CEILING` to the number reported. */
    const loose = GOVERNED.flatMap((f) => sizesIn(f).filter((v) => !onTheScale(v)));
    expect(
      CEILING - loose.length,
      `the ceiling is ${CEILING} and there are only ${loose.length} literals left. ` +
        "Lower the ceiling to match — slack in a ratchet is room for the thing " +
        "it was built to stop.",
    ).toBeLessThanOrEqual(3);
  });
});
