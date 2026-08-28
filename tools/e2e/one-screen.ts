#!/usr/bin/env tsx
/**
 * THE LANDING PAGE IS ONE SCREEN, MEASURED RATHER THAN INTENDED.
 *
 * Founder ruling, 2026-08-28: "I want landing page to be a single screen, non
 * scrollable." `styles/landing.css` implements it by giving `.lp` the
 * viewport's height and hiding its overflow — and that pairing is exactly why
 * this gate has to exist.
 *
 * A PAGE THAT HIDES ITS OVERFLOW DOES NOT FAIL LOUDLY. It fails by quietly
 * cutting the bottom off itself. There is no scrollbar to reveal the problem,
 * no console error, no failing assertion anywhere in the unit suite — the
 * sentence a person needed, or the button they came to press, is simply not
 * on the screen and cannot be reached by any gesture. Every other gate in
 * this repository is blind to it: jsdom has no layout engine, so
 * `test/landing.test.ts` can hold the page's STRUCTURE and can never once see
 * whether it fits.
 *
 * Found by this walk on the first run, at 320x568 — the smallest phone still
 * in real use: `begin` sat seventeen pixels below the fold. Every unit test
 * passed. The page looked finished in every screenshot anyone had taken,
 * because every screenshot anyone had taken was of a tall window.
 *
 * ── WHAT IT ASSERTS, AT EVERY VIEWPORT ─────────────────────────────────────
 *
 *   1. Nothing is clipped. `.lp` hides its overflow, so the number that
 *      matters is ITS `scrollHeight` against ITS `clientHeight` — not the
 *      document's. A control run proved why: four hundred pixels of extra
 *      height injected into the page left the document's own measurement
 *      completely unmoved, because the clipping box swallowed them. The
 *      document is still asked, one line below, for the failure where the
 *      clipping does not happen at all.
 *   2. Nothing overflows horizontally, which is the same defect turned
 *      sideways and the one `e2e:phone` catches for the world.
 *   3. THE ACTS ARE WHOLLY ON SCREEN. Not merely present in the DOM, which is
 *      what a unit test can see and is worth nothing here: `begin` and the
 *      note beside it must have their bottom edge above the fold. This is the
 *      assertion that caught the real defect, and it is the reason the walk
 *      measures rectangles rather than counting elements.
 *   4. Every act still clears WCAG 2.2 AA's 24x24, because the obvious way to
 *      make a page fit is to shrink things until it does.
 *   5. The headline is on screen too — a page that fits by clipping its own
 *      first sentence has met the letter of the ruling and nothing else.
 *
 * ── THE VIEWPORTS, AND WHY THESE ───────────────────────────────────────────
 *
 * Height is the axis this page can fail on, so the list is chosen to vary it
 * against width rather than to enumerate devices. The two that earn their
 * place: `laptop-short` is a 1280x800 laptop with a browser's own chrome on
 * it, which is the most common real window nobody designs for; and
 * `phone-tiny` is the one that actually failed. `tablet-land` is here because
 * short-and-wide and short-and-narrow are different failures — the first
 * wraps the lede in two lines, the second in six — and a rule keyed on height
 * alone gets one of them wrong.
 *
 * Usage: `pnpm e2e:one-screen`, with the web app already served.
 * Flags: `--base-url <url>` (default http://127.0.0.1:3010).
 */
import type { Browser } from "playwright";

import { launchChromium } from "./browser.js";

interface Viewport {
  name: string;
  width: number;
  height: number;
}

/** WCAG 2.2 AA's floor for a target, and the one `e2e:phone` holds too. */
const MIN_TARGET_PX = 24;

const VIEWPORTS: Viewport[] = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "laptop-short", width: 1280, height: 660 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "tablet-land", width: 1024, height: 600 },
  { name: "phone", width: 390, height: 844 },
  { name: "phone-small", width: 360, height: 640 },
  { name: "phone-tiny", width: 320, height: 568 },
];

function parseArgs(argv: string[]): { baseUrl: string } {
  let baseUrl = "http://127.0.0.1:3010";
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--base-url") {
      const next = argv[i + 1];
      if (!next) throw new Error("--base-url needs a url");
      baseUrl = next.replace(/\/+$/, "");
      i += 1;
    }
  }
  return { baseUrl };
}

interface Measured {
  clipped: number;
  vOverflow: number;
  hOverflow: number;
  viewportHeight: number;
  acts: { name: string; pressable: boolean; bottom: number; width: number; height: number }[];
  headlineBottom: number | null;
}

/**
 * THE MEASUREMENT, AS A STRING, and that is not a style choice.
 *
 * `tsx` compiles this file with esbuild's `keepNames`, which wraps every
 * named function — including `const box = (el) => …` — in a `__name` helper
 * that exists in this module and not in the page. Passing such a function to
 * `page.evaluate` ships the wrapper and not the helper, and it fails as
 * `ReferenceError: __name is not defined` from a line that looks perfectly
 * ordinary. `tools/e2e/phone.ts` and `at-scale.ts` both carry the same note
 * and the same shape; a string is never compiled, so it never acquires one.
 */
const PROBE = `(() => {
  const doc = document.documentElement;
  const page = document.querySelector(".lp");
  const out = {
    /* THE INNER BOX IS THE ONE THAT MATTERS, and it took a control test to
       learn it. \`.lp\` hides its own overflow, so content running past the
       bottom is CLIPPED rather than scrolled — the document never grows, and
       a walk that only asked the document reported a page with four hundred
       extra pixels in it as clean. \`scrollHeight\` on the clipping box still
       reports the full height of what is inside it, which is the one number
       that can see the defect this gate exists for. */
    clipped: page ? page.scrollHeight - page.clientHeight : -1,
    vOverflow: doc.scrollHeight - doc.clientHeight,
    hOverflow: doc.scrollWidth - doc.clientWidth,
    viewportHeight: doc.clientHeight,
    acts: [],
    headlineBottom: null,
  };
  const wanted = [
    ["begin", ".lp-act", true],
    ["continue", ".lp-quiet-verb", true],
    ["aside", ".lp-act-aside", false],
  ];
  for (const pair of wanted) {
    const el = document.querySelector(pair[1]);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    out.acts.push({ name: pair[0], pressable: pair[2], bottom: r.bottom, width: r.width, height: r.height });
  }
  const h = document.querySelector(".lp-headline");
  if (h) out.headlineBottom = h.getBoundingClientRect().bottom;
  return JSON.stringify(out);
})()`;

/**
 * Everything the walk needs from one viewport, read in one pass in the page.
 * One evaluate rather than several because a layout that changes between two
 * calls is a layout neither call described.
 */
async function measure(browser: Browser, url: string, vp: Viewport): Promise<Measured> {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  try {
    await page.goto(url, { waitUntil: "networkidle" });
    /* The being's gaze and the doorway's glow both settle after first paint;
       measuring into that costs a rerun, not a wrong answer, but a wrong
       answer is what an intermittent gate teaches people to ignore. */
    await page.waitForSelector(".lp-act", { state: "attached" });
    await page.waitForTimeout(500);

    return JSON.parse((await page.evaluate(PROBE)) as string) as Measured;
  } finally {
    await page.close();
  }
}

async function main(): Promise<void> {
  const { baseUrl } = parseArgs(process.argv.slice(2));
  /* `?landing` because the dev server steps the route guard aside and serves
     the world at `/`; `main.tsx` names this query for exactly this reason. */
  const url = `${baseUrl}/?landing`;
  console.log(`[one-screen] ${url}`);

  const browser = await launchChromium();
  const failures: string[] = [];

  try {
    for (const vp of VIEWPORTS) {
      const m = await measure(browser, url, vp);
      const here: string[] = [];

      if (m.clipped < 0) here.push("no `.lp` on the page — nothing to measure");
      else if (m.clipped > 0) {
        here.push(
          `${m.clipped}px of the page is past the bottom of the screen — and because the ` +
            `overflow is hidden it is clipped, not scrollable, so it is simply gone`,
        );
      }
      if (m.vOverflow > 0) {
        here.push(`the document scrolls vertically by ${m.vOverflow}px`);
      }
      if (m.hOverflow > 0) here.push(`scrolls horizontally by ${m.hOverflow}px`);

      if (m.acts.length === 0) here.push("no acts on the page at all");
      for (const act of m.acts) {
        if (act.bottom > m.viewportHeight) {
          here.push(
            `\`${act.name}\` is ${Math.round(act.bottom - m.viewportHeight)}px below the fold ` +
              `— with the overflow hidden it cannot be reached by any gesture`,
          );
        }
        /* ONLY WHAT CAN BE PRESSED. `private by default` is a span, and
           holding a line of prose to a target-size floor is how a gate
           teaches people that its failures are noise. WCAG 2.2's target rule
           is about pointer targets; the note beside the button is not one. */
        if (act.pressable && (act.width < MIN_TARGET_PX || act.height < MIN_TARGET_PX)) {
          here.push(
            `\`${act.name}\` is ${Math.round(act.width)}x${Math.round(act.height)}, ` +
              `under WCAG 2.2 AA's ${MIN_TARGET_PX}x${MIN_TARGET_PX}`,
          );
        }
      }

      if (m.headlineBottom === null) here.push("no headline on the page");
      else if (m.headlineBottom > m.viewportHeight) {
        here.push(
          `the headline runs ${Math.round(m.headlineBottom - m.viewportHeight)}px past the fold`,
        );
      }

      const label = `${vp.name} ${vp.width}x${vp.height}`;
      if (here.length === 0) {
        const lowest = m.acts.reduce((n, a) => Math.max(n, a.bottom), 0);
        console.log(
          `  ok   ${label.padEnd(22)} lowest act ${Math.round(lowest)} of ${m.viewportHeight}`,
        );
      } else {
        console.log(`  FAIL ${label}`);
        for (const line of here) console.log(`         ${line}`);
        failures.push(`${label}: ${here.join("; ")}`);
      }
    }
  } finally {
    await browser.close();
  }

  if (failures.length > 0) {
    console.error(`\n[one-screen] ${failures.length} viewport(s) do not hold the ruling.`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n[one-screen] clean — one screen at all ${VIEWPORTS.length} viewports.`);
}

main().catch((err) => {
  console.error("[one-screen] walk failed:", err);
  process.exitCode = 1;
});
