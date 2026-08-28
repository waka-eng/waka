/**
 * COMING BACK TO A WALL IS NOT A RE-READING OF IT.
 *
 * ── THE REPORT ─────────────────────────────────────────────────────────────
 *
 * The founder, 2026-08-28, over a screen recording of travelling between
 * walls: *"dont make the text keep reloding evertime i go to the wall. if new
 * content, then have it ready before i get there"*.
 *
 * ── WHAT WAS ACTUALLY WRONG, WHICH IS NOT WHAT IT LOOKED LIKE ──────────────
 *
 * Nothing was being re-fetched. A room's jar is already prefetched the moment
 * travel toward it begins, so arrival usually finds it ready. What re-ran was
 * the POSTER'S ARRIVAL ANIMATION, and it re-ran because it was being asked the
 * wrong question.
 *
 * The poster distinguishes words that are NEW from words that carried over: a
 * carried word is already lit and still (`.jar-word--held`), a new one animates
 * in. That is the drift readout — the spine of an identity is the text that
 * does not move — and it is worth keeping exactly as it is.
 *
 * It compared against `prev.text`: whatever sentence had been ON SCREEN a
 * moment earlier. On a travel that is A DIFFERENT WALL'S sentence. So walking
 * from your own wall to a room matched almost nothing and every word arrived;
 * walking back matched almost nothing again and your own wall re-assembled
 * itself in front of you, every time, forever.
 *
 * Worse than noisy: meaningless in both directions. A word that two unrelated
 * ambitions happened to share would have read as "carried" — a claim about
 * drift that nothing supports.
 *
 * It is keyed by wall now, so the question is the one the readout was built to
 * answer: what is new since THIS wall last spoke.
 *
 * ── WHAT THIS MEASURES ─────────────────────────────────────────────────────
 *
 * Sign up, keep enough for a sentence to form, make a second wall, travel to
 * it, travel back — and count how many of the words on the wall you RETURNED
 * to are already lit. All of them means the wall simply is what it was.
 *
 * The first arrival is deliberately NOT held to that rule: the first time you
 * see a sentence it should arrive. A gate that demanded stillness there would
 * be arguing for a poster that never animates at all.
 */
import type { Page } from "playwright";

import { launchChromium } from "./browser";
import { settleAfterArrival } from "./arrival";

const DEFAULT_BASE = "http://127.0.0.1:3010";

const WORDS = `(() => {
  const all = document.querySelectorAll(".jar-word");
  let held = 0;
  for (let i = 0; i < all.length; i++) if (all[i].classList.contains("jar-word--held")) held += 1;
  const h1 = document.querySelector(".jar-poster");
  const chip = document.querySelector(".jar-here");
  return JSON.stringify({
    total: all.length,
    held: held,
    text: h1 ? h1.innerText.replace(/\\s+/g, " ").trim() : "",
    wall: chip ? chip.innerText.replace(/\\s+/g, " ").trim() : "",
  });
})()`;

interface Reading {
  total: number;
  held: number;
  text: string;
  wall: string;
}

const read = async (page: Page): Promise<Reading> =>
  JSON.parse((await page.evaluate(WORDS)) as string) as Reading;

/** Walk to the wall whose row in the list carries this name. */
const travelTo = async (page: Page, name: RegExp): Promise<boolean> => {
  await page.locator(".jar-here-more").first().click();
  await page.waitForTimeout(900);
  /* the list holds the chip and its caret as well as the walls, so the row is
     found by its NAME rather than by an index — an index here silently clicked
     the caret and the walk "travelled" without going anywhere */
  const row = page.locator(".jar-hq button", { hasText: name });
  const n = await row.count();
  if (n === 0) {
    await page.keyboard.press("Escape");
    return false;
  }
  await row.last().click();
  await page.waitForTimeout(5_000);
  return true;
};

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
    await page.fill("input[name=email]", `back-${Date.now()}@example.test`);
    await page.fill("input[name=password]", "coming-back-gate-1");
    await page.fill("input[name=name]", "Back");
    await page.click("button[type=submit]");
    await page.waitForTimeout(9_000);
    for (const t of [
      "a memory about the sea",
      "a memory about a long walk",
      "a memory about arriving early",
    ]) {
      await page.locator(".jar-mouth-rest").first().click();
      await page.waitForTimeout(450);
      await page.fill('textarea[aria-label="capture inspiration"]', t);
      await page.locator(".jar-mouth-where button", { hasText: /^save$/ }).first().click();
      await page.waitForTimeout(3_000);
    }
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await settleAfterArrival(page);
    await page.waitForTimeout(3_000);

    const first = await read(page);
    said.push(`first arrival: ${first.total - first.held} of ${first.total} words arrived, which is right`);
    if (first.total === 0) {
      bad.push("your own wall has no poster at all — nothing here was measured");
    }

    /* a fresh account has ONE wall, so there is nothing to travel to */
    await page.locator(".jar-here-more").first().click();
    await page.waitForTimeout(800);
    await page.getByText(/^add new$/i).first().click();
    await page.waitForTimeout(1_200);
    await page.locator(".jar-newplace-row", { hasText: /an agent/i }).first().click();
    await page.waitForTimeout(1_200);
    await page.fill(".jar-roomform-box", "Scout");
    await page.getByText(/^give it a wall$/i).first().click();
    await page.waitForTimeout(6_000);

    if (!(await travelTo(page, /^scout$/i))) {
      bad.push("the second wall was never made, so there was nowhere to travel to");
    } else {
      const away = await read(page);
      said.push(`away on ${JSON.stringify(away.wall)}`);
      if (!(await travelTo(page, /^me$/i))) {
        bad.push("could not get back to your own wall");
      } else {
        const back = await read(page);
        said.push(
          `back on ${JSON.stringify(back.wall)}: ${back.held} of ${back.total} words already lit`,
        );
        if (back.total === 0) {
          bad.push("coming back, the wall has no poster at all");
        } else if (back.held < back.total) {
          bad.push(
            `coming back to a wall you have already read, ${back.total - back.held} of its ` +
              `${back.total} words arrived again — the wall re-reads itself every time you ` +
              `walk to it`,
          );
        }
        if (back.text !== first.text)
          said.push("(the sentence itself changed while away, so some arrival is legitimate)");
      }
    }

    await ctx.close();
  } finally {
    await browser?.close();
  }

  console.log("");
  for (const s of said) console.log(`  ${s}`);
  console.log("");
  if (bad.length === 0) {
    console.log("[coming-back] a wall you return to is already saying what it said — its words");
    console.log("              are lit and still, and only a first reading arrives.");
    return 0;
  }
  console.log(`[coming-back] ${bad.length} finding(s):\n`);
  for (const b of bad) console.log(`  ${b}`);
  console.log("");
  return 1;
};

const args = process.argv.slice(2);
const at = args.indexOf("--base-url");
process.exit(await run(at >= 0 ? args[at + 1]! : DEFAULT_BASE));
