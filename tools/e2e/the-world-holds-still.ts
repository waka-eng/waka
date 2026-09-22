#!/usr/bin/env tsx
/**
 * ═══ THE WORLD NEVER MOVES UNLESS THE USER MOVED IT ═════════════════════
 *
 * A founder law, and until now the only one of the five with nothing
 * measuring it. The other four have instruments: light is held by
 * `contrast.test.ts` and `e2e:measure`, fading-never-deletes by
 * `e2e:erasure`, states-render-numerals-never by `e2e:journeys`. Motion had
 * the law written down and nobody watching it.
 *
 * It has been broken before, and expensively. Orbs used to ORBIT — the whole
 * ground turning, forever, with nobody touching it — and it took a founder
 * ruling to take it out ("orbit goes; the field lights instead", 2026-08-26).
 * That is the shape this exists to stop coming back: motion that decorates
 * rather than explains, and a world that is doing something while the person
 * is doing nothing.
 *
 * ── WHAT IT ASKS ────────────────────────────────────────────────────────────
 *
 * Settle the world, then touch nothing for nine seconds and photograph it
 * four times — at rest, and at +3s, +6s and +9s. Between any two samples:
 *
 * THE CHROME. No element appears, no element leaves, and no element's box
 * moves. Read from the DOM rather than from pixels deliberately: a creature
 * that brightens where it stands is not the world moving, and a pixel rule
 * would report it forever until somebody muted the rule.
 *
 * ── AND THE GROUND IS NOT MEASURED HERE. THIS IS THE IMPORTANT PART ─────────
 *
 * The orbit this law was written against was on the CANVAS, so the canvas is
 * the half that matters most — and it is the half this walk cannot honestly
 * ask about. It was written asking it, and the first run reported every orb
 * moving every three seconds. That was the instrument, not the product.
 *
 * `orbs.ts` finds orbs by flood-filling thresholded light. AN ORB'S CORE IS
 * AS BRIGHT AS IT IS ALIVE — its own header says so — and on a wall of fresh
 * keeps the cores are dim: measured on 2026-08-31, three memories gave eight
 * to twelve 4x4 and 8x8 fragments that appeared and vanished between samples,
 * plus the companion at 264x232 breathing by twelve pixels a side. Not one
 * blob passed `isOrb`. So the ground read cannot tell an orb that MOVED from
 * an orb that DIMMED, and a rule that cannot tell those apart is worse than
 * an absent one: it goes red on a still world, somebody widens it until it
 * stops, and then it is decoration with a green tick.
 *
 * SO IT ASKS THE SIM INSTEAD OF THE PIXELS, WHEN THE SIM WILL ANSWER. The
 * loop already publishes every ball's position as `window.__waka()`, behind
 * `VITE_SHOW_INTERNAL`. Where that exists the ground is measured exactly —
 * ball by ball, no flood fill, no argument about brightness — and `alive` is
 * deliberately left out, because a ball dimming is light and this walk is
 * about motion.
 *
 * Where it does not exist — a plain build, which is what CI builds — THE
 * GROUND GOES UNWATCHED AND THE RUN SAYS SO on its own line, found or not.
 * That is not the same as passing.
 *
 * ── AND THE GROUND IS NOT ASKED TO BE PERFECTLY STILL, WHICH IS NOT A
 *    WEAKENING ──────────────────────────────────────────────────────────────
 *
 * Asked for exact stillness, the ground failed on the first run with the
 * probe on: two balls tracing a closed loop, three pixels wide, about nine
 * seconds around, returning each time to where they began, with the camera
 * fixed and `alive` unchanged.
 *
 * That is not a leak. It is designed, and the loop says so where `stir` is
 * declared: `amp` scales every ambient drift at once — "the nebulae's
 * wander, the orbs' float, the companion's bob, the dust — so that a world
 * left alone eases toward stillness instead of jittering at a reader who has
 * stopped reading". It eases to `SETTLE_MIN`, which is 0.2 and not 0. A fifth
 * of the float is left on purpose, by somebody who wrote down the trade.
 *
 * A gate that failed on that would be this walk overruling a decision it did
 * not make, on its own reading of a law the same people wrote. So the claim
 * is the one both the law and the design make: A BALL LEFT ALONE STAYS INSIDE
 * ITS OWN FOOTPRINT. The world may breathe where it stands; it may not go
 * anywhere. An orbit fails this by hundreds of pixels, a re-fit that moves a
 * ball to a new home fails it and stays failed, and the designed float passes
 * with six times the room it needs.
 *
 * THE FOOTPRINT IS NOT A NUMBER SOMEBODY LIKED. It is `isOrb`'s own floor in
 * `orbs.ts`: the narrowest thing this repo will call an orb is 20px across.
 * A ball that has moved less than its own width still covers ground it was
 * already covering — it has not gone anywhere a person could point at — and
 * that overlap is what "inside its own footprint" means.
 *
 * It was half that for one run, on the reasoning that a radius was the
 * measure, and the designed float came in at 7px of the 10. A rule with
 * three pixels of room is a rule that goes red the first time a layout
 * changes and gets widened by whoever is unlucky enough to be there. The
 * diameter is both the truer reading and the one with room in it: the float
 * uses 7px of 20.
 *
 * Verified on 2026-08-31 against a build with the flag on.
 *
 * ── AND IT PROVES ITS OWN EYES, EVERY RUN ───────────────────────────────────
 *
 * A stillness check that cannot see movement passes forever and says nothing.
 * That is not a hypothetical failure for this instrument, it is the LIKELY
 * one: every part of it — the sampler, the canvas read, the comparison — fails
 * safe toward "nothing changed".
 *
 * So after the quiet ten seconds the walk MOVES THE WORLD ON PURPOSE and
 * demands that the sampler report it. It opens the walls list, which puts a
 * row on screen for every wall — a change in WHAT IS THERE and WHERE, which
 * is exactly the alphabet this sampler reads. Keeping something was the first
 * choice and it is the wrong control: the count goes from two to three in the
 * same box, and a sampler that reads geometry and not text is right to see
 * nothing. A control the instrument cannot see does not test the instrument.
 *
 * The control is a user act, which is the other half of the law: this same
 * movement is legal, because somebody asked for it.
 *
 * ── WHY IT WAITS AS LONG AS IT DOES ─────────────────────────────────────────
 *
 * A keep schedules ONE re-read of the board six seconds later
 * (`DERIVATION_SETTLE_MS`), so the poster can legitimately change its words
 * well after the press that caused it. That is the user's act landing late,
 * not the world moving on its own — so the quiet window starts after it, and
 * a walk that sampled sooner would report the product breaking a law it is
 * carefully keeping.
 *
 *     pnpm e2e:holds-still [--base-url <url>] [--negative]
 *
 * `--negative` does two things, one per half. It gives a piece of chrome a
 * looping animation — motion that explains nothing, running while nobody is
 * there. And it samples the ground WITHOUT WAITING FOR THE SETTLE, while the
 * balls are still easing to their homes after arrival, which is the product's
 * own physics genuinely moving the world. The second is what keeps the
 * footprint rule honest: a bound nothing can exceed is not a bound.
 *
 * ON A PLAIN BUILD ONLY THE FIRST OF THE TWO IS LIVE, and saying "both must be
 * caught" without that qualifier was this file overstating its own reach —
 * the same sin its positive half is careful not to commit. Where `__waka` is
 * absent the ground is unread, so the unsettled sampling has nothing to
 * measure and the drifting chrome is the whole of the negative proof. The run
 * prints NO SIGHT OF THE GROUND either way, so which of the two caught it is
 * on the transcript rather than left to be assumed.
 *
 * AND CATCHING IT IS NOT ENOUGH ON ITS OWN. The verdict was `!ok`, so a run
 * that missed the drift and failed its own blindness control instead would
 * have reported the drift as found. The two are separated (`sawDrift`,
 * `blind`): the sabotage must be caught, and the instrument must still prove
 * its eyes while catching it.
 */
import { type Browser, type Page } from "playwright";

import { settleAfterArrival } from "./arrival";
import { launchChromium } from "./browser";

const DEFAULT_BASE = "http://127.0.0.1:3010";
const PASSWORD = "holds-still-1";
/** The board's own late re-read after a keep, plus room for the network. */
const AFTER_THE_ACT_MS = 9_000;
/** How long the world is left alone, and how often it is looked at. */
const SAMPLES = 4;
const GAP_MS = 3_000;

const uniq = (): string => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/**
 * The narrowest thing `orbs.ts` will call an orb is 20px across, so a ball
 * that has travelled less than that still overlaps where it was.
 */
const FOOTPRINT = 20;

interface Frame {
  /** Every element, as "what it is @ where it is". */
  chrome: string[];
  /** Every ball by id, at where it is — null on a build with no internals. */
  ground: Record<string, [number, number]> | null;
}

/**
 * WHAT IT IS AND WHERE IT IS, for everything on screen.
 *
 * Rounded to whole pixels: sub-pixel layout jitter from a font settling is
 * not the world moving, and a rule that reported it would be a rule nobody
 * could keep green.
 */
async function chromeOf(page: Page): Promise<string[]> {
  return (await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const tag = el.tagName.toLowerCase();
      if (tag === "script" || tag === "style") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const cls = el.getAttribute("class") ?? "";
      out.push(
        tag +
          (cls !== "" ? "." + cls.trim().split(/\s+/).join(".") : "") +
          " @ " +
          Math.round(r.left) +
          "," +
          Math.round(r.top) +
          " " +
          Math.round(r.width) +
          "x" +
          Math.round(r.height),
      );
    }
    return out.sort();
  })) as string[];
}

/**
 * THE GROUND, FROM THE LOOP'S OWN MOUTH. `null` where the build does not
 * carry the probe, which is a different answer from "nothing moved" and is
 * reported as such.
 */
async function groundOf(page: Page): Promise<Record<string, [number, number]> | null> {
  return (await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const probe = w.__waka;
    if (typeof probe !== "function") return null;
    const state = (probe as () => { balls: Array<Record<string, unknown>> })();
    const out: Record<string, [number, number]> = {};
    for (const b of state.balls) {
      /* only what is lit: a ball that is out is not on this wall, and the
         dial and travel put balls out on purpose */
      if (b.active !== true) continue;
      /* `alive` is deliberately absent: a ball dimming is light, not motion */
      out[String(b.id)] = [Math.round(Number(b.x)), Math.round(Number(b.y))];
    }
    return out;
  })) as Record<string, [number, number]> | null;
}

async function frame(page: Page): Promise<Frame> {
  return { chrome: await chromeOf(page), ground: await groundOf(page) };
}

/** What is in `b` and not in `a`, and the other way round. */
function drift(a: string[], b: string[]): { came: string[]; went: string[] } {
  const inA = new Set(a);
  const inB = new Set(b);
  return {
    came: b.filter((x) => !inA.has(x)),
    went: a.filter((x) => !inB.has(x)),
  };
}

interface Result {
  ok: boolean;
  lines: string[];
  /**
   * WHY IT FAILED, because `--negative` used to accept any answer but yes.
   *
   * The verdict there was `!ok`, so a run where the drift went unseen and the
   * BLINDNESS control failed instead would have printed "the drift was found"
   * — a negative gate passing on the evidence that it cannot see. The halves
   * are separated now: the sabotage must be caught, and the instrument must
   * still prove its own eyes while catching it.
   */
  sawDrift: boolean;
  blind: boolean;
}

async function walk(browser: Browser, base: string, negative: boolean): Promise<Result> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  if (negative) {
    /* MOTION THAT EXPLAINS NOTHING: a piece of chrome given a loop that runs
       whether or not anybody is there. This is the shape the orbit had — the
       world busy while the person is still. */
    await ctx.addInitScript(() => {
      window.addEventListener("load", () => {
        const s = document.createElement("style");
        s.textContent =
          "@keyframes e2e-sabotage-drift { from { transform: translateX(0) } " +
          "to { transform: translateX(40px) } }" +
          ".jar-values { animation: e2e-sabotage-drift 2s linear infinite alternate !important }";
        document.head.appendChild(s);
      });
    });
  }
  const page = await ctx.newPage();
  const lines: string[] = [];
  let ok = true;
  let sawDrift = false;
  let blind = false;

  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.click("#login-tab-signup");
  await page.fill("input[name=email]", `still-${uniq()}@example.test`);
  await page.fill("input[name=password]", PASSWORD);
  await page.fill("input[name=name]", "Still");
  await page.click("button[type=submit]");
  await page.waitForTimeout(8_000);

  /* THE WORLD NEEDS A GROUND TO HOLD STILL. An empty account has no orbs at
     all, and "nothing moved" over an empty field is a sentence about nothing. */
  for (const text of ["the ground stays where it was put", "nobody is touching this"]) {
    await page.locator(".jar-mouth-rest").first().click();
    await page.waitForTimeout(700);
    await page.fill('textarea.jar-mouth-field', `${text} ${uniq()}`);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(4_500);
  }

  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  /* NEGATIVE MODE DOES NOT WAIT FOR ANY OF IT. The pour is still staging
     balls and dropping them to their homes — the world genuinely moving, by
     the product's own physics and at the product's own distances — so the
     footprint rule must catch it. A bound nothing can ever exceed is not a
     bound, and skipping only the board's late re-read was not enough: that
     reached 12px of the 20, which proves nothing about a rule set at 20. */
  if (negative) {
    await page.waitForTimeout(1_200);
  } else {
    await settleAfterArrival(page);
    await page.waitForTimeout(AFTER_THE_ACT_MS);
  }

  const first = await frame(page);
  lines.push(
    `  settled with ${first.chrome.length} things in the chrome, and ` +
      (first.ground === null
        ? "NO SIGHT OF THE GROUND — this build carries no internals, so the field went unwatched"
        : `${Object.keys(first.ground).length} balls lit, read from the loop itself`),
  );
  const track: Array<Record<string, [number, number]>> = [];
  if (first.ground !== null) track.push(first.ground);

  let prev = first;
  for (let i = 1; i < SAMPLES; i += 1) {
    await page.waitForTimeout(GAP_MS);
    const now = await frame(page);
    if (now.ground !== null) track.push(now.ground);
    const c = drift(prev.chrome, now.chrome);
    /* A BALL THAT WAS LIT AND IS NOT, or the other way round, is the ground
       CHANGING rather than breathing — no tolerance for that one. */
    const g =
      prev.ground !== null && now.ground !== null
        ? drift(Object.keys(prev.ground), Object.keys(now.ground))
        : { came: [], went: [] };
    if (c.came.length === 0 && c.went.length === 0 && g.came.length === 0 && g.went.length === 0) {
      lines.push(`  +${i * (GAP_MS / 1_000)}s  still`);
    } else {
      ok = false;
      sawDrift = true;
      lines.push(`  +${i * (GAP_MS / 1_000)}s  THE WORLD MOVED, and nobody moved it`);
      for (const x of c.went.slice(0, 4)) lines.push(`      chrome was: ${x}`);
      for (const x of c.came.slice(0, 4)) lines.push(`      chrome now: ${x}`);
      for (const x of g.went.slice(0, 4)) lines.push(`      a ball went out: ${x}`);
      for (const x of g.came.slice(0, 4)) lines.push(`      a ball came up: ${x}`);
    }
    prev = now;
  }

  /* ── HOW FAR DID ANYTHING GET? ──────────────────────────────────────────
     The designed float breathes in place; what this refuses is a ball that
     GOES somewhere. Measured as the widest box each ball's positions fit in
     across the whole quiet window, against its own footprint. */
  if (track.length > 1) {
    let worst = 0;
    let worstId = "";
    let ids = 0;
    for (const id of Object.keys(track[0]!)) {
      const seen = track.filter((t) => id in t).map((t) => t[id]!);
      if (seen.length < 2) continue;
      ids += 1;
      const xs = seen.map((p) => p[0]);
      const ys = seen.map((p) => p[1]);
      const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      if (span > worst) {
        worst = span;
        worstId = id;
      }
    }
    if (ids === 0) {
      lines.push("  no ball stayed lit across the window, so its travel was not measured");
    } else if (worst > FOOTPRINT) {
      ok = false;
      sawDrift = true;
      lines.push(
        `  A BALL WENT SOMEWHERE. ${worstId} covered ${worst}px across the quiet window, ` +
          `past the ${FOOTPRINT}px of its own footprint — that is travel, not breathing`,
      );
    } else {
      lines.push(
        `  the ground breathed and stayed put: the furthest any of ${ids} balls got was ` +
          `${worst}px of the ${FOOTPRINT}px it is allowed`,
      );
    }
  }

  /* ── AND NOW MOVE IT ON PURPOSE ─────────────────────────────────────────
     Everything above fails safe toward "nothing changed", so a run that
     never sees a change has proved nothing. */
  const more = page.locator(".jar-here-more");
  if ((await more.count()) === 0) {
    /* WITHOUT THE CONTROL THERE IS NO VERDICT. `nothing-invisible` guards the
       same locator and this did not, so an absent walls list ended the walk
       in a stack trace rather than an answer — and a harness error reads as
       infrastructure when what it means is "this run proved nothing". */
    ok = false;
    blind = true;
    lines.push(
      "  THE CONTROL IS MISSING. `.jar-here-more` is not on screen, so the world " +
        "could not be moved on purpose and the stillness above is unproven.",
    );
    await ctx.close();
    return { ok, lines, sawDrift, blind };
  }
  await more.first().click();
  await page.waitForTimeout(1_500);
  const opened = await frame(page);
  const cc = drift(prev.chrome, opened.chrome);
  if (cc.came.length > 0) {
    lines.push(
      `  moved on purpose: opening the walls list put ${cc.came.length} thing(s) on screen, ` +
        "and the sampler saw every one",
    );
  } else {
    ok = false;
    blind = true;
    lines.push(
      "  THE INSTRUMENT IS BLIND. The walls list was opened and the sampler reported " +
        "nothing new on screen — so the stillness above is not evidence of anything.",
    );
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  /* AND THE GROUND'S OWN CONTROL, where there is a ground to control. A keep
     drops a ball into the field, so the loop must report one more than it
     did — the half of this walk that the chrome cannot speak for. */
  if (opened.ground !== null) {
    await page.locator(".jar-mouth-rest").first().click();
    await page.waitForTimeout(700);
    await page.fill('textarea.jar-mouth-field', `on purpose ${uniq()}`);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(6_000);
    const after = await frame(page);
    const gc =
      after.ground === null
        ? { came: [], went: [] }
        : drift(Object.keys(opened.ground), Object.keys(after.ground));
    if (gc.came.length > 0) {
      lines.push(
        `  and a keep put ${gc.came.length} ball(s) on the ground, which the loop reported`,
      );
    } else {
      ok = false;
      blind = true;
      lines.push(
        "  THE GROUND HALF IS BLIND. A memory was kept and the loop reported no new ball — " +
          "so the ground's stillness above is not evidence of anything.",
      );
    }
  }

  await ctx.close();
  return { ok, lines, sawDrift, blind };
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const negative = argv.includes("--negative");
  const i = argv.indexOf("--base-url");
  const base = (i >= 0 ? argv[i + 1] : undefined) ?? DEFAULT_BASE;

  console.log("[holds-still] the world never moves unless the user moved it");
  console.log(
    negative
      ? "[holds-still] NEGATIVE mode — a piece of chrome is drifting and MUST be found\n"
      : `[holds-still] base url: ${base}\n`,
  );

  const browser = await launchChromium();
  let res: Result;
  try {
    res = await walk(browser, base, negative);
  } finally {
    await browser.close();
  }
  for (const l of res.lines) console.log(l);
  console.log("");

  if (negative) {
    const caught = res.sawDrift && !res.blind;
    console.log(
      caught
        ? "[holds-still] PASS — the drift was found, and the instrument proved its eyes " +
          "while finding it"
        : res.blind
          ? "[holds-still] FAIL — the instrument went blind, so catching a drift proves nothing"
          : "[holds-still] FAIL — chrome was drifting and the walk called the world still",
    );
    return caught ? 0 : 1;
  }
  console.log(
    res.ok
      ? "[holds-still] PASS — left alone, the world stayed exactly as it was"
      : "[holds-still] FAIL — the world moved with nobody touching it",
  );
  return res.ok ? 0 : 1;
}

void main().then((code) => {
  process.exitCode = code;
});
