/**
 * BY KEYBOARD — the world, with the mouse unplugged.
 *
 * ── THE QUESTION NO GATE HAS ASKED ─────────────────────────────────────────
 *
 * The usability audit covered contrast, target sizes and the Nielsen
 * heuristics. It could not have covered this, because **the field is a
 * canvas**: an orb is painted pixels, not an element. There is nothing for
 * Tab to land on and nothing for a screen reader to announce, and no amount
 * of contrast checking notices that.
 *
 * So a person who cannot use a pointer — a broken wrist, a tremor, a screen
 * reader, or simply someone who works from the keyboard — meets a product
 * whose central act may be unreachable. Every other walk in this repo drives
 * a mouse, including the ones written to be thorough: `dead-css` sweeps the
 * canvas by clicking a grid of coordinates, which is a confession that the
 * things it wants are not addressable any other way.
 *
 * ── WHAT IT MEASURES ───────────────────────────────────────────────────────
 *
 * Tab from the top of the world and record, in order, everything focus lands
 * on: what it is, what it says, and whether the person can SEE where they
 * are. Then try to do the product's two central acts with the keyboard alone
 * — say something into the mouth, and open a memory to read it.
 *
 *   reached      how many distinct stops a Tab cycle finds
 *   unnamed      stops with no accessible name — a reader announces "button"
 *   invisible    stops with no visible focus indicator, measured by asking
 *                the browser for the computed outline/box-shadow while focused
 *   the mouth    can a memory be kept without a pointer
 *   a memory     can one be opened and read without a pointer
 *
 * A canvas that cannot be tabbed into is not a bug in the canvas. It is a
 * question about whether the product has a keyboard path to its own content,
 * and the answer belongs in an audit rather than in a lint rule.
 *
 * Usage:
 *     pnpm dev:local
 *     pnpm e2e:by-keyboard
 *
 * Flags: `--base-url <url>`, `--headed`, `--keep <n>` (memories to seed).
 */
import { chromium, type BrowserContext, type Page, type Route } from "playwright";

interface Args {
  baseUrl: string;
  headed: boolean;
  keep: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { baseUrl: "http://127.0.0.1:3010", headed: false, keep: 3 };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i]!.split(/=(.*)/s);
    const take = (): string => inline ?? argv[++i] ?? "";
    if (flag === "--base-url") args.baseUrl = take().replace(/\/+$/, "");
    else if (flag === "--headed") args.headed = true;
    else if (flag === "--keep") args.keep = Number(take());
    else if (flag === "--help" || flag === "-h") {
      console.log("Usage: pnpm e2e:by-keyboard [--base-url <url>] [--keep <n>] [--headed]");
      process.exit(0);
    } else {
      console.error(`[by-keyboard] unknown option ${flag}`);
      process.exit(2);
    }
  }
  return args;
}

const uniq = (): string => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function stubExternals(ctx: BrowserContext, base: string): Promise<void> {
  await ctx.route(
    (url) => !url.href.startsWith(base),
    (route: Route) => {
      const u = route.request().url();
      if (/\.css|css2|pretendard/.test(u)) {
        return route.fulfill({ status: 200, contentType: "text/css", body: "/* stub */" });
      }
      return route.fulfill({ status: 200, contentType: "font/woff2", body: "" });
    },
  );
}

async function signUp(page: Page, base: string): Promise<void> {
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.click("#login-tab-signup");
  await page.fill("input[name=email]", `kb-${uniq()}@example.test`);
  await page.fill("input[name=password]", "by-keyboard-local-password-1");
  await page.fill("input[name=name]", "Keyboarder");
  await page.click("button[type=submit]");
  await page.waitForTimeout(6_000);
}

interface Stop {
  tag: string;
  cls: string;
  name: string;
  /** Whether anything visibly marks this element as focused. */
  litUp: boolean;
}

/**
 * WHAT THE BROWSER SAYS IS FOCUSED, AND WHETHER IT LOOKS IT.
 *
 * `litUp` compares the focused element's own outline and shadow against what
 * the same element computes when nothing is focused. Reading only `outline`
 * would call a design that marks focus with a background change unfocused,
 * and reading nothing at all would let a product with no focus ring pass a
 * keyboard audit — which is the failure this exists to catch.
 */
const FOCUS_PROBE = `(() => {
  var el = document.activeElement;
  if (!el || el === document.body) return null;
  var cs = getComputedStyle(el);
  var marks = [cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0,
               cs.boxShadow !== 'none',
               parseFloat(cs.borderBottomWidth) > 2];
  return {
    tag: el.tagName.toLowerCase(),
    cls: String(el.className || '').slice(0, 60),
    name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 48),
    litUp: marks.some(Boolean),
  };
})()`;

async function tabCycle(page: Page, limit = 40): Promise<Stop[]> {
  const stops: Stop[] = [];
  const seen = new Set<string>();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < limit; i += 1) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(120);
    const stop = (await page.evaluate(FOCUS_PROBE)) as Stop | null;
    if (!stop) continue;
    const key = `${stop.tag}.${stop.cls}|${stop.name}`;
    if (seen.has(key)) break; /* the cycle has come round */
    seen.add(key);
    stops.push(stop);
  }
  return stops;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    "[by-keyboard] The world with the mouse unplugged. The field is a canvas, so an\n" +
      "              orb is painted pixels rather than an element — this asks whether\n" +
      "              the product has a keyboard path to its own content.\n",
  );

  const browser = await chromium.launch({
    headless: !args.headed,
    executablePath: "/opt/pw-browsers/chromium",
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    await stubExternals(ctx, args.baseUrl);
    const page = await ctx.newPage();
    await signUp(page, args.baseUrl);

    /* SOMETHING TO REACH FOR. A field with nothing in it would report a clean
       keyboard pass over an empty world, which is the same vacuous success
       every other gate in this session had to be talked out of. */
    for (let i = 0; i < args.keep; i += 1) {
      await page.locator(".jar-mouth-rest").first().click({ timeout: 8_000 });
      await page.waitForTimeout(700);
      await page.fill(
        'textarea[aria-label="capture inspiration"]',
        `something worth finding again ${i} ${uniq()}`,
      );
      await page.locator(".jar-mouth-where button", { hasText: /^save$/ }).first().click();
      await page.waitForTimeout(4_000);
    }
    await page.goto(`${args.baseUrl}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(7_000);

    const stops = await tabCycle(page);
    console.log(`  Tab reaches ${stops.length} stop(s) in the world:\n`);
    for (const s of stops) {
      console.log(
        `    ${s.litUp ? "lit " : "DARK"}  ${(s.name || "(no name)").padEnd(34)} ${s.tag}.${s.cls.split(" ")[0] ?? ""}`,
      );
    }
    const unnamed = stops.filter((s) => s.name === "");
    const dark = stops.filter((s) => !s.litUp);

    /* THE TWO CENTRAL ACTS, ATTEMPTED WITH KEYS ALONE. */
    const canvasFocusable = (await page.evaluate(
      () => document.querySelector("canvas")?.getAttribute("tabindex") !== null,
    )) as boolean;

    let keptByKeyboard = false;
    try {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      for (let i = 0; i < 30; i += 1) {
        await page.keyboard.press("Tab");
        await page.waitForTimeout(100);
        const isMouth = (await page.evaluate(() =>
          String((document.activeElement as HTMLElement | null)?.className ?? "").includes(
            "jar-mouth-rest",
          ),
        )) as boolean;
        if (!isMouth) continue;
        await page.keyboard.press("Enter");
        await page.waitForTimeout(900);
        await page.keyboard.type("kept with no mouse at all");
        await page.waitForTimeout(300);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(4_500);
        keptByKeyboard = (await page.evaluate(async () => {
          const r = await fetch("/api/inspirations?limit=50", { credentials: "include" });
          const b = (await r.json()) as { inspirations?: Array<{ textPreview: string }> };
          return (b.inspirations ?? []).some((x) => x.textPreview.includes("no mouse at all"));
        })) as boolean;
        break;
      }
    } catch {
      keptByKeyboard = false;
    }

    /* AND READING ONE BACK. The door is a real button, so it can be reached;
       what matters is whether anything BEHIND it can be. */
    let memoryOpened = false;
    try {
      await page.goto(`${args.baseUrl}/`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(7_000);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      for (let i = 0; i < 30; i += 1) {
        await page.keyboard.press("Tab");
        await page.waitForTimeout(100);
        const onDoor = (await page.evaluate(() =>
          String((document.activeElement as HTMLElement | null)?.className ?? "").includes(
            "jar-saved",
          ),
        )) as boolean;
        if (!onDoor) continue;
        await page.keyboard.press("Enter");
        await page.waitForTimeout(3_500);
        /* From the archive, keep tabbing and pressing Enter — if any keyboard
           route into a memory exists, this finds it. */
        for (let j = 0; j < 25; j += 1) {
          await page.keyboard.press("Tab");
          await page.waitForTimeout(100);
          await page.keyboard.press("Enter");
          await page.waitForTimeout(400);
          if ((await page.locator(".jar-panel").count()) > 0) {
            memoryOpened = true;
            break;
          }
        }
        break;
      }
    } catch {
      memoryOpened = false;
    }

    console.log(
      `\n  ${unnamed.length} of ${stops.length} stops announce nothing to a reader` +
        `\n  ${dark.length} of ${stops.length} stops show no visible focus` +
        `\n  the canvas ${canvasFocusable ? "can be focused" : "CANNOT be focused — no tabindex"}` +
        `\n  keeping a memory with keys alone: ${keptByKeyboard ? "works" : "DID NOT WORK"}` +
        `\n  opening one to read it:          ${memoryOpened ? "works" : "DID NOT WORK"}`,
    );
    console.log(
      "\n[by-keyboard] A canvas that cannot be tabbed into is not a defect in the canvas.\n" +
        "              It is a question about whether the product has a keyboard path to\n" +
        "              its own content — reported, not ruled on.",
    );

    /* ── WHAT THIS GATE HOLDS, AND WHAT IT ONLY REPORTS ────────────────────
       The chrome is perfect today: every stop named, every stop visibly
       focused, and the mouth usable with keys alone. Those are ratchets — a
       regression in any of them fails, because they were true once and losing
       them would be somebody's edit rather than an open question.

       Reaching a MEMORY is not a ratchet, because it has never worked. Making
       it fail here would paint the branch red on a finding that needs a
       design decision (see docs/audits/by-keyboard-2026-08-26.md), and a
       check that is always red is a check everyone learns to skip. It is
       printed loudly on every run instead, so it cannot be forgotten — and
       the day the archive grows a text route, `memoryOpened` becomes a
       ratchet too and this comment goes with it. */
    const broke: string[] = [];
    if (stops.length < 8) broke.push(`Tab reaches ${stops.length} stops, was 8`);
    if (unnamed.length > 0) {
      broke.push(`${unnamed.length} stop(s) announce nothing: ${unnamed.map((s2) => s2.cls).join(", ")}`);
    }
    if (dark.length > 0) {
      broke.push(`${dark.length} stop(s) show no visible focus: ${dark.map((s2) => s2.cls).join(", ")}`);
    }
    if (!keptByKeyboard) broke.push("a memory can no longer be kept with the keyboard alone");
    if (!memoryOpened) {
      console.log(
        "\n[by-keyboard] STILL OPEN: no keyboard route into a memory. Not failed here —\n" +
          "              see the audit. Printed every run so it cannot go quiet.",
      );
    }
    if (broke.length > 0) {
      console.log(`\n[by-keyboard] the keyboard path got WORSE:\n${broke.map((b) => `                ${b}`).join("\n")}`);
      process.exit(1);
    }
  } finally {
    await browser.close();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[by-keyboard] crashed:", err);
  process.exit(2);
});
