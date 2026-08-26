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
 *   UNUSED    the rule matched no element on any surface walked
 *   OVERRULED the rule matched, and every declaration it makes was beaten by
 *             a later one on every element it matched
 *   live      it decided at least one property on at least one element
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
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type BrowserContext, type CDPSession, type Page } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const STYLES = resolve(HERE, "../../packages/web/src/styles");
/** The sheets a rule can be attributed back to, in load order. */
const SOURCES = ["layers.css", "global.css", "system.css", "chrome.css", "home.css"] as const;

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

async function walkSurface(
  cdp: CDPSession,
  page: Page,
  surface: string,
  seen: Map<string, Seen>,
): Promise<number> {
  const doc = (await cdp.send("DOM.getDocument", { depth: -1, pierce: true })) as {
    root: { nodeId: number; nodeType: number; children?: unknown[] };
  };
  const ids = elementIds(doc.root);
  for (const id of ids) await readNode(cdp, id, surface, seen);
  console.log(`  ${surface.padEnd(22)} ${String(ids.length).padStart(5)} elements`);
  return ids.length;
}

const PASSWORD = "dead-css-password-1";

async function surfaces(ctx: BrowserContext, page: Page, cdp: CDPSession, base: string, seen: Map<string, Seen>): Promise<void> {
  /* THE DOOR, BOTH FACES. The sign-up tab paints controls the sign-in tab
     does not, and the second of them is where half of `global.css`'s login
     rules live. */
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2_500);
  await walkSurface(cdp, page, "the door (sign in)", seen);
  await page.click("#login-tab-signup");
  await page.waitForTimeout(1_200);
  await walkSurface(cdp, page, "the door (sign up)", seen);

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
    await page.locator(".jar-mouth-rest").first().click();
    await page.waitForTimeout(700);
    await page.fill('textarea[aria-label="capture inspiration"]', text);
    await page.locator(".jar-mouth-where button", { hasText: /^save$/ }).first().click();
    await page.waitForTimeout(4_500);
  }
  await walkSurface(cdp, page, "the world", seen);

  await page.locator(".jar-mouth-rest").first().click();
  await page.waitForTimeout(1_000);
  await walkSurface(cdp, page, "the mouth open", seen);

  /* a memory open — the card and its footer */
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6_000);
  let opened = false;
  try {
    await page.locator(".jar-saved").first().click({ timeout: 20_000 });
    await page.waitForTimeout(4_000);
    outer: for (const y of [390, 350, 430, 310, 470, 270, 510]) {
      for (let x = 160; x <= 940; x += 28) {
        await page.mouse.click(x, y);
        await page.waitForTimeout(450);
        if ((await page.evaluate(() => document.querySelectorAll(".jar-panel").length)) > 0) {
          opened = true;
          break outer;
        }
      }
    }
  } catch {
    opened = false;
  }
  if (opened) {
    await page.waitForTimeout(1_200);
    await walkSurface(cdp, page, "a memory open", seen);
  } else {
    console.log("  a memory open         NOT WALKED — no card opened");
  }

  for (const [path, name] of [
    ["/profile", "your account"],
    ["/onboarding", "the welcome"],
  ] as const) {
    await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3_000);
    await walkSurface(cdp, page, name, seen);
  }
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const jsonAt = argv.indexOf("--json");
  const fileAt = argv.indexOf("--file");
  const onlyFile = fileAt >= 0 ? argv[fileAt + 1] : null;
  const base = process.env.WAKA_BASE_URL ?? "http://127.0.0.1:3010";

  const indexes = new Map<string, Map<string, Set<string>[]>>();
  for (const name of SOURCES) {
    try {
      indexes.set(name, ruleIndex(readFileSync(resolve(STYLES, name), "utf8")));
    } catch {
      /* a sheet that has been deleted is simply not a source any more */
    }
  }

  console.log("[dead-css] which rules still decide anything, asked of the browser");
  console.log("[dead-css] layers make this unanswerable by reading the files\n");

  const browser = await chromium.launch({
    executablePath: process.env.WAKA_CHROMIUM_PATH?.trim() || "/opt/pw-browsers/chromium",
  });
  const seen = new Map<string, Seen>();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    console.log("[dead-css] surfaces walked:");
    await surfaces(ctx, page, cdp, base, seen);
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

  /* A RULE THAT NEVER MATCHED ANYTHING NEVER REACHES THIS PROCESS AT ALL:
     `getMatchedStylesForNode` only ever hands back rules that DID match. So
     "UNUSED" can never be printed from this data, and saying so is more
     honest than leaving a verdict in the enum that will never appear. The
     unmatched half needs the sheet parsed and every selector queried, which
     is a different walk; what this one answers is the harder half. */
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
  console.log(`\n[dead-css] ${dead.length} overruled, ${live.length} live, over the surfaces listed above.`);
  console.log("[dead-css] EVIDENCE, NOT A DELETION LIST — a rule for a state never entered reads the same as a dead one.");

  if (jsonAt >= 0) {
    const out = argv[jsonAt + 1] ?? "dead-css.json";
    writeFileSync(out, JSON.stringify({ rows }, null, 2));
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
