#!/usr/bin/env tsx
/**
 * THE PRODUCT ON A PHONE, MEASURED RATHER THAN REASONED ABOUT.
 *
 * Until 2026-08-25 nothing in this repo had ever laid a phone viewport over
 * the world. `everything-in-the-world.md` Phase 5 gated touch targets on the
 * FLAT routes at 390px and stopped there; `e2e:measure` runs at 1100x780;
 * every screenshot taken in the session that found this was 1100x780. So the
 * world's behaviour on the device most of its reading will happen on was
 * entirely unknown, and what the first walk found was not ergonomics:
 *
 *   AT 390px THE FOUR THINGS ALONG THE TOP EDGE LAY ACROSS EACH OTHER.
 *   `.jar-values` is centred and 196px wide, so it covered both the top-left
 *   pair and the account link. Playwright could not tap `.jar-when` at all —
 *   the pointer was intercepted — which meant the timeline could not be
 *   opened on a phone, and the thing you hit instead walked you somewhere
 *   else in the world.
 *
 * A defect that makes a control unreachable is invisible to every other gate
 * here, because every other gate is either a unit test in jsdom (no layout),
 * a desktop measurement, or an API walk. This one exists so that class of
 * defect has somewhere to be caught.
 *
 * ── WHAT IT ASSERTS ────────────────────────────────────────────────────────
 *
 *   1. Nothing overflows the viewport horizontally.
 *   2. No interactive control is hidden underneath another one — asked by
 *      hit-testing each control's own centre, the same way `journeys` asks
 *      it, because that is what catches "lands on the wrong thing".
 *   3. No text field is under 16px, which is the size below which mobile
 *      Safari zooms the page on focus and does not zoom back.
 *   4. Every control clears WCAG 2.2 AA's 24x24, and the ACTS — the mouth and
 *      the verbs under it — clear 44. See the comment in `home.css` for why
 *      the line is drawn in two places rather than at 44 for everything.
 *
 * ── WHY IT SIGNS UP AND KEEPS ──────────────────────────────────────────────
 *
 * An empty account hides most of the world: the count, the timeline's word,
 * the card and every modal only exist once something has been kept. The first
 * version of this walk measured a fresh account, found almost nothing on
 * screen, and reported it clean. It keeps three memories before it measures.
 *
 *     pnpm e2e:phone              # every check must pass
 *     pnpm e2e:phone --negative   # each must fail when the defect is put back
 */
import { chromium, type Browser, type Page } from "playwright";

interface View {
  name: string;
  width: number;
  height: number;
}

/** The two that matter: a current iPhone, and the smallest still in use. */
const VIEWS: View[] = [
  { name: "390x844", width: 390, height: 844 },
  { name: "360x640", width: 360, height: 640 },
];

/** WCAG 2.2 AA 2.5.8 Target Size (Minimum). */
const WCAG_MIN = 24;
/** What the acts get, per the ruling in `home.css`. */
const ACT_MIN = 44;
/** Below this, mobile Safari zooms the page on focus. */
const NO_ZOOM = 16;

/**
 * The controls a person reaches for one-handed while holding the phone.
 *
 * Class FRAGMENTS, matched with `includes`. The first version listed CSS
 * selectors and asked `name.startsWith(selector)` — but a probed name reads
 * `button.jar-mouth-rest.jar-label`, which starts with `button.`, so the test
 * was false for every control and the 44px rule this suite advertises never
 * ran. Everything was quietly checked at 24 and reported clean.
 */
const ACTS = ["jar-mouth-rest", "jar-where-on", "jar-where-off"];

interface Finding {
  view: string;
  surface: string;
  kind: "overflow" | "covered" | "zoom" | "target";
  detail: string;
}

const PROBE = `(() => {
  const vw = window.innerWidth;
  const named = (e) => {
    const cls = typeof e.className === "string" ? e.className.trim().split(/\\s+/).slice(0, 2).join(".") : "";
    return e.tagName.toLowerCase() + (cls ? "." + cls : "");
  };
  const out = { overflow: [], covered: [], zoom: [], targets: [], scrollW: document.documentElement.scrollWidth, vw };
  const seen = new Set();
  for (const e of document.querySelectorAll("*")) {
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(e);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
    const name = named(e);

    if ((r.right > vw + 1 || r.left < -1) && !seen.has("o" + name)) {
      seen.add("o" + name);
      out.overflow.push(name + " spans " + Math.round(r.left) + ".." + Math.round(r.right) + " of " + vw);
    }

    const tappable = e.matches("button, a, input, textarea, select, [role=button]");
    if (tappable) {
      if (!seen.has("t" + name)) {
        seen.add("t" + name);
        out.targets.push({ name, w: Math.round(r.width), h: Math.round(r.height) });
      }
      /* IS ANYTHING LYING ON TOP OF IT. Asked at the control's own centre —
         style tells you nothing about what the pointer will actually reach. */
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (cx >= 0 && cx <= vw && cy >= 0 && cy <= window.innerHeight) {
        const hit = document.elementFromPoint(cx, cy);
        if (hit && hit !== e && !e.contains(hit) && !hit.contains(e) && !seen.has("c" + name)) {
          seen.add("c" + name);
          out.covered.push(name + " — its own centre reaches " + named(hit));
        }
      }
    }

    if ((e.tagName === "INPUT" || e.tagName === "TEXTAREA") && parseFloat(cs.fontSize) < ${NO_ZOOM} && !seen.has("z" + name)) {
      seen.add("z" + name);
      out.zoom.push(name + " at " + cs.fontSize);
    }
  }
  return JSON.stringify(out);
})()`;

interface Probe {
  overflow: string[];
  covered: string[];
  zoom: string[];
  targets: Array<{ name: string; w: number; h: number }>;
  scrollW: number;
  vw: number;
}

async function read(page: Page, view: string, surface: string): Promise<Finding[]> {
  const p = JSON.parse((await page.evaluate(PROBE)) as string) as Probe;
  const found: Finding[] = [];
  for (const d of p.overflow) found.push({ view, surface, kind: "overflow", detail: d });
  for (const d of p.covered) found.push({ view, surface, kind: "covered", detail: d });
  for (const d of p.zoom) found.push({ view, surface, kind: "zoom", detail: d });
  if (p.scrollW > p.vw + 1) {
    found.push({
      view,
      surface,
      kind: "overflow",
      detail: `the page itself scrolls sideways — ${p.scrollW}px of content in ${p.vw}px`,
    });
  }
  for (const t of p.targets) {
    const isAct = ACTS.some((fragment) => t.name.includes(fragment));
    const min = isAct ? ACT_MIN : WCAG_MIN;
    if (t.w < min || t.h < min) {
      found.push({
        view,
        surface,
        kind: "target",
        detail: `${t.name} is ${t.w}x${t.h}, under the ${min}px this one is held to`,
      });
    }
  }
  return found;
}

async function walk(browser: Browser, view: View, negative: boolean): Promise<Finding[]> {
  const ctx = await browser.newContext({
    viewport: { width: view.width, height: view.height },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });
  if (negative) {
    /* THE DEFECTS EXACTLY AS THEY SHIPPED, put back one file at a time: the
       centred signpost returned to the chrome's own line (which is what made
       the timeline untappable), and every field back under 16px. */
    await ctx.addInitScript(() => {
      window.addEventListener("load", () => {
        const s = document.createElement("style");
        s.textContent =
          ".jar-values { top: 10px !important; }" +
          "input, textarea { font-size: 15px !important; }" +
          ".jar-mouth-rest { padding-top: 0 !important; padding-bottom: 0 !important; }";
        document.head.appendChild(s);
      });
    });
  }
  const page = await ctx.newPage();
  const base = process.env.WAKA_BASE_URL ?? "http://127.0.0.1:3010";

  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2_000);
  const found = await read(page, view.name, "the door");

  await page.click("#login-tab-signup");
  await page.fill("input[name=email]", `phone-${view.width}-${Date.now()}@example.test`);
  await page.fill("input[name=password]", "phone-password-1");
  await page.fill("input[name=name]", "Phone");
  await page.click("button[type=submit]");
  await page.waitForTimeout(8_000);

  for (const text of [
    "A phone is where most of this will be read.",
    "A target under a thumb is a target missed.",
    "Sixteen pixels, or the page zooms itself.",
  ]) {
    await page.locator(".jar-mouth-rest").first().tap();
    await page.waitForTimeout(700);
    await page.fill('textarea[aria-label="capture inspiration"]', text);
    await page.locator(".jar-mouth-where button", { hasText: /^save$/ }).first().tap();
    await page.waitForTimeout(4_500);
  }
  await page.waitForTimeout(2_000);
  found.push(...(await read(page, view.name, "the world")));

  await page.locator(".jar-mouth-rest").first().tap();
  await page.waitForTimeout(900);
  found.push(...(await read(page, view.name, "the mouth open")));

  await ctx.close();
  return found;
}

async function main(): Promise<number> {
  const negative = process.argv.includes("--negative");
  console.log("[phone] the product at phone size, in a real engine");
  console.log(
    negative
      ? "[phone] NEGATIVE mode — the shipped defects are put back and MUST be found\n"
      : "[phone] nothing may overflow, hide, zoom, or sit under the size it is held to\n",
  );

  const browser = await chromium.launch({
    executablePath: process.env.WAKA_CHROMIUM_PATH?.trim() || "/opt/pw-browsers/chromium",
  });
  let found: Finding[] = [];
  try {
    for (const v of VIEWS) found = found.concat(await walk(browser, v, negative));
  } finally {
    await browser.close();
  }

  for (const f of found) {
    console.log(`  ${f.view}  ${f.surface.padEnd(14)} ${f.kind.padEnd(9)} ${f.detail}`);
  }

  if (negative) {
    const ok = found.length > 0;
    console.log(
      ok
        ? `\n[phone] ${found.length} finding(s) — the sabotage was caught`
        : "\n[phone] NOTHING FOUND against the shipped defects — this suite is decoration",
    );
    return ok ? 0 : 1;
  }
  console.log(
    found.length === 0
      ? `\n[phone] clean at ${VIEWS.map((v) => v.name).join(" and ")}`
      : `\n[phone] ${found.length} finding(s)`,
  );
  return found.length === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(`[phone] harness error: ${err instanceof Error ? err.message : err}`);
    process.exit(2);
  });
