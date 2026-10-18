/**
 * THE PHONE IS A WIDTH SOMEBODY MEASURED, NOT A WIDTH SOMEBODY ASSUMED.
 *
 * Founder, four separate times: "I want the experience to be more mobile
 * friendly", "treat it as a mobile first app", "must be responsive and good
 * front end practices", and — because the first three had produced nothing
 * anyone could see — "audit some mobile experiences to ensure ours is highly
 * usable and clear and intuitive and aesthetically high craft and update my
 * design as well (directly change code)".
 *
 * On 2026-10-10 `claims.css` was 80 KB holding the top-centre switcher, both
 * corners, all three overlays, the card grid, the composer, the claim ask and
 * the speech bubble, and it contained ZERO width media queries. `chat.css`
 * the same. `home.css` next door had fourteen. Nothing looked obviously
 * shattered, because intrinsic sizing was carrying it — which is exactly why
 * it survived two audits: a surface that is merely fluid LOOKS responsive,
 * and the four things that were actually broken were each invisible until a
 * browser was put at 320 pixels and asked.
 *
 * What it found, in one pass:
 *
 *   - the archive's shelves were FOUR PIXELS TALL at every phone width and 26
 *     at 768, crushed by a flex-shrink nobody had reason to suspect
 *   - the card grid's 260px track overflowed its own 230px overlay at 320
 *   - the delete-confirm row hung 83px off the right edge and squeezed the
 *     conversation preview beside it to ZERO pixels
 *   - and the top of every conversation — 442px of it at 320×568 — was above
 *     the frame AND NOT SCROLLABLE TO, while the scroller cheerfully reported
 *     no overflow at all
 *
 * ── WHAT THIS FILE IS FOR ──────────────────────────────────────────────────
 *
 * Not to re-measure: a unit test has no layout engine and cannot. It holds
 * the two things a measurement cannot hold by itself.
 *
 *   1. THE FIXES, as declarations. Each one is a single property whose
 *      absence re-opens a specific break above, and each is the kind of line
 *      a later tidy-up deletes as redundant — `flex: none` on a row that
 *      obviously only wants to be its own height, a `min()` wrapped around a
 *      grid track that obviously fits. They are not obvious; they are the
 *      bug. So the assertion carries the symptom in its message, because a
 *      failing test that only says "flex: none is missing" teaches the next
 *      person nothing about why it was there.
 *
 *   2. THE WRITING RULE. Every breakpoint in these two sheets must be
 *      preceded by a comment containing the word MEASURED and a pixel number.
 *      `docs/six-laws.md` Law 6 — "nothing is measured once" — and the whole
 *      reason this pass was needed is that the previous two were reasoned
 *      rather than measured. A bare `@media (max-width: 480px)` is a guess
 *      with a number in it, and this is the gate that says so.
 *
 * It deliberately does NOT assert a count of breakpoints, or which widths
 * they use. The right number of breakpoints is however many the measurements
 * demanded, and a test that pins it would be a test against the next
 * measurement.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). Nothing. It reads the two stylesheets
 * off disk and parses them, exactly as `type-scale.test.ts`,
 * `one-class-one-thing.test.ts` and `contrast.test.ts` do.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const STYLES = resolve(HERE, "../src/styles");

/**
 * The two sheets this pass covers, and the reason they are a pair: they were
 * written after the gates were, so they inherited every house rule in spirit
 * and none in fact — the same omission that let two parallel type scales grow
 * (see `type-scale.test.ts`'s own note on why they joined `GOVERNED` late).
 */
const SHEETS = ["claims.css", "chat.css"] as const;

const source = (file: string): string => readFileSync(resolve(STYLES, file), "utf8");

/** Comments blanked, for the rules. The prose in these files quotes CSS, and
    a gate that reads its own documentation as evidence reports work that was
    never done — `type-scale.test.ts` and `check-seams.mjs` each learned this
    the same way. */
const rules = (file: string): string =>
  source(file).replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));

/** The body of one rule, by selector, with comments already blanked. */
function block(file: string, selector: string): string {
  const at = rules(file).indexOf(`\n${selector} {`);
  if (at === -1) return "";
  const open = rules(file).indexOf("{", at);
  const close = rules(file).indexOf("}", open);
  return rules(file).slice(open + 1, close);
}

/**
 * THE CONTENTS OF THE COARSE-POINTER BLOCKS, AND NOTHING ELSE.
 *
 * This read used to be `split(/@media \(pointer: coarse\) \{/)` and keep
 * everything after the brace — which is every rule to the END OF THE FILE,
 * not the rules inside the block. It passed for two months because the
 * coarse blocks happened to sit last in both sheets.
 *
 * On 2026-10-11 a new coarse block was added EARLY in `claims.css` for the
 * me/my-agent switch, and two of the eight acts below started failing while
 * their coarse rules sat in the file untouched: the search was finding each
 * selector's ORDINARY rule first, because that rule now came after a coarse
 * open brace. The gate was wrong, not the stylesheet.
 *
 * The same flaw passes a false positive, which is the half that matters: a
 * `min-height: var(--waka-corner)` written at any pointer would have
 * satisfied a gate whose whole purpose is to ask for it at coarse ONLY —
 * "44 everywhere" being the ruling the house declined, because it moves a
 * composition the founder signed off on. So count braces.
 */
function coarseRules(file: string): string {
  const text = rules(file);
  const open = /@media\s*\(pointer:\s*coarse\)\s*\{/g;
  const blocks: string[] = [];
  for (let m = open.exec(text); m; m = open.exec(text)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const from = i;
    for (; i < text.length && depth > 0; i += 1) {
      if (text[i] === "{") depth += 1;
      else if (text[i] === "}") depth -= 1;
    }
    blocks.push(text.slice(from, i - 1));
  }
  return blocks.join("\n");
}

describe("the phone is a width somebody measured", () => {
  it("has breakpoints at all, which is where this started", () => {
    /* THE FINDING, AS A TEST. Zero width media queries in 80 KB holding the
       entire new UI. Not "too few" — none, so there was no width at which
       anything had been decided. `prefers-reduced-motion` does not count: it
       answers a preference, not a screen.

       ── WHY `chat.css` IS NOT IN THIS ONE, AND WHAT REPLACED IT ───────────

       This assertion originally covered both sheets, written while the pass
       that found the four breaks was still running. It ran out before
       reaching `chat.css`, which left a gate demanding work nobody had
       measured — the exact thing this file exists to forbid, one level up.

       So `chat.css` was measured, on 2026-10-10, with a real touch device
       emulated (Playwright, `hasTouch`, DPR 3) at 320x568, 360x640, 390x844,
       414x896 and 768x1024, on a transcript long enough to overflow and
       inside the overlay it actually renders in. It has NO width-driven
       break: nothing overflows horizontally at any width, the scroller
       reaches both ends of a 3,363px transcript at 320, and the composer
       stays on screen. Its one real phone problem was a 23px touch target on
       `Load earlier messages` — the only way to reach the beginning of a long
       conversation — and a touch target is a POINTER question, so the fix
       lives in that sheet's `pointer: coarse` block where it is measurable.

       Adding a width query to satisfy a gate would have been a number
       somebody picked, dressed as a number somebody observed. The file's own
       escape clause said to delete the assertion and say what replaced it;
       this is the saying. The writing rule below still covers both sheets,
       so the day `chat.css` earns a breakpoint, it has to carry its
       measurement like every other one. */
    for (const file of ["claims.css"]) {
      const sized = [...rules(file).matchAll(/@media\s*\([^)]*(?:max|min)-(?:width|height)[^)]*\)/g)];
      expect(
        sized.length,
        `${file} has no breakpoint that mentions a width or a height. It had ` +
          "none at all until 2026-10-10, and what that cost was four " +
          "separately broken surfaces nobody could see — see this file's " +
          "header. If every one of them was genuinely deleted, delete this " +
          "assertion in the same commit and say what replaced it.",
      ).toBeGreaterThan(0);
    }
  });

  it("never writes a breakpoint without the measurement behind it", () => {
    /* THE HOUSE CONVENTION, ENFORCED. `home.css` has carried a measured table
       above its phone breakpoints since August — the one at `max-width: 560px`
       lists four controls, their x-ranges and the fact that Playwright could
       not tap one of them. That is what a breakpoint in this codebase looks
       like. The rule is simply: the comment above it says MEASURED and names
       a pixel width, so the next person can tell a number that was observed
       from a number that was picked. */
    const offenders: string[] = [];
    for (const file of SHEETS) {
      const text = source(file);
      /* FOUND IN THE RULES, READ IN THE SOURCE.
         This matched against the raw source and promptly failed on a query
         that does not exist: the header above `claims.css`'s breakpoints
         quotes "`@media (max-width: 480px)` with no number behind it" as the
         example of what this codebase does not write, and the matcher read
         its own documentation as a violation — the precise failure the note
         on `rules()` warns about, committed by the file that wrote the note.
         `rules()` blanks comments CHARACTER FOR CHARACTER, newlines kept, so
         offsets are identical in both strings: the query is located in the
         blanked text, where prose cannot pretend to be code, and the comment
         above it is then read out of the real source, where it still exists. */
      const code = rules(file);
      for (const hit of code.matchAll(/@media\s*\([^)]*(?:max|min)-(?:width|height|pointer)[^{]*\{/g)) {
        /* The nearest comment ending above this query. Any distance: these
           headers run forty lines, and the rule is about the comment being
           THERE and being about this query, not about how long it is. */
        const before = text.slice(0, hit.index);
        const ends = before.lastIndexOf("*/");
        const starts = ends === -1 ? -1 : before.lastIndexOf("/*", ends);
        const note = starts === -1 ? "" : before.slice(starts, ends);
        /* Nothing but whitespace between the comment and the query, or it is
           some other rule's comment and this query has none of its own. */
        const attached = ends !== -1 && before.slice(ends + 2).trim() === "";
        if (!attached || !/MEASURED/.test(note) || !/\d{3}\s*[×x]|\b\d{3}px\b|\b\d{3}\b/.test(note)) {
          offenders.push(`${file}: ${hit[0].replace(/\s+/g, " ").slice(0, 60)}`);
        }
      }
    }
    expect(
      offenders,
      "a breakpoint here with no measurement above it:\n  " +
        offenders.join("\n  ") +
        "\nEvery query in these two sheets says MEASURED and carries the " +
        "width it was observed breaking at. Two audits of this were done by " +
        "READING the code, and both missed four real breaks — a number " +
        "nobody stood on a phone to get is a guess wearing a decimal point.",
    ).toEqual([]);
  });
});

describe("the four breaks that a browser found and reading did not", () => {
  /* ═══ THE BAR RAN OFF THE SCREEN AND TOOK CLOSE WITH IT (2026-10-17) ════
     Measured with Playwright on touch: the open-save bar's row was 387px
     inside a 328px dock at 360 and a 288px dock at 320, with no overflow rule
     — Close sat at x 342-403 on a 320px screen. The fix is three lines a
     tidy-up would call redundant: controls never shrink (so the row cannot
     squeeze a tap target), only the state line may, and the dock tightens
     under a phone breakpoint. */
  it("keeps every control in the bottom bar from shrinking, and tightens the bar on a phone", () => {
    const css = rules("claims.css");
    expect(
      /\.waka-dock-item,\s*\.waka-dock-tool,\s*\.waka-dock-sep\s*\{\s*flex:\s*none;/.test(css),
      "the dock's controls lost `flex: none`. Without it a crowded bar shrinks " +
        "Close and the tools below their 44px target — or, with nothing able " +
        "to shrink, runs off the right edge: Close at x 342-403 on a 320px phone.",
    ).toBe(true);
    expect(
      /@media \(max-width: 4\d\dpx\) \{\s*\.waka-dock \{[^}]*max-width:\s*calc\(100vw - var\(--sp-16\)\)/.test(css),
      "the dock no longer tightens on a phone. At the desktop spacing the " +
        "open-save row is 387px and needs a 419px screen to fit.",
    ).toBe(true);
    expect(
      /\.waka-dock-tool[^{]*\{[^}]*\bwidth:\s*(?:[0-3]\d|4[0-3])px/.test(css),
      "a dock tool is sized under 44px. Fitting a narrow phone by shrinking " +
        "the targets put every act under the floor beside a one-press Delete; " +
        "the narrow bar folds Share and Delete into ⋯ instead.",
    ).toBe(false);
  });

  /* ═══ AT 350 THE VERBS ABOUT A NOTE FOLD, AND THE STATE GETS A LINE ════
     Measured 2026-10-17: Back, five 44px tools, Close and two rules need
     343px of a phone; below that Share and Delete fold into ⋯ rather than
     any target shrinking. The ⋯ is hidden above 350 (two classes, because
     `.waka-add` comes later and would show it), its menu hangs from its
     right edge (centred, it ran off a 320px screen), and under 440 a state
     line takes its own row instead of being squeezed to ~10px. */
  it("folds Share and Delete into ⋯ at 350px, anchors its menu right, and gives the state its own line", () => {
    const css = rules("claims.css");
    expect(/\.waka-dock-more\.waka-add\s*\{\s*display:\s*none;/.test(css), "the ⋯ shows at full width").toBe(true);
    expect(
      /@media \(max-width: 350px\) \{\s*\.waka-dock-roomy\s*\{\s*display:\s*none;\s*\}\s*\.waka-dock-more\.waka-add\s*\{\s*display:\s*inline-flex;/.test(css),
      "below 350px Share and Delete no longer fold into ⋯ — the row needs 343px at 44px a target",
    ).toBe(true);
    expect(
      /\.waka-add-menu\.waka-more-menu\s*\{[^}]*right:\s*0;[^}]*transform:\s*none;/.test(css),
      "the ⋯ menu is centred on its button again, which runs it off the right of a 320px phone",
    ).toBe(true);
    expect(
      /\.waka-dock-making:has\(> \.waka-dock-state\)\s*\{[^}]*flex-wrap:\s*wrap;[^}]*\}\s*\.waka-dock-making > \.waka-dock-state\s*\{[^}]*flex:\s*1 0 100%;/.test(css)
        && /\.waka-dock:has\(\.waka-dock-making > \.waka-dock-state\)\s*\{\s*width:\s*calc\(100vw - var\(--sp-16\)\);/.test(css),
      "a state line shares the phone row with the tools again and is squeezed to ~10px",
    ).toBe(true);
  });

  it("keeps the shelves from being crushed to a sliver", () => {
    expect(
      /flex:\s*none/.test(block("claims.css", ".waka-tabs")),
      "`.waka-tabs` has lost `flex: none`. It is a flex child of a " +
        "height-capped column, and `overflow-x` sets its automatic minimum " +
        "size to ZERO — so the grid below borrows its height and the row of " +
        "shelves comes out 4px tall with the pills clipped out of it. " +
        "Measured at 320, 360, 390, 414 AND 768: this was never a phone-only " +
        "bug, the phone is only where it was finally seen.",
    ).toBe(true);
  });

  /* ═══ THE RULE OUTLIVED THE GRID IT WAS WRITTEN FOR ══════════════════
     This named `.waka-cards`, the archive's tile grid, which is gone: the
     founder asked for the Apple Notes list ("copy this for saved
     inspirations") and the archive is a column of grouped rows now, with no
     track to be wider than anything.

     SO THE GATE READS THE SHEET INSTEAD OF A NAME. A rule that checks one
     selector dies with that selector and takes its lesson with it; this asks
     the question of EVERY grid in the two sheets, which means the next grid
     somebody writes is held to it without anybody remembering to add a line
     here. A flat `minmax(260px, 1fr)` is 30px wider than the room's content
     box at 320, so the surface grows a sideways scrollbar on the narrowest
     phone; `min()` inside the minimum is what stops it. */
  it("never lets a grid track be wider than the page it is on", () => {
    const loose: string[] = [];
    for (const file of ["claims.css", "home.css"]) {
      const text = source(file).replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
      for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const track = /grid-template-columns:([^;]*)/.exec(match[2]!)?.[1];
        if (!track || !/minmax\(/.test(track)) continue;
        /* Only an AUTO-FIT/AUTO-FILL track can be forced wider than its
           container: an explicit track list is already bounded by the count
           the author wrote. */
        if (!/auto-fit|auto-fill/.test(track)) continue;
        if (/minmax\(\s*min\(/.test(track)) continue;
        loose.push(`${match[1]!.trim()} in ${file}`);
      }
    }
    expect(
      loose,
      "a repeating grid track has a bare minimum again. A flat " +
        "`minmax(260px, 1fr)` is 30px wider than the room's content box at " +
        "320, so the surface grows a sideways scrollbar on the narrowest " +
        "phone. `.waka-held` has written `minmax(min(22rem, 100%), 1fr)` for " +
        "exactly this reason since it was built; every repeating track owes " +
        "the same.",
    ).toEqual([]);
  });

  /* ═══ THIS CASE NAMED A CLASS NOTHING RENDERS, AND SO COULD NOT FAIL ════
     It was `expect(/flex: 0 0 auto/.test(block("claims.css",
     ".waka-talks-ask"))).toBe(false)`. `block()` returns the EMPTY STRING
     for a selector it cannot find, the regex does not match an empty string,
     and the case therefore passed on nothing at all — a vacuous absence
     assertion of exactly the kind the 2026-10-11 reviews counted seven of.
     The whole `.waka-talks-*` family had been renamed: the list is
     `.waka-rail-*` and `.waka-list-*` now.

     AND THE REGRESSION IT GUARDED HAD ALREADY COME BACK UNDER THE NEW NAME.
     Measured in Chromium at 320x568 with touch, a real account, one
     conversation, its delete asked:

       `.waka-rail-ask` carries the same `flex: 0 0 auto` the old class was
       measured for, and `.waka-rail-item` does not wrap. The group no longer
       OVERFLOWS — it is 145.5px, not 334, because the failure line takes its
       own row — but the preview collapses from 183.7px to 78.5px. Read off
       the screenshot: "a message ...". Seven characters and an ellipsis, on
       the one control that tells you WHICH conversation you are erasing,
       which is the founder-facing half of the original finding.

     SO THE QUESTION IS ASKED OF THE BREAKPOINT RATHER THAN OF A `flex`
     SHORTHAND. What matters is not which of several shorthands the base rule
     writes — it is that under 560 the question gets its own line and the
     preview keeps the width of the row. A rule naming one value dies the
     next time somebody writes the same behaviour a different way; this reads
     the block the behaviour lives in. */
  it("gives the delete question its own line instead of crushing the preview", () => {
    const text = rules("claims.css");
    const at = text.indexOf("@media (max-width: 560px) {");
    expect(
      at,
      "the 560 breakpoint is gone from claims.css. Under it the chats " +
        "list's confirm group and the row's preview share one line, and the " +
        "preview measured 78.5px — about seven characters — at 320.",
    ).toBeGreaterThan(-1);
    let depth = 1;
    let i = at + "@media (max-width: 560px) {".length;
    const from = i;
    for (; i < text.length && depth > 0; i += 1) {
      if (text[i] === "{") depth += 1;
      else if (text[i] === "}") depth -= 1;
    }
    const body = text.slice(from, i - 1);

    expect(
      /\.waka-rail-item\s*\{[^}]*flex-wrap:\s*wrap/.test(body),
      "`.waka-rail-item` no longer wraps under 560. Without it the confirm " +
        "group and the conversation's preview share one line, and the " +
        "preview measured 78.5px at 320 — 'a message ...' — while you are " +
        "asked to confirm erasing it.",
    ).toBe(true);
    expect(
      /\.waka-rail-ask\s*\{[^}]*flex:\s*1\s+0\s+100%/.test(body),
      "`.waka-rail-ask` no longer takes a full line under 560. Its base rule " +
        "pins it at `flex: 0 0 auto` — measured at its widest it took 145.5px " +
        "out of a 232px row — so this override is the only thing standing " +
        "between the question and the preview it is about.",
    ).toBe(true);
    expect(
      /\.waka-rail-item\s*>\s*\.waka-list-row\s*\{[^}]*flex:\s*1\s+1\s+0/.test(body),
      "the row lost its zero flex-basis under 560. With the item wrapping " +
        "and the preview's basis left at `auto` — its full un-truncated " +
        "title, 461px for an ordinary one — the preview alone asks for more " +
        "than the row has and pushes the delete verb onto a second line, on " +
        "every row in the list and not only the one being asked about.",
    ).toBe(true);
  });

  it("does not pin the transcript with a property that eats its own overflow", () => {
    const scroll = block("chat.css", ".chat-scroll");
    expect(
      /justify-content:\s*flex-end/.test(scroll),
      "`.chat-scroll` is back on `justify-content: flex-end`. Overflow in " +
        "the block-START direction of a scroll container is UNREACHABLE — " +
        "measured 442px of conversation above the frame at 320×568, 316 at " +
        "360×640, 89 at 390×844, with the scroller reporting " +
        "`scrollHeight === clientHeight` every time. The beginning of the " +
        "conversation is not clipped, it is gone. `margin-block-start: auto` " +
        "on the transcript does the same job and yields to overflow.",
    ).toBe(false);
    /* AND NOTHING ELSE MAY PUSH IT OFF THE ORIGIN EITHER. On 2026-10-11 the
       transcript stopped being bottom-pinned at all: this is an assistant
       transcript, not a messaging app, and those flow from the top (see
       `.chat-scroll`'s note for the two families and why the mix of them is
       what the founder was looking at when he said "so ugly").

       That is a STRONGER guarantee than the auto margin this gate used to
       require, not a weaker one. The auto margin was safe because it yields
       to overflow; content that flows from the top is safe because there is
       no block-start overflow for a scroller to hide. So the assertion is
       now the whole bug class rather than the one escape from it: neither
       rule that moves content off a scroller's scrollable origin may come
       back to this element. */
    for (const banned of ["margin-block-start:\\s*auto", "justify-content:\\s*flex-end"]) {
      expect(
        new RegExp(banned).test(block("chat.css", ".chat-transcript")),
        `\`.chat-transcript\` has \`${banned.replace("\\s*", ": ")}\` again. ` +
          "Both bottom-pin the transcript, and this surface is read from the " +
          "top — the reply is long-form prose, and prose is read from its " +
          "beginning. `justify-content` additionally re-opens the measured " +
          "bug above: 442px of conversation above the frame at 320×568 with " +
          "the scroller reporting no overflow at all.",
      ).toBe(false);
    }
  });
});

describe("nothing is pushed off a scroller's origin", () => {
  /**
   * THE FLEXBOX TRAP THAT HAS NOW BITTEN THIS CODEBASE TWICE, IN TWO FILES.
   *
   * `justify-content: flex-end` (or `center`) inside a scroll container does
   * not extend the scrollable area — it moves the content off the scrollable
   * ORIGIN. Overflow in the block-start direction becomes unreachable, and
   * the scroller reports `scrollHeight === clientHeight` while doing it, so
   * nothing about the element looks wrong and no measurement of it finds the
   * problem. The content is not clipped. It is gone.
   *
   *   2026-10-10, `.chat-transcript`: 442px of a conversation above the frame
   *   at 320x568, unreachable, with the scroller reporting no overflow.
   *
   *   2026-10-11, `.jar-hq-inner`: the top of a five-line top of mind, same
   *   symptom, found within an hour of writing the band — by the author of
   *   the first fix, who had documented it in `chat.css` the night before.
   *
   * That is what makes it a class rather than an instance. The fix in both
   * cases is an auto margin on the child, which does the same thing when
   * there is room and nothing at all when there is not.
   *
   * This asks the rule the question directly: no rule anywhere in these
   * sheets may both scroll in the block axis and push its own content away
   * from the origin.
   */
  const PUSHERS = /justify-content:\s*(flex-end|center|end|safe\s+flex-end)/;
  const SCROLLS = /overflow(-y)?:\s*(auto|scroll)/;

  for (const file of ["home.css", "claims.css", "chat.css", "chrome.css"]) {
    it(`${file} never scrolls a block axis it has pushed content off`, () => {
      /* PER SELECTOR, NOT PER RULE — and the first version of this gate was
         per rule, which a one-line sabotage walked straight through: the two
         declarations only have to meet on the ELEMENT, not in the same block.
         Splitting them across two rules for the same selector is the exact
         shape a later tidy-up produces, so the union is what gets asked. */
      const text = rules(file);
      const scrolls = new Set<string>();
      const pushes = new Set<string>();
      const rowish = new Set<string>();
      for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const body = match[2]!;
        for (const part of match[1]!.split(",")) {
          const selector = part.trim().replace(/\s+/g, " ");
          if (!selector || selector.startsWith("@")) continue;
          if (SCROLLS.test(body)) scrolls.add(selector);
          if (PUSHERS.test(body)) pushes.add(selector);
          /* A ROW IS INNOCENT. `justify-content` acts on the MAIN axis, so a
             row-direction flex pushing content to the inline end is doing
             nothing to the block axis it scrolls. Only a column — or a
             default-direction block — can strand its own top. */
          if (/flex-direction:\s*row/.test(body)) rowish.add(selector);
        }
      }
      const guilty = [...scrolls].filter((s) => pushes.has(s) && !rowish.has(s)).sort();
      expect(
        guilty,
        "these selectors scroll AND push their content off the scroll " +
          "origin:\n  " + guilty.join("\n  ") + "\n" +
          "Block-start overflow is UNREACHABLE when content is moved by " +
          "`justify-content` rather than by an auto margin, and the scroller " +
          "reports `scrollHeight === clientHeight` while hiding it — so " +
          "nothing looks broken and no measurement finds it. Use " +
          "`margin-block-start: auto` on the first child instead: it yields " +
          "to overflow and `justify-content` does not. `.chat-transcript` " +
          "lost 442px of a conversation this way and `.jar-hq-inner` lost the " +
          "top of a reading."      ).toEqual([]);
    });
  }
});

describe("the acts are reachable by a thumb", () => {
  /**
   * THE LINE `home.css` DREW, APPLIED HERE TOO.
   *
   * It is written out at `home.css`'s own coarse-pointer block: WCAG 2.2 AA
   * asks 24×24, Apple asks 44 and Material 48, and those are recommendations
   * rather than the conformance bar — so THE ACTS get 44, everything else
   * clears 24, and nothing moves a pixel on a desktop. That ruling was made
   * in August on the stylesheet somebody was looking at, and the sheets
   * holding the newer half of the product never heard about it, which is Law
   * 3 in one sentence.
   *
   * Measured under the floor and raised: the two destinations in the save
   * box, the mic beside them, the shelf tabs, the row that opens a
   * conversation, both rows of the account card, the way into a conversation
   * from the speech bubble, and the chat's send.
   */
  const ACTS: ReadonlyArray<readonly [string, string, string]> = [
    ["claims.css", ".waka-composer-send", "where what you typed goes"],
    ["claims.css", ".waka-composer-ask", "the other destination for it"],
    ["claims.css", ".waka-composer-mic", "how the words get in"],
    ["claims.css", ".waka-tab", "choosing a shelf, inside a sideways slider"],
    /* ═══ TWO OF THESE NAMED CLASSES NOTHING RENDERS ════════════════════
       `.waka-talks-open` and `.jar-char-bubble-go` were in this list until
       2026-10-12 and both had zero renderers in `packages/web/src`. Unlike
       the absence assertions elsewhere in this file these did not pass
       vacuously — the loop below FAILS on a selector with no coarse rule —
       so they passed because the dead rules were still in the sheet. That
       is the worse half of the same disease: the gate was green, the rule
       it checked was unreachable, and the live control it was written about
       was never measured.

       `.jar-char-bubble-go` is the sharp one. The offer inside the bubble is
       `.jar-char-bubble-act` now, and it arrived with NO floor at all:
       measured in Chromium at 320x568 with touch, "Add an inspiration" was
       93.8 x 18 — under the 24 WCAG 2.2 AA asks, let alone the 44 this
       project gives acts — while this list asserted, and got, 44 on a class
       no hand could reach.

       `.waka-talks-open` is the press that opens a conversation, which is
       `.waka-list-row` now and is the same class the archive and the
       principles list use, so the floor covers three surfaces instead of
       one. Only the floor moved: the old rule's `align-items: center` was
       written for a one-line ROW and `.waka-list-row` is a COLUMN — see the
       note on the rule itself. */
    ["claims.css", ".waka-list-row", "opening a conversation, a save or a principle"],
    ["claims.css", ".waka-account-out", "signing out"],
    ["claims.css", ".jar-char-bubble-act", "the way into a conversation"],
    ["chat.css", ".chat-page .chat-send", "the one act on the chat surface"],
  ];

  for (const [file, selector, what] of ACTS) {
    it(`grows ${selector} to a thumb's target on a coarse pointer`, () => {
      /* Asked of the COARSE BLOCKS specifically, not of the file: a rule that
         gave every pointer 44 would be the "44 everywhere" the house ruling
         declined, and it would move the desktop composition the founder
         signed off on. */
      const coarse = coarseRules(file);
      const at = coarse.indexOf(selector);
      const body = at === -1 ? "" : coarse.slice(at, coarse.indexOf("}", at));
      expect(
        /min-height:\s*var\(--waka-corner\)/.test(body),
        `${selector} (${what}) is no longer brought to \`--waka-corner\` on a ` +
          "coarse pointer. It measured under 44px on every phone width " +
          "tested, in English and in Korean, and it is one of the things a " +
          "person reaches for one-handed — a mis-hit costs them the thing " +
          "they were keeping or the conversation they were opening.",
      ).toBe(true);
    });
  }

  it("names the target size once, so the reserve and the button cannot drift", () => {
    /* `--waka-corner` is declared as "the fixed corner buttons' target size…
       named because two things depend on it". Eight more things depend on it
       now, which is a stronger reason for it to exist and the same reason it
       must not be written out as a literal at any of them. */
    expect(
      /--waka-corner:\s*44px/.test(source("claims.css")),
      "`--waka-corner` is gone or is no longer 44px. Every coarse-pointer " +
        "target in both sheets names it, and a target size that resolves to " +
        "nothing does not look like a broken rule anywhere — it looks like a " +
        "button that quietly got small again.",
    ).toBe(true);
  });
});
