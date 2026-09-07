/**
 * ONE CLASS, ONE THING — A NAME CANNOT BELONG TO TWO COMPONENTS.
 *
 * Founder, 2026-09-08, from a phone: "when clicking on the text that was
 * formed, this weird thing appears at the bottom. It doesn't happen in
 * desktop."
 *
 * What it was. `home.css` declared `.jar-ground` TWICE, in two blocks 230
 * lines apart, written months apart, for two components that have nothing to
 * do with each other:
 *
 *     .jar-ground { display: block; width: 100%; ... }   a memory the claim
 *                                                        stands on — a
 *                                                        quotation you can
 *                                                        press
 *     .jar-ground { position: absolute; left: 18px;      the bottom-left
 *                   bottom: 46px; display: flex; ... }   whose-ground picker
 *
 * A stylesheet is one cascade. The second block is later, so it won — and it
 * won for BOTH elements. Pressing the claim on your own wall therefore took
 * the memory underneath it, tore it out of its container, pinned it to the
 * bottom-left corner of the nearest positioned ancestor, laid it out as a
 * flex row, and — because `system.css` names `.jar-ground` in the uppercase
 * label register too — SET THE QUOTATION IN CAPITALS.
 *
 * Every single gate in this repository was green while that shipped.
 * `e2e:measure` reads computed styles and got exactly what the CSS said.
 * `e2e:dead-css` asks which rules are alive: both were, gloriously.
 * `nothing-invisible-takes-a-press` asks whether controls can be pressed: it
 * could. `e2e:phone` measures overlap between CONTROLS, and the thing landing
 * on top of the claim is a paragraph. Nothing was broken in the sense any of
 * them can express. The defect is upstream of all of them: two components
 * were given one name, and after that the cascade behaved perfectly.
 *
 * ── WHAT THIS ASKS ─────────────────────────────────────────────────────────
 *
 * Of every bare single-class selector (`.foo`, alone, no compound, no
 * combinator, no pseudo) declared in an UNCONDITIONAL block: is it declared
 * that way in more than one place, with both blocks setting LAYOUT?
 *
 * Three narrowings, each one deliberate, because a gate that cries wolf is
 * deleted by the third person who meets it:
 *
 *   - BARE SINGLE CLASSES ONLY. `.jar-was .jar-ask` and `.jar-panel button`
 *     are scoped by construction — they name a thing INSIDE another thing,
 *     which is how a component redresses its own children. Only the bare form
 *     claims the name outright.
 *   - UNCONDITIONAL BLOCKS ONLY. A `@media (pointer: coarse)` block that
 *     re-declares `.jar-values { padding-top }` is the same component
 *     answering a different device. That is what media queries are for.
 *     `@layer` wrappers are not conditions and are walked through.
 *   - LAYOUT IN BOTH. A second block that only sets `color` or `opacity` is a
 *     state, a theme or a register — the overwhelmingly common and correct
 *     reason to name a class twice. It is when both blocks decide WHERE
 *     SOMETHING GOES that two authors are demonstrably talking about two
 *     different boxes.
 *
 * The rule is stricter than the bug that produced it on purpose: the failure
 * mode is not "absolute position leaks", it is "a name means two things", and
 * the next instance of it will not be a `position: absolute`.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). Nothing. It reads the stylesheets off
 * disk and parses them, exactly as `type-scale.test.ts` and `contrast.test.ts`
 * do.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const STYLES = resolve(HERE, "../src/styles");

/**
 * The sheets that dress the world. `surface.css` is exempt for the same
 * reason `type-scale.test.ts` exempts it — it is the flat screens' sheet and
 * `one-product-one-system.md` Phase 6 deletes it. If the flat screens are
 * ever kept instead, this exemption becomes a bug.
 */
const GOVERNED = ["home.css", "chrome.css", "global.css", "system.css"] as const;

/**
 * Properties that decide where a box is and how big it is.
 *
 * `color`, `font-*`, `opacity`, `background`, `border-color`, `transition`
 * and friends are deliberately absent: re-declaring those under one name is
 * what a state or a theme IS.
 */
const LAYOUT = new Set([
  "position",
  "display",
  "top",
  "right",
  "bottom",
  "left",
  "inset",
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "float",
  "flex",
  "flex-direction",
  "flex-wrap",
  "grid",
  "grid-template-columns",
  "grid-template-rows",
  "place-items",
  "align-items",
  "justify-content",
  "transform",
  "translate",
]);

/** Read the rules, not the prose — the same blanking `type-scale` uses. */
const commentsBlanked = (css: string): string =>
  css.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));

/** One declaration block, and where a reader will find it. */
interface Block {
  file: string;
  line: number;
  selector: string;
  props: string[];
  /** property -> value as written, for the layout properties only */
  laid: Map<string, string>;
  /** whether the block names this class and NOTHING else */
  solo: boolean;
  /** which cascade layer it landed in — a redress across layers is not a clash */
  layer: string;
}

/**
 * Every unconditional rule block in one sheet, as (selector, properties).
 *
 * Hand-rolled rather than a parser dependency, and small enough to read: walk
 * the characters, keep a stack of the at-rules we are inside, and take a block
 * only when nothing on that stack is a CONDITION. `@layer` and `@scope` are
 * not conditions. `@keyframes` is skipped wholesale — its "selectors" are
 * percentages.
 */
function blocksIn(file: string): Block[] {
  const css = commentsBlanked(readFileSync(resolve(STYLES, file), "utf8"));
  const out: Block[] = [];
  const stack: string[] = [];
  let head = "";
  let line = 1;
  let headLine = 1;
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i]!;
    if (ch === "\n") line += 1;
    if (ch === "{") {
      const selector = head.trim();
      head = "";
      if (selector.startsWith("@")) {
        stack.push(selector);
        continue;
      }
      /* a declaration block: read to its matching brace */
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
      const conditional = stack.some(
        (at) =>
          at.startsWith("@media") ||
          at.startsWith("@supports") ||
          at.startsWith("@container") ||
          at.startsWith("@keyframes"),
      );
      if (!conditional) {
        const props: string[] = [];
        const laid = new Map<string, string>();
        for (const m of body.matchAll(/(^|[;{])\s*([-a-z]+)\s*:\s*([^;}]*)/g)) {
          props.push(m[2]!);
          if (LAYOUT.has(m[2]!)) laid.set(m[2]!, m[3]!.trim());
        }
        const parts = selector.split(",").map((one) => one.trim());
        const layer = stack.filter((at) => at.startsWith("@layer")).join(" ");
        for (const one of parts) {
          out.push({
            file,
            line: headLine,
            selector: one,
            props,
            laid,
            solo: parts.length === 1,
            layer,
          });
        }
      }
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
 * THE ONE PAIR THIS GATE INHERITED AND DID NOT FIX, and it is a list that
 * only ever shrinks — the same ratchet `type-scale.test.ts` keeps.
 *
 * `.nc-stage--top-of-mind-wall` is declared in `global.css` and again in
 * `system.css`, both inside `@layer product`, and the two disagree about
 * three grid properties. Which one wins is decided by the order the BUNDLER
 * concatenates two files — the precise hazard `layers.css` was written to
 * end, still live inside a single layer.
 *
 * It is not fixed here because it belongs to the public profile page, one of
 * the flat screens `one-product-one-system.md` Phase 6 deletes, and merging
 * two grid definitions blind would restyle a page this change has no business
 * touching. When that screen goes, this entry goes with it. Nothing may be
 * added to this list to make a build pass: a new collision is a new bug.
 */
const INHERITED = new Set([".nc-stage--top-of-mind-wall"]);

/** `.foo` and nothing else — no compound, no combinator, no pseudo, no state. */
const BARE_CLASS = /^\.[a-zA-Z][\w-]*$/;

describe("one class, one thing", () => {
  it("no bare class is laid out by two different blocks", () => {
    const byClass = new Map<string, Block[]>();
    for (const file of GOVERNED) {
      for (const block of blocksIn(file)) {
        if (!BARE_CLASS.test(block.selector)) continue;
        if (!block.solo) continue;
        if (!block.props.some((p) => LAYOUT.has(p))) continue;
        const bag = byClass.get(block.selector);
        if (bag) bag.push(block);
        else byClass.set(block.selector, [block]);
      }
    }
    const collisions: string[] = [];
    for (const [name, blocks] of byClass) {
      for (let a = 0; a < blocks.length; a += 1) {
        for (let b = a + 1; b < blocks.length; b += 1) {
          const one = blocks[a]!;
          const two = blocks[b]!;
          /* a redress across cascade layers is the documented way chrome.css
             dresses global.css — it is one component in two voices */
          if (one.layer !== two.layer) continue;
          if (INHERITED.has(name)) continue;
          const fought = [...one.laid.entries()]
            .filter(([prop, value]) => two.laid.has(prop) && two.laid.get(prop) !== value)
            .map(([prop, value]) => `${prop}: ${value} vs ${two.laid.get(prop)}`);
          if (fought.length === 0) continue;
          collisions.push(
            `${name} — ${one.file}:${one.line} and ${two.file}:${two.line} ` +
              `disagree about ${fought.join("; ")}`,
          );
        }
      }
    }
    expect(
      collisions,
      "Two components share one class name, so the later block silently " +
        "re-lays-out the earlier one's element. Rename one of them.\n" +
        collisions.join("\n"),
    ).toEqual([]);
  });

  it("reads the sheets it claims to read", () => {
    /* A parser that silently returns nothing passes the test above forever.
       This is the tripwire under it: home.css is the world's own sheet and it
       has hundreds of unconditional bare-class blocks. */
    const home = blocksIn("home.css").filter((b) => BARE_CLASS.test(b.selector));
    expect(home.length).toBeGreaterThan(200);
    /* and the conditional half is really excluded: `.jar-values` is
       re-declared inside `@media (max-width: 560px)`, which is not a
       collision and must not be counted as one */
    const values = home.filter((b) => b.selector === ".jar-values" && b.solo);
    expect(values.length).toBe(1);
    expect(home.every((b) => b.line > 0)).toBe(true);
    expect(home.some((b) => b.line > 500)).toBe(true);
  });

  it("the inherited pair is still really there, and still really a clash", () => {
    /* An allowlist that outlives its entry is a lie the next reader believes.
       This fails the day `.nc-stage--top-of-mind-wall` is fixed or deleted,
       which is the day the entry above must go. */
    const seen = new Map<string, string[]>();
    for (const file of GOVERNED) {
      for (const block of blocksIn(file)) {
        if (!INHERITED.has(block.selector) || !block.solo) continue;
        const bag = seen.get(block.selector);
        if (bag) bag.push(`${file}:${block.line}`);
        else seen.set(block.selector, [`${file}:${block.line}`]);
      }
    }
    for (const name of INHERITED) {
      expect(seen.get(name)?.length ?? 0, `${name} is no longer declared twice`).toBeGreaterThan(1);
    }
  });
});
