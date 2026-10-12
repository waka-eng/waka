/**
 * EVERY STYLESHEET SAYS WHICH LAYER IT IS IN, AND `layers.css` KNOWS THEM ALL.
 *
 * `layers.css` exists for exactly one purpose, stated in its own first
 * paragraph: "`@layer` makes the order explicit and total. … That is a
 * statement of intent, IN ONE PLACE, rather than a fact you have to
 * reconstruct from four import lines and a bundler's behaviour."
 *
 * Nothing checked it. Not one gate in this repository asked which layer a
 * sheet was in — `type-scale.test.ts` and `one-class-one-thing.test.ts` both
 * READ `claims.css`, for type and for duplicate selectors, and neither had
 * any reason to notice that it carries no `@layer` statement at all.
 *
 * ── WHAT IT COST, AND WHAT PAYING IT COST ────────────────────────────────
 *
 * `claims.css` was the largest sheet in the tree and had 318 unlayered rules,
 * so by `layers.css`'s own rule — stated there three times — every one of
 * them beat every rule in `global.css`, `system.css`, `home.css`,
 * `chrome.css` and `chat.css`, REGARDLESS OF SPECIFICITY. Two consequences
 * were found in Chromium on 2026-10-12 and both were the shape the founder
 * had already reported once:
 *
 *   THE CAPTURE BOX. `chrome.css` said `.jar-mouth-rest:not(--said) {
 *   padding: 8px 12px }` from `@layer chrome`; `home.css` said
 *   `@media (pointer: coarse) .jar-mouth-rest { padding-top/bottom: 14px }`
 *   from `@layer product`. Measured at 393x852 DPR 3 with
 *   `matchMedia("(pointer: coarse)")` true, the element computed
 *   `padding: 12px 16px 4px 16px` — NEITHER of them. The winner was
 *   `.waka-composer-body .jar-keep-box` in unlayered `claims.css`. Two sheets
 *   stated a vertical padding for that box and neither reached it.
 *
 *   THE WHITE BORDER THE FOUNDER BANNED. `layers.css` holds
 *   `:focus-visible { outline: none }` UNLAYERED precisely so nothing can
 *   remove it, because it replaced a 2px near-white ring on the founder's
 *   ruling "never show this white border ANYWHERE". `claims.css` declared
 *   `outline: 2px solid var(--ink)` — `rgb(242, 236, 225)`, the same
 *   rectangle — on 22 controls, and being unlayered it beat that floor on
 *   120 keyboard tab stops. Nothing in this repository could see it.
 *
 * ── THE DEBT IS NOW MOSTLY PAID, AND THAT IS WHY THIS NUMBER FELL ─────────
 *
 * `claims.css` is `@layer chrome` as of 2026-10-12, which took 350 unlayered
 * rules to 32. The previous version of this header argued at length that the
 * change could not be made — "the honest fix is a restyling and this gate is
 * not the place to smuggle one", 11 class families colliding, "it cannot be
 * signed off by reading a diff". That reasoning was right about the method
 * and wrong about the size, and the correction is worth keeping because it
 * is how the next one of these should be done:
 *
 *   COUNTING FAMILIES OVERSTATED IT BY AN ORDER OF MAGNITUDE. 11 class
 *   families shared a selector; what matters is a shared PROPERTY on an
 *   element both rules match, and that was 63 declarations, of which 59 were
 *   decided in claims.css's favour inside `chrome` by specificity or stated
 *   the value they were already beating. Four were real.
 *
 *   IT WAS SIGNED OFF BY MEASURING, NOT BY READING. 28 surfaces signed in at
 *   two pointer kinds, `CSS.getMatchedStylesForNode` on every element for the
 *   contested-property list, a computed-style diff over ~80 properties for
 *   the result, the real tab order for the focus rings, and a pixel diff for
 *   the one control whose ring mattered. The style diff is ZERO; the focus
 *   rings are the change, they are the founder's own ruling arriving, and the
 *   one surface that genuinely needed its ring keeps it. `layers.css` holds
 *   the numbers.
 *
 * ── WHY IT IS STILL A RATCHET ─────────────────────────────────────────────
 *
 * Because 32 is not 2. `home.css` still has 30 rules outside its own layer
 * blocks — an append past a closing brace, which is how all of them got
 * there and is exactly what this gate is for. `UNLAYERED_CEILING` is the
 * real count today. It may fall and it may not rise, which means a new sheet
 * written without a layer fails here, and so does a new rule appended past a
 * closing brace. The companion case below fails when the ceiling floats
 * above the real count, for the reason `type-scale.test.ts` gives: "a ratchet
 * that cannot notice its own slack is a ratchet that only ever ran once."
 *
 * ── WHAT IS DELIBERATELY UNLAYERED, AND IT IS EXACTLY TWO RULES ───────────
 *
 * `layers.css`'s own `:focus-visible { outline: none }` and `.jar
 * :focus-visible { filter: brightness(1.75) }`. Their unlayered position IS
 * the mechanism — "a surface that needs a different-looking focus may draw
 * one; it may not draw nothing" — and it is argued at length in that file.
 * They are named here so the floor is 2 rather than 0 and still true.
 *
 * IT SAID ONE RULE UNTIL 2026-10-12, AND THAT WAS THIS GATE MISCOUNTING
 * ITSELF, not a miscount of the tree. The parser treated `@layer base,
 * product, chrome, register;` — a STATEMENT, with no block — as an at-rule
 * BLOCK: nothing cleared the selector buffer at the `;`, so the next
 * selector arrived as `@layer …; :focus-visible`, started with `@`, was
 * pushed on the at-rule stack, and its own closing brace popped the stack
 * again. The rule was never counted at all, and the one sheet it happened in
 * is the sheet that declares the order. Fixed below; the fix is why the real
 * total was 350 rather than the 349 this file asserted, and the arithmetic
 * every earlier note in it did was off by the same one.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). Nothing. It reads the stylesheets off
 * disk and brace-matches them, exactly as `one-class-one-thing.test.ts`,
 * `type-scale.test.ts` and `one-box-two-faces.test.ts` do. The parser is the
 * same shape as `one-class-one-thing.test.ts`'s and for the same reason: a
 * real CSS parser is a dependency, and what is needed here is only the
 * at-rule stack a block sits inside.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const STYLES = resolve(HERE, "../src/styles");

/**
 * The debt, and the three times this number has moved.
 *
 *   345  as first measured — claims.css 322, home.css 22, layers.css 1 (the
 *        last of those being this gate's own off-by-one, see the header).
 *   341  2026-10-12, and NOT because anybody layered anything: four dead
 *        rules went out and took their unlayered-ness with them. The
 *        `.jar-char-bubble-go` family had no renderer anywhere in `src` —
 *        the offer inside the speech bubble is `.jar-char-bubble-act` now —
 *        and the deletion is tombstoned at the family's own block in
 *        claims.css.
 *   349  RAISED on the `origin/dev` merge, the one direction this number is
 *        not supposed to move. Eight rules written on `dev` since 2026-10-08
 *        arrived in claims.css, which was entirely unlayered, so there was
 *        nowhere else for them to land; they were old rules arriving, not new
 *        debt. WHAT THE GATE DID CATCH IN THE SAME MERGE, and the reason it
 *        earns its keep: a ninth rule landed OUTSIDE `chrome.css`'s `@layer
 *        chrome` block. Our side wrapped that sheet; `dev` appended to the
 *        end of it; git merged both without a conflict and the rule ended up
 *        past the closing brace, silently outranking every layered sheet.
 *        Nothing else would have seen it.
 *    32  2026-10-12. `claims.css` is `@layer chrome`, which took 318 rules
 *        out at once — and this time the number fell because the work was
 *        done rather than because dead rules left, which is the first time
 *        any of the four ratchets in this tree can say that. See
 *        `layers.css` for the argument for `chrome` over `product`, the 63
 *        contested declarations, the zero-difference computed-style diff and
 *        the 144 focus rings that did change.
 *
 * What is left is `home.css`'s 30 and `layers.css`'s deliberate 2. The floor
 * this is walking toward is 2.
 */
const UNLAYERED_CEILING = 32;

/** Read the rules, not the prose — the same blanking the other gates use. */
const commentsBlanked = (css: string): string =>
  css.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));

const sheets = (): string[] =>
  readdirSync(STYLES)
    .filter((name) => name.endsWith(".css"))
    .sort();

interface Rule {
  file: string;
  line: number;
  selector: string;
  /** the `@layer` names this block sits inside, joined; "" when unlayered */
  layer: string;
}

/**
 * Every declaration block in one sheet, with the layer it landed in.
 *
 * `@keyframes` is skipped wholesale: its "selectors" are percentages and a
 * keyframe is not in the cascade the way a rule is.
 */
function rulesIn(file: string): Rule[] {
  const css = commentsBlanked(readFileSync(resolve(STYLES, file), "utf8"));
  const out: Rule[] = [];
  const stack: string[] = [];
  let head = "";
  let line = 1;
  let headLine = 1;
  let quote = "";
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i]!;
    if (ch === "\n") line += 1;
    /* STRINGS ARE NOT STRUCTURE — `content: "}"` closed a block early in
       `one-class-one-thing.test.ts` before it learned this. */
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "{") {
      const selector = head.trim();
      head = "";
      if (selector.startsWith("@")) {
        stack.push(selector);
        continue;
      }
      let depth = 1;
      let j = i + 1;
      for (; j < css.length && depth > 0; j += 1) {
        if (css[j] === "\n") line += 1;
        if (css[j] === "{") depth += 1;
        else if (css[j] === "}") depth -= 1;
      }
      i = j - 1;
      if (stack.some((at) => at.startsWith("@keyframes"))) continue;
      out.push({
        file,
        line: headLine,
        selector: selector.replace(/\s+/g, " ").slice(0, 60),
        layer: stack.filter((at) => at.startsWith("@layer")).join(" "),
      });
      continue;
    }
    if (ch === "}") {
      stack.pop();
      head = "";
      continue;
    }
    /* AN AT-STATEMENT IS NOT AN AT-BLOCK, and missing that made this gate
       undercount the one sheet it cares most about. `@layer base, product,
       chrome, register;` has no `{`, so without this line the head goes on
       accumulating and the NEXT selector arrives as
       `@layer base, product, chrome, register; :focus-visible` — which
       starts with `@`, is pushed on the at-rule stack as a block, and is
       then popped by its own closing brace. `layers.css`'s
       `:focus-visible { outline: none }` was invisible to this parser for
       its whole life, which is why the total it reported was 349 against a
       real 350. A `;` can only be reached HERE, outside a declaration
       block, because a block is consumed whole by the brace-match above. */
    if (ch === ";") {
      head = "";
      continue;
    }
    if (head.trim() === "" && ch.trim() !== "") headLine = line;
    head += ch;
  }
  return out;
}

const everyRule = (): Rule[] => sheets().flatMap((file) => rulesIn(file));

describe("there is one cascade and every sheet declares where it sits in it", () => {
  it("finds rules to talk about, in more than one sheet", () => {
    /* the tripwire: a parser that finds nothing agrees with everything, which
       is how the first version of `e2e:dead-css` reported 0 dead rules */
    const rules = everyRule();
    expect(rules.length, "the parser found no rules at all").toBeGreaterThan(800);
    expect(new Set(rules.map((r) => r.file)).size).toBeGreaterThan(5);
  });

  it("keeps the count of unlayered rules at or under the ceiling", () => {
    const loose = everyRule().filter((r) => r.layer === "");
    const byFile = new Map<string, number>();
    for (const rule of loose) byFile.set(rule.file, (byFile.get(rule.file) ?? 0) + 1);
    expect(
      loose.length,
      `${loose.length} unlayered rules, and the ceiling is ${UNLAYERED_CEILING}.\n` +
        [...byFile].map(([file, n]) => `  ${file}: ${n}`).join("\n") +
        "\nAn unlayered rule beats every layered one at any specificity — see " +
        "styles/layers.css. A new sheet needs an `@layer` wrapper; a new rule " +
        "needs to be INSIDE one, which means checking you are not appending " +
        "past a closing brace.",
    ).toBeLessThanOrEqual(UNLAYERED_CEILING);
  });

  it("has an unlayered ceiling that is still worth having", () => {
    const loose = everyRule().filter((r) => r.layer === "");
    expect(
      UNLAYERED_CEILING - loose.length,
      `the ceiling is ${UNLAYERED_CEILING} and there are ${loose.length} left. ` +
        "Lower it — slack in a ratchet is room for the thing it was built to stop.",
    ).toBeLessThanOrEqual(3);
  });

  it("lets no sheet but the two named ones hold an unlayered rule", () => {
    /* THE LIST IS NOT AN ALLOWLIST FOR CONVENIENCE. `home.css` is a debt
       with a measured cost written down in `layers.css`'s table;
       `layers.css` itself is the one deliberate case. A THIRD name appearing
       here is a new sheet that never got a wrapper, which is how
       `claims.css` happened.

       `claims.css` CAME OFF THIS LIST ON 2026-10-12, with the rest of its
       318 rules, when it was wrapped in `@layer chrome`. Leaving the name
       here would have been the exact hole this comment warns about: a sheet
       that is now fully layered would be permitted to grow an unlayered rule
       again, silently, and the only gate that could notice would be the one
       holding the door open. A name may only be in this set while the sheet
       really has rules outside a layer. */
    const known = new Set(["home.css", "layers.css"]);
    const strays = [
      ...new Set(everyRule().filter((r) => r.layer === "").map((r) => r.file)),
    ].filter((file) => !known.has(file));
    expect(
      strays,
      "a sheet outside the three known ones has rules outside every layer. " +
        "Wrap the file, or move the rule inside the block it was appended past.",
    ).toEqual([]);
  });

  it("keeps `layers.css`'s assignment table matching the tree", () => {
    /* THE TABLE WAS STALE FOR TWO WHOLE SHEETS and nothing could tell. The
       "A STALE TABLE IS NOT A HARMLESS STALE COMMENT" paragraph in
       `layers.css` records both times it happened, and says why it is not
       harmless: the rule the table states is TRUE, so a reader reasoning from
       a wrong table gets every duplicate definition backwards. So the table
       must name every sheet that has rules, by name.

       CITED BY ITS SENTENCE AND NOT BY ITS LINE. This comment said
       `layers.css:38-47`, and that range had already moved — which is the
       same defect as a stale table, one file along. */
    const table = readFileSync(resolve(STYLES, "layers.css"), "utf8");
    const missing = sheets().filter(
      (file) => rulesIn(file).length > 0 && !table.includes(file),
    );
    expect(
      missing,
      "styles/layers.css is the one place the precedence order is stated, and " +
        "its assignment table does not name these sheets. A table that is " +
        "stale for a sheet is worse than no table: the rule it states — " +
        "unlayered beats all layers — is true, so a reader reasoning from it " +
        "gets the answer backwards.",
    ).toEqual([]);
  });

  it("declares the layer order once, and `layers.css` is where", () => {
    const order = sheets().filter((file) =>
      /@layer\s+[a-z, ]+;/.test(commentsBlanked(readFileSync(resolve(STYLES, file), "utf8"))),
    );
    expect(
      order,
      "the `@layer a, b, c;` ordering statement must appear in exactly one " +
        "file. Two of them and the order is decided by whichever the bundler " +
        "emits first, which is the whole thing layers.css was written to end.",
    ).toEqual(["layers.css"]);
  });
});
