/**
 * THE RESTING PHRASE AND THE FIELD ARE ONE BOX.
 *
 * Founder, 2026-09-08, from a recording: "Capture inspiration moves up and
 * down slightly when I click on it. No matter if it's clicked or not clicked,
 * it should always be in the same position."
 *
 * The mouth has two faces and one place. At rest it is a button holding the
 * words `capture inspiration`; pressed, that button is replaced by a textarea
 * whose PLACEHOLDER is the same words in the same register. The whole design
 * is that the press changes what the words ARE and nothing about where they
 * sit — press it and you are already typing, in the line you were reading.
 *
 * IT HAS NOW BROKEN THREE TIMES, each time because one face was given a
 * property the other was not:
 *
 *   2026-08-24 — the button had no leading and the textarea set
 *     `line-height: 1.9`, so the words dropped half a line. Fixed by giving
 *     both the same leading.
 *   2026-08-28 — the button became `inline-block` so it would stop owning the
 *     whole row and swallowing presses meant for orbs behind it. Correct, and
 *     it reintroduced the jump at one pixel: an inline-block sits on a line
 *     box and carries the slot's leading above it; a textarea is a block and
 *     does not.
 *   2026-08-25/09-08 — the coarse-pointer pass gave the BUTTON 13px of
 *     vertical padding to reach the 44px an act needs under a thumb, and gave
 *     the field none. MEASURED at 393x852 DPR 3: the ink band moved from
 *     device rows 114-134 to 75-95 when pressed. Thirteen CSS pixels, on a
 *     ten-pixel word, on the one act this product exists for.
 *
 * Each fix was right and each was written on one face. So the rule is stated
 * here mechanically instead: WHATEVER DECIDES WHERE THE FIRST LINE OF INK
 * SITS MUST BE SAID TO BOTH FACES, in every condition where it is said to
 * either. That is the vertical padding, and it is being block-level rather
 * than inline — the two things that have actually broken.
 *
 * WHAT IT DELIBERATELY DOES NOT ASK. Anything about the drawer
 * (`.jar-mouth-slot--note .jar-mouth-field`), which is a compound selector
 * and a different component: a full-page note is not pretending to be the
 * resting line. And anything about horizontal padding, width or the face —
 * the field is wider than the phrase on purpose, and a wider box does not
 * move a centred line.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). Nothing. It reads `home.css` off disk
 * and parses it, exactly as `one-class-one-thing.test.ts` and
 * `type-scale.test.ts` do.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHEET = resolve(HERE, "../src/styles/home.css");

/** The two faces, by the only selector each is claimed by. */
const REST = ".jar-mouth-rest";
const FIELD = ".jar-mouth-field";

/**
 * `layers.css` declares `@layer base, product, chrome, register;`, and an
 * unlayered rule outranks every layer. Both faces are bare single classes, so
 * specificity is equal everywhere and this order plus document order is the
 * whole cascade between them.
 */
const LAYERS = ["@layer base", "@layer product", "@layer chrome", "@layer register"];
const rankOf = (layer: string): number => {
  const at = LAYERS.indexOf(layer);
  return at === -1 ? LAYERS.length : at;
};

interface Decl {
  /** the at-rule conditions this block sits under, layers excluded */
  condition: string;
  rank: number;
  order: number;
  props: Map<string, string>;
}

/**
 * Every unconditional-or-media declaration of `selector`, in cascade order.
 *
 * Hand-rolled for the same reason `one-class-one-thing.test.ts` gives: walk
 * the characters, keep a stack of the at-rules we are inside, and read a
 * block only when the selector list names this class BARE — a compound like
 * `.jar-mouth-slot--away .jar-mouth-rest` is a different component talking.
 */
function declarationsOf(selector: string): Decl[] {
  const css = readFileSync(SHEET, "utf8").replace(/\/\*[\s\S]*?\*\//g, (b) =>
    b.replace(/[^\n]/g, " "),
  );
  const out: Decl[] = [];
  const stack: string[] = [];
  let head = "";
  let order = 0;
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i]!;
    if (ch === "{") {
      const sel = head.trim();
      head = "";
      if (sel.startsWith("@")) {
        stack.push(sel);
        continue;
      }
      let depth = 1;
      let body = "";
      let j = i + 1;
      for (; j < css.length && depth > 0; j += 1) {
        const c = css[j]!;
        if (c === "{") depth += 1;
        else if (c === "}") depth -= 1;
        if (depth > 0) body += c;
      }
      i = j - 1;
      order += 1;
      if (stack.some((at) => at.startsWith("@keyframes"))) continue;
      if (!sel.split(",").some((one) => one.trim() === selector)) continue;
      const props = new Map<string, string>();
      for (const m of body.matchAll(/(^|[;{])\s*([-a-z]+)\s*:\s*([^;}]*)/g)) {
        props.set(m[2]!, m[3]!.trim());
      }
      out.push({
        condition: stack.filter((at) => !at.startsWith("@layer")).join(" "),
        rank: rankOf(stack.filter((at) => at.startsWith("@layer")).join(" ")),
        order,
        props,
      });
      continue;
    }
    if (ch === "}") {
      stack.pop();
      head = "";
      continue;
    }
    head += ch;
  }
  return out;
}

/** the vertical padding a face ends up with under `condition`, as written */
function verticalPadding(decls: Decl[], condition: string): { top: string; bottom: string } {
  const apply = decls
    .filter((d) => d.condition === "" || d.condition === condition)
    .sort((a, b) => a.rank - b.rank || a.order - b.order);
  let top = "0";
  let bottom = "0";
  for (const d of apply) {
    const all = d.props.get("padding");
    if (all !== undefined) {
      const parts = all.split(/\s+/);
      /* one value is all four sides; two or more put the vertical first */
      top = parts[0]!;
      bottom = parts.length >= 3 ? parts[2]! : parts[0]!;
    }
    const t = d.props.get("padding-top");
    if (t !== undefined) top = t;
    const b = d.props.get("padding-bottom");
    if (b !== undefined) bottom = b;
  }
  return { top, bottom };
}

/** the last `display` that wins under `condition` */
function display(decls: Decl[], condition: string): string {
  const apply = decls
    .filter((d) => d.condition === "" || d.condition === condition)
    .sort((a, b) => a.rank - b.rank || a.order - b.order);
  let value = "inline";
  for (const d of apply) {
    const v = d.props.get("display");
    if (v !== undefined) value = v;
  }
  return value;
}

/**
 * Every condition either face is declared under, plus the unconditional one.
 * Discovered rather than listed: a new `@media` written on one face and not
 * the other is exactly the shape of all three regressions above.
 */
function conditionsInPlay(a: Decl[], b: Decl[]): string[] {
  return [...new Set([...a, ...b].map((d) => d.condition))];
}

describe("the resting phrase and the field are one box", () => {
  const rest = declarationsOf(REST);
  const field = declarationsOf(FIELD);

  it("reads a sheet that really declares both faces", () => {
    /* the tripwire: a parser that finds nothing agrees with everything */
    expect(rest.length, "no bare .jar-mouth-rest blocks found").toBeGreaterThan(1);
    expect(field.length, "no bare .jar-mouth-field blocks found").toBeGreaterThan(1);
    expect(conditionsInPlay(rest, field)).toContain("@media (pointer: coarse)");
  });

  it("gives both the same air above and below the words, in every condition", () => {
    const wrong: string[] = [];
    for (const condition of conditionsInPlay(rest, field)) {
      const a = verticalPadding(rest, condition);
      const b = verticalPadding(field, condition);
      if (a.top !== b.top || a.bottom !== b.bottom) {
        wrong.push(
          `${condition || "unconditional"} — ${REST} has ${a.top}/${a.bottom} and ` +
            `${FIELD} has ${b.top}/${b.bottom}`,
        );
      }
    }
    expect(
      wrong,
      "One face of the mouth has vertical air the other has not, so pressing " +
        "the phrase moves the words. Say it to both, in the layer that wins.\n" +
        wrong.join("\n"),
    ).toEqual([]);
  });

  it("keeps both out of a line box, so neither carries the slot's leading", () => {
    /* `inline-block` is the specific value that broke this: it sits on the
       slot's baseline and inherits its half-leading, while the textarea beside
       it does not. Any block-level box is fine; an inline one is not. */
    for (const condition of conditionsInPlay(rest, field)) {
      for (const [name, decls] of [
        [REST, rest],
        [FIELD, field],
      ] as const) {
        const value = display(decls, condition);
        expect(
          value.startsWith("inline"),
          `${name} is \`display: ${value}\` under ${condition || "no condition"} — ` +
            "an inline box sits on a line box and carries its leading, which is " +
            "the one-pixel version of the founder's report",
        ).toBe(false);
      }
    }
  });
});
