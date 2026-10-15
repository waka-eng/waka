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
 *
 * ── AND THE SECOND HALF OF THE SAME REPORT, WHICH THE FIRST FIX MISSED ─────
 *
 * The founder again, 2026-08-30, over another recording: *"i think i already
 * asked u to fix this, but dont make the text be there and reload when
 * character goes to the room. keep it rendered and dont rerender when
 * character arrives"*.
 *
 * They were right that they had asked. The first fix answered WHICH WORDS
 * ANIMATE on a return; this is about whether the block is THERE AT ALL while
 * you travel. A room's chrome was gated on the room having been WOKEN — a
 * state set when the character finishes arriving — so the room's column was
 * empty for the whole journey and its words appeared at the moment of arrival.
 * Every word new, every time, however much was already in hand.
 *
 * A room's words are ready when its jar has been fetched, which happens the
 * moment travel toward it begins. So the second phase of this walk starts a
 * journey to a room and watches two events race: when the room's column first
 * says anything, and when the character gets there. The words must win.
 */
import type { Page } from "playwright";

import { launchChromium } from "./browser";
import { settleAfterArrival } from "./arrival";
import { saveAnInspiration } from "./keep";

const DEFAULT_BASE = "http://127.0.0.1:3010";

const WORDS = `(() => {
  const all = document.querySelectorAll(".jar-word");
  let held = 0;
  for (let i = 0; i < all.length; i++) if (all[i].classList.contains("jar-word--held")) held += 1;
  const h1 = document.querySelector(".jar-poster");
  /* WHICH WALL YOU ARE STANDING ON. This read \`.jar-here\`, the chip in the
     top bar, which has no renderer — the wall picker moved and the chip
     returns null. The creature's own form switch carries it now: the
     standing face is the wall you are on, which is what \`journeys.ts\` reads
     for the same question. */
  const face = document.querySelector(".jar-char-face--standing");
  return JSON.stringify({
    total: all.length,
    held: held,
    text: h1 ? h1.innerText.replace(/\\s+/g, " ").trim() : "",
    wall: face ? face.innerText.replace(/\\s+/g, " ").trim() : "",
  });
})()`;

/* ═══ THE ROOM-COLUMN PROBE IS GONE WITH PHASE 2 ═══════════════════════
   It looked for a `.jar-wallcol` whose `data-kind` was `group`. `SpaceKind`
   is `"self" | "agent"` now — there is no `group` — so the probe matched
   nothing and reported `says: false` forever. See the tombstone where phase
   two stood. */

interface Reading {
  total: number;
  held: number;
  text: string;
  wall: string;
}

const read = async (page: Page): Promise<Reading> =>
  JSON.parse((await page.evaluate(WORDS)) as string) as Reading;

/**
 * Walk to the wall whose face carries this name.
 *
 * ═══ THE WALLS LIST WAS THE DOOR, AND IT WENT WITH ROOMS ═════════════════
 * This opened `.jar-here-more` and pressed a row in `.jar-hq`. Both the
 * caret and the list went in `405ee4aa`; `.jar-here-more` has no renderer (`.jar-hq` DOES render, at `Home.tsx:6958`, and `reading-support` depends on it -- corrected 2026-10-15; the conclusion stands on `.jar-here-more` alone), so
 * the first line threw and this walk could not travel anywhere at all.
 *
 * TRAVEL ITSELF DID NOT GO. `Home.tsx` on the agent wall: "rather than my
 * agent like moving rooms it kind of like switching itself up to its agent
 * form" — the creature's face IS the wall switch now, and `journeys.ts`
 * uses exactly this locator to stand on an agent's ground.
 */
const travelTo = async (page: Page, where: "away" | "home"): Promise<boolean> => {
  /* BY STANDING-NESS, NOT BY NAME. The agent's face carries its DISPLAY
     name, which is not the name it was created with — making an agent
     called "Scout" produces a face reading "MY AGENT" (measured
     2026-10-15), so a walk that travelled by name never found it and
     reported "the second wall was never made" about a wall that was there.
     There are exactly two faces and one of them is lit, which is the whole
     question this walk asks of them. */
  const want =
    where === "away"
      ? page.locator(".jar-char-face:not(.jar-char-face--standing)").first()
      : page.locator(".jar-char-face", { hasText: /^me$/i }).first();
  if ((await want.count()) === 0) return false;
  await want.click({ timeout: 8_000 });
  await page.waitForTimeout(6_000);
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
      await saveAnInspiration(page, t);
      await page.waitForTimeout(3_000);
    }
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await settleAfterArrival(page);
    await page.waitForTimeout(3_000);

    const first = await read(page);
    said.push(`first arrival: ${first.total - first.held} of ${first.total} words arrived, which is right`);
    /* ═══ NO POSTER IS NOT A PRODUCT FAULT, AND SAYING IT WAS IS THE BUG ═══
       This pushed "your own wall has no poster at all" into `bad`, which
       fails the run. The poster is the generated reading: it exists once
       the synthesis pipeline has written a sentence for this account, and
       on a stack with no generation running a fresh account simply does not
       have one yet. Reporting that as a finding is this gate claiming the
       wall is broken when what happened is that it had nothing to say yet —
       the same class of false claim this whole sweep is removing.

       It is a SKIP, loudly: the walk below has nothing to count, so it
       stops here and says so rather than measuring zero against zero and
       calling it a pass. */
    if (first.total === 0) {
      console.log("");
      console.log("  NOT MEASURED — this account has no poster yet. The held-words readout is");
      console.log("  about a generated sentence, so this gate needs one on the wall before it");
      console.log("  can ask whether returning to the wall re-reads it. Nothing here is a");
      console.log("  statement about the product.");
      console.log("");
      await ctx.close();
      return 0;
    }

    /* A FRESH ACCOUNT HAS ONE WALL, so there is nothing to travel to and a
       second one is made here.

       ═══ THE MAKE-A-PLACE DIALOG IS GONE; AGENTS ARE MADE IN SETTINGS ════
       This walked `.jar-here-more` → `add new` → the `an agent` row of
       `.jar-newplace-row` → `.jar-roomform-box` → `give it a wall`. Every
       one of those five went with rooms in `405ee4aa`. The CAPABILITY did
       not: `SettingsPanel.tsx` calls `createProfile` from its `Memories`
       group, which is the only door to it left, and `journeys.ts` makes its
       agent exactly this way. */
    await page.locator("button.waka-corner--settings").click({ timeout: 10_000 });
    await page.waitForTimeout(1_200);
    const group = page.locator(".waka-settings-row", { hasText: /memories/i }).first();
    if ((await group.count()) === 0) {
      bad.push("the account card has no Memories group, so no second wall could be made");
    } else {
      await group.click({ timeout: 8_000 });
      await page.waitForTimeout(800);
      await page.fill(".waka-settings-add input[type=text]", "Scout");
      await page.locator(".waka-settings-add button").first().click({ timeout: 8_000 });
      await page.waitForTimeout(6_000);
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await settleAfterArrival(page);
    await page.waitForTimeout(3_000);

    if (!(await travelTo(page, "away"))) {
      bad.push("the second wall was never made, so there was nowhere to travel to");
    } else {
      const away = await read(page);
      said.push(`away on ${JSON.stringify(away.wall)}`);
      if (!(await travelTo(page, "home"))) {
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

    /* ═══════════════════════════════════════════════════════════════════
       PHASE TWO IS DELETED — "a ROOM's words, while you are still walking"
       ═══════════════════════════════════════════════════════════════════

       It made a room, walked back to your own wall, then started a journey
       to the room and raced two events: when the room's column first said
       anything, against when the character arrived. The words had to win.

       IT WAS ABOUT ROOMS SPECIFICALLY, AND ITS OWN COMMENT SAID SO: "An
       agent's wall was enough for the question above; this one is about
       rooms specifically, because it was a room's chrome that waited on
       arrival." That is a precise statement of why it cannot be repointed
       at an agent wall — the defect it guards was in the branch of the
       chrome that gated a room's column on the room having been WOKEN, and
       that branch is deleted along with everything else room-shaped.

       IT COULD NOT HAVE RUN ANYWAY, THREE TIMES OVER: the maker
       (`.jar-newplace-row`, `.jar-roomform`), the door (`.jar-here-more`),
       and the probe itself, which looked for a `.jar-wallcol` with
       `data-kind="group"` when `SpaceKind` is `"self" | "agent"`.

       WHAT COVERAGE WENT: nothing watches the race between a wall's words
       and the character's arrival. Phase one above still holds the other
       half of the same founder report — that a wall you RETURN to does not
       re-read itself — and it holds it over an agent wall, which is the
       only kind of travel left. If walls that must be fetched on the way
       ever come back, this race comes back with them. */

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
