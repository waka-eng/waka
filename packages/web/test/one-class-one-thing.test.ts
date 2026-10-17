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
 * could. `e2e:phone` hit-tests every control's own centre and WOULD have
 * caught it — both the evidence sentence and the claim are buttons — but the
 * evidence only exists once the claim has been pressed, and that walk never
 * presses it. Nothing was broken in the sense any of them can express. The defect is upstream of all of them: two components
 * were given one name, and after that the cascade behaved perfectly.
 *
 * ── WHAT THIS ASKS ─────────────────────────────────────────────────────────
 *
 * Of every bare single-class selector (`.foo` — no compound, no combinator,
 * no pseudo) named by an UNCONDITIONAL block: do two such blocks in the same
 * cascade layer DISAGREE about the value of a layout property they both set?
 * A disagreement means one of them is dead, silently, and a dead layout
 * declaration is either a bug or a lie.
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
 * Every sheet in `src/styles` that carries class rules. `layers.css` is in the
 * list because an unlayered rule in it would outrank every layer; it holds
 * only the layer order and one compound selector today, so it contributes
 * nothing — which is the point of asking rather than assuming.
 *
 * (An earlier draft of this note exempted `surface.css`, copied from
 * `type-scale.test.ts`. That file was deleted on 2026-08-26 — the exemption
 * described a file that is not there, in a list it was not in.)
 *
 * `claims.css` AND `chat.css` JOINED ON 2026-10-10, two days after they
 * joined `type-scale.test.ts`'s list for the same reason. The omission was
 * identical and so was its cost: the two sheets that carry the switcher, the
 * corners, all three overlays, the card grid, the composer and the chat
 * console were the only live sheets in `src/styles` no structural gate read.
 * A gate with a hand-written list of what it watches only watches the past.
 *
 * ── WHAT ADDING THEM SURFACED: NOTHING, AND THAT IS A FINDING ──────────────
 *
 * Zero new collisions. That is not the two sheets being clean — it is this
 * gate being unable to see the shape they actually had. The 2026-10-10 audit
 * named two duplications in `claims.css`,
 * `.waka-composer-send:disabled` and `.waka-composer-ask:focus-visible`, and
 * `BARE_CLASS` below excludes BOTH: a selector carrying `:disabled` or
 * `:focus-visible` is not a bare class, so neither was ever a candidate.
 *
 * Checked by hand instead, and they are two different things:
 *
 *   - `.waka-composer-ask:focus-visible` really was declared twice, fifty
 *     lines apart, with the same two declarations verbatim. REMOVED. Nothing
 *     about it looked wrong, because the values agreed — the cascade produced
 *     the correct ring from either block, which is exactly why it survived.
 *   - `.waka-composer-send:disabled` is declared twice and is NOT a defect.
 *     One block sets `cursor`, the other sets `border-color` / `background` /
 *     `color`; the property sets are DISJOINT and the pairing carries a
 *     comment explaining it ("both go quiet together, and neither
 *     disappears"). An audit that counts declarations calls this a
 *     duplication. It is one component answering one state in two places,
 *     which is untidy and true.
 *
 * ── WHY THE GATE WAS NOT WIDENED TO CATCH THEM ─────────────────────────────
 *
 * Measured before deciding, because that is what the narrowings above were.
 * Asking "does any selector set the same property in two unconditional
 * blocks in one layer" reports FIFTY-ONE pairs across the governed sheets,
 * and almost every one is the documented idiom: `chrome.css` redressing
 * `global.css`, and `system.css` holding the register that `global.css`
 * states loosely. Narrowing all the way to "same FILE, same selector, same
 * property, same VALUE" — the only form that can never be a redress, a theme
 * or a state — still reports ELEVEN.
 *
 * Eleven means an allowlist of eleven, and this file's own doctrine is that
 * an allowlist that size "is not a gate — it is a list of things the gate has
 * agreed not to look at". So the sheets are in the list and the rule is
 * unchanged. The eleven are real and worth draining by hand; the day they are
 * down to zero is the day this check is worth writing, and not before.
 */
const GOVERNED = [
  "home.css",
  "chrome.css",
  "global.css",
  "system.css",
  "layers.css",
  "claims.css",
  "chat.css",
] as const;

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
  let quote = "";
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i]!;
    if (ch === "\n") line += 1;
    /* STRINGS ARE NOT STRUCTURE. `content: "}"` closed a block early and
       `content: "{"` swallowed the rule after it — one hid a real collision,
       the other invented one. */
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      head += ch;
      continue;
    }
    /* A STATEMENT AT-RULE ENDS AT ITS SEMICOLON. `@layer a, b;` and
       `@import url(x);` have no block, so an accumulating `head` ran on and
       read the NEXT rule's brace as the at-rule's own — deleting that rule
       from the gate's view entirely. */
    if (ch === ";") {
      head = "";
      continue;
    }
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
      let bq = "";
      for (; j < css.length && depth > 0; j += 1) {
        const c = css[j]!;
        if (c === "\n") line += 1;
        if (bq) {
          if (c === "\\") { body += c + (css[j + 1] ?? ""); j += 1; continue; }
          if (c === bq) bq = "";
          body += c;
          continue;
        }
        if (c === '"' || c === "'") { bq = c; body += c; continue; }
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
 * THE ONE PAIR THIS GATE INHERITED IS RETIRED, AND THE LIST IS NOW EMPTY.
 *
 * `.nc-stage--top-of-mind-wall` was declared in `global.css` and again in
 * `system.css`, with three grid properties in disagreement — which of them
 * won decided by the order the BUNDLER concatenated two files, the precise
 * hazard `layers.css` was written to end, still live inside a single layer.
 *
 * The note here said the condition for retiring it was "someone harmonising
 * those three grid properties on purpose". That is not what happened, and
 * what did happen is better: the class had no renderer left. `.nc-*` was the
 * flat screens' language — the post-it, its stage, its titlecard — and
 * `PublicProfile.tsx` was its last host anywhere in the tree until that page
 * was rewritten in the product's own material. So the clash went out with 43
 * dead rules rather than being resolved, which is the honest outcome for a
 * collision between two definitions of a thing nobody draws.
 *
 * Two things worth keeping:
 *
 *   - This entry's own reasoning was WRONG about the escape route. It argued
 *     the entry could not be fixed because merging the grids "would restyle
 *     the public profile page, which this change has no business touching" —
 *     correct at the time, and it quietly assumed the page would keep
 *     needing those rules. The page is still live; its styling is not.
 *   - The ceiling is zero now and the list is empty. Nothing may be added to
 *     either to make a build pass: a new collision is a new bug.
 */
const INHERITED = new Set<string>([]);

/** A ratchet, and it only turns down. It is at zero; it stays there. */
const INHERITED_CEILING = 0;

/**
 * THE LIMIT THIS GATE KNOWS IT HAS, written down rather than discovered.
 *
 * `solo` below is the rule's ARITY: a block counts only if its whole selector
 * list is this one class. So a hostile or careless author can hide a class
 * from this gate by adding any second selector to the comma list.
 *
 * That hole is deliberate, and it was measured before being accepted. Judging
 * per-PART instead flags seven pairs in the tree today, and every one of them
 * is the legitimate idiom this codebase is built on: a shared rule naming
 * four signposts at once (`home.css:622`, `position: relative`), then each
 * signpost's own block setting `position: absolute` over it. Those overrides
 * are intended — the group's declaration being dead for those four is how the
 * cascade is being used, not a defect. A gate that reports them is a gate
 * somebody deletes, and then the real collision has nothing watching it.
 *
 * So: this catches the accident, which is what happened, and not the evasion,
 * which has not.
 */
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
          /* A redress across cascade layers is the documented way chrome.css
             dresses global.css — one component in two voices, not a clash.
             AN UNLAYERED RULE IS NOT THAT. It outranks every layer at any
             specificity (`layers.css` relies on exactly that), so it is the
             most dangerous neighbour to have, not an exempt one — and
             home.css already carries 18 unlayered blocks, one missing indent
             away from being this bug again. */
          const bothLayered = one.layer !== "" && two.layer !== "";
          if (bothLayered && one.layer !== two.layer) continue;
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
       has hundreds of unconditional bare-class blocks.

       200 -> 150 on 2026-10-12. Rooms were removed (founder: "방 없애") and 69
       of home.css's bare-class blocks went with them — the room's settings
       sheet, its proposals, its stance row, its progress stages, the band of
       member grounds and the room's own doors. This is a TRIPWIRE for a dead
       parser, not a ratchet on the sheet's size, so it is set well below the
       real figure rather than at it; a gate that fails on honest subtraction
       teaches people to edit the gate. */
    const home = blocksIn("home.css").filter((b) => BARE_CLASS.test(b.selector));
    expect(home.length).toBeGreaterThan(150);
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
    expect(INHERITED.size, "the inherited list may only shrink").toBeLessThanOrEqual(
      INHERITED_CEILING,
    );
    for (const name of INHERITED) {
      expect(seen.get(name)?.length ?? 0, `${name} is no longer declared twice`).toBeGreaterThan(1);
    }
  });
});
