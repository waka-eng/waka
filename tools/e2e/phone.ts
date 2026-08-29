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
 *   5. No two controls sit closer than 44px centre to centre unless BOTH are
 *      44px in both axes. Size alone does not catch the shape that actually
 *      costs someone something: two controls that each clear the floor, one
 *      of which takes a memory down, close enough that one absorbs a miss
 *      meant for the other. This rule used to live in `e2e:journeys` as
 *      `the-hand`, which could not emulate touch — it resized a fine-pointer
 *      page, so every control whose size comes from `@media (pointer: coarse)`
 *      measured at its DESKTOP size and the walk reported crowding that no
 *      phone has. It is asked here, where the pointer is real.
 *
 * ── WHY IT SIGNS UP AND KEEPS ──────────────────────────────────────────────
 *
 * An empty account hides most of the world: the count, the timeline's word,
 * the card and every modal only exist once something has been kept. The first
 * version of this walk measured a fresh account, found almost nothing on
 * screen, and reported it clean. It keeps three memories before it measures.
 *
 * AND IT OPENS ONE OF THEM. For its whole first life this walk measured the
 * door, the world at rest and the mouth open — never a card. The card is
 * where the smallest controls in the product live, and they were all under
 * the floor: `reflect` and `delete` at 37x15, the two stepping carets at
 * 18x14 sitting 32px apart. A gate that advertises "the product on a phone"
 * and never opens the thing you tap a memory to see is not measuring the
 * product. Opening it costs a coordinate sweep, because a keepsake is drawn
 * on a canvas and has no selector to click.
 *
 *     pnpm e2e:phone              # every check must pass
 *     pnpm e2e:phone --negative   # each must fail when the defect is put back
 */
import { type Browser, type Page } from "playwright";
import { settleAfterArrival } from "./arrival";
import { aimAt, maybeOrbs, readBlobs, readOrbs } from "./orbs";
import { launchChromium } from "./browser";
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
 * The distance below which one target absorbs a miss meant for its neighbour.
 * Only a pair that is itself 44px in both axes may be closer — two big
 * targets cannot steal each other's misses.
 */
const MIN_APART = 44;

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
  kind: "overflow" | "covered" | "zoom" | "target" | "crowded" | "unmeasured";
  detail: string;
}

const PROBE = `(() => {
  const vw = window.innerWidth;
  const named = (e) => {
    const cls = typeof e.className === "string" ? e.className.trim().split(/\\s+/).slice(0, 2).join(".") : "";
    return e.tagName.toLowerCase() + (cls ? "." + cls : "");
  };
  const out = { overflow: [], covered: [], zoom: [], targets: [], crowded: [], scrollW: document.documentElement.scrollWidth, vw };
  const seen = new Set();
  /* EVERY control, undeduped and with its centre. The crowding rule is about
     PAIRS, and the seen-set above collapses by name: both stepping carets are
     a bare button element with no class, so they share one name and deduping
     would hide the one pair this rule was written for.
     NO BACKTICKS IN HERE. This whole probe is a template literal, and the
     first version of this comment quoted an identifier the way the rest of
     the file does, which closed the literal and turned the JavaScript below
     it into TypeScript the compiler tried to parse. */
  const all = [];
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
      all.push({
        name:
          (e.getAttribute("aria-label") || e.innerText || name).trim().replace(/\\s+/g, " ").slice(0, 26) ||
          name,
        w: Math.round(r.width),
        h: Math.round(r.height),
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
      });
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

  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      if (a.w >= ${MIN_APART} && a.h >= ${MIN_APART} && b.w >= ${MIN_APART} && b.h >= ${MIN_APART}) continue;
      const d = Math.hypot(a.cx - b.cx, a.cy - b.cy);
      if (d >= ${MIN_APART}) continue;
      const key = "p" + a.name + "|" + b.name;
      if (seen.has(key)) continue;
      seen.add(key);
      out.crowded.push(
        a.name + " (" + a.w + "x" + a.h + ") & " + b.name + " (" + b.w + "x" + b.h + ") " + Math.round(d) + "px apart",
      );
    }
  }
  return JSON.stringify(out);
})()`;

interface Probe {
  overflow: string[];
  covered: string[];
  zoom: string[];
  targets: Array<{ name: string; w: number; h: number }>;
  crowded: string[];
  scrollW: number;
  vw: number;
}

async function read(page: Page, view: string, surface: string): Promise<Finding[]> {
  const p = JSON.parse((await page.evaluate(PROBE)) as string) as Probe;
  const found: Finding[] = [];
  for (const d of p.overflow) found.push({ view, surface, kind: "overflow", detail: d });
  for (const d of p.covered) found.push({ view, surface, kind: "covered", detail: d });
  for (const d of p.zoom) found.push({ view, surface, kind: "zoom", detail: d });
  for (const d of p.crowded) found.push({ view, surface, kind: "crowded", detail: d });
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

/**
 * A KEEPSAKE IS DRAWN ON A CANVAS AND HAS NO SELECTOR, so the only way in is
 * to tap where one might be. `.jar-saved` opens the field of them; the sweep
 * then walks the middle band of the screen until a `.jar-panel` appears. The
 * y offsets are fractions of the viewport rather than pixels so the same
 * sweep works at 844 and at 640.
 */
async function openCard(page: Page, view: View): Promise<boolean> {
  /* A MEMORY, NOT ANY PANEL.
     This counted `.jar-panel`, and the wall's settings sheet IS one. So a tap
     that missed an orb and landed on chrome opened settings, this reported
     success, and the walk then measured the SETTINGS SHEET while labelling
     the surface "a memory open" — six findings against controls that are not
     on a memory card at all (`jar-settings-head`, `jar-settings-x`,
     `jar-settings-verb`), on one run in three. `.jar-panel-text` is the
     memory's own body and nothing else has it. */
  const panels = async (): Promise<number> =>
    (await page.evaluate(() => document.querySelectorAll(".jar-panel-text").length)) as number;
  /* AND WHATEVER A STRAY TAP DID OPEN IS PUT AWAY BEFORE THE NEXT ONE, or it
     stands over the orb the next tap is aimed at — and worse, it is still
     standing when the walk measures.

     This asked whether a `.jar-panel` was open, which is the same mistake one
     layer out as the one `panels()` above was making. A tap that misses an orb
     can land on the caret and open the WALLS LIST, and a list is not a panel:
     it survived, and the walk then reported its rows as crowded controls on a
     surface it had labelled "a memory open" — two findings against a list that
     has nothing to do with a memory, on some runs and not others.

     Escape unconditionally, because there is nothing to lose by pressing it
     into an empty world and everything to lose by guessing at the shape of
     what a stray tap raised — AND THEN COLLAPSE THE WALLS LIST BY ITS OWN
     CARET, because Escape does not close it. It is a toggle with
     `aria-expanded`, dismissed by a press outside it or by the caret again,
     and I shipped a comment claiming Escape was enough before checking: the
     list came back on the very next run. It says whether it is open, so ask
     it rather than assuming. */
  const putAway = async (): Promise<void> => {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const caret = page.locator('.jar-here-more[aria-expanded="true"]');
    if (await caret.count()) {
      await caret.first().tap();
      await page.waitForTimeout(300);
    }
  };
  try {
    await page.locator(".jar-saved").first().tap({ timeout: 20_000 });
  } catch {
    return false;
  }
  await page.waitForTimeout(4_000);

  /* LOOK FIRST, THEN TAP — the walk no longer hunts.
     This aimed a hundred and seventeen taps along nine horizontal bands and
     let the world say whether any of them landed. That worked only while it
     was quietly leaning on the arrival greeting: the greeting glides the
     camera DOWN to the newest memory, so a walk measuring inside that window
     found the field conveniently under its bands. Waiting the greeting out
     properly — which every gate does now — took the crutch away and the sweep
     began missing every single time, reporting "no memory could be opened":
     a sentence about the walk, printed where a reader looks for a sentence
     about the product.

     An orb has no selector, but it is not invisible. `readOrbs` finds it the
     way a person does, by its own light, and `aimAt` re-reads the field
     immediately before each tap because THE FIELD DRIFTS — a centroid read
     once and tapped a few seconds later is a tap at where the orb was.

     This is still the thumb's route and that is the point of keeping it: the
     ground's listbox is a named way in and `e2e:by-keyboard` proves a reader
     can use it, but its options are 1px wide at x=-1. They are for a screen
     reader. Only this says a THUMB can open a memory. */
  /* IN ROUNDS, BECAUSE THE FIELD IS STILL ARRIVING.
     Tapping the archive door starts a journey: the camera travels and the
     ground pours, and a single sweep taken four seconds later sometimes finds
     orbs that are still moving toward their homes, so every tap lands where
     one was. Two rounds in three passed and the third reported "no memory
     could be opened" — about the walk's patience, printed where a reader
     looks for a sentence about the product. Three rounds, two seconds apart. */
  for (let round = 0; round < 3; round += 1) {
    if (round > 0) await page.waitForTimeout(2_000);
    /* the strict reading first, then everything that might be one: this walk
       needs ONE memory open, and a wrong guess costs a single tap */
    const strict = await readOrbs(page);
    const seen = new Set(strict.map((b) => `${b.x},${b.y}`));
    const wider = maybeOrbs(await readBlobs(page)).filter((b) => !seen.has(`${b.x},${b.y}`));
    for (const target of [...strict, ...wider]) {
      const at = await aimAt(page, target);
      if (!at) continue;
      await page.touchscreen.tap(at.x, at.y);
      await page.waitForTimeout(450);
      if ((await panels()) === 0) {
        await putAway();
        continue;
      }
      /* it may still be on its way in or on its way back out */
      await page.waitForTimeout(1_000);
      if ((await panels()) > 0) return true;
      await putAway();
    }
  }

  /* NOTHING LIT WAS AN ORB, OR NO ORB TOOK THE TAP.
     Reported as `unmeasured` rather than passed: an unmeasured surface must
     not read like a clean one. */
  return false;
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
          ".jar-mouth-rest { padding-top: 0 !important; padding-bottom: 0 !important; }" +
          /* and the card's foot as it shipped: 18x14 carets a thumb's width
             from `delete`, which is what the crowding rule is here for */
          ".jar-panel button { min-width: 0 !important; min-height: 0 !important; }" +
          ".jar-panel-foot button { min-width: 0 !important; min-height: 0 !important; }" +
          ".jar-panel-foot-c { gap: 2px !important; }";
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

  /* AND A MEMORY OPEN. Loaded fresh rather than reached from here: the mouth
     is open, and the sweep below would spend its first passes closing it. */
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  /* the welcome has to finish before the sweep starts, or the sweep spends
     its passes on a card the greeting opened and is about to close —
     `arrival.ts` has the whole account */
  await settleAfterArrival(page);
  if (await openCard(page, view)) {
    found.push(...(await read(page, view.name, "a memory open")));
  } else {
    /* SAID OUT LOUD RATHER THAN PASSED OVER. A sweep that finds nothing looks
       exactly like a surface with nothing wrong on it, and the difference is
       the whole value of this walk. */
    found.push({
      view: view.name,
      surface: "a memory open",
      kind: "unmeasured",
      detail: "no memory could be opened — the smallest controls in the product went unmeasured",
    });
  }

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

  const browser = await launchChromium();
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
