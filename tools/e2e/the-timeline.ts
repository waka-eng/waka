/**
 * THE TIMELINE IS A LIST OF DATES, AND EVERY ONE OF THEM ANSWERS.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *
 * The dial has produced four separate reports from the founder. The first
 * three were about one gesture:
 *
 *   2026-08-27  "line is not only hard to drag, but moves around"
 *   2026-08-27  "should align with the text NOW"
 *   2026-08-28  "why is timeline not right under the word 'now'"
 *
 * Each was answered where it stood — freeze the anchor while held, then
 * unfreeze it on release, then move the anchor out of `measure()` so it
 * recomputes when the WORD changes rather than when the window does. Three
 * fixes, in tension with each other, holding up a control nobody could hit.
 *
 *   2026-08-30  "instead of this draggable line, when clicking on now, just
 *                show the major dates to make them clickable"
 *
 * That is the fourth, and it removes the gesture rather than the symptoms. A
 * wall does not change continuously — it changes on the days something was
 * kept — so the days ARE the instrument, and the rail's whole length was one
 * answer offered at a thousand heights.
 *
 * ── WHAT THIS WALK HOLDS ───────────────────────────────────────────────────
 *
 *   1. NOTHING STANDS OVER THE WORLD AT REST. `.jar-dial-track` was a 44px
 *      strip running nearly half the height of the screen, with no ink in it,
 *      mounted at all times and live to every press. It swallowed presses
 *      meant for the walls list behind it — measured at x 110..140, y 50..420
 *      on 2026-08-30, and it took two attempts to reach ADD NEW through it.
 *      So this walk reaches for that control the way a person would, once.
 *
 *   2. THE DATES HANG UNDER THE WORD. The surviving half of the first three
 *      reports: the word sits after the wall chip, so its place depends on
 *      the wall's NAME and no stylesheet constant can be under it. The list
 *      takes the word's own left edge — an edge, not a centre, so it cannot
 *      drift when the widest date changes.
 *
 *   3. PRESSING A DATE WINDS THE WALL TO IT. The claim the eye cannot check:
 *      an instrument that opened, listed real dates and quietly kept showing
 *      today would look completely correct in a screenshot.
 *
 *   4. AND THE WAY BACK IS IN THE LIST. The rail had none — returning to the
 *      present meant landing a drag within half a day of the top of a line
 *      you could not see.
 *
 * ── WHY IT SEEDS THE DATABASE ──────────────────────────────────────────────
 *
 * The instrument exists only where there is history: a wall whose whole life
 * is today offers nothing to wind back to, so the world does not render a
 * word at all. A walk that signs up and saves two things has exactly that
 * wall, and would measure the absence rather than the control. There is no
 * way through the product to keep something LAST MONTH — deliberately — so
 * the dates are backdated in one statement, the same seam `at-scale` uses and
 * for the same reason.
 */
import type { Page } from "playwright";
import postgres from "postgres";

import { launchChromium } from "./browser";
import { settleAfterArrival } from "./arrival";
import { saveAnInspiration } from "./keep";

const DEFAULT_BASE = "http://127.0.0.1:3010";

/** A left edge within this of the word's is under it, as far as an eye is concerned. */
const ALIGNED = 2;
/** How far below the word the sheet may stand — the anchored sheets' own air. */
const BELOW_MAX = 24;
/** How many days back the seeded memories are pushed, oldest first. */
const BACK_DAYS = [61, 33, 12];

const BOXES = `(() => {
  const pick = (s) => {
    const e = document.querySelector(s);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { l: Math.round(r.left), w: Math.round(r.width), t: Math.round(r.top), b: Math.round(r.bottom) };
  };
  /* textContent, NOT innerText. The label register uppercases these in CSS,
     and innerText reports what is PAINTED — so a gate reading it compares the
     product's typography against the test's spelling and fails on "NOW" vs
     "now". The words are the claim; the case is a rendering decision made one
     rule away, and the label register has its own gate.
     (No backticks inside this string: it is a template literal, and one in a
     comment ends it mid-sentence. That has cost this project three gates.) */
  return JSON.stringify({
    when: pick(".jar-when"),
    sheet: pick(".jar-dial"),
    word: ((document.querySelector(".jar-when") || {}).textContent || "").trim(),
    rows: [...document.querySelectorAll(".jar-dial-stop")].map((b) => (b.textContent || "").trim()),
    lit: ((document.querySelector(".jar-dial-stop--here") || {}).textContent || "").trim(),
  });
})()`;

interface Box { l: number; w: number; t: number; b: number }
interface Shot {
  when: Box | null;
  sheet: Box | null;
  word: string;
  rows: string[];
  lit: string;
}

const read = async (page: Page): Promise<Shot> =>
  JSON.parse((await page.evaluate(BOXES)) as string) as Shot;

function connectionUrl(): string {
  const url = process.env.DB_CONNECTION_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "[the-timeline] DB_CONNECTION_URL is not set. This walk backdates the\n" +
        "               memories it keeps — the instrument does not exist on a\n" +
        "               wall whose whole life is today — so it needs the same\n" +
        "               connection string the API uses:\n\n" +
        "                 export $(grep DB_CONNECTION_URL .env.local | xargs)\n",
    );
    process.exit(2);
  }
  return url;
}

const run = async (base: string): Promise<number> => {
  const browser = await launchChromium();
  const bad: string[] = [];
  const said: string[] = [];
  const sql = postgres(connectionUrl(), { max: 2 });

  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const email = `dial-${Date.now()}@example.test`;
    await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2_000);
    await page.click("#login-tab-signup");
    await page.waitForTimeout(800);
    await page.fill("input[name=email]", email);
    await page.fill("input[name=password]", "the-timeline-gate-1");
    await page.fill("input[name=name]", "Dial");
    await page.click("button[type=submit]");
    await page.waitForTimeout(9_000);

    const kept = [
      "a memory to wind back to",
      "and a second one, a month later",
      "and a third, nearer the present",
    ];
    for (const t of kept) {
      await saveAnInspiration(page, t);
      await page.waitForTimeout(2_800);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }

    /* THE HISTORY, WRITTEN THE ONLY WAY IT CAN BE. Each memory is pushed back
       a different number of days, so the wall has three distinct days on it
       and no two rows in the list can be confused. */
    for (let i = 0; i < kept.length; i += 1) {
      await sql`
        update inspirations
        set created_at = now() - (${BACK_DAYS[i]!} || ' days')::interval
        where text = ${kept[i]!}
      `;
    }

    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await settleAfterArrival(page);
    await page.waitForTimeout(2_500);

    /* ── 1. at rest: the word alone, and nothing standing over the world ── */
    const rest = await read(page);
    if (!rest.when) {
      bad.push("at rest there is no word to press — the wall has history and offers no way into it");
      /* ═══ AND THE WALK STOPS HERE RATHER THAN PRESSING IT ANYWAY ════════
         Every step below opens the dial by clicking `.jar-when`. Having
         just reported that the word is not on screen, clicking it spent 30
         seconds timing out and then printed "the walk threw: locator.click:
         Timeout 30000ms exceeded" — a harness error stapled to a correct
         finding, which makes a real result look like broken infrastructure.
         One finding, reported once.

         WHY THE WORD IS ABSENT, because it is worth knowing before anyone
         "fixes" this gate: `Home.tsx:9833` renders it only when
         `parkedAt !== null` — once you have ALREADY wound away from now.
         That condition was narrowed by the rooms removal; its comment says
         the other half "was A ROOM" and goes with them. All three
         `setTimeOpen(true)` calls live inside that same button, so at rest
         there is no way into the dial at all. This walk is reporting that
         accurately and it is a product finding, not a harness one. */
      console.log("");
      for (const b of bad) console.log(`  ✗ ${b}`);
      console.log("");
      console.log("[the-timeline] FAIL — the dial cannot be opened at rest, so nothing below it");
      console.log("               was measured. See `Home.tsx:9833`.");
      await ctx.close();
      return 1;
    } else {
      said.push(`at rest the word reads ${JSON.stringify(rest.word)}`);
    }
    if (rest.sheet) bad.push("the dates are on screen before anybody asked for them");
    if (rest.rows.length > 0)
      bad.push(`${rest.rows.length} date rows are standing at rest`);

    /* THE STRIP'S OWN GROUND, ASKED DIRECTLY. `.jar-dial-track` stood here.
       Anything interactive at this point, with the instrument closed, is the
       same defect back. */
    const under = (await page.evaluate(`(() => {
      const e = document.elementFromPoint(125, 240);
      return e ? String(e.className || e.tagName) : "(nothing)";
    })()`)) as string;
    said.push(`where the rail used to stand, a press now lands on ${JSON.stringify(under)}`);
    if (/jar-dial/.test(under))
      bad.push(`the dial still owns the point the rail stood at — a press there hits ${under}`);

    /* ═══ STEP 2 IS GONE: IT PRESSED THROUGH TO THE WALLS LIST ════════════
       It opened `.jar-here-more` and reached for ADD NEW, because the
       swallowed press this whole file is named for was measured against
       exactly that control: "it swallowed presses meant for the walls list
       behind it ... it took two attempts to reach ADD NEW through it".

       The walls list went with rooms (`405ee4aa`), and ADD NEW with it —
       room creation was already gone before that. `.jar-here-more` has no
       renderer, so `.first().click()` threw after the default timeout and
       took the whole walk down before steps 3, 4 and 5 ever ran. Unlike the
       guarded version in `nothing-invisible-takes-a-press.ts`, this one was
       unguarded: one dead class was costing this file every other claim it
       makes about the dial.

       THE CLAIM IT CARRIED IS NOT LOST — EXCEPT THAT IT IS, TODAY.
       CORRECTED 2026-10-15. Step 1 above IS the same question asked better:
       it reads `elementFromPoint` at the exact coordinates the strip
       occupied and fails if anything of the dial's owns that point. But it
       SITS BELOW THE EARLY RETURN at the top of this walk, and that return
       fires on every run: `.jar-when` renders only when `parkedAt !== null`
       (see the note above), `rest.word` is therefore always absent, the walk
       pushes that finding and returns before reaching the probe. So claim #1
       is currently measured ZERO times per run. The successor is real and
       correct; it is just unreachable until the dial's door opens from
       outside, which is product finding #1 in this change. Step 2 only ever
       confirmed the consequence of what step 1 measures directly, and it
       needed a specific control behind the strip to do it. Picking a
       different control that happens to sit near those coordinates would be
       choosing a target to keep a step alive.

       WHAT COVERAGE WENT: nothing now proves a press at the strip's old
       position REACHES whatever is behind it — only that nothing of the
       dial's is on top. The difference matters if some third thing ever
       covers that region, and `nothing-invisible-takes-a-press.ts` is the
       file that would catch it, over every stacked box rather than one. */

    /* ── 3. pressing the word ── */
    await page.locator(".jar-when").first().click();
    await page.waitForTimeout(700);
    const open = await read(page);
    if (!open.sheet || open.rows.length === 0) {
      bad.push("pressing the word opened nothing");
    } else {
      const edge = open.sheet.l - open.when!.l;
      const below = open.sheet.t - open.when!.b;
      said.push(
        `pressed, ${open.rows.length} rows: ${JSON.stringify(open.rows)} — ` +
          `${edge}px off the word's left edge, ${below}px below it`,
      );
      if (Math.abs(edge) > ALIGNED)
        bad.push(`the dates sit ${edge}px off the word's left edge — they hang from nothing`);
      if (below <= 0 || below > BELOW_MAX)
        bad.push(`the dates sit ${below}px below the word, outside the air the other sheets keep`);
      if (open.rows[0] !== "now")
        bad.push(`the first row is ${JSON.stringify(open.rows[0])} rather than the way back to now`);
      if (open.lit !== "now")
        bad.push(`standing at now, the lit row is ${JSON.stringify(open.lit)}`);
      /* three days were seeded and none of them is today */
      if (open.rows.length !== BACK_DAYS.length + 1)
        bad.push(
          `${open.rows.length - 1} dates offered for ${BACK_DAYS.length} days of history — ` +
            "the list is marking the calendar rather than the archive",
        );
    }

    /* ── 4. pressing a date winds the wall to it ── */
    if (open.rows.length > 1) {
      const target = open.rows[1]!;
      await page.locator(".jar-dial-stop", { hasText: new RegExp(`^${target}$`) }).first().click();
      await page.waitForTimeout(1_800);
      const wound = await read(page);
      said.push(`pressed ${JSON.stringify(target)} — the word now reads ${JSON.stringify(wound.word)}`);
      if (wound.word !== target)
        bad.push(
          `pressing ${JSON.stringify(target)} left the word reading ` +
            `${JSON.stringify(wound.word)} — the press did not reach the wall`,
        );
      if (wound.rows.length > 0)
        bad.push("the dates are still standing after one of them was answered");

      /* the anchor after the word has changed width — the 2026-08-28 report */
      await page.locator(".jar-when").first().click();
      await page.waitForTimeout(700);
      const again = await read(page);
      if (again.sheet && again.when) {
        const edge = again.sheet.l - again.when.l;
        said.push(`re-opened under a longer word, ${edge}px off its left edge`);
        if (Math.abs(edge) > ALIGNED)
          bad.push(
            `wound back, the dates sit ${edge}px off the word — the anchor did not follow ` +
              "the reading (founder, 2026-08-28: \"why is timeline not right under the word 'now'\")",
          );
        if (again.lit !== target)
          bad.push(`wound to ${JSON.stringify(target)}, the lit row is ${JSON.stringify(again.lit)}`);
      }

      /* ── 5. and the way back ── */
      await page.locator(".jar-dial-stop", { hasText: /^now$/ }).first().click();
      await page.waitForTimeout(1_500);
      const back = await read(page);
      said.push(`pressed now — the word reads ${JSON.stringify(back.word)}`);
      if (back.word !== "now")
        bad.push(`the way back left the word reading ${JSON.stringify(back.word)}`);
    }
  } catch (err) {
    bad.push(`the walk threw: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
    await browser.close();
  }

  console.log("\n[the-timeline] what the walk saw");
  for (const s of said) console.log(`  · ${s}`);
  if (bad.length === 0) {
    console.log("\n[the-timeline] PASS — the dates hang from the word, answer a press, and put themselves away\n");
    return 0;
  }
  console.log("");
  for (const b of bad) console.log(`  ✗ ${b}`);
  console.log(`\n[the-timeline] FAIL — ${bad.length} problem(s)\n`);
  return 1;
};

const args = process.argv.slice(2);
const at = args.indexOf("--base-url");
run(at >= 0 ? args[at + 1]! : DEFAULT_BASE).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
