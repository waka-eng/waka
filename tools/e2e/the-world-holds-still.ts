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
 * demands that the sampler report it. It opens the archive from the dock,
 * which puts a row on screen for every memory — a change in WHAT IS THERE and
 * WHERE, which is exactly the alphabet this sampler reads. Keeping something
 * was the first choice and it is the wrong control: the count goes from two to
 * three in the same box, and a sampler that reads geometry and not text is
 * right to see nothing. A control the instrument cannot see does not test the
 * instrument.
 *
 * IT WAS THE WALLS LIST UNTIL 2026-10-15, and that list went with rooms — see
 * the tombstone at the control itself for what that did to every run of this
 * gate in between.
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
 * there. And it SCRUBS THE DIAL between samples, which re-solves the field and
 * sends every surviving ball to a new home, which is the product's own physics
 * genuinely moving the world. The second is what keeps the footprint rule
 * honest: a bound nothing can exceed is not a bound.
 *
 * ═══ THE SECOND HALF USED TO RIDE ON THE POUR, AND THE POUR IS GONE ═══════
 *
 * It read: "it samples the ground WITHOUT WAITING FOR THE SETTLE, while the
 * balls are still easing to their homes after arrival". That was true while
 * arrival staged balls and dropped them in. `simulation.ts` removed the pour
 * — every `spawnAt` is `-1` now, and the tombstone where `POUR_MS` used to be
 * says so — and `applyPresence` puts a newly present ball straight onto its
 * home (`b.x = b.homeX`). THERE IS NO LOAD-TIME MOTION LEFT. So skipping the
 * settle sampled a world that was already still, the footprint check reported
 * a few pixels of designed float, and the self-test for the one bound in this
 * file could not fire at all. A negative control that cannot fail is the same
 * defect as a gate that cannot fail, one level up.
 *
 * THE REPLACEMENT IS A REAL MOVER, AND IT IS THE PRODUCT'S OWN. `windTo` is on
 * `SimApi`; `reconcileScrub` re-assigns homes whenever the SET of present
 * orbs changes, and "everyone eases toward their new home" is its own comment.
 * So the walk winds back past the newest memory and forward again, and the
 * balls that stay lit genuinely travel. Measured on 2026-10-15 against a
 * `VITE_SHOW_INTERNAL=1` dev build with four memories kept: 93px of travel,
 * against the 20px footprint. The bound is exceedable again.
 *
 * ON A PLAIN BUILD ONLY THE FIRST OF THE TWO IS LIVE, and saying "both must be
 * caught" without that qualifier was this file overstating its own reach —
 * the same sin its positive half is careful not to commit. Where `__waka` is
 * absent the ground is unread, so the scrub has nothing to measure and the
 * drifting chrome is the whole of the negative proof. The run prints NO SIGHT
 * OF THE GROUND either way, so which of the two caught it is on the
 * transcript rather than left to be assumed.
 *
 * AND `__waka` IS NARROWER THAN IT LOOKS, WHICH IS WORTH KNOWING BEFORE YOU
 * TRUST A GREEN RUN. `wakaSim` is published under `showsDebug()` — `DEV ||
 * VITE_SHOW_INTERNAL` — but `__waka`, which is what `groundOf` reads, is
 * published under `import.meta.env.VITE_SHOW_INTERNAL` alone. A plain `vite`
 * dev server therefore has the scrub's handle and NOT the ground's eyes, and
 * the default base (a built bundle on :3010) has neither. Both report NO
 * SIGHT OF THE GROUND, honestly, and only `VITE_SHOW_INTERNAL=1` reads it.
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
import { saveAnInspiration } from "./keep";

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

/**
 * THE NEGATIVE MODE'S MOVER, AND THE ONLY ONE LEFT THAT MOVES THE GROUND.
 *
 * Winds the wall back past its newest memory and forward again. `windTo` is
 * on `SimApi`, which the page publishes as `window.wakaSim` under
 * `showsDebug()`; `reconcileScrub` re-assigns every home when the SET of
 * present orbs changes, and the balls that stay lit ease across the field to
 * the gap the absent one left. That is travel, at the product's own
 * distances, caused by the product's own code — which is what a control for
 * the footprint rule has to be.
 *
 * Returns what it managed to do, so a run that could not scrub says so
 * instead of counting a still world as a caught one. `null` means the handle
 * was not there; the caller treats that as the plain-build case.
 */
async function scrubTheDial(page: Page, phase: number): Promise<string | null> {
  return (await page.evaluate(async (turn: number) => {
    const sim = (window as unknown as { wakaSim?: () => { windTo?: (T: number) => void } | null })
      .wakaSim?.();
    if (!sim || typeof sim.windTo !== "function") return null;
    /* The memories' own stamps, because a time plucked out of the air either
       changes nothing (no ball crosses it) or empties the wall (every ball
       does), and both leave the footprint rule with nothing to measure. One
       step back is the newest memory going out and the rest re-homing. */
    const r = await fetch("/api/inspirations?limit=200", { credentials: "include" });
    if (!r.ok) return null;
    const body = (await r.json()) as { inspirations?: Array<{ createdAt: string }> };
    const stamps = (body.inspirations ?? [])
      .map((row) => Date.parse(row.createdAt))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    if (stamps.length < 2) return null;
    /* alternate, so every gap in the window has motion in it rather than one
       move followed by three still samples */
    const T = turn % 2 === 1 ? stamps[stamps.length - 1]! - 1 : Date.now();
    sim.windTo!(T);
    return turn % 2 === 1 ? "wound back past the newest memory" : "wound forward to now";
  }, phase)) as string | null;
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
      const s = document.createElement("style");
      s.textContent =
        "@keyframes e2e-sabotage-drift { from { transform: translateX(0) } " +
        "to { transform: translateX(40px) } }" +
        /* ═══ `.jar-values` HAD NO RENDERER, SO THE SABOTAGE ANIMATED
               NOTHING ════════════════════════════════════════════════════
           The up-signpost at headquarters went when the archive and the
           principles became destinations in the dock; `home.css` still
           carries `.jar-values` rules and no component writes the class.
           A `--negative` run therefore injected a keyframe nobody could
           see and then FAILED ITSELF for not catching a drift it had never
           caused — the run read "chrome was drifting and the walk called
           the world still", which is a sentence about this file dressed as
           a sentence about the product.

           `.jar-values-room` is the live element in the same region of
           headquarters — `PrincipleRead`'s own container, verified on
           screen 2026-10-15 for a fresh account with two memories, and
           three rows of the chrome move when it is animated.

           AND IT IS DELIBERATELY NOT `.waka-dock`, WHICH WAS TRIED FIRST.
           The dock is the most permanent chrome there is, which is exactly
           why it is the wrong thing to shake: the walk clicks the dock to
           keep a memory and to move the world on purpose, and Playwright
           refuses to click an element that never stops moving ("element is
           not stable", 58 retries, then a timeout inside
           `saveAnInspiration`). A sabotage must break what the gate
           MEASURES, never what the gate DRIVES. */
        ".jar-values-room { animation: e2e-sabotage-drift 2s linear infinite alternate !important }";
      /* `load`, and it is enough: `addInitScript` re-runs on every
         navigation, and the walk reaches the measured page with a real
         `page.goto(base + "/")` rather than an in-page route change. */
      window.addEventListener("load", () => document.head.append(s));
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
     all, and "nothing moved" over an empty field is a sentence about nothing.

     THROUGH `keep.ts`, WHICH IS THE WHOLE POINT OF `keep.ts`. This pasted the
     old four lines — open the notepad, fill
     `textarea[aria-label="Capture inspiration"]`, press Enter — and that
     textarea is the CLOSED composer slot: it is in the DOM and it is not
     visible, so the fill retried for thirty seconds and threw. `keep.ts`
     exists because eleven gates pasted a stale composer flow once before;
     this was the twelfth copy, and it is now the same call as everywhere
     else. Four memories rather than two, so the scrub has a ball left lit
     after it winds one out. */
  for (let i = 0; i < 4; i += 1) {
    await saveAnInspiration(page, `the ground stays where it was put ${i} ${uniq()}`);
    await page.waitForTimeout(1_500);
  }

  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  /* BOTH MODES SETTLE NOW. Negative mode used to skip this, on the reasoning
     that the pour was still dropping balls into place and the footprint rule
     had to catch it. There is no pour (see the tombstone in the header), so
     skipping the settle sampled a world that was already still and the
     footprint self-test could not fire. Negative mode gets its motion from a
     scrub between samples instead, which is a mover that still exists. */
  await settleAfterArrival(page);
  await page.waitForTimeout(AFTER_THE_ACT_MS);

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
  /* What the scrub managed, said on the transcript rather than assumed — a
     negative run on a build with no `wakaSim` has NOT exercised the footprint
     rule and must not read as though it had. */
  let scrubbed: string | null = null;
  for (let i = 1; i < SAMPLES; i += 1) {
    /* NEGATIVE MODE MOVES THE GROUND ON PURPOSE, BETWEEN THE SAMPLES. The
       positive run touches nothing here, which is the whole claim. */
    if (negative) scrubbed = (await scrubTheDial(page, i)) ?? scrubbed;
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

  if (negative) {
    lines.push(
      scrubbed === null
        ? "  THE SCRUB DID NOT RUN — no `wakaSim` on this build, so the footprint rule was " +
          "not exercised and the drifting chrome is the whole of this run's negative proof"
        : `  the dial was scrubbed between samples (${scrubbed}), so the ground was ` +
          "genuinely moved and the footprint rule had something to catch",
    );
  }

  /* ── AND NOW MOVE IT ON PURPOSE ─────────────────────────────────────────
     Everything above fails safe toward "nothing changed", so a run that
     never sees a change has proved nothing.

     ═══ THE CONTROL WAS THE WALLS LIST, AND THE WALLS LIST WENT WITH ROOMS ══
     This opened `.jar-here-more` — the caret on the wall chip that listed
     every wall you could walk to. Rooms came out in `405ee4aa` and the chip
     itself renders `null`; the class survives only as rules in `home.css`.
     So the control read zero, and EVERY run of this gate — positive and
     negative alike — ended on "THE CONTROL IS MISSING ... the stillness above
     is unproven". Not a timeout: a confident, wrong verdict about the
     instrument, filed against a product that was fine.

     THE ARCHIVE IS THE CONTROL NOW, and it is a better one for exactly the
     reason the walls list was chosen. What this needs is a USER ACT that
     changes WHAT IS THERE and WHERE — the alphabet this sampler reads — and
     opening the archive puts a whole list on screen. Measured 2026-10-15:
     29 new things in the chrome, and Escape puts every one of them back.
     The walls list managed the same kind of change and no longer exists;
     keeping a memory is still the wrong control for the same reason it
     always was (the count goes from two to three in the same box).

     It is also the same door `first-sixty.ts` repointed `.jar-saved` to, so
     the two gates now name the archive the same way. */
  const more = page
    .locator(".waka-dock-item", { hasText: /^Inspirations$/ })
    .first();
  if ((await more.count()) === 0) {
    /* WITHOUT THE CONTROL THERE IS NO VERDICT. `nothing-invisible` guards the
       same locator and this did not, so an absent control ended the walk
       in a stack trace rather than an answer — and a harness error reads as
       infrastructure when what it means is "this run proved nothing". */
    ok = false;
    blind = true;
    lines.push(
      "  THE CONTROL IS MISSING. The dock's `Inspirations` row is not on screen, so the " +
        "world could not be moved on purpose and the stillness above is unproven.",
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
      `  moved on purpose: opening the archive put ${cc.came.length} thing(s) on screen, ` +
        "and the sampler saw every one",
    );
  } else {
    ok = false;
    blind = true;
    lines.push(
      "  THE INSTRUMENT IS BLIND. The archive was opened and the sampler reported " +
        "nothing new on screen — so the stillness above is not evidence of anything.",
    );
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  /* AND THE GROUND'S OWN CONTROL, where there is a ground to control. A keep
     drops a ball into the field, so the loop must report one more than it
     did — the half of this walk that the chrome cannot speak for. */
  if (opened.ground !== null) {
    /* the same stale composer flow as the seeding loop above, same fix */
    await saveAnInspiration(page, `on purpose ${uniq()}`);
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
