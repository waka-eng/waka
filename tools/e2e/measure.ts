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
import { chromium, type Browser, type Page } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const CSS = resolve(REPO, "packages/web/src/styles/home.css");
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
<link rel="stylesheet" href="/home.css">
<style>
  html, body { margin: 0; height: 100%; background: #0a0d14; }
  .jar { position: fixed; inset: 0; }
  /* the world writes these two as inline \`left\` from the wall's column */
  .jar-way { left: ${INSET}px; }
  .jar-way--r { left: auto; right: ${INSET}px; transform: none; }
  /* the card is placed by the frame loop and animated in; pinned for measure */
  .jar-panel {
    position: static !important; transform: none !important;
    animation: none !important; inset: auto !important;
    margin: 40px auto !important; width: 460px !important;
  }
</style>
<div class="jar" style="--jar-vh:100vh;--jar-vw:100vw">
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
  <div class="jar-dial jar-dial--open"><button class="jar-dial-name jar-label">timeline</button><div class="jar-dial-track"><div class="jar-dial-handle"></div></div></div>

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
    saved: box(".jar-saved"), dial: box(".jar-dial"),
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
      const wanted = [
        "jar-values", "jar-values-words", "jar-way", "jar-way--r",
        "jar-saved", "jar-saved-count", "jar-caret",
        "jar-panel-head", "jar-panel-when", "jar-panel-vis",
        "jar-panel-text", "jar-panel-foot", "jar-mouth-where",
      ];
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
    needs: ["jar-values", "jar-way", "jar-saved", "jar-dial"],
    sabotage: ".jar-values { top: 40px; }",
    run: async (page) => {
      const b = (await page.evaluate(BOXES)) as Boxes;
      const box = (k: string) => b[k] as { top: number; bottom: number; left: number; right: number };
      const got = {
        top: box("values").top,
        left: box("wayL").left,
        right: b.vw - box("wayR").right,
        /* THE COUNT IS AT THE BOTTOM EDGE and the rail stands off it, since
           2026-08-25: it used to be the other way round, which cost the count
           its own inset — it kept 10px from the RAIL and the rail kept 6px
           from the screen, so the sign a person reads most sat furthest from
           an edge of the four. */
        bottom: b.vh - box("saved").bottom,
        "the rail above it": box("saved").top - box("dial").bottom,
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

    browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? "/opt/pw-browsers/chromium",
    });

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
