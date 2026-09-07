/**
 * THE TIMELINE HANGS FROM ITS WORD, AND HOLDS STILL UNDER THE HAND.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *
 * The dial has produced three separate reports from the founder and, until
 * this file, zero gates. Nothing in `tools/e2e` had ever dragged it:
 *
 *   2026-08-27  "line is not only hard to drag, but moves around"
 *   2026-08-27  "should align with the text NOW"
 *   2026-08-28  "why is timeline not right under the word 'now'"
 *
 * The first two were fixed by freezing the rail's anchor while the dial was
 * `--open` or `--live`. The third was CAUSED by that fix, and the two pull
 * against each other, which is exactly why they need holding together in one
 * file: a repair to either one alone re-breaks the other.
 *
 * ── THE TWO RULES, WHICH ARE IN TENSION ────────────────────────────────────
 *
 * The rail's left is set from the word's centre. The word is the READING —
 * "now" at rest, "Aug 27" after a scrub — so the word changes width, and the
 * rail is chasing a moving anchor.
 *
 *   HOLD STILL WHILE HELD.  A rail that re-centres mid-drag moves under the
 *                           hand that is dragging it. Unusable.
 *   HANG UNDER THE WORD.    Once let go, the line belongs under the reading
 *                           it now shows, or it is pointing at nothing.
 *
 * Freezing on `--open` satisfied the first and broke the second, because
 * after a drag THE POINTER IS STILL OVER THE RAIL — that is where a hand
 * necessarily is — so `--open` stayed true and the anchor stayed frozen
 * against a word that had already changed. Measured on a 1440px wall: the
 * word went from NOW (w49, centre 125) to AUG 27 (w65, centre 133) while the
 * rail stayed at 125. Eight pixels, permanently.
 *
 * `--live` is the honest condition: held, not merely hovered. Hovering never
 * moves the word — only releasing does.
 *
 * ── AND THE SECOND HALF OF THE SAME BUG ────────────────────────────────────
 *
 * Fixing the condition alone still left it 8px out, because the anchor lived
 * inside `measure()` and `measure()` runs on a RESIZE. The word changes
 * without the window changing, so nothing recomputed. It is `hangRail()` now,
 * with a second caller: an effect on the reading. `onDialUp` cannot be that
 * caller — it runs before React commits the new word, so it would measure the
 * word the scrub replaced.
 */
import type { Page } from "playwright";

import { launchChromium } from "./browser";
import { settleAfterArrival } from "./arrival";

const DEFAULT_BASE = "http://127.0.0.1:3010";

/** A centre within this of the word's is under it, as far as an eye is concerned. */
const ALIGNED = 2;

const BOXES = `(() => {
  const pick = (s) => {
    const e = document.querySelector(s);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { l: Math.round(r.left), w: Math.round(r.width), c: Math.round(r.left + r.width / 2), t: Math.round(r.top), b: Math.round(r.bottom) };
  };
  const dial = document.querySelector(".jar-dial");
  return JSON.stringify({
    when: pick(".jar-when"),
    track: pick(".jar-dial-track"),
    word: (document.querySelector(".jar-when") || {}).innerText || "",
    cls: dial ? dial.className : "",
  });
})()`;

interface Shot {
  when: { l: number; w: number; c: number; t: number; b: number } | null;
  track: { l: number; w: number; c: number; t: number; b: number } | null;
  word: string;
  cls: string;
}

const read = async (page: Page): Promise<Shot> =>
  JSON.parse((await page.evaluate(BOXES)) as string) as Shot;

const off = (s: Shot): number | null =>
  s.when && s.track ? s.track.c - s.when.c : null;

const run = async (base: string): Promise<number> => {
  const browser = await launchChromium();
  const bad: string[] = [];
  const said: string[] = [];

  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2_000);
    await page.click("#login-tab-signup");
    await page.waitForTimeout(800);
    await page.fill("input[name=email]", `dial-${Date.now()}@example.test`);
    await page.fill("input[name=password]", "the-timeline-gate-1");
    await page.fill("input[name=name]", "Dial");
    await page.click("button[type=submit]");
    await page.waitForTimeout(9_000);
    for (const t of ["a memory to wind back to", "and a second one"]) {
      await page.locator(".jar-mouth-rest").first().click();
      await page.waitForTimeout(450);
      await page.fill('textarea[aria-label="Capture inspiration"]', t);
      await page.locator(".jar-mouth-where button", { hasText: /^save$/ }).first().click();
      await page.waitForTimeout(2_800);
    }
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await settleAfterArrival(page);
    await page.waitForTimeout(2_000);

    /* ── at rest ── */
    const rest = await read(page);
    const restOff = off(rest);
    if (restOff === null) {
      bad.push("at rest: no word or no rail on screen at all");
    } else {
      said.push(`at rest the word reads ${JSON.stringify(rest.word)} at centre ${rest.when!.c}, the line at ${rest.track!.c}`);
      if (Math.abs(restOff) > ALIGNED)
        bad.push(`at rest the line sits ${restOff}px off the word's centre`);
    }

    /* ── reached for ──
       PRESSED, NOT HOVERED, AND THAT DISTINCTION IS THE WHOLE GATE.
       `--open` is `timeOpen || timeNear || scrubbing`, and `timeNear` is the
       pointer on THE WORD — not on the rail. So a walk that hovers the word,
       moves down to the handle (leaving the word), drags and lets go ends with
       `--open` false, and cannot see a bug that only exists while it is true.
       The first version of this file did exactly that and passed its own
       sabotage.

       A person who wants to scrub PRESSES the word: `timeOpen` latches, the
       rail stays up after the hand lets go, and `--open` is still true with a
       word that has just changed width underneath it. That is the founder's
       screenshot, and it is the only flow in which the rail is still on screen
       to be looked at afterwards. */
    await page.locator(".jar-when").first().click();
    await page.waitForTimeout(900);
    const hover = await read(page);
    const hoverOff = off(hover);
    if (hoverOff !== null && Math.abs(hoverOff) > ALIGNED)
      bad.push(`reached for, the line sits ${hoverOff}px off the word's centre`);

    /* ── held: it must NOT move under the hand ── */
    const handle = await page.locator(".jar-dial-handle").first().boundingBox();
    if (!handle) {
      bad.push("the rail has no handle to take hold of");
    } else {
      const before = (await read(page)).track;
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(handle.x + handle.width / 2, handle.y + 150, { steps: 12 });
      await page.waitForTimeout(500);
      const held = await read(page);
      if (before && held.track && held.track.l !== before.l)
        bad.push(
          `the line moved ${held.track.l - before.l}px sideways WHILE BEING DRAGGED — ` +
            `it wanders under the hand holding it`,
        );
      said.push(`held, the line stayed at ${held.track ? held.track.l : "?"}`);

      /* ── let go: the word changes, and the line must follow it ── */
      await page.mouse.up();
      await page.waitForTimeout(1_200);
      const done = await read(page);
      const doneOff = off(done);
      /* the state has to be the one the bug lives in, or a pass is an accident */
      if (!done.cls.includes("jar-dial--open"))
        bad.push(
          `after letting go the rail is not open (class ${JSON.stringify(done.cls)}) — ` +
            `this walk is not in the state the founder reported and proves nothing`,
        );
      said.push(
        `let go, the word reads ${JSON.stringify(done.word)} at centre ${done.when ? done.when.c : "?"}, ` +
          `the line at ${done.track ? done.track.c : "?"}`,
      );
      if (doneOff === null) bad.push("after the scrub there is no word or no rail to compare");
      else if (Math.abs(doneOff) > ALIGNED)
        bad.push(
          `after a scrub the line sits ${doneOff}px off the word's centre — the reading moved ` +
            `(${JSON.stringify(rest.word)} -> ${JSON.stringify(done.word)}) and the line did not follow it`,
        );
      /* the reading has to have actually changed, or this proves nothing */
      if (done.word.trim().toUpperCase() === rest.word.trim().toUpperCase())
        bad.push(
          `the scrub did not change the reading (still ${JSON.stringify(done.word)}) — ` +
            `this gate measured nothing and must not be read as a pass`,
        );
    }

    await ctx.close();
  } finally {
    await browser?.close();
  }

  console.log("");
  for (const s of said) console.log(`  ${s}`);
  console.log("");
  if (bad.length === 0) {
    console.log("[timeline] the line hangs under its word at rest, reached for, and after a");
    console.log("           scrub has rewritten the word — and it holds still while held.");
    return 0;
  }
  console.log(`[timeline] ${bad.length} finding(s):\n`);
  for (const b of bad) console.log(`  ${b}`);
  console.log("");
  return 1;
};

const args = process.argv.slice(2);
const at = args.indexOf("--base-url");
process.exit(await run(at >= 0 ? args[at + 1]! : DEFAULT_BASE));
