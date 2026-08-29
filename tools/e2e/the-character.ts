/**
 * THE CHARACTER IS ONE SIZE, EVERYWHERE.
 *
 * ── THE RULING ─────────────────────────────────────────────────────────────
 *
 * The founder, 2026-08-28: *"character shouldnt be responsive to screensize.
 * it should always be consistent size."*
 *
 * It had been `clamp(view.h * 0.14, 84, 150)` and then shrunk AGAIN into
 * whatever room headquarters had left, down to a 32px floor. Two rules, each
 * reasonable alone, and together they meant the one character in the product
 * had no fixed identity: 126px on a tall desktop, 84 on a laptop, and on a
 * short window small enough to read as one more orb. The screenshot that
 * ended it had the character sitting inside the poster's third line at about
 * forty pixels across.
 *
 * A being does not change size because the window did. Everything else in
 * headquarters is text and chrome and may reflow; this may not, because its
 * size is part of what it is.
 *
 * ── WHY IT ASKS THE WORLD RATHER THAN LOOKING ──────────────────────────────
 *
 * The body is painted on a canvas. The obvious measurement — find the big
 * bright blob — reads the character's AURA, and the aura is clipped by a
 * narrow viewport and merges with whatever else is lit beside it. Measured
 * that way the character came back as 252x244, 248x216 and 188x244 on three
 * screens while its body was in fact identical on all three: a reading that
 * would have failed this gate for a reason that was entirely the gate's.
 *
 * So the world states its size on the root as `--jar-char`, the same way it
 * already states the seam and the mouth's top. Chrome states its place;
 * nothing guesses at it.
 */
import { launchChromium } from "./browser";
import { settleAfterArrival } from "./arrival";

const DEFAULT_BASE = "http://127.0.0.1:3010";

/** Screens the character has to be the same creature on. */
const SCREENS: Array<[number, number]> = [
  [1440, 900],
  [1280, 720],
  [1100, 560],
  [900, 1200],
  [768, 480],
  [390, 844],
];

const SIZE = `(() => {
  const el = document.querySelector(".jar");
  if (!el) return "";
  return getComputedStyle(el).getPropertyValue("--jar-char").trim();
})()`;

const run = async (base: string): Promise<number> => {
  const browser = await launchChromium();
  const seen: Array<{ w: number; h: number; size: string }> = [];

  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2_000);
    await page.click("#login-tab-signup");
    await page.waitForTimeout(800);
    await page.fill("input[name=email]", `char-${Date.now()}@example.test`);
    await page.fill("input[name=password]", "the-character-gate-1");
    await page.fill("input[name=name]", "Char");
    await page.click("button[type=submit]");
    await page.waitForTimeout(9_000);
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await settleAfterArrival(page);

    for (const [w, h] of SCREENS) {
      await page.setViewportSize({ width: w, height: h });
      /* the size is written by the layout pass, which runs on the resize */
      await page.waitForTimeout(1_600);
      seen.push({ w, h, size: (await page.evaluate(SIZE)) as string });
    }
    await ctx.close();
  } finally {
    await browser?.close();
  }

  console.log("");
  for (const s of seen)
    console.log(`  ${String(s.w).padStart(4)}x${String(s.h).padEnd(4)}  the character is ${s.size || "(unstated)"}`);
  console.log("");

  const unstated = seen.filter((s) => s.size === "");
  if (unstated.length > 0) {
    console.log(`[character] the world does not state its character's size on ${unstated.length} screen(s).`);
    console.log(`            Without --jar-char there is nothing here to check: the body is`);
    console.log(`            canvas, and its glow is not its size.`);
    return 1;
  }
  const distinct = [...new Set(seen.map((s) => s.size))];
  if (distinct.length === 1) {
    console.log(`[character] the same creature on all ${seen.length} screens — ${distinct[0]} everywhere.`);
    return 0;
  }
  console.log(`[character] the character is ${distinct.length} different sizes across ${seen.length} screens:`);
  for (const d of distinct)
    console.log(`  ${d.padStart(6)}  on ${seen.filter((s) => s.size === d).map((s) => `${s.w}x${s.h}`).join(", ")}`);
  console.log(`\n            It is not a layout element. It is the being you are talking to.`);
  return 1;
};

const args = process.argv.slice(2);
const at = args.indexOf("--base-url");
process.exit(await run(at >= 0 ? args[at + 1]! : DEFAULT_BASE));
