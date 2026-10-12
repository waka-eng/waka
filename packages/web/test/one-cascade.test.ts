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
 * ── WHAT THAT COST, MEASURED RATHER THAN FEARED ───────────────────────────
 *
 * `claims.css` is the largest sheet in the tree and has 322 unlayered rules,
 * so by `layers.css`'s own rule — stated there three times — every one of
 * them beats every rule in `global.css`, `system.css`, `home.css`,
 * `chrome.css` and `chat.css`, REGARDLESS OF SPECIFICITY. Two consequences
 * were found in Chromium on 2026-10-12, and both are the shape the founder
 * has already reported once:
 *
 *   THE CAPTURE BOX. `chrome.css` says `.jar-mouth-rest:not(--said) {
 *   padding: 8px 12px }` from `@layer chrome`; `home.css` says
 *   `@media (pointer: coarse) .jar-mouth-rest { padding-top/bottom: 14px }`
 *   from `@layer product`. Measured at 393x852 DPR 3 with
 *   `matchMedia("(pointer: coarse)")` true, the element computes
 *   `padding: 12px 16px 4px 16px` — NEITHER of them. The winner is
 *   `.waka-composer-body .jar-keep-box` in unlayered `claims.css`. Two sheets
 *   state a vertical padding for that box and neither reaches it, which is
 *   finding 2 of `docs/reviews/code-quality-2026-10-11.md` with the real
 *   numbers in place of the predicted ones.
 *
 *   THE CHAT PAGE. `home.css:5273`'s `.waka-over--talk .chat-page` sits
 *   OUTSIDE that file's layer blocks, so it out-ranks the whole of
 *   `chat.css`, which is `@layer chrome` end to end. It would win on
 *   specificity today; the day somebody writes `.chat-page` geometry in
 *   `chat.css` and it does not take, this is why, and until now there was no
 *   comment in either file to find.
 *
 * ── WHY THIS IS A RATCHET AND NOT A RULE ──────────────────────────────────
 *
 * Because the honest fix is a restyling and this gate is not the place to
 * smuggle one. `layers.css:48-57` is emphatic that a sheet cannot be moved
 * between precedence levels on its own ("Wrapping chrome.css alone was tried
 * and instantly undid every override it exists to make"), and wrapping
 * `claims.css` in `@layer chrome` would drop 322 rules below `chat.css` and
 * below `home.css`'s own chrome block on every selector they share — 11 class
 * families do. That is the corners, all three overlays, the composer, the
 * card grid and the speech bubble changing at once, and it cannot be signed
 * off by reading a diff.
 *
 * So the debt is COUNTED. `UNLAYERED_CEILING` is the number of unlayered
 * rules in `src/styles` today. It may fall and it may not rise, which means a
 * new sheet written without a layer fails here, and so does a new rule
 * appended past a closing brace — the way all 22 of `home.css`'s got there.
 * The companion case below fails when the ceiling floats above the real
 * count, for the reason `type-scale.test.ts` gives: "a ratchet that cannot
 * notice its own slack is a ratchet that only ever ran once."
 *
 * ── WHAT IS DELIBERATELY UNLAYERED, AND IT IS EXACTLY ONE RULE ────────────
 *
 * `layers.css`'s own `.jar :focus-visible`. Its unlayered position IS the
 * mechanism — "a surface that needs a different-looking focus may draw one;
 * it may not draw nothing" — and it is argued at length in that file. It is
 * named here so the ceiling can go to 1 rather than to 0 and still be true.
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
 * The debt, as it stood when this gate was written.
 *
 *   claims.css   322   the whole file, no `@layer` statement anywhere
 *   home.css      22   lines 4424-4579 and 5154-5317, appended past a brace
 *   layers.css     1   `.jar :focus-visible`, deliberate and argued there
 *
 * 345 total. The ceiling is 345 and the floor it is walking toward is 1.
 *
 * 345 -> 341 on 2026-10-12, and NOT because anybody layered anything — four
 * dead rules went out and took their unlayered-ness with them. The
 * `.jar-char-bubble-go` family (base, `:hover:not(:disabled)`, `:disabled`,
 * `:focus-visible`) had no renderer anywhere in `src`: the offer inside the
 * speech bubble is `.jar-char-bubble-act` now, and the deletion is
 * tombstoned at the family's own block in `claims.css`. claims.css 322 ->
 * 318; the other two files are untouched.
 *
 * WHICH IS THE THIRD RATCHET IN THIS TREE TO MOVE FOR THAT REASON — see the
 * same sentence over `COLOUR_CEILING` and `SPACE_CEILING` in
 * `type-scale.test.ts`, each of which has now fallen only ever because dead
 * rules were deleted. Those two did not move in this pass: the deleted rules
 * carried `var()` tokens and no literals, measured at 72/72 and 19/19 after
 * the cut. This one did, and it is lowered to the real count rather than
 * left with four of slack in it, which is what the companion case below is
 * for and what it caught.
 */
/* RAISED 341 -> 349 ON THE `dev` MERGE (2026-10-12), which is the one
   direction this number is not supposed to move, so the reason is written
   down rather than the number quietly edited.

   341 was measured on this branch before `origin/dev` was merged in. The
   merge brought eight rules that had been written on `dev` since 2026-10-08
   and they land in `claims.css`, which is the sheet that is entirely
   unlayered — so there was nowhere else for them to go. They are not new
   unlayered rules in the sense this gate exists to catch; they are old
   rules arriving for the first time.

   WHAT THE GATE DID CATCH IN THE SAME MERGE, and the reason it earns its
   keep: a ninth rule landed OUTSIDE `chrome.css`'s `@layer chrome` block.
   Our side wrapped that sheet; `dev` appended to the end of it; git merged
   both without a conflict and the rule ended up past the closing brace,
   silently outranking every layered sheet. Nothing else would have seen
   it. It is inside the block now, which is why this is 349 and not 350.

   THE DIRECTION STILL ONLY GOES DOWN from here. The way to make this
   number fall properly is to give `claims.css` a layer — 322 rules that
   currently beat every other sheet — which is deliberately not done
   because it restyles surfaces nobody can verify by reading. */
const UNLAYERED_CEILING = 349;

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

  it("lets no sheet but the three named ones hold an unlayered rule", () => {
    /* THE LIST IS NOT AN ALLOWLIST FOR CONVENIENCE. `claims.css` and
       `home.css` are debts with a measured cost written down in
       `layers.css`'s table; `layers.css` itself is the one deliberate case.
       A FOURTH name appearing here is a new sheet that never got a wrapper,
       which is how `claims.css` happened. */
    const known = new Set(["claims.css", "home.css", "layers.css"]);
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
    /* THE TABLE WAS STALE FOR TWO WHOLE SHEETS and nothing could tell — which
       `layers.css:38-47` records happening ONCE BEFORE, for a different pair,
       and calls "not a harmless stale comment" because the rule it states is
       true and a reader reasoning from a wrong table gets every duplicate
       definition backwards. So the table must name every sheet that has
       rules, by name. */
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
