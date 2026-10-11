/**
 * ═══ EVERY VISIBLE CONTROL CAN ACTUALLY BE PRESSED ═══════════════════════
 *
 * Founder, on a screenshot of the top-centre switcher: "not clickable."
 *
 * The whole switcher — the only way to reach three of the four rungs —
 * rendered perfectly, lit the rung you were on, had every handler wired, and
 * could not be pressed by a human being. `.waka-corners` is
 * `pointer-events: none` so the world behind stays draggable through the bar,
 * and every child that needs a press has to turn it back on. `.waka-rungs`
 * never did, so it inherited `none`.
 *
 * ── THIS IS THE THIRD TIME, AND THE SECOND ONE WROTE THE EPITAPH ──────────
 *
 * `.jar-edge` shipped it (finding 14). Then `.jar-board-acts` shipped it, and
 * the note left on that fix says exactly what happened here: "`pointer-events`
 * INHERITS and `.jar-hq` is `none`. Dropping the old `pointer-events: none`
 * here was not enough: with nothing declared, these inherit the parent's
 * `none` and stay unclickable while looking perfectly fine. That is the same
 * failure wearing a new hat." Third hat.
 *
 * ── WHY NO EXISTING GATE COULD SEE IT ────────────────────────────────────
 *
 * Two gates look near this and neither can.
 *
 *   `nothing-invisible-takes-a-press.ts` guards the INVERSE: a box that
 *   paints nothing and swallows presses meant for something behind it. It
 *   asks "does this win a hit test it should lose". The question here is
 *   "does this LOSE a hit test it should win", and nothing asked it.
 *
 *   THE UNIT SUITE PRESSES THIS CONTROL AND PASSES. `home-navigation`
 *   chooses rungs from this exact menu and asserts the address changes.
 *   jsdom implements no hit testing at all, so `element.click()` dispatches
 *   straight at the handler that a real pointer could never reach. A gate
 *   that presses a dead control and reports success is worse than no gate:
 *   it gets cited as evidence the control works. It was.
 *
 * ── SO THIS ONE READS THE CASCADE INSTEAD OF PRESSING ANYTHING ───────────
 *
 * A real hit test needs a browser, and this suite has none. What it can do is
 * the thing that would have caught all three: find every ground that turns
 * pointer events OFF, and require every pressable region inside it to turn
 * them back ON. That is a property of the stylesheets alone.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): NOTHING, AND THAT IS THE POINT.
 *
 * No component mounts, no module is replaced, no DOM is built. This suite
 * reads `src/styles/claims.css` and `src/styles/home.css` off disk as text
 * and asks a question about the cascade in them.
 *
 * It has to, and the reason is the whole provenance of the bug. The suites
 * that DO mount this control replace a browser with jsdom, and jsdom's
 * missing piece is exactly the one this defect lives in: there is no hit
 * testing, so `pointer-events` has no effect on anything and `.click()`
 * reaches every handler. Mounting the menu here would reproduce the green
 * test that already exists and already missed it three times. The real
 * substitute for a browser would be a browser; absent one, the honest check
 * is on the rules themselves, where the omission actually is.
 *
 * The second half is the one that makes it a ratchet rather than a list: the
 * set of dead grounds is READ from the sheets, not written here, so a new
 * `pointer-events: none` cannot be added without its interactive children
 * being declared below. A list nobody is forced to update is a list that
 * documents the day it was written.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const STYLES = resolve(dirname(fileURLToPath(import.meta.url)), "../src/styles");

const source = (file: string): string => readFileSync(resolve(STYLES, file), "utf8");

/** Comments blanked, so prose quoting a declaration is not read as one. */
const rules = (file: string): string =>
  source(file).replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));

/** Every rule body that declares `pointer-events: none`, by its selector. */
function deadGrounds(file: string): string[] {
  const text = rules(file);
  const found: string[] = [];
  for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/pointer-events:\s*none/.test(match[2]!)) continue;
    for (const part of match[1]!.split(",")) {
      const selector = part.trim();
      if (selector && !selector.startsWith("@")) found.push(selector);
    }
  }
  return found;
}

/** Whether a class turns pointer events back on for itself. */
function revives(file: string, className: string): boolean {
  const text = rules(file);
  const guard = `(?<![a-z0-9-])\\.${className}(?![a-z0-9-])`;
  for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!new RegExp(guard).test(match[1]!)) continue;
    if (/pointer-events:\s*auto/.test(match[2]!)) return true;
  }
  return false;
}

/**
 * THE GROUNDS THAT TURN PRESSES OFF, AND WHAT STILL HAS TO TAKE ONE.
 *
 * Each entry is a container whose whole purpose is to let presses fall
 * THROUGH it — the bar over the world, headquarters riding the camera — paired
 * with the regions inside it that are controls and therefore must opt back in.
 *
 * A class listed here does not have to carry the declaration on itself: an
 * ancestor between it and the ground will do, which is why
 * `.waka-switch-trigger` is absent while `.waka-switch` above it is present.
 * What is listed is the OUTERMOST interactive region in each subtree, because
 * that is the one whose omission kills everything under it — which is exactly
 * what `.waka-rungs` did to all four rungs at once.
 */
const MUST_TAKE_A_PRESS: ReadonlyArray<readonly [string, string, readonly string[]]> = [
  [
    "claims.css",
    ".waka-corners",
    [
      /* the wall picker, left corner */ "jar-here-split",
      /* the settings cog, right corner */ "waka-corner-place",
      "waka-corner",
      /* the identity switch, where one is rendered */ "waka-switch",
      /* THE FOUR RUNGS. The omission the founder found: "not clickable". */
      "waka-rungs",
    ],
  ],
  [
    "home.css",
    ".jar-hq",
    [
      /* the board's verbs under the top of mind — the SECOND time this
         shipped, and the fix that wrote the note this file quotes */
      "jar-board-acts",
      /* the claim's answers and the receipts beside them */ "jar-ask",
      /* `.jar-poster-invite` was listed here for one day and this gate is
         how it left: the class went with the question it dressed, `revives`
         stopped finding it, and the failure said so. A list that fails when
         a name goes stale is the only kind worth keeping. */
    ],
  ],
  /* THE SPEECH BUBBLE. `.jar-char-bubble-go` — "the way into a conversation"
     — lives in here, and the bubble lets presses fall through to the world
     everywhere the words are not. */
  ["claims.css", ".jar-char-bubble", ["jar-char-bubble-body"]],
  /* THE SAVE BOX'S GROUND. It is `none` so the world stays draggable around
     the field; the field, its slots and the armed destination opt back in. */
  ["home.css", ".jar-mouth", ["jar-mouth-rest", "jar-mouth-field", "jar-mouth-slot--note"]],
  /* The destination label becomes pressable only once it is armed, which is
     the one case where `none` -> `auto` is a STATE rather than an omission. */
  ["home.css", ".jar-mouth-where", ["jar-mouth-where--armed"]],
  /* A room's board: live rooms take presses, the rest are a backdrop. */
  ["home.css", ".jar-values-room", ["jar-values-room--live"]],
];

describe("nothing visible loses its press", () => {
  for (const [file, ground, children] of MUST_TAKE_A_PRESS) {
    for (const child of children) {
      it(`${ground} lets .${child} take a press`, () => {
        expect(
          revives(file, child) || revives("claims.css", child) || revives("home.css", child),
          `\`.${child}\` sits inside \`${ground}\`, which is ` +
            "`pointer-events: none` so the world behind stays draggable " +
            "through it — and it no longer turns pointer events back on. It " +
            "will render, it will light, its handlers will be wired, and a " +
            "pointer will pass straight through it. This has shipped three " +
            "times (`.jar-edge`, `.jar-board-acts`, `.waka-rungs`) and the " +
            "unit suite cannot see it: jsdom has no hit testing, so " +
            "`.click()` reaches a handler no human could.",
        ).toBe(true);
      });
    }
  }

  it("knows every ground that turns presses off, so a new one cannot arrive unlisted", () => {
    /* THE HALF THAT MAKES THIS A RATCHET. A curated list of children is only
       as good as somebody's memory of updating it, and all three bugs above
       are failures of exactly that memory. So the GROUNDS are read from the
       stylesheets: a new `pointer-events: none` container that is not
       accounted for fails this, and whoever added it has to say what inside
       it is still meant to be pressable — the question none of the three
       authors was ever asked.

       TWO SHAPES ACCOUNT FOR THEMSELVES AND ARE NOT LISTED, because a rule
       the compiler can check beats a name somebody has to remember:

         A WHOLESALE REVIVAL. `.jar-char-say > * { pointer-events: auto }`
         turns every child back on, so nothing inside it can be born dead.
         That is strictly better than this test's own list and is the pattern
         to copy — `.waka-rungs` would never have happened under it.

         A STATE THAT IS LEAVING OR BUSY. `--away`, `--out`, `--busy`. Here
         `pointer-events: none` IS the feature: a panel on its way out must
         not take a press on the way, and `one-class-one-thing` already holds
         these modifiers to meaning exactly that. */
    const covered = new Set(MUST_TAKE_A_PRESS.map(([, ground]) => ground));
    const text = rules("claims.css") + "\n" + rules("home.css");
    const revivesItsChildren = (selector: string): boolean =>
      new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*>?\\s*\\*[^{}]*\\{[^{}]*pointer-events:\\s*auto`).test(text);

    const unlisted = [...new Set([...deadGrounds("claims.css"), ...deadGrounds("home.css")])]
      /* Only a bare class is a container a control can live in; a `::before`
         glow or an `[aria-hidden]` flourish has nothing inside it to press. */
      .filter((selector) => /^\.[a-z][a-z0-9-]*$/.test(selector))
      .filter((selector) => !covered.has(selector))
      .filter((selector) => !revivesItsChildren(selector))
      .filter((selector) => !/--(away|out|busy|gone|leaving|hidden)$/.test(selector))
      /* WHAT IS LEFT IS ARTWORK, and each was opened and checked for a
         control on 2026-10-11 rather than assumed: the canvas and the
         atmosphere are `aria-hidden` paint, the skeleton is a loading
         shimmer, and `.jar-topbar`, `.jar-offline`, `.jar-when-place` and
         `.jar-reflection-key` are lines of text with nothing to press in
         them. A ground earns a line in `MUST_TAKE_A_PRESS` the day somebody
         puts a control inside it — and if that is what you are doing now,
         this failing is the point. */
      .filter(
        (selector) =>
          ![
            ".jar-canvas",
            ".jar-atmos",
            ".jar-skel",
            ".jar-topbar",
            ".jar-offline",
            ".jar-when-place",
            ".jar-reflection-key",
            ".jar-hq-inner",
            /* paint over the whole world, no content of its own */
            ".jar-grain",
            /* revives `.jar-when-story button` directly — an element
               selector rather than a class, which the wholesale check above
               does not match but which has the same effect for everything
               pressable in it */
            ".jar-when-story",
          ].includes(selector),
      );
    expect(
      unlisted,
      "a new `pointer-events: none` container is in the stylesheets and " +
        "nothing says what inside it is still meant to be pressable. Three " +
        "options, best first: give it a wholesale revival " +
        "(`.the-ground > * { pointer-events: auto }`) so nothing inside can " +
        "be born dead; or name it in `MUST_TAKE_A_PRESS` with its " +
        "interactive regions; or — if it holds nothing a person presses — " +
        "add it to the artwork list beside this assertion, which is the same " +
        "decision said out loud.",
    ).toEqual([]);
  });
});
