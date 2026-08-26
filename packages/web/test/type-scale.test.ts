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

/**
 * THE SPACING GRID, held the same way.
 *
 * 47 distinct spacing literals when this was measured, and the founder called
 * it "random spacing here and there". It was not a wild scatter: nearly every
 * frequent value was already even. What existed was a two-pixel grid nobody
 * had written down, with a handful of odd values sitting off it.
 *
 * So `system.css` declares the grid by pixel value (`--sp-14` is 14px, and
 * naming a step after what it IS beats a `--sp-7` a reader has to translate),
 * 194 declarations moved onto it with no geometry change, and what is left is
 * counted here. The point is not shorter CSS — `var(--sp-14)` is longer than
 * `14px`. It is that "off the grid" becomes something a machine can see.
 */
const SPACE_CEILING = 38;

/** Spacing values, per governed file, as written. */
function spacingIn(file: string): string[] {
  const out: string[] = [];
  const decl = /\b(padding|margin|gap|row-gap|column-gap)(-top|-right|-bottom|-left)?:\s*([^;{}]+);/g;
  for (const m of read(file).matchAll(decl)) {
    const value = m[3]!;
    if (/var\(|calc\(|env\(/.test(value)) continue;
    for (const px of value.matchAll(/\b\d+px\b/g)) out.push(`${file}: ${m[1]}${m[2] ?? ""}: ${px[0]}`);
  }
  return out;
}

describe("the spacing grid is one grid", () => {
  it("declares the grid in one place", () => {
    const system = read("system.css");
    for (const step of ["--sp-2", "--sp-8", "--sp-14", "--sp-24", "--sp-96"]) {
      expect(
        new RegExp(`(?<![\\w-])${step}:`).test(system),
        `\`${step}\` is gone from system.css. Call sites naming it now resolve ` +
          "to nothing, and a spacing value that resolves to nothing is not a " +
          "layout that looks broken — it is one that quietly collapsed.",
      ).toBe(true);
    }
  });

  it("keeps the count of off-grid spacing at or under the ceiling", () => {
    const loose = GOVERNED.flatMap((f) => spacingIn(f));
    expect(
      loose.length,
      `${loose.length} raw spacing values, and the ceiling is ${SPACE_CEILING}.\n` +
        `  ${loose.join("\n  ")}\n` +
        "Either the value is on the two-pixel grid — use its token — or it is " +
        "off it, in which case it is one of the odd values this ratchet exists " +
        "to drain, and the fix is to move to the step above or below.",
    ).toBeLessThanOrEqual(SPACE_CEILING);
  });

  it("has a spacing ceiling that is still worth having", () => {
    const loose = GOVERNED.flatMap((f) => spacingIn(f));
    expect(
      SPACE_CEILING - loose.length,
      `the ceiling is ${SPACE_CEILING} and there are ${loose.length} left. Lower it.`,
    ).toBeLessThanOrEqual(3);
  });
});

/**
 * THE PALETTE, held the same way — and the finding that opened it.
 *
 * 97 distinct colour literals across the three governed stylesheets when this
 * was measured. Thirteen of them were the VALUE OF A TOKEN THAT ALREADY
 * EXISTED: `--jar-deep: #06080d` is declared, and `#06080d` was then written
 * raw four times; `--jar-panel-edge` and `--jar-muted` the same. A token
 * declared and then bypassed is worse than no token — the next person changes
 * the declaration, watches most of the product follow, and has no way to see
 * the places that did not.
 *
 * Those thirteen are converted. The rest is a long tail of one-off shadows and
 * gradients where a name would add nothing, so it is counted rather than
 * forced. Colour is the most design-sensitive of the three scales, and a blind
 * mapping of 97 values is a redesign nobody asked for.
 */
const COLOUR_CEILING = 125;

/** Colour literals, per governed file. */
function coloursIn(file: string): string[] {
  const out: string[] = [];
  for (const m of read(file).matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)) {
    out.push(`${file}: ${m[0]}`);
  }
  return out;
}

describe("the palette does not bypass itself", () => {
  it("never writes a colour a declared token already holds", () => {
    /* THE FINDING THIS EXISTS FOR, and it is exact rather than a count: a raw
       value identical to a token's own value means the cascade was stepped
       around, and nothing about the rule looks wrong when you read it. */
    const declared = new Map<string, string>();
    for (const file of [...GOVERNED, "system.css"]) {
      for (const m of read(file).matchAll(
        /^\s*(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))\s*;/gm,
      )) {
        if (!declared.has(m[2]!.toLowerCase())) declared.set(m[2]!.toLowerCase(), m[1]!);
      }
    }
    const bypassed: string[] = [];
    for (const file of GOVERNED) {
      for (const line of read(file).split("\n")) {
        if (/^\s*--[a-z0-9-]+:/.test(line)) continue;
        for (const [value, name] of declared) {
          if (line.toLowerCase().includes(value)) bypassed.push(`${file}: ${value} is var(${name})`);
        }
      }
    }
    expect(
      bypassed,
      "a colour was written raw when a token already holds that exact value. " +
        "Change the token and this rule will not follow — use var().",
    ).toEqual([]);
  });

  it("keeps the count of colour literals at or under the ceiling", () => {
    const loose = GOVERNED.flatMap((f) => coloursIn(f));
    expect(
      loose.length,
      `${loose.length} colour literals, ceiling ${COLOUR_CEILING}. A new one means ` +
        "a colour was chosen at a call site. If it is a tier the palette should " +
        "own, name it; if it is a one-off shadow, it is part of the tail this " +
        "ratchet is draining.",
    ).toBeLessThanOrEqual(COLOUR_CEILING);
  });
});

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

/**
 * THE LABEL REGISTER IS ONE RULE, AND STAYS ONE RULE.
 *
 * Founder, 2026-08-25: "ensure font and text style used is also consistent
 * and feel like we built it from an official design system instead of using
 * random font and sizes and spacing here and there."
 *
 * Small, uppercase, tracked — the most repeated gesture in the product, and
 * on 2026-08-26 it was declared TWENTY-FIVE times across `home.css`,
 * `chrome.css` and `global.css`, in four sizes, five trackings and three
 * weights. `chrome.css` had already begun correcting `global.css` by
 * overriding it rather than editing it, which is how three sheets end up
 * disagreeing about one gesture and nobody notices, because every one of them
 * looks reasonable on its own.
 *
 * The count is the whole gate. One declaration cannot drift from itself; two
 * can, and the one that stops being read is the one that keeps being edited.
 */
describe("the label register is declared once", () => {
  const SHEETS = ["home.css", "chrome.css", "global.css", "system.css", "layers.css"] as const;

  const bodies = (name: string): string =>
    /* the same comment-blanking the rest of this file does: these sheets quote
       CSS in their prose, and a gate that reads its own documentation as
       evidence reports work that was never done */
    readFileSync(resolve(STYLES, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");

  it("nothing in the tree says `uppercase` except the register", () => {
    const where = SHEETS.map((name) => ({
      name,
      count: (bodies(name).match(/text-transform:\s*uppercase/g) ?? []).length,
    })).filter((sheet) => sheet.count > 0);

    expect(
      where.map((sheet) => `${sheet.name}:${sheet.count}`).join(" "),
      "the register must be declared in exactly one place, in system.css",
    ).toBe("system.css:1");
  });

  it("it is set in tokens, not in numbers somebody remembered", () => {
    const css = bodies("system.css");
    const rule = css.match(/@layer register\s*\{([\s\S]*)\}\s*$/);
    expect(rule, "there is no `register` layer in system.css").not.toBeNull();
    const body = rule![1]!;
    expect(body).toContain("font-size: var(--t-label)");
    expect(body).toContain("letter-spacing: 0.16em");
    expect(body).toContain("font-weight: 500");
  });

  it("the register layer holds that one rule and nothing else", () => {
    /* THE LAYER IS NOT A CONVENIENCE FOR WINNING ARGUMENTS WITH THE CASCADE.
       It is last so that one declaration cannot be out-ranked — by a `font:`
       shorthand in `chrome.css`, or by `home.css` landing after `system.css`
       in the same layer, both of which really happened. The moment a second
       rule moves in to borrow that power, the layer stops meaning "the
       register" and starts meaning "things that win", and the next person
       cannot tell which. */
    const body = bodies("system.css").match(/@layer register\s*\{([\s\S]*)\}\s*$/)![1]!;
    const rules = (body.match(/\{/g) ?? []).length;
    expect(rules, "the register layer must hold exactly one rule").toBe(1);
  });

  it("the layer order names it last", () => {
    const order = bodies("layers.css").match(/@layer\s+([a-z,\s]+);/);
    expect(order, "layers.css no longer declares an order").not.toBeNull();
    const names = order![1]!.split(",").map((one) => one.trim());
    expect(names[names.length - 1], "`register` must be the last layer").toBe("register");
  });
});
