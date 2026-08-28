#!/usr/bin/env tsx
/**
 * LIGHTING A ROOM — the walk that grades `docs/goals/lighting-a-room.md`.
 *
 * ── WHY A BROWSER, WHEN `rooms.ts` ALREADY DRIVES THE SAME ENDPOINTS ───────
 *
 * `rooms.ts` proves the API: who may join, who may remove, which key stops
 * working. Every claim in it survives a surface that never tells anybody
 * anything. This goal's claims are the opposite kind — they are ALL about
 * what a person is told and where they are standing when they are told it —
 * and there is no way to ask an endpoint whether the traveller was taken
 * anywhere. So this one runs in a browser, and each phase of the goal appends
 * its own steps here.
 *
 * ── PHASE 1: THE MAKER LANDS IN WHAT THEY MADE ─────────────────────────────
 *
 * Three claims, and the third is the one with teeth:
 *
 *   1. The make form says what a room DOES — one sentence, before you have
 *      one. A room's silence is designed (it reads its members' public keeps
 *      and says only what more than one person stands under), so a room of
 *      one is correctly dark, and somebody who has just typed a name has no
 *      way to know that.
 *
 *   2. Making it TAKES YOU THERE. No further tap. The one act in the world
 *      that creates a place used to leave you standing exactly where you
 *      were.
 *
 *   3. The invite is what greets you. A room of one is waiting for exactly
 *      one thing, and it should be offered where you land rather than filed
 *      behind the wall's name.
 *
 * ── HOW ARRIVAL IS PROVEN, WHICH IS NOT BY LOOKING AT A PANEL ──────────────
 *
 * The room's panel renders under `groupPanel && atWall.kind === "group" &&
 * atWall.id === groupPanel`, and `atWall` is pushed by the SIM when the camera
 * comes to rest. So the panel cannot be on screen unless the camera actually
 * arrived — the panel IS the proof, by construction, not merely evidence of
 * it. `.jar-here` (the wall's own name, read from the same `atWall`) is the
 * second witness, and it is checked case-insensitively because it carries the
 * label register's `text-transform: uppercase` and `innerText` respects it.
 *
 * NO MODEL CALLS. Making a room and copying a link derive nothing, so this is
 * fast and free and there is no reason it should not run on every change.
 *
 *     pnpm dev:local          # in another shell
 *     pnpm e2e:lighting [--base-url <url>] [--headed]
 */
import type { Browser, Page } from "playwright";

import { launchChromium } from "./browser";

const DEFAULT_BASE_URL = "http://127.0.0.1:3010";
const PASSWORD = "lighting-a-room-password-1";

const results: Array<{ ok: boolean }> = [];

async function step(title: string, run: () => Promise<string>): Promise<void> {
  const index = results.length + 1;
  const started = Date.now();
  try {
    const detail = await run();
    results.push({ ok: true });
    console.log(`PASS ${index}. ${title} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    console.log(`     ${detail}`);
  } catch (err) {
    results.push({ ok: false });
    console.log(`FAIL ${index}. ${title} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    console.log(`     ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Sign up a fresh account and wait for the world to be standing. */
async function arrive(page: Page, base: string, name: string): Promise<void> {
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2_000);
  await page.click("#login-tab-signup");
  await page.waitForTimeout(800);
  await page.fill("input[name=email]", `lighting-${Date.now()}@example.test`);
  await page.fill("input[name=password]", PASSWORD);
  await page.fill("input[name=name]", name);
  await page.click("button[type=submit]");
  await page.waitForTimeout(8_000);
}

/**
 * Open the make-a-room form: the walls list, "make another place", then "a
 * room". Three clicks deep, and each is the shape `dead-css.ts` measured
 * rather than guessed.
 */
async function openMakeForm(page: Page): Promise<void> {
  await page.locator(".jar-here-more").first().click({ timeout: 8_000 });
  await page.waitForTimeout(900);
  await page.locator(".jar-here-row--make").first().click({ timeout: 8_000 });
  await page.waitForTimeout(900);
  await page.locator(".jar-newplace-row").first().click({ timeout: 8_000 });
  await page.waitForTimeout(900);
}

/** The panel that dresses a room's wall — told from the make form by its verb. */
function roomPanel(page: Page) {
  return page.locator(".jar-roomform", { hasText: /copy the invite link|link copied/i });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = argv.indexOf("--base-url");
  const base = (flag >= 0 ? argv[flag + 1]! : DEFAULT_BASE_URL).replace(/\/+$/, "");
  const headed = argv.includes("--headed");

  console.log(`[lighting] base url: ${base}\n`);

  let browser: Browser | undefined;
  try {
    browser = await launchChromium({ headless: !headed });
    const ctx = await browser.newContext();
    /* The invite is delivered through the clipboard, so reading it back is the
       only way to check WHAT was copied rather than merely that a word on a
       button changed. */
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
    const page = await ctx.newPage();

    await arrive(page, base, "Lighting Walker");

    const roomName = `A room for the walk ${Date.now().toString(36)}`;

    await step("the make form says what a room does", async () => {
      await openMakeForm(page);
      /* PROSE IS WHAT IS LEFT WHEN THE FURNITURE IS TAKEN OUT, and here that
         is a structural fact rather than a guess about wording: every control
         in this form is a <button>, so removing them leaves exactly the text
         that was written to be READ rather than pressed.

         Measured the first way round — the whole form's innerText — this
         passed while proving less than it claimed: the tab labels ("Make a
         room", "Join with a link") carry no full stop, so they joined the
         note into one run and counted toward the eight-word minimum. A form
         with no sentence in it at all would have cleared that bar on its
         furniture alone. */
      const prose = (
        await page.locator(".jar-roomform").first().evaluate((el) => {
          const copy = el.cloneNode(true) as HTMLElement;
          copy.querySelectorAll("button").forEach((b) => b.remove());
          return copy.innerText;
        })
      )
        .replace(/\s+/g, " ")
        .trim();
      const sentence = prose
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .find((s) => s.split(/\s+/).length >= 8 && /[a-z]{3}/.test(s));
      if (!sentence) {
        throw new Error(
          "the form carries no sentence about what a room is — a person who has just typed " +
            `a name is told nothing about what they are making (prose found: "${prose.slice(0, 160)}")`,
        );
      }
      return `it says: "${sentence}"`;
    });

    await step("making it takes you to the room, with no further tap", async () => {
      await page.locator(".jar-roomform-box").first().fill(roomName, { timeout: 8_000 });
      await page
        .locator(".jar-roomform button", { hasText: /^make it$/i })
        .first()
        .click({ timeout: 8_000 });

      /* THE ONLY INTERACTION FROM HERE IS WAITING. Anything else — a click, a
         key, a scroll — would be the walk supplying the very tap this step
         claims is not needed. The glide is a camera journey with an eased
         curve, so the wait is for the world, not for a request. */
      await page.waitForTimeout(9_000);

      const here = (await page.locator(".jar-here").first().innerText()).trim();
      if (here.toLowerCase() !== roomName.toLowerCase()) {
        throw new Error(
          `the traveller is still standing on "${here}" — making a room did not move them ` +
            `(expected to be on "${roomName}")`,
        );
      }
      return `standing on "${here}"`;
    });

    await step("the invite is what greets you there", async () => {
      const panel = roomPanel(page);
      if ((await panel.count()) === 0) {
        throw new Error(
          "nothing on the room's wall offers the invite — a room of one is waiting for " +
            "exactly one thing and does not say so where you are standing",
        );
      }
      const named = (await panel.first().innerText()).toLowerCase().includes(roomName.toLowerCase());
      if (!named) throw new Error("the panel on screen does not name the room that was just made");
      return "the room's own panel is open, naming it, with the invite in it";
    });

    await step("the invite copies from where it landed", async () => {
      await roomPanel(page)
        .locator("button", { hasText: /copy the invite link/i })
        .first()
        .click({ timeout: 8_000 });
      await page.waitForTimeout(1_200);

      const said = await roomPanel(page).innerText();
      if (!/link copied/i.test(said)) {
        throw new Error("the invite button did not confirm it had copied anything");
      }
      /* WHAT was copied, not merely that something was. A link that does not
         carry a join code is a link that opens nothing. */
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      if (!/[?&]join=/.test(clip)) {
        throw new Error(`the clipboard does not hold an invite link: "${clip.slice(0, 120)}"`);
      }
      return `copied ${clip.replace(/join=.*$/, "join=…")}`;
    });

    await ctx.close();
  } catch (err) {
    console.log(`FAIL —. harness: ${err instanceof Error ? err.message : String(err)}`);
    results.push({ ok: false });
  } finally {
    await browser?.close();
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log("");
  console.log(`[lighting] ${results.length - failed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error(`[lighting] harness error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});
