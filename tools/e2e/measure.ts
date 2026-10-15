#!/usr/bin/env tsx
/**
 * THE GATE FOR BUGS THAT ARE INVISIBLE IN THE FILE AND INVISIBLE ON THE PAGE.
 *
 * Two defects in one week, both found by the founder's eye and neither by any
 * gate in this repo:
 *
 *   1. THE CARD'S HEAD WAS NOT A ROW. The date was a block padded 56px left
 *      and 120px right to dodge controls that had moved away two edits
 *      earlier; the visibility pair was `position: absolute; top: 14px`.
 *      Two boxes, two vertical origins, so they could not line up with each
 *      other and the gap between them changed with the length of the date.
 *      Reading the stylesheet shows two rules that each look fine.
 *
 *   2. `.jar-saved` DECLARED `color` TWICE, the second one a line below
 *      `white-space`. The count rendered a whole tier brighter than the
 *      signposts beside it. Reading the file does not show it — the eye
 *      stops at the first declaration — and `grep` for the property finds
 *      both and tells you nothing about which one wins.
 *
 * WHY NO EXISTING GATE COULD HAVE CAUGHT EITHER. The unit suites run in
 * jsdom, which has no layout engine and does not apply a stylesheet:
 * `getBoundingClientRect` answers zeros and `getComputedStyle` answers the
 * initial value for anything the cascade would have decided. So a rendered
 * assertion about alignment or tone passes there no matter what the CSS says
 * — which is worse than no gate, because it is a green tick over an unasked
 * question. `contrast.test.ts` and `hq-pointer.test.ts` work around this by
 * reading the stylesheet as TEXT, and that is the right answer for "does this
 * rule exist"; it cannot answer "what did the cascade decide" or "where did
 * the box end up", which is what both defects above were about.
 *
 * So this one opens a real browser and asks the engine.
 *
 * ── WHAT IT MEASURES, AND WHY A FIXTURE RATHER THAN THE PRODUCT ────────────
 *
 * The world is a canvas with one live orb in it, reachable through a sign-up,
 * a keep, a camera glide and a hit test — none of which has anything to do
 * with whether two labels share a colour. Driving all of that to measure a
 * margin makes a slow suite that fails for a dozen reasons that are not the
 * one being asked about. (Measured while writing this: opening a memory's
 * card in the built world took four minutes of harness and still did not
 * land.)
 *
 * So the fixture below is the real `home.css` with hand-written markup that
 * matches what `Home.tsx` renders. That trade buys speed and precision and
 * costs one thing: the fixture can drift from the product. Case 1 exists to
 * make that impossible to do quietly — every class the fixture stands on is
 * checked against `Home.tsx` first, and a rename that lands in the product
 * and not here fails the suite before a single measurement is trusted.
 *
 * ── WHY THERE IS A `--negative` MODE ───────────────────────────────────────
 *
 * The same reason `journeys` has one: a check that cannot fail is decoration,
 * and a check about a number is especially easy to write so that it never
 * fails. Each case below carries its own sabotage — a stylesheet override
 * that breaks precisely the property being asserted — and must go red under
 * it. A case that survives its sabotage is reported as decoration.
 *
 *     pnpm e2e:measure              # every case must pass
 *     pnpm e2e:measure --negative   # every case must fail when broken
 *
 * Flags: `--negative`, `--only <id>`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, type Page } from "playwright";
/* `import ts from "typescript"` STOOD HERE AND NOTHING USED IT. It is
   unused at HEAD too, so it is residue from a check that was rewritten rather
   than anything this file needs — and `existsSync` beside it was in the same
   state. Both out 2026-10-12: a tools-wide typecheck names them, and an
   import that decides nothing is the same shape as the dead classes this
   file has just finished removing. The one source check left here reads text
   and counts brackets by hand, on purpose, because what it is looking for is
   a comment inside a template literal — which a parser sees as string
   content and has no opinion about. */
import { launchChromium } from "./browser";
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const CSS = resolve(REPO, "packages/web/src/styles/home.css");
/**
 * AND THE TOKENS THE WORLD IS WRITTEN AGAINST.
 *
 * `main.tsx` imports `system.css` before anything else, so every `--t-*` the
 * product uses is declared by the time `home.css` is read. This fixture served
 * `home.css` ALONE, which meant a token declared in `system.css` resolved to
 * nothing here and the property fell back to its initial value.
 *
 * That went unnoticed while `home.css` referenced no `--t-*` at all. The
 * moment the label register became `var(--t-label)` (2026-08-25), the four
 * signposts measured 16px and 13.33px instead of 10px and this suite went red
 * — correctly, and about itself: it had been measuring a page that did not
 * have the product's tokens on it. Serving both is what makes the page under
 * measurement the page that ships.
 */
const TOKENS = resolve(REPO, "packages/web/src/styles/system.css");
/**
 * AND THE LAYER ORDER, which is not decoration either.
 *
 * `layers.css` is one statement — `@layer base, product, chrome, register;` —
 * and it is what decides that the label register out-ranks everything. Without
 * it a browser orders layers BY FIRST APPEARANCE, and in this fixture that
 * order comes out different from the product's: `system.css` introduces
 * `product` then `register`, and `home.css` then introduces `chrome` — AFTER
 * `register` rather than before it. So the fixture would resolve a conflict
 * the opposite way round from the real page, and this suite would be
 * measuring a cascade that ships nowhere.
 *
 * Nothing failed when the register moved into its own layer, which is exactly
 * why this is worth stating: a fixture that disagrees with production only
 * announces itself later, on a case nobody has written yet.
 */
const LAYERS = resolve(REPO, "packages/web/src/styles/layers.css");
/**
 * AND `chrome.css`, WHICH IS LOADED ON THE WORLD'S ROUTE TOO.
 *
 * `main.tsx` imports it unconditionally, so every rule in it applies to the
 * world — and it is in the LAST layer, so it wins every conflict. A fixture
 * that leaves it out is not a smaller version of the product; it is a
 * different cascade, and it agrees with the real one only by luck.
 *
 * What it cost to find out: `chrome.css` ended a selector list with the bare
 * `h1, h2`, and `.jar-poster` is an `h1`. The world's headline therefore took
 * `clamp(28px, 3vw, 40px)` from the chrome sheet instead of the
 * `clamp(23px, 2.5vw, 34px)` `home.css` asks for — 40px against 34 at this
 * fixture's own width — and every case in this suite would have gone on
 * passing, because the sheet doing it was not in the room.
 */
const CHROME = resolve(REPO, "packages/web/src/styles/chrome.css");
/**
 * ═══ WHEREVER A CLASS CAN BE RENDERED, AND NOT ONE FILE OF IT ════════════
 *
 * THIS WAS `const HOME = …/pages/Home.tsx`, AND THE DRIFT CHECK READ THAT
 * ONE FILE AS PLAIN TEXT. Both halves of that were wrong, and they were
 * wrong in opposite directions, which is why the gate was simultaneously
 * red about live classes and green about dead ones.
 *
 *   TOO NARROW. The world is not one file any more. `jar-saved-count` is
 *   rendered by `Menu.tsx` and `SavesOverlay.tsx`, `jar-settings--at-left`
 *   by `space/settings/SpaceSettings.tsx`, `jar-seek` by four components,
 *   `jar-reflect-box` by `GroupPanel.tsx` — every one of them really on
 *   screen, every one of them reported MISSING by a check that only ever
 *   looked at `Home.tsx`. A gate that goes red because the product was
 *   refactored into components is a gate that gets switched off.
 *
 *   TOO LOOSE. A text match says yes to a class name written in a COMMENT
 *   and to one passed to `querySelector`. Three of the names below were
 *   passing on exactly that: `jar-saved` survives in `Home.tsx` only as a
 *   `querySelector` argument, `jar-way` only inside a paragraph about where
 *   the rail used to stand, and `jar-reflect-room` only inside its own
 *   TOMBSTONE — a comment that says, in so many words, that it is gone. So
 *   the one case built to notice a fixture standing on a class the world no
 *   longer renders was being reassured by the sentence announcing the
 *   removal.
 *
 * WHAT IS READ INSTEAD: every `.ts`/`.tsx` under `packages/web/src` except
 * `src/styles`, which is where a class is DECLARED and never where one is
 * rendered — and within each file only the value of a `className=` /
 * `class=` attribute. A token is present when something really puts it on an
 * element.
 *
 * READING THE TREE RATHER THAN A PATH IS ALSO WHAT MAKES THIS SURVIVE A
 * REFACTOR, which it had to the same day it was written: the world
 * simulation came out of `Home.tsx` into `canvas/simulation.ts` and
 * `Home.tsx` lost six thousand lines. A check pointed at one file would have
 * needed repointing — four source-text gates elsewhere in the repo did —
 * and this one needed nothing, because it asks the question of wherever the
 * answer is.
 */
const WEB_SRC = resolve(REPO, "packages/web/src");
const WEB_SRC_LABEL = "packages/web/src";
/**
 * Not a renderer: `styles` is where a class is declared, never where one is
 * put on an element.
 *
 * `__probe` WAS IN HERE AND CAME OUT ON 2026-10-12. It was a scratch copy of
 * `Home.tsx` left behind while the world simulation was being extracted, and
 * the directory is gone for good. An exemption for a path that cannot exist
 * is the same shape as the dead classes this file has just finished removing:
 * it reads like a rule and decides nothing, and the next person to see it has
 * to go and find out that the thing it names never comes back.
 */
const NOT_A_RENDERER = new Set(["styles", "node_modules"]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!NOT_A_RENDERER.has(entry.name)) sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Every class token the product really puts on an element.
 *
 * WHOLE TOKENS, NOT SUBSTRINGS, and that is not a refinement — it is the
 * drift this case exists for. `includes` said yes to `jar-panel-head` while
 * the product had renamed it to `jar-panel-headline`, because one name is a
 * prefix of the other. Splitting the attribute into tokens makes the
 * question "is this class on something" rather than "do these letters
 * appear", and a prefix can no longer answer it.
 *
 * Comments are stripped first, for the reason in the note above `WEB_SRC`:
 * a name inside a tombstone is evidence of the opposite of presence.
 */
function renderedClasses(): Set<string> {
  const found = new Set<string>();
  for (const file of sourceFiles(WEB_SRC)) {
    /* Comments out first — that is half the point of this function, see the
       note above `WEB_SRC`. Newlines are kept so nothing joins up across a
       line that was not joined before. */
    const code = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
      .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, keep: string) => keep + " ".repeat(m.length - keep.length));
    for (const piece of literals(code)) {
      /* A SELECTOR IS NOT A RENDER, and this is the other half of the point.
         `Home.tsx` keeps `jar-saved` alive only by handing ".jar-saved" to
         `querySelector`, and a check that counts that is a check that says a
         class is on the page because somebody is looking for it. A literal
         that opens with a selector's own punctuation is a selector. */
      const head = piece.trimStart()[0];
      if (head === "." || head === "#" || head === "[") continue;
      for (const token of piece.split(/\s+/)) {
        if (/^[A-Za-z][\w-]*$/.test(token)) found.add(token);
      }
    }
  }
  return found;
}

/**
 * Every string literal in a file, as separate pieces of text.
 *
 * ── WHY THIS IS THREE LOCAL REGULAR EXPRESSIONS AND NOT A SCANNER ─────────
 *
 * Two earlier versions of this were wrong in opposite directions and both of
 * them are worth writing down, because each produced a confident wrong
 * answer about a class that was in front of me on the screen.
 *
 *   A REGEX OVER THE `className=` ATTRIBUTE, matching `["'`][^"'`]*["'`]`,
 *   reported `jar-dial`, `jar-panel`, `jar-panel-vis` and `jar-hq-inner`
 *   missing. All four are written the way most conditional classes in this
 *   product are — ``className={`jar-dial${away ? " jar-dial--away" : ""}`}``
 *   — and a character class that stops at a quote stops INSIDE the hole, on
 *   the quote opening `" jar-dial--away"`. The capture is `jar-dial${away ? `
 *   and the base name goes with the modifier.
 *
 *   A CHARACTER-BY-CHARACTER SCANNER over the whole file reported fifteen
 *   missing, which is most of what this fixture stands on. The cause is that
 *   a `.tsx` file is full of PROSE: an apostrophe in a sentence of copy or a
 *   JSX text node opens a single-quoted string as far as the scanner is
 *   concerned, and everything after it is "inside a string" until the next
 *   apostrophe — so one `What's` desynchronises the rest of the file.
 *
 * The fix for both is the same and it is the ordinary rule of the language:
 * a `'` or `"` string CANNOT CONTAIN A RAW NEWLINE. Matching those two
 * locally and line-bounded means a stray apostrophe can corrupt one line and
 * no more. Template literals may span lines, so they are matched greedily and
 * then split on their own `${` and `}` — the text chunks come out whole, and
 * any quoted string inside a hole is found by the first two passes anyway,
 * since those run over the entire file rather than inside this match.
 *
 * It is deliberately loose about WHERE a literal is: tracking the end of a
 * JSX attribute expression needs most of a parser, and the two ways this
 * check was actually being lied to are comments and selector strings, which
 * `renderedClasses` deals with directly and which need no attribute
 * boundary. What is left over is a literal carrying a class name for some
 * other reason; the cost of one of those is a drift unnoticed for a release,
 * against a gate that is wrong every single run.
 */
function literals(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/"(?:[^"\\\n]|\\.)*"/g)) out.push(m[0].slice(1, -1));
  for (const m of code.matchAll(/'(?:[^'\\\n]|\\.)*'/g)) out.push(m[0].slice(1, -1));
  for (const m of code.matchAll(/`(?:[^`\\]|\\.)*`/g)) {
    for (const chunk of m[0].slice(1, -1).split(/\$\{|\}/)) out.push(chunk);
  }
  return out;
}

/* THE INSET EVERY SIGNPOST KEPT FROM THE EDGE IT WAS NEAREST WAS `10`, and
   the founder's ruling behind it — 2026-08-25, "make margin 10px for all 4" —
   is recorded here rather than dropped with the constant. It was one number
   in one place so that moving it was one edit and the suite could not assert
   two different answers in two cases. Nothing reads it since the two
   signpost cases went on 2026-10-12 (see their tombstone below): there are no
   four margins left to keep an inset from. If the bar is ever measured for
   its distance from the glass, that number belongs here under this ruling. */

/** How far a measured centre may sit from another and still be "aligned". */
const CENTRE_SLOP = 0.75;

interface Case {
  id: string;
  name: string;
  /** Class names this case measures. Each must really be rendered by Home. */
  needs: string[];
  /** CSS injected in `--negative` mode to break exactly what this asserts. */
  sabotage: string;
  run: (page: Page) => Promise<{ ok: boolean; detail: string }>;
}

/* ── the fixture ───────────────────────────────────────────────────────────
   Markup mirroring what the world renders, against the product's own
   stylesheet.

   THE SIGNPOST FAMILY IS NOT IN HERE ANY MORE (2026-10-12). It was six
   elements — the way up, the two ways sideways, the archive door and the
   count on it, the wall chip in the top bar — and five of the six have no
   renderer in `packages/web/src` outside `src/styles`. Fixture markup for a
   class nobody draws is the one thing this fixture must not have: the whole
   trade it makes is speed in exchange for the risk of drift, and markup that
   drifts in the fixture's favour means every number taken from it is about a
   page nobody has. See the two tombstones below for the cases that stood on
   them and what measuring the bar instead would cost. */
const FIXTURE = `<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="/layers.css">
<link rel="stylesheet" href="/system.css">
<link rel="stylesheet" href="/home.css">
<link rel="stylesheet" href="/chrome.css">
<style>
  /* THE PRODUCT'S BOX MODEL, WHICH IS ONE DECLARATION AND WAS MISSING.
     global.css sets border-box on every element and this fixture does not
     serve that sheet, so .jar-hq-inner capped its CONTENT at 680 here while
     the product caps its BORDER BOX at 680 and gives the column 640. The
     headline case reads the column now (the claim is sized in cqi), and it
     was reading a column 40px wider than any that exists. It still passed,
     because the clamp's ceiling happened to swallow the difference — which is
     a case passing for a reason nobody chose. Not the whole sheet: this one
     rule is what the fixture's geometry depends on, and pulling in the rest
     would change what every other case here is standing on. */
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #0a0d14; }
  .jar { position: fixed; inset: 0; }
  /* THE CARD IS NO LONGER PINNED. It was forced to 'position: static' with a
     margin, because its place used to be solved by the frame loop — and that
     pin would now hide the very thing the founder asked for, since the
     stylesheet itself centres it. Only the entrance is stilled, so nothing is
     read mid-animation. */
  .jar-panel, .jar-seek, .jar-settings, .jar-prov-room { animation: none !important; }
</style>
<script>
  /* THE ONE THING THE WORLD WRITES INLINE, WRITTEN THE SAME WAY HERE.
     hangRail sets the dates left edge from the left edge of the word that
     says now, because that word sits after the wall chip and moves with the
     wall's name — no constant in a stylesheet can be under it on every wall.
     A fixture that left the stylesheet's placeholder in place would be asking
     whether the sheet hangs off its button and answering about a guess.
     This is the product's line, not an approximation of it.
     (No backticks in here: this whole fixture is a template literal, and one
     stray backtick in a comment ends it mid-sentence. That has cost this
     project two gates already.) */
  addEventListener("DOMContentLoaded", () => {
    const w = document.querySelector(".jar-when");
    const d = document.querySelector(".jar-dial");
    if (w && d) d.style.left = Math.round(w.getBoundingClientRect().left) + "px";
  });
</script>
<div class="jar" style="--jar-vh:100vh;--jar-vw:100vw">
  <!-- THE HEADLINE, and it is an <h1> because the world's is. That is the
       whole point of it being here: a bare \`h1\` selector in another sheet
       reaches this element, and a fixture that rendered the poster as a
       \`div\` would be immune to the one defect the case below exists for. -->
  <!-- IN ITS COLUMN, because the column is where its left edge comes from.
       The poster stood as a bare child of \`.jar\` and so began at x 0, which
       made "does the signpost line up with the claim" unanswerable here: the
       fixture had no claim edge to line up WITH. \`.jar-hq-inner\` carries the
       side padding and the measure, and that is all this needs — not
       \`.jar-hq\`, which is absolutely positioned and takes no pointer, and
       would change what every other case in this file is standing on. -->
  <div class="jar-hq-inner">
    <h1 class="jar-poster">a sentence the world is holding up</h1>
  </div>
  <div class="jar-topbar" data-jar-chrome="1">
    <div class="jar-exits">
      <!-- THE WALL CHIP IS GONE FROM THIS ROW AND FROM THE PRODUCT.
           It was \`<span class="jar-here-split"><button class="jar-here jar-back
           jar-label">ME</button></span>\`, and it stood here only to be the
           thing \`.jar-settings--at-left\` hangs off. \`Home.tsx\` returns
           \`null\` in its place under the heading "THE WALL PICKER MOVED TO
           THE TOP-LEFT CORNER" — the name of the ground and the list of the
           others render into the corner row now. See the tombstone above
           \`every-modal-is-one-modal\` for what that arm measured, why the
           sheet it measured cannot be opened at all, and what would bring
           the measurement back. -->
      <button class="jar-when jar-label">now</button>
    </div>
    <!-- THE ACCOUNT PILL IS GONE FROM THIS ROW AND FROM THE PRODUCT.
         It was \`<button class="jar-account jar-back jar-label">Your account</button>\`,
         and it stood here only to be the thing \`.jar-settings--at-right\`
         hangs off in \`every-modal-is-one-modal\`. Both went on 2026-10-11 when
         settings stopped being a page — founder: "I want all setting-related
         stuff to be only accessible through the drop down and not be its own
         thing". See that case's own tombstone for what the measurement was
         and what replaced it. -->
  </div>
  <!-- THE DATES, which are only ever on screen while they are open — so the
       fixture holds them open, the way it holds every other sheet open. -->
  <div class="jar-dial" data-jar-chrome="1">
    <div class="jar-dial-list">
      <button class="jar-dial-stop jar-label jar-dial-stop--here">now</button>
      <button class="jar-dial-stop jar-label">Aug 12</button>
      <button class="jar-dial-stop jar-label">Jul 26</button>
    </div>
  </div>

  <div class="jar-mouth-slot">
  </div>

  <div class="jar-settings" data-jar-chrome="1" role="dialog">
    <div class="jar-settings-head"><span class="jar-label">this wall</span></div>
  </div>
  <div class="jar-prov-room" data-jar-chrome="1" role="dialog">
    <p class="jar-prov-room-lead">Where this came from.</p>
  </div>

  <div class="jar-panel" data-jar-chrome="1" role="dialog">
    <div class="jar-panel-head">
      <span class="jar-panel-when jar-label">today &middot; aug 23</span>
      <p class="jar-ask jar-ask--row jar-panel-vis">
        <button type="button" class="jar-where-on">private</button>
        <span aria-hidden="true"> &middot; </span>
        <button type="button" class="jar-where-off">public</button>
      </p>
    </div>
    <p class="jar-panel-text">A card is one object with a middle, not three things stacked on each other with the spacing left to chance.</p>
    <p class="jar-ask jar-ask--after jar-panel-foot">
      <span class="jar-panel-foot-l"><button type="button">reflect</button></span>
      <span class="jar-panel-foot-c">
        <button type="button" aria-label="previous"><span class="jar-caret jar-caret--left"></span></button>
        <button type="button" aria-label="next"><span class="jar-caret jar-caret--right"></span></button>
      </span>
      <span class="jar-panel-foot-r"><button type="button">delete</button></span>
    </p>
    <!-- THE SAME CARD WHILE ITS WORDS ARE BEING EDITED, and it is written
         BELOW the reading foot rather than above it. The world renders exactly
         one of these two at a time; stacking this one between the words and
         the reading foot put a second margin in that gap and pushed
         'card-words-have-air' from 22px to 26px — a fixture distorting the
         very measurement beside it. Last in the panel, it touches nothing. -->
    <p class="jar-ask jar-ask--after jar-panel-foot" id="foot-editing">
      <span class="jar-panel-foot-l"><label class="jar-attach">attach a picture</label></span>
      <span class="jar-panel-foot-c"><button type="button" class="jar-panel-save">save</button></span>
      <span class="jar-panel-foot-r"><button type="button">leave it</button></span>
    </p>
    <!-- THE SECOND ROW OF QUIET VERBS, AND IT IS IN HERE BECAUSE A CASE WAS
         READING ONE THAT WAS NOT. The case below named
         verb-rows-one-register compares three rows and asked the probe for
         typeMouth, which the probe has never produced: the mouth's own verb
         row left this fixture and the read was not taken out with it. So the
         third register came back as the empty string, three registers were
         always counted where two were measured, and the case was PERMANENTLY
         RED on a correct page. That is a false report, which is the one thing
         worse than a gap. Found and fixed 2026-10-12.

         This is the row that replaces it, and it is the product's own: the
         card's confirmation strip, jar-panel-askrow holding jar-ask with
         jar-ask--row and the two quiet verbs in it, rendered three times over
         in the memory card (publish, un-publish, forget). The claim is
         unchanged — every row of quiet verbs is set in one register — and it
         is now asked of three rows that exist.
         (No backticks in this comment: the whole fixture is one template
         literal and a quoted identifier would end it mid-sentence. The case
         named no-backtick-inside-a-probe is in this file because that has
         cost the project four gates.) -->
    <div class="jar-panel-askrow" role="group">
      <p class="jar-panel-warn">this will be visible to everyone</p>
      <p class="jar-ask jar-ask--row" id="ask-row">
        <button type="button" class="jar-where-on">keep it private</button>
        <span aria-hidden="true"> &middot; </span>
        <button type="button" class="jar-where-off">make it public</button>
      </p>
    </div>
  </div>

  <!-- A \`.jar-seek\` SHEET, WHICH IS STILL A SHAPE THE WORLD USES, AND NO
       LONGER THE REFLECT ONE. This was \`.jar-seek.jar-reflect-room\` — the
       sheet the world put up after a keep — kept here so a variant meant to
       sit at the bottom could be caught being stretched from the top. That
       surface was deleted on 2026-10-10 and the case that measured it went on
       2026-10-12; the tombstone above \`verb-rows-one-register\` says what the
       measurement was. What stays is a bare \`.jar-seek\`, because
       \`every-modal-is-one-modal\` reads one and \`.jar-seek\` itself is still
       rendered by four components. It carries no variant: a variant in here
       is a claim about a component, and this fixture has no markup for any
       of them. -->
  <div class="jar-seek" data-jar-chrome="1" role="dialog">
    <p class="jar-prov-lead jar-label">saved</p>
  </div>
</div>`;

/* ── reading the page ──────────────────────────────────────────────────────
   Every probe is handed over as a STRING. `tsx` rewrites arrow functions with
   helper names that do not exist inside the page, so a function passed to
   `page.evaluate` dies on `__name is not defined` — the same reason
   `journeys.ts` writes its probes this way. */
const BOXES = `(() => {
  const box = (s) => {
    const e = document.querySelector(s);
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return { top: b.top, bottom: b.bottom, left: b.left, right: b.right,
             midY: b.top + b.height / 2, midX: b.left + b.width / 2 };
  };
  const ink = (s) => {
    const e = document.querySelector(s);
    if (!e) return null;
    const c = getComputedStyle(e);
    return [c.fontSize, c.letterSpacing, c.fontWeight, c.textTransform, c.color].join(" | ");
  };
  return {
    vw: window.innerWidth, vh: window.innerHeight,
    dial: box(".jar-dial"), nowWord: box(".jar-when"),
    when: box(".jar-panel-when"), vis: box(".jar-panel-vis"),
    text: box(".jar-panel-text"),
    footL: box(".jar-panel-foot-l"), footC: box(".jar-panel-foot-c"), footR: box(".jar-panel-foot-r"),
    footVerb: box(".jar-panel-foot-l button"), footCaret: box(".jar-panel-foot-c .jar-caret"),
    /* THE FOUR SIGNPOSTS AND THEIR CARETS WENT WITH THE TWO CASES THAT READ
       THEM (2026-10-12) — see the tombstone above \`verb-rows-one-register\`.
       \`.jar-caret\` is still read, down in the card's foot, by
       \`the-edit-offers-one-act\`. */
    /* the three rows of quiet verbs the card really has */
    typeVis: ink(".jar-panel-vis button"),
    typeWhen: ink(".jar-panel-when"),
    typeAsk: ink(".jar-panel-askrow .jar-ask--row button"),
  };
})()`;

type Boxes = Record<string, never> & {
  vw: number; vh: number;
  [k: string]: unknown;
};

const near = (a: number, b: number, slop = CENTRE_SLOP): boolean => Math.abs(a - b) <= slop;
const r1 = (n: number): string => n.toFixed(1);

const CASES: Case[] = [
  {
    id: "fixture-is-honest",
    name: "every class this suite measures is really rendered by the world",
    needs: [],
    /* Sabotage: pretend the product renamed one. The check must notice. */
    sabotage: "",
    run: async () => {
      /* DERIVED, NEVER RESTATED. This was a hand-kept list beside the cases'
         own `needs`, so a case added later declared five classes and this
         one went on checking the same fourteen — a drift check that had
         itself drifted. There is one place a case says what it stands on,
         and this reads it. */
      const wanted = [
        ...new Set([
          ...CASES.flatMap((c) => c.needs),
          /* the fixture's own scaffolding, measured by no single case but
             stood on by all of them. `jar-saved-count` was here until
             2026-10-12 and came out with the archive door it was printed on:
             it is still rendered — by `Menu.tsx` and `SavesOverlay.tsx`, as
             the number beside the archive's name in the bar — but this
             fixture no longer stands on it, and a drift list that names
             classes the fixture does not use is a list that will one day go
             red about something this suite does not measure. */
          "jar-caret",
        ]),
      ].sort();
      const rendered = renderedClasses();
      const missing = wanted.filter((c) => !rendered.has(c));
      return {
        ok: missing.length === 0,
        detail:
          missing.length === 0
            ? `${wanted.length} classes, every one of them really rendered somewhere in ${WEB_SRC_LABEL}`
            : `the fixture stands on classes the world no longer renders: ${missing.join(", ")}` +
              " — every measurement below would be about a page nobody has",
      };
    },
  },

  {
    id: "no-backtick-inside-a-probe",
    name: "no gate has a comment that ends the string it is written inside",
    needs: [],
    /* A source check: there is no stylesheet to sabotage, and what it guards
       is a file whose probe has been silently rewritten — which the harness
       reports as a harness error, or worse does not report at all. */
    sabotage: "",
    run: async () => {
      /**
       * FOUR GATES HAVE BEEN KILLED BY THE SAME CHARACTER, and a warning in a
       * comment did not stop the fifth.
       *
       * These walks read the page through long `page.evaluate` strings, which
       * are template literals — and this repo quotes identifiers in backticks,
       * because that is how every other comment here reads. One of those
       * inside a template literal ENDS THE LITERAL mid-sentence, and what
       * follows is parsed as code. `orbs.ts` took two gates down that way;
       * `the-timeline.ts` and this file each took one, on 2026-08-30, after a
       * header warning about exactly this had already been written.
       *
       * PARSING IS NOT ENOUGH, and the first version of this case only
       * parsed. A quoted identifier is a PAIR of backticks: the first ends
       * the literal and the second opens a new one, so the file very often
       * re-synchronises into something that still compiles — and then the
       * probe silently carries different text than it reads. Two of the four
       * incidents failed at parse; one failed at runtime with
       * `label is not defined`; the fourth would have run and lied. A check
       * that catches half of them and is named for all of them is decoration
       * of the kind these gates exist not to be.
       *
       * So this is lexical and exact: it walks the file tracking whether it
       * is in code, a string, or a template, and reports any comment opened
       * INSIDE a template that the template's own end arrives before closing.
       * That is the trap itself rather than one of its symptoms, and it does
       * not care whether the wreckage happens to compile.
       */
      const dir = resolve(dirname(fileURLToPath(import.meta.url)));
      const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
      const found: string[] = [];

      for (const f of files) {
        const src = readFileSync(join(dir, f), "utf8");
        /* frames: a template, or the code inside one of its ${ } holes */
        /* BLOCK COMMENTS ONLY, and that is a correction rather than a
           narrowing. There are no comments at all inside a template's raw
           text — it is a string — so this is looking for the SHAPE a person
           writes when they mean one. Slash-star is that shape and nothing
           else is: the first version also watched for two slashes and
           reported three walks for the ones in an http:// URL, which is a
           gate calling an address a defect. All four real incidents were
           block comments. */
        const frames: Array<{ tmpl: boolean; open: number; kind: "" | "block" }> = [];
        let mode: "code" | "block" | "line" | "sq" | "dq" | "tmpl" = "code";
        let line = 1;
        const top = () => frames[frames.length - 1];
        for (let i = 0; i < src.length; i += 1) {
          const c = src[i]!;
          const d = src[i + 1];
          if (c === "\n") {
            line += 1;
            if (mode === "line") mode = "code";
            continue;
          }
          if (mode === "block") {
            if (c === "*" && d === "/") { mode = "code"; i += 1; }
            continue;
          }
          if (mode === "line") continue;
          if (mode === "sq" || mode === "dq") {
            if (c === "\\") i += 1;
            else if ((mode === "sq" && c === "'") || (mode === "dq" && c === '"')) mode = "code";
            continue;
          }
          if (mode === "tmpl") {
            const t = top()!;
            if (c === "\\") { i += 1; continue; }
            /* the shape of a comment, opened inside the template's own text */
            if (t.kind === "" && c === "/" && d === "*") {
              t.kind = "block";
              t.open = line;
              i += 1;
              continue;
            }
            if (t.kind === "block" && c === "*" && d === "/") { t.kind = ""; i += 1; continue; }
            if (c === "$" && d === "{") { frames.push({ tmpl: false, open: line, kind: "" }); mode = "code"; i += 1; continue; }
            if (c === "\u0060") {
              if (t.kind !== "") {
                found.push(
                  `${f}:${t.open} — a comment inside a template literal is ended by a backtick ` +
                    `on line ${line}; everything after it is no longer that string`,
                );
              }
              frames.pop();
              mode = "code";
            }
            continue;
          }
          /* mode === "code" */
          if (c === "/" && d === "*") { mode = "block"; i += 1; continue; }
          if (c === "/" && d === "/") { mode = "line"; i += 1; continue; }
          if (c === "'") { mode = "sq"; continue; }
          if (c === '"') { mode = "dq"; continue; }
          if (c === "\u0060") { frames.push({ tmpl: true, open: line, kind: "" }); mode = "tmpl"; continue; }
          if (c === "}" && frames.length > 0 && !top()!.tmpl) { frames.pop(); mode = "tmpl"; continue; }
        }
      }

      return {
        ok: found.length === 0,
        detail:
          found.length === 0
            ? `${files.length} walks in tools/e2e, no comment ends the probe it is written inside`
            : found.join("\n    "),
      };
    },
  },

  {
    id: "no-duplicate-declarations",
    name: "no rule decides one property twice",
    needs: [],
    sabotage: "",
    run: async () => {
      /* THE `.jar-saved` BUG, AS A RULE. A block that sets `color` twice
         renders the second and reads as the first, and no amount of looking
         at the file finds it. Comments and strings are stripped first so a
         property named inside prose is not counted. */
      const css = readFileSync(CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      const offences: string[] = [];
      const rule = /([^{}]+)\{([^{}]*)\}/g;
      let m: RegExpExecArray | null;
      while ((m = rule.exec(css)) !== null) {
        const selector = m[1]!.trim().split("\n").pop()!.trim();
        const seen = new Map<string, number>();
        for (const decl of m[2]!.split(";")) {
          const prop = decl.split(":")[0]?.trim().toLowerCase();
          if (!prop || prop.startsWith("--") || prop.startsWith("@")) continue;
          seen.set(prop, (seen.get(prop) ?? 0) + 1);
        }
        for (const [prop, n] of seen) {
          /* a deliberate fallback pair — `color: red; color: var(--x)` — is
             the one legitimate shape, and this stylesheet does not use it */
          if (n > 1) offences.push(`${selector} { ${prop} × ${n} }`);
        }
      }
      return {
        ok: offences.length === 0,
        detail:
          offences.length === 0
            ? "every rule decides each property once"
            : `${offences.length} rule(s) decide a property twice, and the second wins silently: ${offences.join("; ")}`,
      };
    },
  },

  /* ═══ THE FOUR SIGNPOSTS ARE NOT MEASURED ANY MORE, BECAUSE THERE ARE NO
     LONGER FOUR SIGNPOSTS ══════════════════════════════════════════════════
     TWO CASES STOOD HERE AND BOTH WENT ON 2026-10-12. They were
     `signposts-one-voice` ("the four signposts are set in one voice") and
     `signposts-one-inset` ("every signpost keeps the same air from the edge
     it is nearest"), and between them they named six classes:

       .jar-values        the way up, `philosophies & values`
       .jar-values-words  the words inside it
       .jar-way           the neighbouring wall's name in the left margin
       .jar-way--r        and in the right margin
       .jar-saved         the archive door at the bottom edge
       .jar-saved-count   the count printed on it

     FIVE OF THE SIX HAVE NO RENDERER. Measured 2026-10-12 against the value
     of every `className=` in every `.ts`/`.tsx` under `packages/web/src`
     outside `src/styles`: `jar-values`, `jar-values-words` and `jar-way--r`
     appear nowhere at all; `jar-way` survives only inside a paragraph in
     `Home.tsx` about where the rail used to stand; `jar-saved` survives only
     as a `querySelector` argument. `jar-saved-count` is the one that is still
     drawn, and it has moved into `Menu.tsx` and `SavesOverlay.tsx` — it is
     the number beside the archive's own name in the bar, not a word at the
     bottom edge of the world.

     AND THE GRAMMAR WENT, NOT JUST THE NAMES. `Home.tsx` carries the ruling
     under its own heading "THE STRIP OF WALL NAMES IS GONE" and again under
     "THE `N INSPIRATIONS` DOOR IS GONE FROM HERE TOO": up, down, left and
     right as four words in four margins is not how this product navigates.
     Four nouns in a bar are — Now, Inspirations, Chats, Principles — and that
     bar never leaves the screen. So "the four signposts share one voice and
     one inset" is not a claim with a drifted selector in it; it is a claim
     about a screen that no longer exists.

     WHY THEY ARE NOT REPOINTED AT THE BAR. The thing these two cases
     measured is the property of a MARGIN: four separate absolutely-positioned
     elements, each with its own edge to keep its distance from, each at risk
     of being set in a different register because nothing lays them out
     together. The dock is one flex row of four buttons in one rule. Its rows
     cannot disagree about their inset — there is no inset, there is a gap —
     and they cannot disagree about their voice without the rule that sets all
     four changing. Asserting it here would be a case that cannot fail, which
     this file calls decoration and deletes.

     WHAT COVERAGE WENT, SAID RATHER THAN ABSORBED: nothing now measures the
     type register of the navigation, or its distance from the edge of the
     glass. WHAT WOULD RESTORE IT: a case against `.waka-dock` itself —
     whether its row sits clear of the safe-area inset, whether its label
     register is the one `--t-label` sets — with fixture markup for the bar.
     That is a new case with its own markup, not a selector swap, and it
     belongs to whoever is measuring the bar.

     The two sabotages went with them: `.jar-saved-count { color: #fff }` and
     `.jar-values { top: 40px }`. */

  {
    id: "verb-rows-one-register",
    name: "every row of quiet verbs is set in the label register",
    needs: ["jar-panel-vis", "jar-panel-askrow", "jar-ask--row", "jar-where-on"],
    sabotage: ".jar-panel-vis button { font-size: 13px; text-transform: none; }",
    run: async (page) => {
      /* THE MISS THIS CASE EXISTS FOR. `private/public` was brought to the
         label register on the CARD and left at `.jar-ask`'s 13px prose in the
         MOUTH — the same four words, two registers, depending which surface
         you were on, and nothing in the repo could tell. What is compared is
         type only, not colour: these rows sit on different grounds and are
         allowed different ink.

         AND THE THIRD ROW IS THE CARD'S ASK STRIP NOW, NOT THE MOUTH'S.
         The read was `b.typeMouth`, which the probe stopped producing when
         the mouth's verb row left the fixture and nobody took the read out
         with it — so for as long as that was true this case compared two
         real registers against the empty string and failed on a correct
         page. See the fixture note at `.jar-panel-askrow`. */
      const b = (await page.evaluate(BOXES)) as Boxes;
      const typeOf = (s: string) => (s ?? "").split(" | ").slice(0, 4).join(" | ");
      const rows = {
        "the card's date": typeOf(b.typeWhen as string),
        "the card's private/public": typeOf(b.typeVis as string),
        "the card's ask row": typeOf(b.typeAsk as string),
      };
      const distinct = [...new Set(Object.values(rows))];
      return {
        ok: distinct.length === 1,
        detail:
          distinct.length === 1
            ? `all three: ${distinct[0]}`
            : `${distinct.length} registers — ` +
              Object.entries(rows).map(([k, v]) => `${k}: ${v}`).join(" / "),
      };
    },
  },

  {
    id: "a-date-is-worth-pressing",
    name: "every date is a real target, and the one you are on is the lit one",
    needs: ["jar-dial", "jar-dial-list", "jar-dial-stop"],
    sabotage:
      ".jar-dial-stop { min-height: 0 !important; padding: 0 !important; }" +
      " .jar-dial-stop--here { color: inherit !important; }",
    run: async (page) => {
      /**
       * THE DEFECT THIS REPLACES A RAIL TO AVOID. The rail was reported hard
       * to hit three separate times — "hard to drag", "moves around", "not
       * right under the word" — and the answer to all three was to stop
       * asking for a drag at all. A menu whose rows are twenty pixels of
       * ten-pixel type would be the identical defect wearing a list's
       * clothes, so the row's own box is measured rather than assumed.
       *
       * AND WHERE YOU ARE STANDING IS SAID IN LIGHT. It is the founder's
       * first law and the reason the rail could be retired at all: the word
       * carries the fact, the lit row carries it inside the list, and nothing
       * anywhere draws a tick or a dot to say it twice.
       */
      const read = `(() => {
        /* ALPHA IS THE CHANNEL HERE, NOT HUE. Every quiet thing on this surface
           is the same ink at a lower alpha, so a luminance that read only the
           three colour stops answered 0.0 for a lit row against a muted one —
           found by this case failing against correct CSS, which is the gate
           being wrong rather than the product. */
        const lum = (c) => { const p = c.match(/[\\d.]+/g).map(Number); const a = p.length > 3 ? p[3] : 1; return (0.2126*p[0] + 0.7152*p[1] + 0.0722*p[2]) * a; };
        const rows = [...document.querySelectorAll(".jar-dial-stop")];
        const box = rows.map((e) => { const b = e.getBoundingClientRect(); return { h: b.height, w: b.width, top: b.top }; });
        const here = document.querySelector(".jar-dial-stop--here");
        const rest = rows.filter((e) => e !== here);
        return {
          count: rows.length,
          shortest: box.length ? Math.min(...box.map((b) => b.h)) : -1,
          narrowest: box.length ? Math.min(...box.map((b) => b.w)) : -1,
          /* a column, not a heap: every row strictly below the one before it */
          stacked: box.every((b, i) => i === 0 || b.top >= box[i - 1].top + box[i - 1].h - 0.5),
          hereLum: here ? lum(getComputedStyle(here).color) : -1,
          restLum: rest.length ? Math.max(...rest.map((e) => lum(getComputedStyle(e).color))) : -1,
        };
      })()`;
      const m = (await page.evaluate(read)) as Record<string, number | boolean>;
      const count = m.count as number;
      const shortest = m.shortest as number;
      const lit = (m.hereLum as number) - (m.restLum as number);
      const faults: string[] = [];
      if (count < 2) faults.push(`only ${count} row(s) in the fixture`);
      if (shortest < 24) faults.push(`the shortest row is ${r1(shortest)}px tall, under the 24 a pointer is owed`);
      if ((m.narrowest as number) < 40) faults.push(`the narrowest row is ${r1(m.narrowest as number)}px wide`);
      if (!m.stacked) faults.push("the rows overlap rather than stacking");
      if (lit < 8) faults.push(`the row you are standing on is not lit — ${r1(lit)} points of luminance over the rest`);
      return {
        ok: faults.length === 0,
        detail:
          faults.length === 0
            ? `${count} dates, none shorter than ${r1(shortest)}px, the one you are on lit ${r1(lit)} points over the rest`
            : faults.join("; "),
      };
    },
  },

  /* ═══ THE SHEET THAT WAS ONLY AS TALL AS ITS CONTENTS IS GONE WITH THE
     SHEET ═══════════════════════════════════════════════════════════════════
     `a-sheet-is-its-contents-tall` STOOD HERE and went on 2026-10-12. It
     measured `.jar-seek.jar-reflect-room` — the sheet the world put up after
     a keep to ask what made you want to keep it — and asserted that its floor
     was one padding below its last child.

     THE SURFACE WAS DELETED ON 2026-10-10, AND THIS DID NOT GO RED, which is
     the part worth recording. `Home.tsx`'s own tombstone says it in full:
     "THE STANDALONE REFLECT SHEET IS GONE, AND IT WAS ALREADY UNREACHABLE
     BEFORE IT WAS DELETED… `worldReflectOnKept` and `jar-reflect-room` went
     with it." Of the five classes this case declared, `jar-reflect-on` is
     nowhere in `packages/web/src` at all and `jar-reflect-room` survives only
     inside that sentence — so the drift check two cases up was being
     reassured, by a text match, by the very comment announcing the removal.
     Meanwhile `home.css` still carries `.jar-seek.jar-reflect-room`, so the
     measurement went on PASSING: a case standing on fixture markup of its
     own, measuring a live rule, about a surface no person can open. That is
     worse than a red gate. A red gate gets fixed.

     (`jar-seek`, `jar-reflect-q` and `jar-reflect-box` are all still
     rendered, and are not what went: the first by four components, the other
     two by the read-only reflection list in a memory's card and by the room
     board's propose box. Only the SHEET went.)

     WHAT COVERAGE WENT: nothing now measures whether a sheet's box is filled
     by what is in it — the cascade bug that stretched one from the top edge
     to its own `bottom` and left four hundred pixels of nothing under the
     verbs, three times.

     WHY IT IS NOT REPOINTED AT A LIVE `.jar-seek`. The three that render
     (`.jar-inspiration-composer`, `.jar-inspiration-search`,
     `.jar-reading-comparison`) are declared in `chrome.css`, not `home.css`,
     each with its own `max-height` and its own `overflow-y`, and each is a
     different shape of contents. Pointing this case at one of them means new
     fixture markup matching that component and a new judgement about what
     "full" means for a scrolling box — which is a new case, exactly as the
     tombstone below `every-modal-is-one-modal` says of the right-hand sheet.
     It should be written by whoever is measuring that sheet.

     The sabotage went with it: `.jar-seek.jar-reflect-room { top: 58px;
     bottom: 16vh; transform: translateX(-50%) }`. */

  /* ═══ COVERAGE THIS CASE NO LONGER HAS, SAID AT THE TOP OF IT ═══════════
     THE RIGHT-HAND ANCHORED SHEET IS NOT MEASURED ANY MORE. It was
     `atRight: anchored(".jar-settings--at-right", ".jar-account", "right")`,
     and BOTH of those classes have zero renderers in `packages/web/src`
     outside `src/styles` — measured 2026-10-12. The sheet and the button it
     hung off went together on 2026-10-11, when settings stopped being a
     page: founder, "I want all setting-related stuff to be only accessible
     through the drop down and not be its own thing" (`main.tsx` carries the
     route's own tombstone). So four of the six things this case compared
     were about the product and the fifth was about the fixture agreeing with
     itself.

     WHY IT IS NOT REPOINTED AT WHAT REPLACED IT, which is the question to
     answer rather than to skip. Your account opens in `.waka-account` now —
     the cog's popover, `claims.css` — and it IS anchored under its button,
     by `position: absolute; top: calc(100% + var(--sp-8)); right: 0` inside
     `.waka-corner-place`. Two reasons that does not belong here:

       1. IT WOULD FAIL THE HALF OF THE CASE THAT MATTERS. This case's
          backbone is the 2026-08-25 ruling that every modal wears the CARD's
          surface, read off `.jar-panel` at runtime rather than written down.
          `.waka-account` deliberately does not: `--sp-12` of padding against
          the card's `--sp-24`, `--waka-r-surface` against the card's 18px,
          `--waka-raised` against `--jar-panel`, a hairline border against
          the card's triple shadow. It is a POPOVER, which is a different
          object with a different specification, and asserting it is a modal
          would be the gate telling a lie about the design rather than the
          design drifting.
       2. ITS ANCHORING IS STRUCTURAL, NOT MEASURED. The sheet this case
          watched was absolutely positioned against the VIEWPORT with a
          hand-written `right: 8px` "measured off the account pill itself" —
          a number that can drift from the button by exactly the pixels this
          case counted. `.waka-account` is positioned against a wrapper that
          contains the button, so "under its own handle" is true by
          construction and there is no gap for a measurement to catch.

     WHAT WOULD RESTORE REAL COVERAGE: a case of its own, measuring the
     popover against the popover's own specification (bound by
     `100dvh - the corner - the gap`, scrolls inside itself, opens leftward on
     a phone) rather than against the memory card's. That is a new case with
     its own fixture markup, not a selector swap, and it should be written
     when somebody is measuring that card rather than smuggled in here.

     AND ITS SIBLING WENT THE SAME WAY ON 2026-10-12, AND IT TOOK MORE WITH
     IT THAN A DEAD HANDLE. `atLeft` was
     `anchored(".jar-settings--at-left", ".jar-here", "left")`, and the
     previous pass recorded one half of why it had to go: `.jar-here` has no
     renderer — the wall chip in `.jar-topbar` returns `null`, under
     `Home.tsx`'s own heading "THE WALL PICKER MOVED TO THE TOP-LEFT CORNER"
     — so the arm measured a live sheet against a dead handle and deferred on
     the question "what opens the wall's settings now".

     THE ANSWER TO THAT QUESTION IS NOTHING, which settles it. The sheet is
     `SpaceSettings`, mounted only by `settingsFor === spaceKey(atWall)`, and
     `settingsFor` is a `useState<string | null>(null)` whose setter is called
     at three places in `Home.tsx` and passed `null` at every one of them.
     Nothing in `packages/web/src` ever sets it to a space key. So
     `.jar-settings--at-left` is a class with a renderer and no door: the
     React that would draw it cannot run. An anchored-sheet measurement needs
     a sheet somebody can open and a button it hangs off, and this had
     neither.

     That is a finding about the product rather than about this file, and it
     is reported rather than fixed here: `space/settings/SpaceSettings.tsx`
     renders `.jar-settings--at-left`, `Home.tsx` holds the `settingsFor`
     state, and the opener is missing between them.

     WHAT COVERAGE WENT: the anchored half of this case is now unmeasured on
     the LEFT as well as the right. `dates` is the one anchored sheet left,
     and it is a real one — `.jar-when` is rendered and `.jar-dial` hangs off
     it — so the claim "a modal that belongs to a button hangs off that
     button" is still held, by one example instead of three. WHAT WOULD
     RESTORE IT: an opener for the wall's settings, after which this arm comes
     back pointed at whatever button that is.

     AND WHY NONE OF THE THREE WAS CAUGHT BY THE DRIFT CHECK ABOVE. `needs`
     was documented as "Class names this case measures", and the case that
     enforces it reads exactly that list. The three ANCHORS were never in it
     — only the surfaces were — so the one gate built to notice a fixture
     standing on a class the world no longer renders could not see the three
     classes doing it. Every class this case now reads, surface AND anchor, is
     in `needs` below, which is what closes that hole rather than patching one
     instance of it. */
  {
    id: "every-modal-is-one-modal",
    name: "every modal wears one surface, and each is placed where it belongs",
    /* SURFACES AND ANCHORS BOTH. `jar-when` is the handle `dates` hangs off,
       and it is in this list for the same reason the surfaces are: it is a
       class this case reads, so the drift check has to see it. That is the
       hole the tombstone above this case describes, closed. */
    needs: ["jar-panel", "jar-seek", "jar-settings", "jar-prov-room", "jar-dial", "jar-when"],
    /* one of the four given its old surface back — the exact drift this
       case exists to notice */
    sabotage:
      ".jar-settings { top: 58px !important; left: 20px !important; transform: none !important;" +
      " border-radius: 14px !important; background: #0a0d14 !important; box-shadow: none !important; }" +
      /* THE `--at-left` HALF OF THIS SABOTAGE WENT WITH THE ARM IT BROKE
         (2026-10-12): it sent an anchored sheet back to the middle, which is
         what this case used to REQUIRE of `.jar-settings--at-left`. The
         `.jar-dial` half below is the surviving anchored sheet's sabotage and
         is what `--negative` now rests on for that claim. */
      /* and the dates given a ground of their own, which is how the rail's
         bespoke scrim got there in the first place */
      " .jar-dial { background: #0a0d14 !important; box-shadow: none !important; }",
    run: async (page) => {
      /* THE FOUNDER'S RULING, 2026-08-25, pointing at a memory's card: "all
         modals must be centered and have same style as this one." There were
         four surfaces — 18px/4px/14px/6px radii, three grounds, two of them
         not centred at all — and which one you got depended on which verb you
         had pressed. The card is the reference, so it is read first and
         everything else is compared against IT rather than against a literal
         written here: if the card changes, the others are required to follow. */
      const read = `(() => {
        const one = (s) => {
          const e = document.querySelector(s);
          if (!e) return null;
          const c = getComputedStyle(e), b = e.getBoundingClientRect();
          return {
            skin: [c.borderRadius, c.padding, c.backgroundColor, c.boxShadow, c.backdropFilter].join(" | "),
            offX: (b.left + b.width / 2) - window.innerWidth / 2,
            offY: (b.top + b.height / 2) - window.innerHeight / 2,
          };
        };
        const anchored = (s, btn, side) => {
          const e = document.querySelector(s), b = document.querySelector(btn);
          if (!e || !b) return null;
          const er = e.getBoundingClientRect(), br = b.getBoundingClientRect();
          const o = one(s);
          o.below = er.top - br.bottom;
          o.edge = side === "left" ? er.left - br.left : er.right - br.right;
          return o;
        };
        return { card: one(".jar-panel"), seek: one(".jar-seek"),
                 settings: one(".jar-settings"), prov: one(".jar-prov-room"),
                 dates: anchored(".jar-dial", ".jar-when", "left") };
      })()`;
      type M = { skin: string; offX: number; offY: number; below?: number; edge?: number };
      const m = (await page.evaluate(read)) as Record<string, M | null>;
      const missing = Object.entries(m).filter(([, v]) => !v).map(([k]) => k);
      if (missing.length) return { ok: false, detail: `not in the fixture at all: ${missing.join(", ")}` };
      const card = m.card as M;
      const others = ["seek", "settings", "prov", "dates"] as const;

      /* AND THE PLACEMENT RULING NARROWED, 2026-08-28: "when clicking on the
         top left and top right button, those cards should just appear right
         below the button rather than in the center." The SURFACE half of the
         2026-08-25 ruling is untouched and still checked against the card for
         all of them; what splits is where each one stands. A modal that
         belongs to the WORLD takes the middle, because that is where your
         eyes already are. A modal that belongs to a BUTTON hangs off that
         button, because it is that button's contents. */
      const centred = ["card", "seek", "settings", "prov"] as const;
      const offCentre = centred.filter(
        (k) => !near((m[k] as M).offX, 0, 1) || !near((m[k] as M).offY, 0, 1),
      );
      if (offCentre.length) {
        return {
          ok: false,
          detail:
            "not centred: " +
            offCentre
              .map((k) => `${k} sits ${r1((m[k] as M).offX)}px across and ${r1((m[k] as M).offY)}px down from the middle`)
              .join("; "),
        };
      }
      /* AND THE DATES ARE THE OTHER ANCHORED SHEET (founder, 2026-08-30:
         "instead of this draggable line, when clicking on now, just show the
         major dates to make them clickable"). It belongs to the word that
         says `now`, so it is the same case as the sheet above it: a menu that
         opened across the room from its own handle would make you re-find the
         thread every time. Its left edge is written inline by the world, from
         the word's own box — see the fixture's script, which is the product's
         line.
         IT SAID "THE THIRD SHEET" AND THERE WERE THREE. The right-hand one
         went on 2026-10-11 with the account pill it hung off; this case's own
         tombstone, above `id`, says what is no longer measured and why. */
      /* The anchored arms, named once: the `adrift` check, the sabotage and
         the detail line all have to agree about which they are. */
      const anchored = ["dates"] as const;
      const adrift = anchored.filter((k) => {
        const v = m[k] as M;
        return !(v.below! > 0 && v.below! < 24 && near(v.edge!, 0, 2));
      });
      if (adrift.length) {
        return {
          ok: false,
          detail:
            "not under the button that opens it: " +
            adrift
              .map((k) => `${k} sits ${r1((m[k] as M).below!)}px below it and ${r1((m[k] as M).edge!)}px off its near edge`)
              .join("; "),
        };
      }
      const different = others.filter((k) => (m[k] as M).skin !== card.skin);
      return {
        ok: different.length === 0,
        detail:
          different.length === 0
            /* IT SAID "THREE HANGING OFF THEIR OWN BUTTON" AND READ
               `m.atRight` TO SAY SO, which the probe had already stopped
               returning — so on the PASS path this line threw
               `Cannot read properties of undefined` and the case reported a
               harness error for being correct. Found 2026-10-12 while taking
               `atLeft` out for the same reason. The count is derived from the
               arms that exist rather than written as a numeral, so the next
               arm to go cannot leave a lie or a crash behind it. */
            ? `${centred.length} centred, ${anchored.length} hanging off its own button (` +
              anchored.map((k) => `${k} ${r1((m[k] as M).below!)}px below it`).join(", ") +
              `), all wearing one surface — ${card.skin}`
            : different
                .map((k) => `${k} is a different object from the card:\n      card ${card.skin}\n      ${k.padEnd(4)} ${(m[k] as M).skin}`)
                .join("\n    "),
      };
    },
  },

  {
    id: "card-head-is-a-row",
    name: "the card's head is one row, centred against itself",
    needs: ["jar-panel-head", "jar-panel-when", "jar-panel-vis"],
    sabotage: ".jar-panel-vis { position: absolute; top: 14px; }",
    run: async (page) => {
      const b = (await page.evaluate(BOXES)) as Boxes;
      const when = b.when as { midY: number; left: number };
      const vis = b.vis as { midY: number; right: number };
      const d = when.midY - vis.midY;
      return {
        ok: near(d, 0),
        detail: near(d, 0)
          ? `the date and who-may-see share a centre (${r1(d)}px apart)`
          : `the date sits ${r1(d)}px off the visibility pair's centre — they are not in one row`,
      };
    },
  },

  {
    id: "card-foot-is-a-row",
    name: "the card's foot is one row, all three cells centred",
    needs: ["jar-panel-foot"],
    /* THE CELLS ARE NOT THE CLAIM, AND MEASURING THEM WAS DECORATION. The
       first version of this case compared the three grid cells and survived
       its own sabotage: with `align-items: baseline` the wrappers still line
       up, because each derives a baseline from its own contents. What moved
       in the real defect was the CARET inside the middle cell — a 7px square
       rotated 45deg, with no baseline of its own, which the browser then
       aligned by its bottom edge against the x-height of `reflect`. So the
       caret and the verb are what get compared.

       AND THE SABOTAGE IS A NUDGE, NOT A REPLAY OF THE ORIGINAL. Putting
       `align-items: baseline` back on the grid moves the caret by half a
       pixel in this fixture — real, and under any slop worth having, because
       the caret sits inside a button whose own box already centres it. What
       negative mode has to prove is that this case CAN fail, so it is given
       the plainest regression of the same kind: somebody nudges the caret. */
    sabotage: ".jar-panel-foot-c .jar-caret { margin-top: 4px; }",
    run: async (page) => {
      const b = (await page.evaluate(BOXES)) as Boxes;
      const verb = (b.footVerb as { midY: number }).midY;
      const caret = (b.footCaret as { midY: number }).midY;
      const cells = [b.footL, b.footC, b.footR].map((x) => (x as { midY: number }).midY);
      const level = near(caret, verb, 1);
      const rowed = near(cells[0]!, cells[1]!) && near(cells[1]!, cells[2]!);
      return {
        ok: level && rowed,
        detail:
          level && rowed
            ? `reflect, the carets and delete share a centre (caret ${r1(caret - verb)}px off the verb)`
            : !level
              ? `the caret sits ${r1(caret - verb)}px off \`reflect\`'s centre — it carries no baseline of its own`
              : `cell centres ${cells.map(r1).join(" / ")}`,
      };
    },
  },

  {
    id: "the-edit-offers-one-act",
    name: "editing puts `save` where the ways on were, and lights it",
    needs: ["jar-panel-foot-c", "jar-panel-save", "jar-caret"],
    /* THE DEFECT THAT ACTUALLY HAPPENED, reproduced exactly. The save rule was
       first written as a bare `.jar-panel-save`, which loses to `.jar-ask
       button` — one class plus one element — so it was inert and the button
       came out in the same faint ink as `leave it` beside it. Giving the
       colour back to `inherit` is that bug, and it must go red here. */
    sabotage: ".jar-ask button.jar-panel-save { color: inherit !important; }",
    run: async (page) => {
      /* Founder, 2026-08-25: "when user edits sth, replace the center left
         right arrow icon with save button." Two things have to hold, and the
         second is the one a screenshot would not settle: `save` must land in
         the SAME SLOT the carets had, so nothing shifts under the pointer when
         the edit begins, and it must be brighter than the ways out beside it,
         because light is the only meaning channel this page has. */
      const read = `(() => {
        const ink = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).color : null; };
        /* CELL AGAINST CELL. The first try read one CARET's box against the
           editing cell's box and reported 16.5px — but there are two carets
           with a gap between them, so a single one sits half a gap off its own
           cell's centre by construction. It was measuring the gap and calling
           it a shift. The claim is about the SLOT, so the slot is what is
           read. */
        const feet = [...document.querySelectorAll(".jar-panel-foot")];
        const cellOf = (f) => { const c = f && f.querySelector(".jar-panel-foot-c");
          if (!c) return null; const b = c.getBoundingClientRect(); return b.left + b.width / 2; };
        return {
          saveX: cellOf(document.querySelector("#foot-editing")),
          caretX: cellOf(feet.find((f) => f.id !== "foot-editing")),
          save: ink(".jar-panel-save"),
          leave: ink("#foot-editing .jar-panel-foot-r button"),
        };
      })()`;
      const m = (await page.evaluate(read)) as {
        saveX: number | null; caretX: number | null; save: string | null; leave: string | null;
      };
      if (m.saveX === null || m.caretX === null) {
        return { ok: false, detail: "one of the two feet is not in the fixture" };
      }
      /* NOT "different from `leave it`" — that was too weak a claim, and the
         sabotage slipped through it: `color: inherit` lands a hair off rather
         than exactly on the neighbour's value, so a broken rule still read as
         "different" and the case passed while decorating. What is actually
         claimed is that the act is at FULL ink and the ways out are not, so
         that is what is measured. */
      const alpha = (c: string | null): number => {
        if (!c) return -1;
        const m4 = /rgba?\(([^)]+)\)/.exec(c);
        if (!m4) return -1;
        const parts = m4[1]!.split(",").map((n) => Number(n.trim()));
        return parts.length < 4 ? 1 : (parts[3] as number);
      };
      const sameSlot = near(m.saveX - m.caretX, 0, 1);
      const brighter = alpha(m.save) >= 0.9 && alpha(m.leave) < 0.9;
      return {
        ok: sameSlot && brighter,
        detail: sameSlot && brighter
          ? `\`save\` takes the carets' own centre (${r1(m.saveX - m.caretX)}px off) and reads ${m.save} against ${m.leave}`
          : !sameSlot
            ? `\`save\` sits ${r1(m.saveX - m.caretX)}px off the slot the carets had — the footer moves under the pointer when an edit begins`
            : `\`save\` is not the lit one — it reads ${m.save} beside \`leave it\` at ${m.leave}; the act and the way out are the same offer`,
      };
    },
  },

  {
    id: "card-words-have-air",
    name: "the card's words have air above and below",
    needs: ["jar-panel-text"],
    sabotage: ".jar-panel-text { margin: 0; }",
    run: async (page) => {
      const b = (await page.evaluate(BOXES)) as Boxes;
      const text = b.text as { top: number; bottom: number };
      const above = text.top - (b.when as { bottom: number }).bottom;
      const below = (b.footL as { top: number }).top - text.bottom;
      const ok = above >= 12 && below >= 12;
      return {
        ok,
        detail: ok
          ? `${r1(above)}px above, ${r1(below)}px below`
          : `${r1(above)}px above and ${r1(below)}px below — the card reads as stacked parts, not one thing with a middle`,
      };
    },
  },
  {
    id: "the-headline-is-the-worlds-own",
    name: "the world's headline is set by the world, not by a sheet passing through",
    needs: ["jar-poster"],
    /* the defect exactly as it shipped: a bare element selector reaching the
       poster from outside `home.css`. Injected styles are unlayered, which is
       what `chrome.css`'s later layer amounted to. */
    sabotage: "h1 { font-size: 28px; font-weight: 400; letter-spacing: 0.02em; }",
    run: async (page) => {
      /*
       * WHAT THIS CAUGHT, AND WHY IT COULD NOT HAVE BEFORE.
       *
       * `chrome.css` ended a selector list with the bare `h1, h2`, is loaded
       * on every route, and sits in the LAST layer. `.jar-poster` is an `h1`.
       * So the product's headline took `clamp(28px, 3vw, 40px)` from the
       * chrome sheet rather than the `clamp(23px, 2.5vw, 34px)` `home.css`
       * asks for, and the poster won ONE of its own eight declarations.
       *
       * Six of the seven it lost happened to agree — same face, same 300,
       * same tracking — which is exactly why it went unseen, and exactly why
       * this case compares against `home.css`'s OWN text rather than against
       * numbers typed here. Two declarations that agree today are two that
       * can disagree tomorrow, and the one that stops being read is the one
       * that keeps being edited: `home.css` carries "300, never heavier …
       * weight is what killed the last attempt" beside a declaration that was
       * not in force.
       */
      const declared = readFileSync(CSS, "utf8").match(/\.jar-poster\s*\{([^}]*)\}/);
      if (!declared) return { ok: false, detail: "`home.css` no longer has a `.jar-poster` rule to be held to" };
      const rule = declared[1]!.replace(/\/\*[\s\S]*?\*\//g, " ");
      const want = (prop: string): string | null => {
        const hit = rule.match(new RegExp(`(?<![\\w-])${prop}:\\s*([^;]+);`));
        return hit ? hit[1]!.trim() : null;
      };

      /* `clamp(a, b <unit>, c)` resolved against whatever that unit measures,
         because that is the only way to compare a fluid declaration with a
         rendered pixel.

         `cqi` IS ONE PERCENT OF THE COLUMN, NOT OF THE WINDOW, and the whole
         point of the 2026-08-30 change is that those two stopped agreeing:
         the column caps at 680 while the window goes on growing, so a case
         that resolved `cqi` against the viewport would have declared the
         product wrong at every width above the cap. The column's own content
         box is measured here rather than restated — 640 is a number this
         stylesheet is free to change. */
      const size = want("font-size");
      const view = page.viewportSize() ?? { width: 900, height: 640 };
      const column = (await page.evaluate(`(() => {
        const c = document.querySelector(".jar-hq-inner");
        if (!c) return 0;
        const s = getComputedStyle(c);
        return c.getBoundingClientRect().width - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
      })()`)) as number;
      /* one percent of whatever each unit measures */
      const per: Record<string, number> = {
        vw: view.width / 100,
        vh: view.height / 100,
        cqi: column / 100,
      };
      /**
       * THE MIDDLE TERM IS A `min()` NOW, AND THE FIRST VERSION OF THIS JUST
       * STOPPED CHECKING.
       *
       * It matched `clamp(a px, b <unit>, c px)` and nothing else. When the
       * claim gained a second cap — `min(5.3125cqi, 5vh)`, one for the column
       * and one for a short window — the pattern missed, `expected` fell to
       * null, and the size comparison below was skipped in silence. The case
       * went on passing while checking three properties instead of four,
       * which is the exact way a gate becomes decoration: not by being
       * deleted, by quietly narrowing.
       *
       * So an unparseable font-size is a FAILURE here rather than a skip. If
       * this file cannot read what `home.css` declares, it cannot claim the
       * product agrees with it.
       */
      const fluid = (term: string): number | null => {
        const one = term.trim().match(/^([\d.]+)(vw|vh|cqi)$/);
        if (one) return Number(one[1]) * per[one[2]!]!;
        const least = term.trim().match(/^min\(([^)]+)\)$/);
        if (!least) return null;
        const parts = least[1]!.split(",").map((t) => fluid(t));
        if (parts.some((v) => v === null)) return null;
        return Math.min(...(parts as number[]));
      };
      const clamp = size?.match(/^clamp\(\s*([\d.]+)px\s*,(.+),\s*([\d.]+)px\s*\)$/s);
      const middle = clamp ? fluid(clamp[2]!) : null;
      if (size && middle === null) {
        return {
          ok: false,
          detail:
            `\`home.css\` declares \`font-size: ${size}\` and this case cannot read it, so it ` +
            "cannot say whether the product agrees. Teach the parser the new shape rather than " +
            "leaving a check that quietly passes on three properties instead of four.",
        };
      }
      const expected = clamp
        ? Math.min(Math.max(Number(clamp[1]), middle!), Number(clamp[3]))
        : null;

      const got = (await page.evaluate(() => {
        const el = document.querySelector(".jar-poster");
        if (!el) return null;
        const cs = getComputedStyle(el);
        return {
          size: parseFloat(cs.fontSize),
          weight: cs.fontWeight,
          family: cs.fontFamily.split(",")[0]!.replace(/['"]/g, "").trim(),
          tracking: cs.letterSpacing,
        };
      })) as { size: number; weight: string; family: string; tracking: string } | null;
      if (!got) return { ok: false, detail: "the poster is not in the fixture" };

      const wrong: string[] = [];
      if (expected !== null && Math.abs(got.size - expected) > 0.5) {
        wrong.push(
          `size ${got.size}px, and \`home.css\` asks for ${Math.round(expected * 100) / 100}px ` +
            `in a ${view.width}x${view.height} frame on a ${Math.round(column)}px column`,
        );
      }
      const weight = want("font-weight");
      if (weight && got.weight !== weight) wrong.push(`weight ${got.weight}, declared ${weight}`);
      const family = want("font-family")?.split(",")[0]?.replace(/['"]/g, "").trim();
      if (family && got.family !== family) wrong.push(`face ${got.family}, declared ${family}`);
      /* tracking is declared in em and rendered in px, so it is compared as em */
      const tracking = want("letter-spacing");
      const em = tracking?.match(/^([\d.]+)em$/);
      if (em && Math.abs(parseFloat(got.tracking) - Number(em[1]) * got.size) > 0.2) {
        wrong.push(`tracking ${got.tracking}, declared ${tracking} of ${got.size}px`);
      }

      return {
        ok: wrong.length === 0,
        detail:
          wrong.length === 0
            ? `${got.size}px ${got.weight} ${got.family} at ${got.tracking} — every one of them `
              + "`home.css`'s own"
              + (clamp ? `, the size solved against a ${Math.round(column)}px column in a ${view.width}x${view.height} frame` : "")
            : wrong.join("; "),
      };
    },
  },

  /* ═══ THE ONE VERTICAL AXIS ON A PHONE WENT WITH BOTH OF ITS ENDS ════════
     `one-axis-on-a-phone` STOOD HERE and went on 2026-10-12. The founder's
     ruling it carried is unchanged and is worth keeping on the record:
     2026-09-08, on a phone, "philosophies and value is not centered" —
     reversing their own 2026-08-28 "so ugly" about the same signpost centred
     over an empty wall. What the case measured was the PAIR: `.jar-values`
     at the top of the screen and `.jar-saved` at the bottom are the two ends
     of one vertical axis, so the claim was not "is it in the middle" but "do
     the two ends agree".

     NEITHER END RENDERS. `jar-values` appears nowhere in `packages/web/src`
     outside `src/styles`; `jar-saved` survives only as a `querySelector`
     argument in `Home.tsx`. The axis itself is what went: up and down are
     rows in the bar now, side by side, and two rows of one flex line cannot
     disagree about a centre.

     WHAT COVERAGE WENT: nothing measures the narrow layout's chrome against
     the centre of the glass. WHAT WOULD RESTORE IT: the same `.waka-dock`
     case the signposts' tombstone above asks for, run at 390 — the bar is
     where the phone's chrome lives now.

     The sabotage went with it: `@media (max-width: 560px) { .jar-values
     { left: 8px; transform: none } }`. */

  {
    id: "the-claim-keeps-its-measure",
    name: "the claim reads the same width of line wherever the column is the same",
    needs: ["jar-poster", "jar-hq-inner"],
    /* the old curve put back: type set against the WINDOW while the column
       caps at 680, which is the defect in one declaration */
    sabotage:
      ".jar-poster { font-size: clamp(23px, 2.5vw, 34px) !important; }" +
      " @media (max-width: 560px) { .jar-poster { font-size: clamp(18px, 5.5vw, 23px) !important; } }",
    run: async (page) => {
      /**
       * MEASURE IS WHAT A READER FEELS, and measure is the column divided by
       * the font's real advance — not the sentence's length over its line
       * count, which moves in whole lines and flattered this by five
       * characters when I first took it.
       *
       * THE CLAIM THIS MAKES CHANGED ON 2026-08-30, because the defect it was
       * shaped against turned out to be half of a bigger one.
       *
       * It used to ask only whether a PHONE kept most of the desktop's
       * measure. That question could not see the founder's tablet report
       * ("overall balancing feels kinda off"): between 560px and about
       * 1360px the column has ALREADY stopped growing at its 680 cap while
       * type set in `vw` goes on shrinking with the window, so the line gets
       * longer as the screen gets smaller — 38 characters at 1440 against 56
       * at 768. Both widths are desktops as far as the old case was
       * concerned, so it reported clean.
       *
       * So the first half is now the sharper question: AT TWO WIDTHS WHERE
       * THE COLUMN IS IDENTICAL, THE MEASURE MUST BE IDENTICAL. That is not a
       * threshold anybody has to choose — it is the same column, so it is the
       * same answer, and a curve set against the wrong thing fails it by a
       * mile rather than by a percentage point.
       *
       * The phone claim is kept as the second half, because the phone is
       * where the column really does narrow and something really is given up.
       * IT DOES NOT REACH THE DESKTOP'S NUMBER AND IS NOT MEANT TO: matching
       * it exactly needs 18.6px in a 350px column, which puts the wall's claim
       * at 1.24x body text and stops it reading as the claim; on a desktop it
       * is 2.27x. See `home.css` for that trade written out.
       */
      const read = `(() => {
        const p = document.querySelector(".jar-poster");
        const col = document.querySelector(".jar-hq-inner");
        if (!p || !col) return null;
        const cs = getComputedStyle(p);
        const probe = document.createElement("span");
        probe.textContent = "abcdefghijklmnopqrstuvwxyz abcdefghijklmnopqrstuvwxyz";
        probe.style.cssText =
          "position:absolute;visibility:hidden;white-space:pre;left:-9999px;font-family:" +
          cs.fontFamily + ";font-size:" + cs.fontSize + ";font-weight:" + cs.fontWeight +
          ";letter-spacing:" + cs.letterSpacing;
        document.body.appendChild(probe);
        const per = probe.getBoundingClientRect().width / probe.textContent.length;
        probe.remove();
        return JSON.stringify({
          size: Math.round(parseFloat(cs.fontSize) * 10) / 10,
          column: Math.round(p.getBoundingClientRect().width),
          fits: Math.round(p.getBoundingClientRect().width / per),
        });
      })()`;
      type Shot = { size: number; column: number; fits: number };
      const at = async (w: number, h: number): Promise<Shot | null> => {
        await page.setViewportSize({ width: w, height: h });
        await page.waitForTimeout(200);
        const raw = (await page.evaluate(read)) as string | null;
        return raw ? (JSON.parse(raw) as Shot) : null;
      };
      const wide = await at(1440, 900);
      const tablet = await at(768, 1024);
      const phone = await at(390, 844);
      if (!wide || !tablet || !phone) return { ok: false, detail: "no claim on the fixture to measure" };

      const faults: string[] = [];
      /* the premise: these two widths must be the same column, or the case is
         asking a question about something else and should say so */
      if (Math.abs(wide.column - tablet.column) > 1) {
        faults.push(
          `the column is ${wide.column} at 1440 and ${tablet.column} at 768 — this case ` +
            "compares two widths on the assumption the column caps between them, and it no longer does",
        );
      } else if (Math.abs(wide.fits - tablet.fits) > 1) {
        faults.push(
          `the same ${wide.column}px column reads ${wide.fits} characters at 1440 and ` +
            `${tablet.fits} at 768 — the type is set against the window while the column is capped, ` +
            `so the line gets LONGER as the screen gets smaller (${wide.size}px against ${tablet.size}px)`,
        );
      }
      /* A PHONE KEEPS AT LEAST FOUR FIFTHS OF THE DESKTOP'S MEASURE. */
      const lost = Math.round(((wide.fits - phone.fits) / wide.fits) * 100);
      if (lost > 20) {
        faults.push(
          `a phone at ${phone.size}px fits ${phone.fits} characters against the desktop's ` +
            `${wide.fits} — ${lost}% given up, more than the fifth allowed`,
        );
      }
      return {
        ok: faults.length === 0,
        detail:
          faults.length === 0
            ? `${wide.fits} characters at 1440 and ${tablet.fits} at 768 on one ${wide.column}px ` +
              `column (${wide.size}px both), and a phone at ${phone.size}px keeps ${phone.fits} — ` +
              `${lost}% given up where the column really does narrow`
            : faults.join("; "),
      };
    },
  },
];

interface Args { negative: boolean; only: string | null }

function parseArgs(argv: string[]): Args {
  const args: Args = { negative: false, only: null };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i]!.split(/=(.*)/s);
    const take = (): string => inline ?? argv[++i] ?? "";
    if (flag === "--negative") args.negative = true;
    else if (flag === "--only") args.only = take();
    else if (flag === "--help" || flag === "-h") {
      console.log("Usage: pnpm e2e:measure [--negative] [--only <id>]");
      process.exit(0);
    }
  }
  return args;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const chosen = args.only ? CASES.filter((c) => c.id === args.only) : CASES;
  if (chosen.length === 0) {
    console.error(`[measure] no case with id "${args.only}"`);
    return 2;
  }

  /* Served rather than opened as a file:// so the stylesheet link resolves
     the same way it does in the product, through HTTP with a real origin. */
  let srv: Server | null = null;
  let browser: Browser | null = null;
  const results: Array<{ id: string; ok: boolean; detail: string }> = [];

  try {
    srv = createServer((req, res) => {
      if (req.url === "/home.css") {
        res.setHeader("content-type", "text/css");
        res.end(readFileSync(CSS));
        return;
      }
      if (req.url === "/layers.css") {
        res.writeHead(200, { "content-type": "text/css" });
        res.end(readFileSync(LAYERS));
        return;
      }
      if (req.url === "/chrome.css") {
        res.writeHead(200, { "content-type": "text/css" });
        res.end(readFileSync(CHROME));
        return;
      }
      if (req.url === "/system.css") {
        res.setHeader("content-type", "text/css");
        res.end(readFileSync(TOKENS));
        return;
      }
      res.setHeader("content-type", "text/html");
      res.end(FIXTURE);
    });
    await new Promise<void>((ok) => srv!.listen(0, "127.0.0.1", ok));
    const port = (srv.address() as { port: number }).port;
    const url = `http://127.0.0.1:${port}/`;

    console.log(`[measure] the world's own stylesheet, measured in a real engine`);
    console.log(
      args.negative
        ? "[measure] NEGATIVE mode — each case runs against its own sabotage and MUST fail\n"
        : "[measure] each case must pass\n",
    );

    browser = await launchChromium();

    for (let i = 0; i < chosen.length; i += 1) {
      const kase = chosen[i]!;
      /* A source-only case has no sabotage to inject: in negative mode it is
         reported as not run rather than counted as a pass it did not earn. */
      if (args.negative && kase.sabotage === "") {
        console.log(`SKIP ${i + 1}. ${kase.name} — source check, no stylesheet to sabotage`);
        continue;
      }
      const page = await browser.newPage({ viewport: { width: 900, height: 640 } });
      await page.goto(url, { waitUntil: "load" });
      if (args.negative && kase.sabotage) {
        await page.addStyleTag({ content: kase.sabotage });
      }
      await page.waitForTimeout(120);

      let outcome: { ok: boolean; detail: string };
      try {
        outcome = await kase.run(page);
      } catch (err) {
        outcome = { ok: false, detail: `threw: ${err instanceof Error ? err.message : String(err)}` };
      }
      await page.close();

      const satisfied = args.negative ? !outcome.ok : outcome.ok;
      results.push({ id: kase.id, ok: satisfied, detail: outcome.detail });
      console.log(
        `${satisfied ? "PASS" : "FAIL"} ${i + 1}. ${kase.name} — ${outcome.detail}` +
          (args.negative && !satisfied ? "  << survived its sabotage; this case is decoration" : ""),
      );
    }
  } catch (err) {
    console.error(`\n[measure] harness error: ${err instanceof Error ? err.message : err}`);
    return 2;
  } finally {
    await browser?.close();
    srv?.close();
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n[measure] ${results.length - failed} passed, ${failed} failed`);
  return failed > 0 ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
