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
 * ══ WHAT CHANGED UNDER THIS GATE, AND IT IS THE PREMISE ═══════════════════
 *
 * THE PRESS-TO-SWAP IS GONE. The resting face is no longer a button that is
 * replaced by a textarea: it IS a textarea —
 * `<textarea className="jar-mouth-rest jar-keep-box" rows={1}>` at
 * `Home.tsx:15376`, and `claims.css` says it in one line, "The capture entry
 * is a field now, not a button that opens one." `.jar-mouth-field` has moved
 * to `InspirationComposer.tsx:335`, which renders the FULL-PAGE NOTEPAD — the
 * component the paragraph below excludes by name.
 *
 * Measured in Chromium, signed in, 2026-10-12:
 *
 *                      coarse 393x852 DPR3        fine 1200x900
 *   .jar-mouth-rest    351x44 at y=543            509x44 at y=567
 *                      padding 12px 16px 4px      same
 *   .jar-mouth-field   346x341 at y=104           544x360 at y=104
 *                      padding 0                  padding 0
 *
 * Two surfaces, four hundred pixels apart, one of them eight times the
 * other's height. So the founder's report — ink moving when the phrase is
 * pressed — is now structurally impossible rather than merely fixed: there is
 * one element and it does not get replaced. THAT IS WHY THIS GATE IS KEPT
 * RATHER THAN RETIRED: the swap is the kind of thing that comes back (it has
 * been three shapes in three weeks), and a register of which sheets state a
 * vertical padding for these two names is worth having when it does.
 *
 * ══ AND IT USED TO READ ONE FILE, WHICH MADE IT GREEN AND WRONG ═══════════
 *
 * `const SHEET = resolve(HERE, "../src/styles/home.css")`. Three sheets state
 * a vertical padding for these two names, and the gate opened one of them, so
 * it reported three conditions in agreement while `chrome.css` was setting
 * the rest face `padding: var(--sp-8) var(--sp-12)` unconditionally from a
 * LATER LAYER. Finding 2 of `docs/reviews/code-quality-2026-10-11.md` proved
 * that by running this file's own `verticalPadding` over the rule it could
 * not see: three mismatches, against `3 passed`. A gate pinned to one file,
 * guarding a property three sheets set, is a gate that will go green again.
 *
 * It reads every sheet in `src/styles` now, in load order, and ranks a
 * declaration by its LAYER FIRST and its document position second — which is
 * the actual cascade between two bare classes of equal specificity, and which
 * cannot be computed from one file at all.
 *
 * ══ THE BLIND SPOT, STATED BECAUSE IT IS LOAD-BEARING ═════════════════════
 *
 * NEITHER OF THE TWO DECLARATIONS THIS GATE COMPARES ACTUALLY WINS TODAY.
 * `CSS.getMatchedStylesForNode` on the real page names the winners:
 *
 *   rest    `.waka-composer-body .jar-keep-box`  claims.css, UNLAYERED
 *                                                padding 12px 16px 4px
 *   field   `.jar-seek.jar-inspiration-composer .jar-composer-text`
 *                                                chrome.css, (0,3,0)
 *                                                padding 0
 *
 * Both reach the element through a class it ALSO wears, scoped by an
 * ancestor. A gate that parses selector text cannot resolve either: it would
 * have to know the element's full class list and its ancestors, which is to
 * say it would have to be a browser. `tools/e2e/dead-css.ts`'s header makes
 * the same point about the cascade generally — "the only thing that
 * implements all five correctly is a browser" — and that is where a check on
 * the COMPUTED padding of these two elements belongs. It is not written yet;
 * the numbers above are the measurement a person took by hand.
 *
 * So what this gate holds is narrower than its title and worth being exact
 * about: of the rules that name either face as their SUBJECT with no extra
 * class, no two sheets may disagree about vertical padding under any
 * condition. That catches the 2026-08-25 regression and the one found on
 * 2026-10-12. It does not catch a rule arriving through `.jar-keep-box`.
 *
 * WHAT IT DELIBERATELY DOES NOT ASK. Anything about the drawer
 * (`.jar-mouth-slot--note .jar-mouth-field`), which is a compound selector
 * and a different component: a full-page note is not pretending to be the
 * resting line. And anything about horizontal padding, width or the face —
 * the field is wider than the phrase on purpose, and a wider box does not
 * move a centred line.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). Nothing. It reads every sheet in
 * `src/styles` off disk and parses them, exactly as
 * `one-class-one-thing.test.ts`, `type-scale.test.ts` and
 * `one-cascade.test.ts` do.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const STYLES = resolve(HERE, "../src/styles");

/**
 * Every sheet, in the order the bundle loads them.
 *
 * The order matters only for ties INSIDE one layer, which is exactly the tie
 * `layers.css` exists to stop mattering — but two bare classes in the same
 * layer are still settled by it, so it is stated here rather than discovered
 * from `readdirSync`'s alphabetical accident. `layers.css` is in the list
 * because its one unlayered rule would outrank every layer; it sets no
 * padding on either face today, which is a thing to have asked.
 */
const SHEETS = [
  "layers.css",
  "global.css",
  "system.css",
  "home.css",
  "chrome.css",
  "chat.css",
  "claims.css",
] as const;

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
  /** where a reader will find it, for the failure message */
  where: string;
}

/**
 * Does this selector have `face` as its SUBJECT, with no other class on it?
 *
 * `.jar-mouth-rest` yes. `.jar-mouth-rest:not(.jar-mouth-rest--said)` yes —
 * that is the same element with a pseudo-class, and it is the selector
 * `chrome.css` used to set a padding this gate could not see; it is also a
 * no-op, because `.jar-mouth-rest--said` has no renderer anywhere in `src`.
 * `.jar-mouth-slot--away .jar-mouth-rest` NO: an ancestor-scoped rule is a
 * different component talking about its own child, which is the narrowing
 * this file has always made and still makes.
 * `.waka-composer-body .jar-keep-box` NO, and it is the rule that actually
 * wins — see the blind spot in the header.
 */
function subjectIs(selector: string, face: string): boolean {
  const one = selector.trim();
  if (one === face) return true;
  if (!one.startsWith(face)) return false;
  const tail = one.slice(face.length);
  /* only pseudo-classes and pseudo-elements may follow: a `.`, a space, a
     `>`, `+`, `~` or an attribute all mean a different subject */
  return /^(:{1,2}[a-z-]+(\([^)]*\))?)+$/.test(tail);
}

/**
 * Every unconditional-or-media declaration whose subject is `selector`,
 * across every sheet, in cascade order.
 *
 * Hand-rolled for the same reason `one-class-one-thing.test.ts` gives: walk
 * the characters, keep a stack of the at-rules we are inside, and read a
 * block only when the selector list names this face as a subject.
 */
function declarationsOf(selector: string): Decl[] {
  const out: Decl[] = [];
  let order = 0;
  for (const sheet of SHEETS) {
    out.push(...inOneSheet(sheet, selector, () => (order += 1)));
  }
  return out;
}

function inOneSheet(sheet: string, selector: string, tick: () => number): Decl[] {
  const css = readFileSync(resolve(STYLES, sheet), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    (b) => b.replace(/[^\n]/g, " "),
  );
  const out: Decl[] = [];
  const stack: string[] = [];
  let head = "";
  let line = 1;
  let headLine = 1;
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i]!;
    if (ch === "\n") line += 1;
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
        if (c === "\n") line += 1;
        if (c === "{") depth += 1;
        else if (c === "}") depth -= 1;
        if (depth > 0) body += c;
      }
      i = j - 1;
      const at = tick();
      if (stack.some((s) => s.startsWith("@keyframes"))) continue;
      if (!sel.split(",").some((one) => subjectIs(one, selector))) continue;
      const props = new Map<string, string>();
      for (const m of body.matchAll(/(^|[;{])\s*([-a-z]+)\s*:\s*([^;}]*)/g)) {
        props.set(m[2]!, m[3]!.trim());
      }
      out.push({
        condition: stack.filter((s) => !s.startsWith("@layer")).join(" "),
        rank: rankOf(stack.filter((s) => s.startsWith("@layer")).join(" ")),
        order: at,
        props,
        where: `${sheet}:${headLine}`,
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

/**
 * The vertical padding a face ends up with under `condition`, as written, and
 * WHERE THE LAST WORD ON IT WAS SAID — because a mismatch between two sheets
 * is unactionable without the two file:line pairs, and this gate's whole
 * failure mode was not knowing a second sheet existed.
 */
function verticalPadding(
  decls: Decl[],
  condition: string,
): { top: string; bottom: string; where: string } {
  const apply = decls
    .filter((d) => d.condition === "" || d.condition === condition)
    .sort((a, b) => a.rank - b.rank || a.order - b.order);
  let top = "0";
  let bottom = "0";
  let where = "nothing declares it";
  for (const d of apply) {
    if (
      d.props.has("padding") ||
      d.props.has("padding-top") ||
      d.props.has("padding-bottom")
    ) {
      where = d.where;
    }
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
  return { top, bottom, where };
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

  it("reads sheets that really declare both faces, and more than one of them", () => {
    /* the tripwire: a parser that finds nothing agrees with everything */
    expect(rest.length, "no .jar-mouth-rest blocks found").toBeGreaterThan(1);
    expect(field.length, "no .jar-mouth-field blocks found").toBeGreaterThan(1);
    expect(conditionsInPlay(rest, field)).toContain("@media (pointer: coarse)");
    /* AND THE ONE-FILE BUG CANNOT COME BACK QUIETLY. This gate was green for
       a whole session because it opened `home.css` alone while `chrome.css`
       set the rest face a padding from a later layer. If every declaration it
       can see is from one sheet again, either the product moved or the
       walker broke, and both want a person. */
    const sheetsSeen = new Set([...rest, ...field].map((d) => d.where.split(":")[0]!));
    expect(
      sheetsSeen.size,
      `every declaration of these two faces came from one sheet (${[...sheetsSeen]}). ` +
        "This gate read one file for its whole life and was green while the " +
        "invariant was false; seeing one sheet again is that shape returning.",
    ).toBeGreaterThan(1);
  });

  it("gives both the same air above and below the words, in every condition", () => {
    const wrong: string[] = [];
    for (const condition of conditionsInPlay(rest, field)) {
      const a = verticalPadding(rest, condition);
      const b = verticalPadding(field, condition);
      if (a.top !== b.top || a.bottom !== b.bottom) {
        wrong.push(
          `${condition || "unconditional"} — ${REST} has ${a.top}/${a.bottom} ` +
            `(from ${a.where}) and ${FIELD} has ${b.top}/${b.bottom} ` +
            `(from ${b.where})`,
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
