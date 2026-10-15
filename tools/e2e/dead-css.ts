#!/usr/bin/env tsx
/**
 * WHICH CSS IN THIS TREE STILL DECIDES ANYTHING — ASKED OF THE BROWSER.
 *
 * goal: one-product-one-system, audit A4. Its end state includes "nothing in
 * the tree is unreferenced", and until now nothing here could tell you which
 * rules those were. Two earlier attempts to answer it by parsing the
 * stylesheets both failed, and failed in the same direction: a hand-written
 * parser returned 0 dead rules, which was believed for exactly as long as it
 * took to check one by hand.
 *
 * The reason a parser cannot answer it is `layers.css`:
 *
 *     @layer base, product, chrome;
 *
 * `global.css` and `system.css` are in `product`; `chrome.css` is in `chrome`,
 * a LATER layer, so every declaration in it beats every declaration in the
 * other two REGARDLESS OF SPECIFICITY. `chrome.css`'s stated job is to dress
 * the flat screens in the world's light, and the way it does that is by
 * re-declaring `global.css`'s rules in the world's voice. So `global.css` is
 * full of rules that still match elements, still parse, still look alive, and
 * decide nothing at all. `.btn-primary` on the door is the clean example: nine
 * declarations, every one of them re-set by two chrome-layer rules over the
 * top.
 *
 * Specificity, order, layers, shorthand expansion and `!important` all decide
 * this together, and the only thing that implements all five correctly is a
 * browser. So this asks one, through the same DevTools protocol the Styles
 * pane uses — `CSS.getMatchedStylesForNode` returns every rule that matched a
 * node, in cascade order, weakest first.
 *
 * ── WHAT IT REPORTS ────────────────────────────────────────────────────────
 *
 *   OVERRULED the rule matched, and every declaration it makes was beaten by
 *             a later one on every element it matched
 *   live      it decided at least one property on at least one element
 *   UNUSED    the selector matched no element on any surface walked
 *
 * The first two come from the protocol, which only ever hands back rules that
 * MATCHED — so a rule matching nothing can never appear in that half of the
 * report, however dead it is. The third is a second pass that closes exactly
 * that gap: every selector in the five sheets is read out of the files and put
 * to `querySelectorAll` on each surface. State pseudo-classes are trimmed off
 * first (`:hover`, `:disabled`, `::placeholder`), because a selector is being
 * asked whether the ELEMENT it names is ever on screen, not whether the walk
 * happened to hover it.
 *
 * ── WHAT IT IS NOT ─────────────────────────────────────────────────────────
 *
 * IT IS EVIDENCE, NOT A DELETION LIST, and the difference matters. It can only
 * speak about the surfaces it walked and the states it put them in. A rule for
 * an error that never occurred, a hover it never performed, or a screen it
 * never opened will be reported UNUSED while being perfectly alive. Every
 * surface it walks is printed with its element count so the coverage is
 * legible, and `--json` writes the whole finding out so a claim about it can
 * be checked rather than remembered.
 *
 *     pnpm e2e:dead-css               # walk and report
 *     pnpm e2e:dead-css --json out.json
 *     pnpm e2e:dead-css --file global.css   # only rules from one sheet
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { type BrowserContext, type CDPSession, type Page } from "playwright";
import { launchChromium } from "./browser";
import { openTheNotepad, saveAnInspiration } from "./keep";
import { openAMemory } from "./open-a-memory";
const HERE = dirname(fileURLToPath(import.meta.url));
const STYLES = resolve(HERE, "../../packages/web/src/styles");
/**
 * The sheets a rule can be attributed back to, in load order.
 *
 * `claims.css` AND `chat.css` JOINED ON 2026-10-12, and the omission was not
 * an attribution gap — it was a COVERAGE gap, because this list is also what
 * builds `ask.list`, the second pass that puts every selector to
 * `querySelectorAll` on every surface. Any sheet missing from here is not
 * asked about at all: its rules can appear in the matched half of the report
 * (the protocol hands back whatever matched, whatever file it came from) and
 * can NEVER appear in the UNUSED half, however dead they are. So the two
 * largest sheets in the tree — 5.6k lines of `claims.css` and 1k of
 * `chat.css`, holding the corners, the settings panel, all three overlays,
 * the note page, the composer, the speech bubble and the whole chat console —
 * were the only live sheets whose dead rules this walk structurally could not
 * see. It reported 94 unreachable selectors and none of them could have been
 * from either.
 *
 * It is the same omission, with the same cause and the same cost, that
 * `type-scale.test.ts` and `one-class-one-thing.test.ts` both fixed on
 * 2026-10-10 by adding these two files to their own hand-written lists. A
 * gate with a hand-written list of what it watches only watches the past —
 * `one-class-one-thing.test.ts`'s words — and this was the third copy of that
 * list and the last one still describing 2026-08.
 *
 * `mobile-fonts.css` is deliberately absent: ten lines, one `@font-face`
 * group, no selectors to ask about.
 */
const SOURCES = [
  "layers.css",
  "global.css",
  "system.css",
  "chrome.css",
  "home.css",
  "claims.css",
  "chat.css",
] as const;
interface Seen {
  /** `selectorList.text`, as the browser normalised it. */
  selector: string;
  layer: string;
  /** How many elements this rule matched across every surface. */
  matched: number;
  /** Properties it declared that won on at least one element. */
  won: Set<string>;
  /** Properties it declared that lost everywhere. */
  declared: Set<string>;
  surfaces: Set<string>;
  /** The selectors of the rules that beat this one, for the evidence line. */
  beatenBy: Set<string>;
}

/**
 * WHICH FILE A RULE CAME FROM, given its selector AND what it declares.
 *
 * The dev server serves a BUILT bundle — all five sheets concatenated into one
 * stylesheet with one id — so the protocol's own `sourceURL` cannot separate
 * them and there is no source map for CSS at this layer. What survives the
 * build unchanged is the selector and the property names, so each rule is
 * looked up in the five files by both.
 *
 * THE SELECTOR ALONE IS NOT ENOUGH, and that is the whole reason this reads
 * declarations too. `chrome.css` exists to re-declare `global.css`'s rules in
 * the world's voice, so the SAME SELECTOR appears in both files constantly —
 * and the first version of this attributed every one of them to
 * "global.css+chrome.css", which is precisely the pair a reader needs told
 * apart before deleting anything. Fourteen findings were unusable for that
 * reason. Matching the declared property set as well separates them, because
 * the whole point of the overriding copy is that it declares a different set.
 */
function ruleIndex(text: string): Map<string, Set<string>[]> {
  /* selector-with-whitespace-flattened -> the property-name sets it declares */
  const index = new Map<string, Set<string>[]>();
  const bodies = text.replace(/\/\*[\s\S]*?\*\//g, " ");
  for (const match of bodies.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (match[1] ?? "").split("}").pop() ?? "";
    const flat = selector.replace(/\s+/g, "").replace(/'/g, '"');
    if (flat === "" || flat.startsWith("@")) continue;
    const props = new Set<string>();
    for (const decl of (match[2] ?? "").split(";")) {
      const name = decl.split(":")[0]?.trim();
      if (name) props.add(name);
    }
    const list = index.get(flat) ?? [];
    list.push(props);
    index.set(flat, list);
  }
  return index;
}

function attribute(
  selector: string,
  declared: Set<string>,
  indexes: Map<string, Map<string, Set<string>[]>>,
): string {
  const flat = selector.replace(/\s+/g, "").replace(/'/g, '"');
  const exact: string[] = [];
  const loose: string[] = [];
  for (const name of SOURCES) {
    const index = indexes.get(name);
    const found = index?.get(flat);
    if (!found) continue;
    loose.push(name);
    /* the same selector in two sheets is told apart by what it decides:
       a shorthand expands, so a source `font` covers a rendered `font-size`
       and a subset match is the honest test rather than an equal one */
    const hit = found.some((props) =>
      [...declared].every((want) => props.has(want) || [...props].some((have) => want.startsWith(`${have}-`))),
    );
    if (hit) exact.push(name);
  }
  if (exact.length > 0) return exact.join("+");
  return loose.length === 0 ? "?" : `${loose.join("+")}?`;
}

/**
 * EVERY WORD THE MARKUP COULD PUT ON AN ELEMENT — every `.ts`/`.tsx` under
 * `packages/web/src`, read as text.
 *
 * WHY THIS EXISTS, AND WHAT IT SETTLES. A selector that matched nothing on the
 * surfaces walked is ambiguous by construction: `.jar-board-acts` matched
 * nothing here because the walk never opened headquarters, and `e2e:journeys`
 * proves it is very much alive. So "unused" on its own is not a deletion
 * signal and this file's header says so.
 *
 * A class name that appears in NO SOURCE FILE AT ALL is a different claim
 * entirely, and it does not depend on which states a walk happened to enter:
 * nothing can ever put that word on an element. The two together separate the
 * unvisited from the unreachable, which is the separation A4's "nothing in
 * the tree is unreferenced" actually needs.
 *
 * It is read as text rather than parsed, because a class reaches the DOM
 * through `className`, `class`, a template literal, a `clsx` call, a lookup
 * table, or a string built two functions away — and every one of those still
 * contains the word.
 */
function wordsInSource(root: string): Set<string> {
  const words = new Set<string>();
  const stack = [root];
  while (stack.length > 0) {
    const here = stack.pop() as string;
    let entries: string[];
    try {
      entries = readdirSync(here);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = `${here}/${entry}`;
      let stats;
      try {
        stats = statSync(full);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        if (entry !== "node_modules" && entry !== "styles") stack.push(full);
        continue;
      }
      if (!/\.(ts|tsx|js|jsx|html)$/.test(entry)) continue;
      /* ONE CHARACTER IS A CLASS NAME TOO. The first version required three,
         and `<div className="bg-blob b1">` therefore taught this walk that
         `b1` was a word nothing spoke — which would have made every selector
         mentioning `.b1` look unreachable. A short name is exactly the kind
         this check must not miss. */
      for (const match of readFileSync(full, "utf8").matchAll(/[A-Za-z][A-Za-z0-9_-]*/g)) {
        words.add(match[0]);
      }
    }
  }
  return words;
}

/**
 * EVERY SELECTOR IN THE SHEETS, ONE PER LINE, READY FOR `querySelectorAll`.
 *
 * A rule's selector list is split on its top-level commas — a list is dead
 * only if EVERY name in it is dead, and reporting the list as a unit would
 * hide a live name inside a mostly-dead one, which is the opposite of useful.
 * Commas inside `:not(…)`, `:is(…)` and attribute values are not top level and
 * are stepped over rather than split on.
 */
function selectorsOf(text: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const bodies = text.replace(/\/\*[\s\S]*?\*\//g, " ");
  for (const match of bodies.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    const list = (match[1] ?? "").split("}").pop() ?? "";
    if (list.trim().startsWith("@")) continue;
    let depth = 0;
    let quote = "";
    let piece = "";
    const pieces: string[] = [];
    for (const ch of list) {
      if (quote) {
        if (ch === quote) quote = "";
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "(" || ch === "[") depth += 1;
      else if (ch === ")" || ch === "]") depth -= 1;
      else if (ch === "," && depth === 0) {
        pieces.push(piece);
        piece = "";
        continue;
      }
      piece += ch;
    }
    pieces.push(piece);
    for (const raw of pieces) {
      const one = raw.trim().replace(/\s+/g, " ");
      if (one === "") continue;
      /* keyframe stops and at-rule fragments are not selectors */
      if (/^(from|to|\d+%)$/.test(one)) continue;
      const set = out.get(one) ?? new Set<string>();
      out.set(one, set);
    }
  }
  return out;
}

/**
 * A SELECTOR THAT `querySelectorAll` WILL ACCEPT, asking about the element
 * rather than about the moment. State and part pseudo-classes are trimmed:
 * `.a:hover` becomes `.a`, `.a::placeholder` becomes `.a`. Structural ones
 * (`:not`, `:is`, `:where`, `:nth-child`, attribute selectors) are left alone
 * because they are about the element and the engine handles them.
 */
const STATEFUL =
  /::[a-z-]+(\([^)]*\))?|:(hover|focus|focus-visible|focus-within|active|visited|target|disabled|enabled|checked|indeterminate|placeholder-shown|autofill|user-invalid|invalid|valid|required|optional|read-only|read-write|default|in-range|out-of-range|first-line|first-letter|backdrop|selection|marker)\b/g;

/** Every element node in the document, pierced through shadow roots. */
function elementIds(node: { nodeId: number; nodeType: number; children?: unknown[] }): number[] {
  const out: number[] = [];
  const stack = [node];
  while (stack.length > 0) {
    const n = stack.pop() as {
      nodeId: number;
      nodeType: number;
      children?: unknown[];
      shadowRoots?: unknown[];
      contentDocument?: unknown;
    };
    if (!n) continue;
    if (n.nodeType === 1) out.push(n.nodeId);
    for (const kid of (n.children ?? []) as typeof stack) stack.push(kid);
    for (const root of (n.shadowRoots ?? []) as typeof stack) stack.push(root);
  }
  return out;
}

interface Matched {
  rule: {
    styleSheetId?: string;
    selectorList: { text: string };
    origin: string;
    layers?: Array<{ text: string }>;
    media?: Array<{ text: string }>;
    style: { cssProperties: Array<{ name: string; important?: boolean; range?: unknown }> };
  };
}

/**
 * READ ONE ELEMENT AND CREDIT EACH PROPERTY TO THE RULE THAT WON IT.
 *
 * `matchedCSSRules` arrives WEAKEST FIRST with layers and specificity already
 * resolved, so a later entry beats an earlier one — except for `!important`,
 * which the protocol does not reorder and which is applied here on top. Only
 * declarations carrying a `range` are counted: the ones without are the
 * longhands a shorthand expanded into, and crediting those as well would let
 * a rule that only writes `font` claim it decided `font-size` too.
 */
async function readNode(
  cdp: CDPSession,
  nodeId: number,
  surface: string,
  seen: Map<string, Seen>,
): Promise<void> {
  let matched: Matched[];
  try {
    const res = (await cdp.send("CSS.getMatchedStylesForNode", { nodeId })) as {
      matchedCSSRules?: Matched[];
    };
    matched = res.matchedCSSRules ?? [];
  } catch {
    /* the node went away between the walk and the question */
    return;
  }

  const winner = new Map<string, string>();
  const importantWinner = new Set<string>();
  const keys: string[] = [];

  for (const entry of matched) {
    const rule = entry.rule;
    /* the browser's own default sheet is not this repo's to delete */
    if (!rule.styleSheetId || rule.origin !== "regular") {
      keys.push("");
      continue;
    }
    /* WHAT IDENTIFIES A RULE, GIVEN THAT `rule.range` IS NOT AVAILABLE HERE.
       The protocol only fills a rule's source range in when it has the
       stylesheet's text with positions, and for the built bundle this dev
       server serves it does not — every rule came back with
       `range: undefined`, so the first version of this keyed on
       `sheet:line:column`, produced the string "undefined" for every rule,
       skipped them all, and reported a confident 0 overruled and 0 live.
       Exactly the failure mode this file's header describes, in a new place.

       So identity is composed from what IS there: the layer, any media
       condition, the selector, and the set of properties declared. Two
       genuinely different rules agreeing on all four would be indexed as one
       — and two rules in one layer, under one condition, with one selector
       and one property set is a duplicate declaration, which is an A4 finding
       rather than a measurement error.

       AND NOT THE STYLESHEET ID, WHICH IS THE BUG THIS CAUGHT. Every
       navigation re-attaches the bundle under a NEW id, so keying on it
       recorded one rule as up to seven, one per surface. That is not merely
       untidy: a rule that wins on the door and loses on the account page
       would be split into a live row and an OVERRULED row, and the OVERRULED
       one reads as a deletion candidate for a rule that is doing its job.
       Found by noticing `.field-label` listed twice with identical
       everything. */
    const layerText = (rule.layers ?? []).map((l) => l.text).join(">");
    const mediaText = (rule.media ?? []).map((m) => m.text).join(",");
    const declared = rule.style.cssProperties
      .filter((prop) => prop.range)
      .map((prop) => prop.name)
      .sort()
      .join(",");
    const key = `${layerText}|${mediaText}|${rule.selectorList.text}|${declared}`;
    keys.push(key);
    let record = seen.get(key);
    if (!record) {
      record = {
        selector: rule.selectorList.text,
        layer: layerText || "(none)",
        matched: 0,
        won: new Set(),
        declared: new Set(),
        surfaces: new Set(),
        beatenBy: new Set(),
      };
      seen.set(key, record);
    }
    record.matched += 1;
    record.surfaces.add(surface);
    for (const prop of rule.style.cssProperties) {
      if (!prop.range) continue;
      record.declared.add(prop.name);
      if (prop.important) {
        winner.set(prop.name, key);
        importantWinner.add(prop.name);
      } else if (!importantWinner.has(prop.name)) {
        winner.set(prop.name, key);
      }
    }
  }

  for (const [name, key] of winner) {
    const record = seen.get(key);
    if (record) record.won.add(name);
  }

  /* AND WHO BEAT WHOM. A claim that a rule is dead is only checkable if it
     names the rule that took each property off it, so every loser records the
     winner's selector. This is what turns the report from an assertion into
     something a reader can go and look at. */
  for (const entry of matched) {
    const rule = entry.rule;
    if (!rule.styleSheetId || rule.origin !== "regular") continue;
    const layerText = (rule.layers ?? []).map((l) => l.text).join(">");
    const mediaText = (rule.media ?? []).map((m) => m.text).join(",");
    const props = rule.style.cssProperties.filter((prop) => prop.range).map((prop) => prop.name);
    const key = `${layerText}|${mediaText}|${rule.selectorList.text}|${[...props].sort().join(",")}`;
    const record = seen.get(key);
    if (!record) continue;
    for (const name of props) {
      const holder = winner.get(name);
      if (!holder || holder === key) continue;
      const champion = seen.get(holder);
      if (champion) record.beatenBy.add(champion.selector.replace(/\s+/g, " ").slice(0, 40));
    }
  }
}

/**
 * ASK THE PAGE WHICH OF THESE NAMES ANYTHING ON IT ANSWERS TO.
 *
 * One round trip for the whole list rather than one per selector: at roughly
 * two thousand selectors across five sheets that is the difference between a
 * second and several minutes. A selector the engine rejects outright is
 * counted as matched, not as dead — this walk is not a syntax checker and
 * calling a selector it could not parse "unused" would be a lie in the one
 * direction that costs something.
 */
async function askForSelectors(page: Page, list: string[], alive: Set<string>): Promise<void> {
  const hits = (await page.evaluate((selectors: string[]) => {
    const found: string[] = [];
    for (const selector of selectors) {
      try {
        if (document.querySelector(selector)) found.push(selector);
      } catch {
        found.push(selector);
      }
    }
    return found;
  }, list)) as string[];
  for (const hit of hits) alive.add(hit);
}

async function walkSurface(
  cdp: CDPSession,
  page: Page,
  surface: string,
  seen: Map<string, Seen>,
  ask: { list: string[]; alive: Set<string> } | null = null,
): Promise<number> {
  const doc = (await cdp.send("DOM.getDocument", { depth: -1, pierce: true })) as {
    root: { nodeId: number; nodeType: number; children?: unknown[] };
  };
  const ids = elementIds(doc.root);
  for (const id of ids) await readNode(cdp, id, surface, seen);
  if (ask) await askForSelectors(page, ask.list, ask.alive);
  console.log(`  ${surface.padEnd(22)} ${String(ids.length).padStart(5)} elements`);
  return ids.length;
}

const PASSWORD = "dead-css-password-1";

/** Open a keepsake from a freshly loaded world. Says whether it managed to.
 *
 *  ═══ IT PRESSED `.jar-saved` AND THEN SWEPT THE CANVAS, AND NEITHER WORKS
 *  `.jar-saved` was the descent into the ground and has no renderer; the
 *  sweep is the grid `journeys.ts` removed for being unable to aim. Together
 *  they meant this returned false every time — and `openCardAgain`'s callers
 *  treat false as "the card would not open", so whole families of card rules
 *  were about to be reported as dead CSS on the strength of a walk that
 *  never reached the card. A dead-code walk that cannot enter a state is the
 *  one tool where a false negative gets something DELETED.
 *  `./open-a-memory` is the door now and is shared with five other gates. */
async function openCardAgain(page: Page): Promise<boolean> {
  return openAMemory(page);
}

async function surfaces(
  ctx: BrowserContext,
  page: Page,
  cdp: CDPSession,
  base: string,
  seen: Map<string, Seen>,
  ask: { list: string[]; alive: Set<string> },
): Promise<void> {
  /* THE DOOR, BOTH FACES. The sign-up tab paints controls the sign-in tab
     does not, and the second of them is where half of `global.css`'s login
     rules live. */
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2_500);
  await walkSurface(cdp, page, "the door (sign in)", seen, ask);
  await page.click("#login-tab-signup");
  await page.waitForTimeout(1_200);
  await walkSurface(cdp, page, "the door (sign up)", seen, ask);

  const email = `deadcss-${Date.now()}@example.test`;
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", PASSWORD);
  await page.fill("input[name=name]", "Dead CSS");
  await page.click("button[type=submit]");
  await page.waitForTimeout(8_000);

  /* the world needs something in it before it paints the count, the field,
     the card or any modal */
  for (const text of [
    "a stylesheet that decides nothing is not a stylesheet",
    "the browser is the only thing that implements the cascade",
    "a rule can match and still lose every property it sets",
  ]) {
    await saveAnInspiration(page, text);
    await page.waitForTimeout(4_500);
  }
  await walkSurface(cdp, page, "the world", seen, ask);

  await openTheNotepad(page);
  await page.waitForTimeout(1_000);
  await walkSurface(cdp, page, "the mouth open", seen, ask);

  /* a memory open — the card and its footer */
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6_000);
  /* same dead descent and same dead sweep as `openCardAgain` above, and the
     same consequence: this surface walked zero elements and every card rule
     it exists to prove alive was unaccounted for */
  const opened = await openAMemory(page);
  if (opened) {
    await page.waitForTimeout(1_200);
    await walkSurface(cdp, page, "a memory open", seen, ask);

    /* THE STATES A WALK HAS TO ENTER BEFORE IT MAY CALL ANYTHING DEAD.
       The first version of this stopped at the open card and reported 218
       `home.css` selectors as unused — among them `.jar-board-acts`, which
       `e2e:journeys` proves is alive and which is only reachable by reaching
       for headquarters. An unentered state and a dead rule look identical
       from here, so the answer is to enter more states rather than to trust
       the number. Each of these is one modal or one reveal. */
    for (const [what, open] of [
      ["saying it in your own words", async () => {
        await page.locator(".jar-panel-text").first().click({ timeout: 6_000 });
      }],
      /* ═══ `answering a memory` IS NOT IN THIS LIST ANY MORE (2026-10-15)
         It pressed a `reflect` verb in `.jar-panel-foot`. There is no such
         verb: the foot holds the attach-a-photo label, one stepper caret and
         `Delete` — read off an open card in a browser on 2026-10-15 — and
         the surface it would have opened is now a READ. `Home.tsx` names the
         callback `openReflections` and documents it as "Open the answers
         already on this save. A read, with nothing to write."

         CORRECTION (2026-10-15): this went on to say "nothing in
         `packages/web/src` posts a reflection" and that "with no write path
         left, a fresh account made by this walk can never have an answer to
         read". BOTH ARE FALSE. Reflections are still written — just not
         through a dedicated endpoint. `Home.tsx:5262` builds
         `reflections: [{ question, answer }]` and sends it WITH THE CAPTURE;
         `lib/api/inspirations.ts` carries the field and
         `lib/use-authored-save.ts` says so in as many words. The door is the
         `.waka-moment-why` textarea, rendered whenever the composer holds an
         image.

         SO THE READ STATE IS REACHABLE: attach an image, fill the why, save,
         then press `Read reflection`. That is a cheaper route than the
         "seed a reflection through the API" this tombstone used to
         prescribe. (`when-it-fails` makes the narrower and accurate claim —
         nothing posts to `POST /api/inspirations/:id/reflections`.)

         WHAT COVERAGE WENT: the rules for the answering flow —
         `.jar-reflection-flow`, `.jar-reflection-turn`, `.jar-reflect-q` and
         anything under them — are not walked, so they will appear in this
         run's "never put on screen" list. That list is explicitly NOT a
         deletion list, and this paragraph is why these particular selectors
         are on it. WHAT WOULD RESTORE IT: seed a reflection through the API
         for the walk's own account, then press `Read reflection`. */
      ["letting a memory go", async () => {
        await page.locator(".jar-panel-foot button", { hasText: /delete/i }).first().click({ timeout: 6_000 });
      }],
    ] as Array<[string, () => Promise<void>]>) {
      /* EACH ONE STARTS FROM A CARD THIS LOOP OPENED ITSELF. The first version
         pressed Escape and carried on, which worked for the first state and
         then quietly stopped: the edit state leaves the card gone, and both
         `answering a memory` and `letting a memory go` reported "it did not
         open" for a card that was simply not there any more. A walk that says
         NOT WALKED is honest; a walk that says it for the wrong reason wastes
         the state it was written to enter. */
      await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(6_000);
      if (!(await openCardAgain(page))) {
        console.log(`  ${what.padEnd(22)} NOT WALKED — no card to open it from`);
        continue;
      }
      try {
        await open();
        await page.waitForTimeout(1_500);
        await walkSurface(cdp, page, what, seen, ask);
      } catch {
        console.log(`  ${what.padEnd(22)} NOT WALKED — it did not open`);
      }
    }
  } else {
    console.log("  a memory open         NOT WALKED — no card opened");
  }

  /* ═══ AND THE THINGS THE WORLD ITSELF OPENS ════════════════════════
     `["your settings", ".jar-account"]` WAS HERE AND COULD NEVER OPEN.
     `.jar-account` has no renderer in `src` — it was the world's own way to
     the settings PAGE, and settings is a panel on the corner now, walked
     below under the name `settings`. So the step printed
     `your settings NOT WALKED — it did not open` on every run AND duplicated
     a surface name that was already covered (M7,
     `docs/reviews/cleanliness-2026-10-11.md`).

     `the timeline` IS A DIFFERENT CASE, and the analysis below was wrong.
     CORRECTED 2026-10-15. `.jar-when` IS live, but its render condition is
     no longer what this said. It read

         dial && phase === "ready" && !dialAway
           && (atWall.kind === "group" || parkedAt !== null)

     citing `Home.tsx:16881`, a line number about 7000 lines stale. The group
     half went with rooms; the condition at `Home.tsx:9833` is now
     `parkedAt !== null` ALONE.

     AND THE PRESCRIBED WORKAROUND CANNOT BE TAKEN. It said to wind the dial
     away from now first, by pressing a stop that is not `now`, which sets
     `parkedAt`. But `.jar-dial-stop` is mounted only inside
     `{dial && phase === "ready" && timeOpen ? ...}` (`Home.tsx:9921`), and
     every `setTimeOpen(true)` lives inside the `.jar-when` button that
     requires `parkedAt !== null`. The door only opens from inside.

     SO THIS STEP PRINTS `NOT WALKED — the dial has 0 stop(s)` on every run
     and the walk loses the dial's whole selector family. That is not a
     harness defect to repoint; it is product finding #1 in this change, and
     `the-timeline.ts` reached the same diagnosis independently. This note is
     left pointing at the product rather than inventing a route. */
  /* FROM A FRESH LOAD, same reason as every other re-entry in this walk:
     the card states above leave modals standing, and a dial stop under an
     invisible leftover is found-but-not-actionable. */
  await page.keyboard.press("Escape");
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6_000);
  try {
    const stops = page.locator(".jar-dial-stop");
    const howMany = await stops.count();
    if (howMany < 2) {
      console.log(`  the timeline          NOT WALKED — the dial has ${howMany} stop(s); winding needs two`);
    } else {
      await stops.nth(1).click({ timeout: 6_000 });
      await page.waitForTimeout(1_500);
      await walkSurface(cdp, page, "wound back", seen, ask);
      await page.locator(".jar-when").first().click({ timeout: 6_000 });
      await page.waitForTimeout(1_500);
      await walkSurface(cdp, page, "the timeline", seen, ask);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(800);
    }
  } catch (err) {
    console.log(
      `  the timeline          NOT WALKED — ${err instanceof Error ? err.message.split("\n")[0] : err}`,
    );
  }
  /* FROM A FRESH LOAD, because the chain below is three clicks deep and the
     surfaces before it leave things standing. Reported as
     `locator.click: Timeout 6000ms exceeded` on a button that was plainly on
     screen — the element was found and never actionable, which is what an
     invisible leftover lying over it looks like. Pressing Escape after each
     modal was not enough; loading the world again is. Same lesson as the
     camera that carried across a resize: state a walk did not put there is
     state a walk cannot reason about. */
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6_000);

  /* ═══ FOUR STEPS ARE GONE, AND THEY WERE LEFTOVERS RATHER THAN DEFECTS ══
     `the walls list`, `make another place`, `making a room` and `a room, just
     made` all timed out on every run, and the cleanliness review counted the
     cost: with four surfaces NOT WALKED, "~94 selectors are reported
     unreachable with no way to tell leftovers from unentered states", which
     is this walk's most valuable property degraded for about a quarter of
     `home.css` (M8, `docs/reviews/cleanliness-2026-10-11.md`).

     THE REVIEW ASKED WHETHER THE WALLS LIST STILL EXISTS. It does not, and
     neither does anything the other three pressed. Checked against the tree
     rather than assumed, and all four controls have NO renderer anywhere in
     `src`:

         .jar-here-more        the `▾` beside the wall's name
         .jar-here-row--make   "make another place" in the list it opened
         .jar-newplace-row     choosing "a room" in the dialog that followed
         .jar-roomform-box     still EXISTS, and is now a different control —
                               `Home.tsx:17059` renders it as the field that
                               NAMES AN AGENT. So this step was not merely
                               timing out: had it succeeded it would have
                               walked the wrong surface and called it a room.

     AND THE DELETION OF THE CONTROLS WAS DELIBERATE. `Home.tsx:18110` carries
     the ruling in full — founder: "get rid of the rooms and agent related
     stuff for now" — and records that the make/join sheet "was unreachable"
     and "had survived three cleanliness passes because it looks alive from
     the inside". Making a room from the world is not a thing the product
     offers; joining by a `?join=<code>` address is what survives.

     WHAT COVERAGE THIS WALK LOSES, SAID OUT LOUD RATHER THAN ABSORBED, which
     is the whole point of the header's warning that an unentered state and a
     dead rule look identical from here. Everything behind a room's wall is
     now beyond this walk: the `.jar-here*` family, the group panel, the
     dial's group branch, and `.jar-when` (below). Those selectors will be
     reported UNUSED and ARE NOT THEREFORE DEAD — they are unreachable because
     the only door to them is gone. Deleting them is a separate piece of work
     from deleting a leftover rule, and it needs a founder ruling on whether
     rooms are coming back, not a walk.

     WHAT WOULD RESTORE THE COVERAGE: a `?join=<code>` address for a room this
     walk made through the API, or a seeded account. Either is a bigger change
     than this file, and both beat four steps that can only ever print a
     timeout. */
  /* HEADQUARTERS, REACHED FOR. Its four acts are revealed by hover and by
     focus-within, and nothing else in this walk hovers anything — which is
     exactly why they read as dead until now.

     THE POINTER IS MOVED RATHER THAN THE ELEMENT HOVERED. `.jar-hq` carries
     `pointer-events: none` so the world underneath stays draggable, and
     Playwright's `hover()` refuses an element that cannot take a pointer —
     which is the same fact that made `:hover` unable to reveal those acts in
     the product until it was fixed. Moving the mouse to the coordinates
     hovers whatever is really there. */
  try {
    const box = await page.locator(".jar-poster, .jar-hq-inner").first().boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(1_400);
      await walkSurface(cdp, page, "headquarters reached for", seen, ask);
    } else {
      console.log("  headquarters reached for  NOT WALKED — nothing to reach for");
    }
  } catch {
    console.log("  headquarters reached for  NOT WALKED");
  }

  await page.goto(`${base}/onboarding`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3_000);
  await walkSurface(cdp, page, "the welcome", seen, ask);

  /* ═══ SETTINGS IS A PANEL IN THE CORNER, NOT A TABBED PAGE ═══════════
     `/profile` is gone — founder: "I want all setting-related stuff to be
     only accessible through the drop down and not be its own thing" — so
     the tab walk that used to open each of its panels in turn has nothing
     to open.

     THE SHAPE OF THE PROBLEM SURVIVES THE PAGE, which is why this is a
     rewrite rather than a deletion. That walk existed because every panel
     but the open one carried `hidden`, so half the page's rules were never
     on screen and read as unused — and the lookup below nearly reported a
     hundred and fifty live selectors as dead because of it. The panel has
     the same property: its three groups are disclosures, and only one is
     open at a time. So each is opened in turn, for the same reason. */
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3_000);
  try {
    /* BY THE MODIFIER, NOT BY `.first()`. The right corner holds two
       buttons since 2026-10-11 — an "i" for how the product works beside
       the cog — and the left corner has worn `.waka-corner` the whole
       time, so `.first()` was already a bet on document order and is now
       a bet that would lose. */
    await page.locator("button.waka-corner--settings").click({ timeout: 8_000 });
    await page.waitForTimeout(600);
    await walkSurface(cdp, page, "settings", seen, ask);
    const groups = await page.locator(".waka-settings-row").count();
    for (let i = 0; i < groups; i += 1) {
      await page.locator(".waka-settings-row").nth(i).click({ timeout: 5_000 });
      await page.waitForTimeout(500);
      await walkSurface(cdp, page, `settings group ${i + 1}`, seen, ask);
      await page.locator(".waka-settings-row").nth(i).click({ timeout: 5_000 });
      await page.waitForTimeout(300);
    }
    /* THE OTHER CARD ON THE SAME CORNER. `.waka-about*` is only ever on
       screen while the "i" is pressed, so without this step every rule in
       that family reads as unused — which is the exact failure the note
       above this walk was written about, one card along. */
    await page.locator("button.waka-corner--info").click({ timeout: 8_000 });
    await page.waitForTimeout(600);
    await walkSurface(cdp, page, "how it works", seen, ask);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  } catch {
    /* The corner is absent on a surface with no session. Walking what is
       there beats failing the whole run over one panel. */
  }

  /* THE PAGE OTHER PEOPLE SEE, which is a whole prefix of its own.
     `PublicProfile.tsx` is the only wearer of the `waka-public-` family, and
     without this surface every one of those selectors reads as unused. The
     class-name cross-check is the only thing standing between that reading
     and a very bad deletion.

     ═══ THE FAMILY IS `waka-public-`, NOT `nc-` (corrected 2026-10-15) ═════
     This comment used to say `nc-`, "roughly a hundred and fifty selectors".
     `PublicProfile.tsx` was rewritten onto the product's own material and
     its header records it: the `nc-` classes were "the language of the FLAT
     SCREENS, the ones deleted a week before this pass", and this page "was
     the last living reference to them in the entire tree". Three orphan
     `nc-` selectors survive in the stylesheets and nothing renders them.
     The page now wears eight `waka-public-*` classes, read off the DOM on
     2026-10-15.

     ═══ AND THE HANDLE IS SET THROUGH THE SESSION, BECAUSE NO CONTROL LEFT
         CAN SET IT ════════════════════════════════════════════════════════
     This opened the settings card, hunted a `.waka-settings-row` matching
     /public/i, filled `.waka-settings-body input`, checked
     `.waka-settings-toggle input[type=checkbox]` and pressed
     `.waka-settings-keep`. The public group was deleted in `f1e96412` on a
     founder ruling — "everything regarding public and private should also
     not be a thing in this new experience" — and that commit names it "the
     single writer of both flags in the entire product". None of those three
     classes has a renderer.

     IT FAILED SOFTLY, WHICH IS THE WORST WAY FOR THIS WALK TO FAIL. The
     whole block sat in a `try`/`catch` that set `published = false`, so the
     run printed `NOT WALKED — the handle could not be set` and carried on —
     and every `waka-public-*` rule was then a candidate for deletion on the
     grounds that no surface wore it.

     `PATCH /api/auth/me/profile` STILL WRITES THE FLAGS, deliberately:
     `f1e96412` kept the column and the merge because "a handle is a name
     somebody chose and may have shared". So the handle is set through the
     page's own session — no machine key, the same call the deleted control
     made — and the surface is walked as a stranger. Verified by hand on
     2026-10-15: the PATCH answers 200 and `/:handle` serves a page.

     WHAT THIS IS NOT: it is not a claim that a person can publish. Nobody
     can. It is a CSS-coverage walk reaching a surface that is still routed
     and still served, so that its rules are not deleted as unused. The
     missing-reading branch of the page renders too, and is also real
     markup. */
  const handle = `deadcss${Date.now().toString(36)}`;
  let published = false;
  try {
    const out = (await page.evaluate(async (h: string) => {
      /* the full payload: the route validates `name` and `preferredLocale`
         alongside the public fields, and a partial body answers 400 */
      const me = await fetch("/api/auth/me", { credentials: "include" });
      if (!me.ok) return me.status;
      const body = (await me.json()) as { profile?: { name?: string; preferredLocale?: string } };
      const r = await fetch("/api/auth/me/profile", {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: body.profile?.name ?? "Dead CSS",
          preferredLocale: body.profile?.preferredLocale ?? "en-US",
          publicHandle: h,
          publicProfileEnabled: true,
          publicTopOfMindEnabled: true,
        }),
      });
      return r.status;
    }, handle)) as number;
    published = out === 200;
    if (!published) console.log(`  what others see       the handle PATCH answered ${out}`);
  } catch {
    published = false;
  }
  if (published) {
    /* AS A STRANGER. The point of this surface is what an anonymous visitor
       is served, and a signed-in read renders a different corner. */
    await ctx.clearCookies();
    await page.goto(`${base}/${handle}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5_000);
    await walkSurface(cdp, page, "what others see", seen, ask);
  } else {
    console.log("  what others see       NOT WALKED — the handle could not be set");
  }
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const jsonAt = argv.indexOf("--json");
  const fileAt = argv.indexOf("--file");
  const onlyFile = fileAt >= 0 ? argv[fileAt + 1] : null;
  const base = process.env.WAKA_BASE_URL ?? "http://127.0.0.1:3010";

  const indexes = new Map<string, Map<string, Set<string>[]>>();
  /* stripped selector -> the sheets that write it, and how they write it */
  const declaredIn = new Map<string, Map<string, Set<string>>>();
  for (const name of SOURCES) {
    let text: string;
    try {
      text = readFileSync(resolve(STYLES, name), "utf8");
    } catch {
      /* a sheet that has been deleted is simply not a source any more */
      continue;
    }
    indexes.set(name, ruleIndex(text));
    for (const selector of selectorsOf(text).keys()) {
      const asked = selector.replace(STATEFUL, "").trim();
      if (asked === "" || asked === "*" || asked === "html" || asked === "body" || asked === ":root") continue;
      const wearers = declaredIn.get(asked) ?? new Map<string, Set<string>>();
      const written = wearers.get(name) ?? new Set<string>();
      written.add(selector);
      wearers.set(name, written);
      declaredIn.set(asked, wearers);
    }
  }
  const ask = { list: [...declaredIn.keys()], alive: new Set<string>() };
  const spoken = wordsInSource(resolve(STYLES, ".."));

  console.log("[dead-css] which rules still decide anything, asked of the browser");
  console.log("[dead-css] layers make this unanswerable by reading the files\n");

  const browser = await launchChromium();
  const seen = new Map<string, Seen>();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    console.log("[dead-css] surfaces walked:");
    await surfaces(ctx, page, cdp, base, seen, ask);
  } finally {
    await browser.close();
  }

  interface Row {
    verdict: "UNUSED" | "OVERRULED" | "live";
    file: string;
    layer: string;
    selector: string;
    matched: number;
    declared: number;
    won: number;
    surfaces: string[];
    beatenBy: string[];
  }
  const rows: Row[] = [];
  for (const record of seen.values()) {
    const file = attribute(record.selector, record.declared, indexes);
    if (onlyFile && !file.split("+").includes(onlyFile)) continue;
    rows.push({
      verdict: record.matched === 0 ? "UNUSED" : record.won.size === 0 ? "OVERRULED" : "live",
      file,
      layer: record.layer,
      selector: record.selector.replace(/\s+/g, " ").slice(0, 74),
      matched: record.matched,
      declared: record.declared.size,
      won: record.won.size,
      surfaces: [...record.surfaces],
      beatenBy: [...record.beatenBy],
    });
  }

  const dead = rows.filter((r) => r.verdict === "OVERRULED");
  const live = rows.filter((r) => r.verdict === "live");

  const byFile = new Map<string, { dead: number; live: number }>();
  for (const r of rows) {
    const tally = byFile.get(r.file) ?? { dead: 0, live: 0 };
    if (r.verdict === "OVERRULED") tally.dead += 1;
    else tally.live += 1;
    byFile.set(r.file, tally);
  }

  console.log("\n[dead-css] every declaration beaten, on every element it matched:\n");
  for (const r of dead.sort((a, b) => b.declared - a.declared)) {
    console.log(
      `  ${r.file.padEnd(12)} ${r.layer.padEnd(8)} ${String(r.declared).padStart(2)} decl  ${r.selector}`,
    );
    if (r.beatenBy.length > 0) {
      console.log(`  ${" ".repeat(12)} ${" ".repeat(8)}          beaten by ${r.beatenBy.slice(0, 3).join(" / ")}`);
    }
  }

  console.log("\n[dead-css] by sheet, over the surfaces above:");
  for (const [file, tally] of [...byFile].sort((a, b) => b[1].dead - a[1].dead)) {
    const total = tally.dead + tally.live;
    const share = total === 0 ? 0 : Math.round((tally.dead / total) * 100);
    console.log(`  ${file.padEnd(14)} ${String(tally.dead).padStart(4)} overruled of ${String(total).padStart(4)} matched  (${share}%)`);
  }
  /* ── and the half the protocol cannot report ───────────────────────────
     `getMatchedStylesForNode` only ever hands back rules that MATCHED, so a
     rule matching nothing is invisible to everything above. These are the
     names nothing on any surface answered to. */
  const unused = new Map<string, string[]>();
  for (const [asked, wearers] of declaredIn) {
    if (ask.alive.has(asked)) continue;
    for (const [file, written] of wearers) {
      if (onlyFile && file !== onlyFile) continue;
      const list = unused.get(file) ?? [];
      for (const one of written) list.push(one);
      unused.set(file, list);
    }
  }
  /* UNVISITED OR UNREACHABLE. A selector whose class names all appear
     somewhere in the sources is one this walk simply did not put on screen; a
     selector carrying a class no source file contains cannot be reached by
     anything. Only the second is a deletion signal. */
  const unreachable = new Map<string, string[]>();
  const unvisited = new Map<string, number>();
  for (const [file, list] of unused) {
    for (const one of list) {
      const classes = [...one.matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g)].map((m) => m[1] as string);
      /* A CLASS BUILT OUT OF PIECES IS STILL SPOKEN. A component that writes
         `` `card--${size}` `` puts `card--large` on an element while the
         string `card--large` appears nowhere, so a prefix has to count.

         BUT THE PREFIX MUST END IN A HYPHEN, and that is not a detail. The
         first version accepted any source word of five characters or more as
         a prefix, and the word `surface` — which appears in prose, in comments
         and in identifiers all over this repo — therefore vouched for
         `.surface-shell`, a class belonging to a screen that had been deleted.
         A guard that leaky protects everything and proves nothing. A LITERAL
         ending in a hyphen is what a constructed class name actually looks
         like in the source (`` `nc-note--text-` `` before its interpolation),
         and nothing else is. */
      const speakable =
        classes.length > 0 &&
        classes.every(
          (name) =>
            spoken.has(name) ||
            [...spoken].some(
              (word) => word.length >= 5 && word.endsWith("-") && name.startsWith(word) && name !== word,
            ),
        );
      if (classes.length === 0 || speakable) {
        unvisited.set(file, (unvisited.get(file) ?? 0) + 1);
        continue;
      }
      const rows2 = unreachable.get(file) ?? [];
      rows2.push(one);
      unreachable.set(file, rows2);
    }
  }

  console.log(`\n[dead-css] selectors NO SOURCE FILE can put on an element (${ask.list.length} asked):`);
  for (const [file, list] of [...unreachable].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${file} — ${list.length} unreachable`);
    for (const one of list.slice(0, 30)) console.log(`      ${one.slice(0, 84)}`);
    if (list.length > 30) console.log(`      … and ${list.length - 30} more`);
  }
  console.log("\n[dead-css] and selectors this walk simply never put on screen — NOT a deletion list:");
  for (const [file, count] of [...unvisited].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${file} — ${count} unvisited (their words are all in the sources)`);
  }

  console.log(`\n[dead-css] ${dead.length} overruled, ${live.length} live, over the surfaces listed above.`);
  console.log("[dead-css] EVIDENCE, NOT A DELETION LIST — a rule for a state never entered reads the same as a dead one.");

  if (jsonAt >= 0) {
    const out = argv[jsonAt + 1] ?? "dead-css.json";
    writeFileSync(
      out,
      JSON.stringify(
        {
          rows,
          unreachable: Object.fromEntries(unreachable),
          unvisited: Object.fromEntries(unvisited),
          surfacesWalked: [...new Set(rows.flatMap((r) => r.surfaces))],
        },
        null,
        2,
      ),
    );
    console.log(`[dead-css] wrote ${out}`);
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(`[dead-css] harness error: ${err instanceof Error ? err.message : err}`);
    process.exit(2);
  });
