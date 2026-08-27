#!/usr/bin/env tsx
/**
 * THE USABILITY AUDIT, RUN RATHER THAN ASSERTED.
 *
 * Founder, 2026-08-25, linked a user-experience-audit skill at
 * `mcpmarket.com`. THAT HOST IS BLOCKED BY THIS ENVIRONMENT'S EGRESS PROXY
 * (`EGRESS_BLOCKED`), so its methodology was never read and is not what this
 * uses. What this uses is Nielsen's ten heuristics and WCAG 2.2 AA. That is
 * recorded here rather than glossed: an audit is worth exactly what its method
 * is, and claiming a method that was not used makes every finding
 * unverifiable. If that specific skill is wanted, it needs an egress allowance
 * for the host, or the file pasted in.
 *
 * ── WHAT IS ALREADY COVERED ELSEWHERE, AND SO IS NOT HERE ──────────────────
 *
 *   contrast (1.4.3)      `contrast.test.ts` computes the ink ramp against
 *                         both grounds from the tokens themselves
 *   target size (2.5.8)   `e2e:phone`, at 390 and 360, with the acts at 44
 *   zoom on focus         `e2e:phone`
 *   reachability          `journeys` hit-tests controls at their own centres
 *
 * Duplicating any of those here would mean two gates with one opinion between
 * them, and the second one to be edited would be the one that quietly stopped
 * agreeing.
 *
 * ── WHAT IS OUT OF SCOPE, BY A STANDING DECISION ───────────────────────────
 *
 * The WORLD is one unlabelled canvas and screen-reader support for it is out
 * of scope by founder decision, recorded in `everything-in-the-world.md` and
 * not reopened. So this audits the CHROME and the FORMS — the parts built from
 * real elements, where a missing label is a defect rather than a consequence
 * of the medium. `<canvas>` and anything inside it is skipped explicitly.
 *
 * ── WHAT IT CHECKS ─────────────────────────────────────────────────────────
 *
 *   H1  every control says what it does           WCAG 4.1.2 / Nielsen #2
 *   H2  every field is labelled                   WCAG 1.3.1, 3.3.2
 *   H3  focus is visible on every control         WCAG 2.4.7 / Nielsen #6
 *   H4  the page says what it is                  WCAG 2.4.2
 *   H5  the document declares its language        WCAG 3.1.1
 *   H6  an error says what went wrong             WCAG 3.3.1 / Nielsen #9
 *   H7  no control is disabled with no reason     Nielsen #1 (visibility)
 *
 *     pnpm e2e:usability
 *     pnpm e2e:usability --negative
 */
import { type Browser, type Page } from "playwright";
import { launchChromium } from "./browser";
interface Finding {
  check: string;
  surface: string;
  detail: string;
}

const BASE = process.env.WAKA_BASE_URL ?? "http://127.0.0.1:3010";

/**
 * Everything asked of the page at once.
 *
 * `<canvas>` and its contents are skipped — see the scope note above. So is
 * anything `aria-hidden`, which is a deliberate statement that a thing is
 * decorative and is respected rather than second-guessed.
 */
const PROBE = `(() => {
  const out = { unnamed: [], unlabelled: [], noFocus: [], title: document.title, lang: document.documentElement.lang, disabled: [] };
  const named = (e) => {
    const cls = typeof e.className === "string" ? e.className.trim().split(/\\s+/).slice(0, 2).join(".") : "";
    return e.tagName.toLowerCase() + (cls ? "." + cls : "");
  };
  const skip = (e) => e.closest("canvas") || e.closest("[aria-hidden=true]") || e.getAttribute("aria-hidden") === "true";
  const visible = (e) => {
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(e);
    return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0;
  };

  for (const e of document.querySelectorAll("button, a[href], [role=button]")) {
    if (skip(e) || !visible(e)) continue;
    const text = (e.innerText || "").trim();
    const label = e.getAttribute("aria-label") || e.getAttribute("title") || "";
    const labelledBy = e.getAttribute("aria-labelledby");
    if (!text && !label && !labelledBy) out.unnamed.push(named(e));
    if (e.disabled && !e.getAttribute("aria-disabled") && !e.getAttribute("title") && !label) {
      out.disabled.push(named(e));
    }
  }

  for (const e of document.querySelectorAll("input, textarea, select")) {
    if (skip(e) || !visible(e)) continue;
    if (e.type === "hidden") continue;
    const id = e.id;
    const hasFor = id && document.querySelector('label[for="' + CSS.escape(id) + '"]');
    const wrapped = e.closest("label");
    const label = e.getAttribute("aria-label") || e.getAttribute("aria-labelledby");
    if (!hasFor && !wrapped && !label) out.unlabelled.push(named(e) + (e.name ? " name=" + e.name : ""));
  }

  return JSON.stringify(out);
})()`;

interface Probe {
  unnamed: string[];
  unlabelled: string[];
  noFocus: string[];
  title: string;
  lang: string;
  disabled: string[];
}

/**
 * H3, ASKED WITH THE KEYBOARD, because that is the only way to ask it.
 *
 * The first version called `element.focus()` from a script and compared the
 * computed style before and after. It reported thirteen controls with
 * invisible focus and went on reporting twelve of them AFTER the ring was
 * added and verified present in the build — because `:focus-visible` is a
 * HEURISTIC, and Chromium does not match it for a button focused by script.
 * The gate was measuring a state no keyboard user is ever in.
 *
 * So this presses Tab. Whatever the browser then calls `document.activeElement`
 * is what a person tabbing has landed on, and `:focus-visible` means what it
 * means. A control whose lit state is pixel-identical to its resting state is
 * a person with no cursor.
 */
async function focusWalk(page: Page, surface: string, steps = 25): Promise<Finding[]> {
  const found: Finding[] = [];
  const seen = new Set<string>();
  await page.evaluate(`document.body.focus()`);
  for (let i = 0; i < steps; i += 1) {
    await page.keyboard.press("Tab");
    const row = (await page.evaluate(`(() => {
      const e = document.activeElement;
      if (!e || e === document.body) return null;
      if (e.closest("canvas") || e.getAttribute("aria-hidden") === "true") return null;
      const cls = typeof e.className === "string" ? e.className.trim().split(/\\s+/).slice(0, 2).join(".") : "";
      const name = e.tagName.toLowerCase() + (cls ? "." + cls : "");
      const cs = getComputedStyle(e);
      const lit = [cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.boxShadow].join("|");
      /* the same element with focus taken away, read from a clone in place is
         not possible — so compare against what the engine says an unfocused
         sibling of the same class computes */
      return JSON.stringify({ name, lit, ring: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0 });
    })()`)) as string | null;
    if (!row) continue;
    const { name, ring } = JSON.parse(row) as { name: string; lit: string; ring: boolean };
    if (!ring && !seen.has(name)) {
      seen.add(name);
      found.push({ check: "H3 focus is invisible", surface, detail: name });
    }
  }
  return found;
}

async function audit(page: Page, surface: string): Promise<Finding[]> {
  const p = JSON.parse((await page.evaluate(PROBE)) as string) as Probe;
  const found: Finding[] = [];
  const add = (check: string, detail: string): void => void found.push({ check, surface, detail });

  for (const d of p.unnamed) add("H1 control has no name", d);
  for (const d of p.unlabelled) add("H2 field has no label", d);
  for (const d of p.noFocus) add("H3 focus is invisible", d);
  for (const d of p.disabled) add("H7 disabled with no reason given", d);
  if (!p.title || p.title.trim().length === 0) add("H4 page has no title", "<title> is empty");
  if (!p.lang || p.lang.trim().length === 0) add("H5 no language declared", "<html lang> is empty");
  return found;
}

async function walk(browser: Browser, negative: boolean): Promise<Finding[]> {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 780 } });
  if (negative) {
    /* The defects this is built to find, put back: a control with its name
       stripped, a field with its label removed, and focus rendered invisible. */
    await ctx.addInitScript(() => {
      window.addEventListener("load", () => {
        const s = document.createElement("style");
        s.textContent = "*:focus, *:focus-visible { outline: 0 none !important; box-shadow: none !important; }";
        document.head.appendChild(s);
        setTimeout(() => {
          const b = document.querySelector("button");
          if (b) { b.textContent = ""; b.removeAttribute("aria-label"); b.removeAttribute("title"); }
          for (const i of document.querySelectorAll("input")) {
            i.removeAttribute("aria-label");
            i.removeAttribute("aria-labelledby");
            i.removeAttribute("id");
          }
        }, 1_500);
      });
    });
  }
  const page = await ctx.newPage();
  const found: Finding[] = [];

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2_500);
  found.push(...(await audit(page, "the door")));
  found.push(...(await focusWalk(page, "the door")));

  /* H6: AN ERROR HAS TO SAY WHAT WENT WRONG. Signing in with a password that
     is not the account's is the one failure every person meets, so it is the
     one this asks about. */
  await page.fill("input[name=email]", "nobody-at-all@example.test");
  await page.fill("input[name=password]", "definitely-not-the-password");
  await page.click("button[type=submit]");
  await page.waitForTimeout(3_000);
  const said = await page.evaluate(`(() => {
    const alert = document.querySelector('[role="alert"]');
    return (alert ? alert.innerText : document.body.innerText).trim();
  })()`);
  const text = String(said);
  if (!/incorrect|wrong|not match|no account|invalid|could not|try again|check/i.test(text)) {
    found.push({
      check: "H6 an error does not say what went wrong",
      surface: "the door",
      detail: `a wrong password produced: ${JSON.stringify(text.slice(0, 160))}`,
    });
  }

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1_500);
  await page.click("#login-tab-signup");
  await page.fill("input[name=email]", `usability-${Date.now()}@example.test`);
  await page.fill("input[name=password]", "usability-password-1");
  await page.fill("input[name=name]", "Usability");
  await page.click("button[type=submit]");
  await page.waitForTimeout(9_000);
  found.push(...(await audit(page, "the world")));
  found.push(...(await focusWalk(page, "the world")));

  await page.locator(".jar-mouth-rest").first().click();
  await page.waitForTimeout(900);
  found.push(...(await audit(page, "the mouth open")));
  found.push(...(await focusWalk(page, "the mouth open")));

  await ctx.close();
  return found;
}

async function main(): Promise<number> {
  const negative = process.argv.includes("--negative");
  console.log("[usability] Nielsen's heuristics and WCAG 2.2 AA, in a real engine");
  console.log("[usability] the canvas is out of scope by founder decision; the chrome is not");
  console.log(
    negative
      ? "[usability] NEGATIVE mode — the defects are put back and MUST be found\n"
      : "",
  );

  const browser = await launchChromium();
  let found: Finding[] = [];
  try {
    found = await walk(browser, negative);
  } finally {
    await browser.close();
  }

  const seen = new Set<string>();
  const unique = found.filter((f) => {
    const k = `${f.check}|${f.surface}|${f.detail}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  for (const f of unique) console.log(`  ${f.surface.padEnd(14)} ${f.check.padEnd(38)} ${f.detail}`);

  if (negative) {
    console.log(
      unique.length > 0
        ? `\n[usability] ${unique.length} finding(s) — the sabotage was caught`
        : "\n[usability] NOTHING FOUND against the defects — this suite is decoration",
    );
    return unique.length > 0 ? 0 : 1;
  }
  console.log(
    unique.length === 0
      ? "\n[usability] clean — every control named, every field labelled, focus visible, errors legible"
      : `\n[usability] ${unique.length} finding(s)`,
  );
  return unique.length === 0 ? 0 : 1;
}

main()
  .then((c) => process.exit(c))
  .catch((err: unknown) => {
    console.error(`[usability] harness error: ${err instanceof Error ? err.message : err}`);
    process.exit(2);
  });
