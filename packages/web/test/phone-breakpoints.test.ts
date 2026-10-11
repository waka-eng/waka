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

describe("the phone is a width somebody measured", () => {
  it("has breakpoints at all, which is where this started", () => {
    /* THE FINDING, AS A TEST. Zero width media queries in 80 KB holding the
       entire new UI. Not "too few" — none, so there was no width at which
       anything had been decided. `prefers-reduced-motion` does not count: it
       answers a preference, not a screen. */
    for (const file of SHEETS) {
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
      for (const hit of text.matchAll(/@media\s*\([^)]*(?:max|min)-(?:width|height|pointer)[^{]*\{/g)) {
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

  it("never lets a grid track be wider than the page it is on", () => {
    expect(
      /grid-template-columns:[^;]*minmax\(\s*min\(/.test(block("claims.css", ".waka-cards")),
      "`.waka-cards` has a bare pixel minimum in its track again. A flat " +
        "`minmax(260px, 1fr)` is 30px wider than the overlay's content box " +
        "at 320, so the archive grows a sideways scrollbar on the narrowest " +
        "phone. `.waka-held` has written `minmax(min(22rem, 100%), 1fr)` for " +
        "exactly this reason since it was built — two grids, one rule, and " +
        "only one of them had learned it.",
    ).toBe(true);
  });

  it("lets the delete question shrink instead of hanging off the edge", () => {
    expect(
      /flex:\s*0\s+0\s+auto/.test(block("claims.css", ".waka-talks-ask")),
      "`.waka-talks-ask` refuses to shrink again. Pinned at its widest it " +
        "wants 334px in a 230px row — 83px off the right edge at 320 — and " +
        "all of the shrinking lands on the open button beside it, which " +
        "measured ZERO pixels wide: you are asked to confirm erasing a " +
        "conversation whose name you can no longer read.",
    ).toBe(false);
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
    expect(
      /margin-block-start:\s*auto/.test(block("chat.css", ".chat-transcript")),
      "`.chat-transcript` has lost `margin-block-start: auto`, which is the " +
        "half of that fix that keeps a SHORT conversation sitting on the box " +
        "instead of stranded at the top of a tall frame. Founder on that " +
        "version: \"so ugly.\"",
    ).toBe(true);
  });
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
    ["claims.css", ".waka-talks-open", "opening a conversation"],
    ["claims.css", ".waka-account-out", "signing out"],
    ["claims.css", ".jar-char-bubble-go", "the way into a conversation"],
    ["chat.css", ".chat-page .chat-send", "the one act on the chat surface"],
  ];

  for (const [file, selector, what] of ACTS) {
    it(`grows ${selector} to a thumb's target on a coarse pointer`, () => {
      /* Asked of the COARSE BLOCK specifically, not of the file: a rule that
         gave every pointer 44 would be the "44 everywhere" the house ruling
         declined, and it would move the desktop composition the founder
         signed off on. */
      const coarse = source(file)
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .split(/@media\s*\(pointer:\s*coarse\)\s*\{/)
        .slice(1)
        .join("\n");
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
