/**
 * EVERY ORB ANSWERS THE HAND.
 *
 * ── THE REPORT ─────────────────────────────────────────────────────────────
 *
 * The founder, 2026-08-28: *"some inspiration balls are not clickable. debug
 * why"*. A memory you can see and cannot open is the worst failure this
 * product has, because the orb is the only handle a memory has: there is no
 * list to fall back to, no row to click instead. The orb is the memory.
 *
 * ── WHY NOTHING HERE COULD ALREADY CATCH IT ────────────────────────────────
 *
 * `answers-the-hand.ts` asks whether every CONTROL lights up under a pointer.
 * It walks the DOM, and an orb is not in the DOM — it is paint on a canvas.
 * `measure.ts` reads computed styles, `phone.ts` measures target sizes: both
 * DOM. Every instrument in this repo is blind to the one thing the world is
 * actually made of. So this one does not read the DOM to find its subjects.
 * It reads the PICTURE, the way the person does.
 *
 * ── HOW AN ORB IS FOUND ────────────────────────────────────────────────────
 *
 * One `getImageData` of the whole viewport, then flood-fill the lit pixels
 * into blobs and take each blob's centroid. The threshold is set at the ORB'S
 * CORE, not at its bloom, and that choice is load-bearing: at the bloom's
 * luminance two neighbouring orbs merge into one long blob and the row across
 * the peek line becomes a single 400px smear. At the core they separate.
 *
 * The companion is a blob too, and is excluded by size — it is far larger
 * than any orb. Root lines are excluded by aspect: an orb is round.
 *
 * ── AND THE ORBS DRIFT, WHICH COST ME THE FIRST THREE READINGS ─────────────
 *
 * The field floats. Centroids read once and pressed one after another are
 * pressed at where the orbs WERE — by the eighth the error was 32px, and the
 * instrument reported the world's failure when the failure was its own
 * latency. Three separate runs "found" between one and six unclickable orbs
 * that way, in different places each time, which is the signature of an
 * instrument measuring itself.
 *
 * So the field is re-read immediately before every single press, and the aim
 * is the orb's LIVE centre. A refusal that survives that is the world's.
 *
 * ── AND THE SECOND CHECK, WHICH IS WHERE THE REAL DEFECT WAS ───────────────
 *
 * `.jar-mouth-rest` — the line that keeps a memory — was `display: block;
 * width: 100%`. Its ink is a short centred label; its BOX was 1400px of a
 * 1440px viewport, an invisible bar lying across the whole world at the
 * height of the companion's chin. Everything in headquarters carries
 * `data-jar-chrome`, and `onUp` refuses to hand a press to the world when the
 * press landed on chrome — so that entire band took presses meant for the
 * world and did nothing with them.
 *
 * That is the class of bug worth a permanent gate, because it is invisible by
 * construction: a transparent button is exactly as wide as its CSS says and
 * nothing on the screen shows you where its edges are. So the second check
 * measures every control floating over the world against ITS OWN INK, and
 * fails the ones that claim ground they do not draw on.
 */
import type { Page } from "playwright";

import { launchChromium } from "./browser";
import { settleAfterArrival } from "./arrival";
import { aimAt, readOrbs, type Orb } from "./orbs";

const DEFAULT_BASE = "http://127.0.0.1:3010";
const MEMORY = ".jar-panel-text";

/**
 * How much wider than its own ink a floating control may be.
 *
 * A signpost's finger halo is `inset: -11px -12px` — 24px of width — and the
 * widest real padding in headquarters is the account pill's. 48 clears both
 * with room, and the defect it exists to catch overshot by 1256px, so there is
 * no honest reading anywhere near the line.
 */
const INK_SLACK = 48;

/**
 * Controls that are legitimately wider than their ink, and why.
 *
 * A control belongs here only if its BOX is the thing a person aims at — a
 * row they press anywhere along — rather than an invisible margin around a
 * word. Nothing goes in this list to make a run green.
 */
const WIDE_BY_DECISION: Record<string, string> = {
  "jar-mouth-field":
    "the notepad's own writing surface: a person presses anywhere in it to type",
  "jar-panel-text":
    "an open memory's body — the press target IS the paragraph, at its full width",
};

/**
 * AND TEXT THAT WRAPPED IS EXEMPT BY CONSTRUCTION, not by decision.
 *
 * The first run of this gate accused `.jar-poster` — box 640px, ink 507px.
 * That is a three-line headline: the 133px is the ragged right margin, and no
 * value of `display` or `width` removes it. Shrink-to-fit sizes a box to
 * `min(max-content, available)` and never re-measures after the lines break,
 * so `fit-content` on a wrapped headline returns the column it just wrapped
 * inside — 640px, unchanged. A wrapped block's box IS its column.
 *
 * So the rule is about single-line controls, which are the ones where a box
 * far wider than its word is a mistake somebody made rather than a fact about
 * text. The mouth was one line of 144px inside a box of 1400.
 */
const WRAPPED = 1.5;

/* Every control floating over the world, measured against the text it draws.
   SCOPED BY `data-jar-chrome`, NOT BY `.jar-hq`. The first version of this
   asked headquarters for its controls and the mouth is not in it: the mouth
   is its OWN layer, a sibling, because headquarters is drawn under the canvas
   and you cannot type into words with orbs passing over them. Scoping to the
   column meant the gate passed with the 1400px mouth put back — it never
   measured it. `data-jar-chrome` is the right scope because it is the exact
   attribute `onUp` consults when it decides not to hand the press to the
   world: everything carrying it takes presses, so everything carrying it owes
   the world an honest edge. */
const READ_INK = `(() => {
  const out = [];
  const sel = "button, a, [role=button], textarea";
  const layers = document.querySelectorAll("[data-jar-chrome]");
  const hq = [];
  for (let L = 0; L < layers.length; L++) {
    if (layers[L].matches(sel)) hq.push(layers[L]);
    const inner = layers[L].querySelectorAll(sel);
    for (let k = 0; k < inner.length; k++) hq.push(inner[k]);
  }
  for (let i = 0; i < hq.length; i++) {
    const el = hq[i];
    const box = el.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) continue;
    const rng = document.createRange();
    rng.selectNodeContents(el);
    const ink = rng.getBoundingClientRect();
    rng.detach();
    if (ink.width < 1) continue;
    let cls = "";
    if (el.className && typeof el.className === "string") cls = el.className.trim().split(/\\s+/)[0];
    const cs = getComputedStyle(el);
    let lh = parseFloat(cs.lineHeight);
    if (!(lh > 0)) lh = parseFloat(cs.fontSize) * 1.3;
    out.push({
      cls: cls,
      text: (el.textContent || "").trim().slice(0, 28),
      box: Math.round(box.width),
      ink: Math.round(ink.width),
      lines: lh > 0 ? ink.height / lh : 1,
    });
  }
  return JSON.stringify(out);
})()`;

interface Wide {
  cls: string;
  text: string;
  box: number;
  ink: number;
  /** how many lines the ink runs to — wrapped text cannot hug its own edge */
  lines: number;
}

const signUp = async (page: Page, base: string, kept: string[]): Promise<void> => {
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2_000);
  await page.click("#login-tab-signup");
  await page.waitForTimeout(800);
  await page.fill("input[name=email]", `orbs-${Date.now()}@example.test`);
  await page.fill("input[name=password]", "every-orb-answers-1");
  await page.fill("input[name=name]", "Orbs");
  await page.click("button[type=submit]");
  await page.waitForTimeout(9_000);
  for (const t of kept) {
    await page.locator(".jar-mouth-rest").first().click();
    await page.waitForTimeout(450);
    await page.fill('textarea.jar-mouth-field', t);
    await page.locator(".jar-mouth-where button", { hasText: /^save$/ }).first().click();
    await page.waitForTimeout(2_800);
  }
};

const run = async (base: string, width: number, height: number): Promise<number> => {
  const browser = await launchChromium();
  const wide: Wide[] = [];
  const refused: string[] = [];
  let pressed = 0;

  try {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage();
    await signUp(page, base, [
      "a memory about the sea",
      "a memory about a long walk",
      "a memory about the shape of an argument",
      "a memory about someone's handwriting",
      "a memory about a room with the light off",
      "a memory about arriving early",
      "a memory about the word for it",
      "a memory about starting again",
    ]);

    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await settleAfterArrival(page);
    await page.waitForTimeout(2_500);

    /* ── one: no control claims ground it does not draw on ── */
    for (const c of JSON.parse((await page.evaluate(READ_INK)) as string) as Wide[]) {
      if (WIDE_BY_DECISION[c.cls]) continue;
      if (c.lines > WRAPPED) continue;
      if (c.box - c.ink > INK_SLACK) wide.push(c);
    }

    /* ── two: every orb answers the press ──
       In the jar, where the field owns the screen and a person presses orbs
       one after another. At headquarters only the peek row shows, and it is
       the same orbs from the same array. */
    await page.mouse.move(720, 700);
    await page.mouse.wheel(0, 1400);
    await page.waitForTimeout(2_000);

    const orbs = await readOrbs(page);
    for (const target of orbs) {
      let opened = 0;
      let aimed = "";
      /* two attempts: the field is live, and a press can arrive in the frame
         an orb is crossing the aim point */
      for (let attempt = 0; attempt < 2 && !opened; attempt++) {
        const best: Orb | null = await aimAt(page, target);
        /* it drifted further than any orb drifts between two reads: it is not
           the same orb, and pressing it would measure the wrong thing */
        if (!best) {
          aimed = "";
          break;
        }
        aimed = `${best.x},${best.y}  ${best.w}x${best.h}`;
        await page.mouse.click(best.x, best.y);
        await page.waitForTimeout(300);
        opened = (await page.evaluate(`document.querySelector(${JSON.stringify(MEMORY)}) ? 1 : 0`)) as number;
      }
      if (aimed === "") continue;
      pressed += 1;
      if (opened) {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(340);
      } else {
        const over = (await page.evaluate(`(() => {
          const el = document.elementFromPoint(${target.x}, ${target.y});
          if (!el) return "nothing";
          let t = el.tagName.toLowerCase();
          if (el.className && typeof el.className === "string" && el.className.trim())
            t += "." + el.className.trim().split(/\\s+/)[0];
          return t;
        })()`)) as string;
        refused.push(`${aimed}   the press landed on ${over}`);
      }
    }

    await ctx.close();
  } finally {
    await browser?.close();
  }

  console.log(`\n[orbs] at ${width}x${height}`);
  if (wide.length > 0) {
    console.log(`[orbs] ${wide.length} control(s) over the world claim ground they do not draw on:\n`);
    for (const c of wide)
      console.log(
        `  .${c.cls.padEnd(22)} box ${String(c.box).padStart(5)}px   ink ${String(c.ink).padStart(4)}px   ` +
          `+${c.box - c.ink}px of invisible reach   "${c.text}"`,
      );
    console.log(
      `\n       Every press in that band is taken by the control and never reaches\n` +
        `       the world, so a memory drawn there cannot be opened.\n`,
    );
  }
  if (refused.length > 0) {
    console.log(`[orbs] ${refused.length} of ${pressed} orbs did not open when pressed at their live centre:\n`);
    for (const r of refused) console.log(`  ${r}`);
    console.log("");
  }
  if (wide.length === 0 && refused.length === 0) {
    console.log(`[orbs] every one of ${pressed} orbs opened its memory when pressed,`);
    console.log(`       and no control over the world reaches past its own ink.`);
    if (pressed === 0) {
      console.log(`\n[orbs] but nothing was pressed — the field read as empty, which is a`);
      console.log(`       failure of this instrument, not a pass for the world.`);
      return 1;
    }
    return 0;
  }
  console.log(`[orbs] ${Object.keys(WIDE_BY_DECISION).length} control(s) are wide by decision:`);
  for (const [k, why] of Object.entries(WIDE_BY_DECISION)) console.log(`  .${k.padEnd(22)} ${why}`);
  return 1;
};

const args = process.argv.slice(2);
const at = args.indexOf("--base-url");
const base = at >= 0 ? args[at + 1]! : DEFAULT_BASE;
/* `--viewport 360x640`, because "can a memory be opened" is a question about
   a SIZE as much as about the code: `e2e:phone` could not open one at 360x640
   on some runs and there was no way to ask this gate, which is the strict one,
   whether that was the walk or the world. */
const vp = args.indexOf("--viewport");
const [w, h] = vp >= 0 ? args[vp + 1]!.split("x").map(Number) : [1440, 900];
process.exit(await run(base, w!, h!));
