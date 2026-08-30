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
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, type Page } from "playwright";
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
const HOME = resolve(REPO, "packages/web/src/pages/Home.tsx");

/**
 * THE INSET EVERY SIGNPOST KEEPS FROM THE EDGE IT IS NEAREST.
 *
 * Founder ruling, 2026-08-25: "make margin 10px for all 4". It is one number
 * here rather than four literals below, so moving it is one edit and the
 * suite cannot end up asserting two different answers in two cases.
 */
const INSET = 10;

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
   Markup mirroring what `Home.tsx` renders, against the product's own
   stylesheet. The two positioned families are laid out as the world lays
   them out: the ways sideways are placed from their wall's column, which in
   a single-column fixture is the viewport's own edges. */
const FIXTURE = `<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="/layers.css">
<link rel="stylesheet" href="/system.css">
<link rel="stylesheet" href="/home.css">
<link rel="stylesheet" href="/chrome.css">
<style>
  html, body { margin: 0; height: 100%; background: #0a0d14; }
  .jar { position: fixed; inset: 0; }
  /* the world writes these two as inline \`left\` from the wall's column */
  .jar-way { left: ${INSET}px; }
  .jar-way--r { left: auto; right: ${INSET}px; transform: none; }
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
  <button class="jar-values" data-jar-chrome="1">
    <span class="jar-values-words jar-label">philosophies &amp; values</span>
    <span class="jar-caret jar-caret--up" aria-hidden="true"></span>
  </button>
  <button class="jar-way jar-label" data-jar-chrome="1">
    <span class="jar-caret jar-caret--left" aria-hidden="true"></span><span>AGENT1</span>
  </button>
  <button class="jar-way jar-way--r jar-label" data-jar-chrome="1">
    <span>ROOM1</span><span class="jar-caret jar-caret--right" aria-hidden="true"></span>
  </button>
  <button class="jar-saved" data-jar-chrome="1">
    <span class="jar-saved-count">30 inspirations</span>
    <span class="jar-caret" aria-hidden="true"></span>
  </button>
  <div class="jar-topbar" data-jar-chrome="1">
    <div class="jar-exits">
      <span class="jar-here-split"><button class="jar-here jar-back jar-label">ME</button></span>
      <button class="jar-when jar-label">now</button>
    </div>
    <button class="jar-account jar-back jar-label">Your account</button>
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
    <p class="jar-ask jar-ask--row jar-mouth-where jar-mouth-where--armed">
      <button type="button" class="jar-where-on">private</button>
      <span aria-hidden="true">/</span>
      <button type="button" class="jar-where-off">public</button>
      <span aria-hidden="true" class="jar-mouth-dot"> &middot; </span>
      <button type="button" class="jar-where-on">save</button>
      <span aria-hidden="true" class="jar-mouth-dot"> &middot; </span>
      <button type="button" class="jar-where-off">reflect</button>
    </p>
  </div>

  <div class="jar-settings" data-jar-chrome="1" role="dialog">
    <div class="jar-settings-head"><span class="jar-label">this wall</span></div>
  </div>
  <div class="jar-settings jar-settings--at-left" data-jar-chrome="1" role="dialog">
    <div class="jar-settings-head"><span class="jar-label">this wall</span></div>
  </div>
  <div class="jar-settings jar-settings--at-right" data-jar-chrome="1" role="dialog">
    <div class="jar-settings-head"><span class="jar-label">your account</span></div>
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
  </div>

  <!-- the sheet the world puts up after a keep, so a variant that is meant to
       sit at the bottom can be caught being stretched from the top -->
  <div class="jar-seek jar-reflect-room" data-jar-chrome="1" role="dialog">
    <p class="jar-prov-lead jar-label">saved</p>
    <p class="jar-reflect-on">the mouth's foot is one row now</p>
    <p class="jar-reflect-q">What did this stir in you?</p>
    <textarea class="jar-reflect-box" rows="3" placeholder="In your own words"></textarea>
    <p class="jar-ask jar-ask--row" id="reflect-foot">
      <button type="button">keep</button>
      <span aria-hidden="true"> &middot; </span>
      <button type="button">not now</button>
    </p>
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
    values: box(".jar-values"), wayL: box(".jar-way"), wayR: box(".jar-way--r"),
    saved: box(".jar-saved"), dial: box(".jar-dial"), nowWord: box(".jar-when"),
    when: box(".jar-panel-when"), vis: box(".jar-panel-vis"),
    text: box(".jar-panel-text"),
    footL: box(".jar-panel-foot-l"), footC: box(".jar-panel-foot-c"), footR: box(".jar-panel-foot-r"),
    footVerb: box(".jar-panel-foot-l button"), footCaret: box(".jar-panel-foot-c .jar-caret"),
    inkValues: ink(".jar-values-words"), inkWayL: ink(".jar-way"),
    inkWayR: ink(".jar-way--r"), inkSaved: ink(".jar-saved-count"),
    inkCaretUp: ink(".jar-caret--up"), inkCaretLeft: ink(".jar-caret--left"),
    inkCaretRight: ink(".jar-caret--right"),
    /* the two rows of quiet verbs: the card's head and the mouth's foot */
    typeVis: ink(".jar-panel-vis button"), typeMouth: ink(".jar-mouth-where button"),
    typeWhen: ink(".jar-panel-when"),
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
      const home = readFileSync(HOME, "utf8");
      /* DERIVED, NEVER RESTATED. This was a hand-kept list beside the cases'
         own `needs`, so a case added later declared five classes and this
         one went on checking the same fourteen — a drift check that had
         itself drifted. There is one place a case says what it stands on,
         and this reads it. */
      const wanted = [
        ...new Set([
          ...CASES.flatMap((c) => c.needs),
          /* the fixture's own scaffolding, measured by no single case but
             stood on by all of them */
          "jar-values-words", "jar-saved-count", "jar-caret", "jar-way--r",
        ]),
      ].sort();
      /* WHOLE CLASS NAMES, NOT SUBSTRINGS. `includes` said yes to
         `jar-panel-head` while the product had renamed it to
         `jar-panel-headline` — the exact drift this case exists to catch,
         waved through because one name is a prefix of the other. A class is
         only really there if what follows it is not more class. */
      const missing = wanted.filter(
        (c) => !new RegExp(`(?<![\\w-])${c}(?![\\w-])`).test(home),
      );
      return {
        ok: missing.length === 0,
        detail:
          missing.length === 0
            ? `${wanted.length} classes, all present in Home.tsx`
            : `the fixture stands on classes the world no longer renders: ${missing.join(", ")}` +
              " — every measurement below would be about a page nobody has",
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

  {
    id: "signposts-one-voice",
    name: "the four signposts are set in one voice",
    needs: ["jar-values-words", "jar-way", "jar-saved-count"],
    sabotage: ".jar-saved-count { color: #fff; }",
    run: async (page) => {
      const b = (await page.evaluate(BOXES)) as Boxes;
      const inks = {
        "philosophies & values": b.inkValues as string,
        "the way left": b.inkWayL as string,
        "the way right": b.inkWayR as string,
        "the count": b.inkSaved as string,
      };
      const distinct = [...new Set(Object.values(inks))];
      return {
        ok: distinct.length === 1,
        detail:
          distinct.length === 1
            ? `all four: ${distinct[0]}`
            : `${distinct.length} different registers — ` +
              Object.entries(inks).map(([k, v]) => `${k}: ${v}`).join(" / "),
      };
    },
  },

  {
    id: "signposts-one-inset",
    name: "every signpost keeps the same air from the edge it is nearest",
    needs: ["jar-values", "jar-way", "jar-saved"],
    sabotage: ".jar-values { top: 40px; }",
    run: async (page) => {
      const b = (await page.evaluate(BOXES)) as Boxes;
      const box = (k: string) => b[k] as { top: number; bottom: number; left: number; right: number };
      /* THE COUNT HAS THE EDGE, AND THE RAIL STANDS OFF IT BY THE SAME AIR.
         The rail lives down here too — it is a horizontal instrument and this
         is the only clear full-width band on the page — but it is the count
         that touches the glass, and the gap between them is the same 10px
         every signpost keeps. It used to be the other way round, which cost
         the count its own inset: it kept 10px from the RAIL while the rail
         kept 6px from the screen, so the sign a person reads most sat
         furthest from an edge of the four. */
      /* THE DATES ARE NOT MEASURED HERE ANY MORE, and that is a claim moving
         house rather than a claim being dropped. This case is about the four
         SIGNPOSTS and the one air they all keep from the edge they are
         nearest. The rail's gap was grafted on when the instrument moved up
         here from the bottom band; the instrument is now the third of the
         sheets that hang off the button that opened them, so how it stands
         under `.jar-when` is asked by `every-modal-is-one-modal`, beside the
         same question about the other two. One question, one place. */
      const got = {
        top: box("values").top,
        left: box("wayL").left,
        right: b.vw - box("wayR").right,
        /* THE COUNT HAS THE BOTTOM EDGE ENTIRELY, since 2026-08-27. First the
           rail was under it, which cost the count its own inset — it kept 10px
           from the RAIL while the rail kept 6px from the screen, so the sign a
           person reads most sat furthest from an edge of the four. Then the
           rail moved above it. Now the rail has left this edge altogether and
           gone to hang under its own word, and the count is the only thing
           down here. */
        bottom: b.vh - box("saved").bottom,
      };
      const wrong = Object.entries(got).filter(([, v]) => !near(v, INSET, 1));
      return {
        ok: wrong.length === 0,
        detail:
          wrong.length === 0
            ? `${INSET}px on all four`
            : `wanted ${INSET}px, got ` + Object.entries(got).map(([k, v]) => `${k} ${r1(v)}`).join(", "),
      };
    },
  },

  {
    id: "verb-rows-one-register",
    name: "every row of quiet verbs is set in the label register",
    needs: ["jar-panel-vis", "jar-mouth-where"],
    sabotage: ".jar-mouth-where button { font-size: 13px; text-transform: none; }",
    run: async (page) => {
      /* THE MISS THIS CASE EXISTS FOR. `private/public` was brought to the
         label register on the CARD and left at `.jar-ask`'s 13px prose in the
         MOUTH — the same four words, two registers, depending which surface
         you were on, and nothing in the repo could tell. What is compared is
         type only, not colour: these rows sit on different grounds and are
         allowed different ink. */
      const b = (await page.evaluate(BOXES)) as Boxes;
      const typeOf = (s: string) => (s ?? "").split(" | ").slice(0, 4).join(" | ");
      const rows = {
        "the card's date": typeOf(b.typeWhen as string),
        "the card's private/public": typeOf(b.typeVis as string),
        "the mouth's row": typeOf(b.typeMouth as string),
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

  {
    id: "a-sheet-is-its-contents-tall",
    name: "a modal is only as tall as what is in it",
    needs: ["jar-seek", "jar-reflect-room", "jar-reflect-on", "jar-reflect-q", "jar-reflect-box"],
    /* THE SABOTAGE HAD TO BE REWRITTEN, and the reason is worth keeping. It
       was `top: 58px` alone, which was enough while the variant answered
       `bottom: 16vh` — the two together are what pinned both edges and
       stretched the box. Once every modal became one centred surface nothing
       set `bottom` any more, so forcing `top` merely MOVED the sheet and this
       case survived its own sabotage: decoration, reported as such by
       `--negative`. Both edges are pinned here explicitly, so the case still
       measures the thing it was written for. */
    sabotage:
      ".jar-seek.jar-reflect-room { top: 58px !important; bottom: 16vh !important;" +
      " transform: translateX(-50%) !important; }",
    run: async (page) => {
      /* THE THIRD TIME THIS CASCADE BUG SHIPPED. `.jar-reflect-room` was
         written a hundred and eighty lines ABOVE `.jar-seek`, so its
         `top: auto` lost to the base's `top: 58px` — same specificity, later
         wins — and the sheet stretched from the top edge down to its own
         `bottom: 16vh`: six hundred pixels tall with four hundred of nothing
         under the verbs. Nobody reading either rule would see it. A box is
         honest when its floor is one padding below its last child. */
      const read = `(() => {
        const s = document.querySelector(".jar-reflect-room");
        const last = s && s.lastElementChild;
        if (!s || !last) return null;
        const a = s.getBoundingClientRect(), b = last.getBoundingClientRect();
        return { height: a.height, slack: a.bottom - b.bottom,
                 pad: parseFloat(getComputedStyle(s).paddingBottom) };
      })()`;
      const m = (await page.evaluate(read)) as { height: number; slack: number; pad: number } | null;
      if (!m) return { ok: false, detail: "the sheet is not in the fixture at all" };
      const ok = Math.abs(m.slack - m.pad) <= 1;
      return {
        ok,
        detail: ok
          ? `${r1(m.height)}px tall, with its ${r1(m.pad)}px of padding under the last thing in it and nothing else`
          : `${r1(m.slack - m.pad)}px of dead space under the sheet's last row — it is ${r1(m.height)}px tall and its contents do not fill it`,
      };
    },
  },

  {
    id: "every-modal-is-one-modal",
    name: "every modal wears one surface, and each is placed where it belongs",
    needs: ["jar-panel", "jar-seek", "jar-settings", "jar-prov-room", "jar-dial"],
    /* one of the four given its old surface back — the exact drift this
       case exists to notice */
    sabotage:
      ".jar-settings { top: 58px !important; left: 20px !important; transform: none !important;" +
      " border-radius: 14px !important; background: #0a0d14 !important; box-shadow: none !important; }" +
      /* and the second half of the ruling: an anchored sheet sent back to the
         middle, which is what this case used to REQUIRE */
      " .jar-settings--at-left { left: 50% !important; top: 50% !important;" +
      " transform: translate(-50%, -50%) !important; }" +
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
                 atLeft: anchored(".jar-settings--at-left", ".jar-here", "left"),
                 atRight: anchored(".jar-settings--at-right", ".jar-account", "right"),
                 dates: anchored(".jar-dial", ".jar-when", "left") };
      })()`;
      type M = { skin: string; offX: number; offY: number; below?: number; edge?: number };
      const m = (await page.evaluate(read)) as Record<string, M | null>;
      const missing = Object.entries(m).filter(([, v]) => !v).map(([k]) => k);
      if (missing.length) return { ok: false, detail: `not in the fixture at all: ${missing.join(", ")}` };
      const card = m.card as M;
      const others = ["seek", "settings", "prov", "atLeft", "atRight", "dates"] as const;

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
      /* AND THE THIRD SHEET IS THE DATES (founder, 2026-08-30: "instead of
         this draggable line, when clicking on now, just show the major dates
         to make them clickable"). It belongs to the word that says `now`, so
         it is the same case as the other two: a menu that opened across the
         room from its own handle would make you re-find the thread every
         time. Its left edge is written inline by the world, from the word's
         own box — see the fixture's script, which is the product's line. */
      const adrift = (["atLeft", "atRight", "dates"] as const).filter((k) => {
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
            ? `four centred, three hanging off their own button (${r1((m.atLeft as M).below!)}px, ` +
              `${r1((m.atRight as M).below!)}px and ${r1((m.dates as M).below!)}px below it), ` +
              `all wearing one surface — ${card.skin}`
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

      /* `clamp(a, b vw, c)` resolved at the fixture's own width, because that
         is the only way to compare a fluid declaration with a rendered pixel */
      const size = want("font-size");
      const clamp = size?.match(/clamp\(\s*([\d.]+)px\s*,\s*([\d.]+)vw\s*,\s*([\d.]+)px\s*\)/);
      const width = page.viewportSize()?.width ?? 900;
      const expected = clamp
        ? Math.min(Math.max(Number(clamp[1]), (Number(clamp[2]) / 100) * width), Number(clamp[3]))
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
        wrong.push(`size ${got.size}px, and \`home.css\` asks for ${expected}px at ${width}px wide`);
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
            : wrong.join("; "),
      };
    },
  },

  {
    id: "one-left-edge-on-a-phone",
    name: "on a phone the signpost and the claim share one left edge",
    needs: ["jar-values", "jar-poster", "jar-hq-inner"],
    /* put the signpost back in the middle of the screen, which is where it was */
    sabotage:
      "@media (max-width: 560px) { .jar-values { left: 50% !important;" +
      " transform: translateX(-50%) !important; } }",
    run: async (page) => {
      /* THE FOUNDER, over two screenshots of a phone: "so ugly" (2026-08-28).
         Measured at 390px: the claim is set LEFT from x 20 and the signpost
         above it was CENTRED at 195 — two alignment systems stacked. On a
         desktop that reads as deliberate, because the claim sits in a 680px
         column inside a 1440px frame and a centred label agrees with the
         column's own centre. On a phone the claim IS the full width, so a
         centred label agrees with nothing, and on a wall with nothing on it
         yet the label floats over one short italic line at the far edge.

         THE CASE RESIZES ITSELF, because the rule it measures lives behind
         `max-width: 560px` and every other case here runs at 900. The
         harness hands each case its own page, so this costs nothing but the
         reflow.

         AND IT COMPARES INK, NOT BOXES. The signpost is a button carrying
         12px of side padding, so its BOX has to stand 12px further left than
         the claim for their WORDS to line up. A case that compared boxes
         would demand the wrong number and, worse, would be satisfied by a
         signpost whose letters were visibly out. */
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(200);
      const read = `(() => {
        const e = document.querySelector(".jar-values");
        const p = document.querySelector(".jar-poster");
        if (!e || !p) return null;
        const rg = document.createRange();
        rg.selectNodeContents(e);
        const ink = rg.getBoundingClientRect();
        return JSON.stringify({
          ink: Math.round(ink.left),
          box: Math.round(e.getBoundingClientRect().left),
          claim: Math.round(p.getBoundingClientRect().left),
        });
      })()`;
      const raw = (await page.evaluate(read)) as string | null;
      if (!raw) return { ok: false, detail: "no signpost or no claim on the fixture" };
      const m = JSON.parse(raw) as { ink: number; box: number; claim: number };
      const off = m.ink - m.claim;
      return {
        ok: near(off, 0, 1),
        detail: near(off, 0, 1)
          ? `both start at x ${m.claim} — the signpost's box stands at ${m.box}, ` +
            `its own padding wide of it, so the letters line up`
          : `the signpost's words start at x ${m.ink} and the claim's first letter at ` +
            `x ${m.claim} — ${r1(off)}px apart, two left edges`,
      };
    },
  },

  {
    id: "the-claim-keeps-its-measure",
    name: "the claim does not lose its measure when the column narrows",
    needs: ["jar-poster", "jar-hq-inner"],
    /* the type pinned back at its old flat floor, which is the defect */
    sabotage: "@media (max-width: 560px) { .jar-poster { font-size: 23px !important; } }",
    run: async (page) => {
      /* MEASURED AS CHARACTERS THAT FIT, not as the sentence's length over its
         line count. The second is a coarse proxy — it moves in whole lines, so
         two very different settings that happen to take the same number of
         lines read identical, and it flattered this by five characters when I
         first took it. The column over the font's real advance is exact, and
         says nothing about whatever sentence the wall is holding today.

         `clamp(23px, 2.5vw, 34px)` hits its floor at a 920px viewport while the
         column keeps shrinking below 680, so the type stopped responding before
         the column did and the measure fell away on exactly the widths people
         hold in their hand.

         IT DOES NOT REACH THE DESKTOP'S NUMBER AND IS NOT MEANT TO. Matching it
         exactly needs 18.5px in a 350px column, which would put the wall's
         claim at 1.23x body text and stop it reading as the claim; on a desktop
         it is 2.27x. See `home.css` for that trade written out. */
      const read = `(() => {
        const p = document.querySelector(".jar-poster");
        if (!p) return null;
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
          fits: Math.round(p.getBoundingClientRect().width / per),
        });
      })()`;
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(200);
      const deskRaw = (await page.evaluate(read)) as string | null;
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(200);
      const phoneRaw = (await page.evaluate(read)) as string | null;
      if (!deskRaw || !phoneRaw) return { ok: false, detail: "no claim on the fixture to measure" };
      const desk = JSON.parse(deskRaw) as { size: number; fits: number };
      const phone = JSON.parse(phoneRaw) as { size: number; fits: number };
      const lost = Math.round(((desk.fits - phone.fits) / desk.fits) * 100);
      /* A PHONE KEEPS AT LEAST FOUR FIFTHS OF THE DESKTOP'S MEASURE, and the
         number is chosen from both sides: the flat 23px floor this replaces
         loses a quarter and must fail; scaling with the column loses 18% and
         must pass. 18 as the line was the first try and sat exactly on the
         measured value — a threshold with no room on the passing side is one
         font-metric change away from failing for nothing. */
      return {
        ok: lost <= 20,
        detail:
          `desktop ${desk.size}px fits ${desk.fits} characters, a phone at ${phone.size}px fits ` +
          `${phone.fits} — ${lost}% of the desktop's measure given up ` +
          `${lost <= 20 ? "(within the fifth allowed)" : "*** MORE THAN A FIFTH ***"}`,
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
