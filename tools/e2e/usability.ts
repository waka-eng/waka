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
import { openTheNotepad } from "./keep";
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
  const out = { unnamed: [], unlabelled: [], title: document.title, lang: document.documentElement.lang, disabled: [] };
  const named = (e) => {
    const cls = typeof e.className === "string" ? e.className.trim().split(/\\s+/).slice(0, 2).join(".") : "";
    return e.tagName.toLowerCase() + (cls ? "." + cls : "");
  };
  /* INERT IS A STATEMENT THAT A THING IS NOT OFFERED, and it is respected
     the same way aria-hidden is. A control inside an inert subtree cannot
     be reached by pointer, keyboard or screen reader, so asking whether it
     has a name, or a reason for being disabled, is asking about something
     nobody can get to. */
  const skip = (e) => e.closest("canvas") || e.closest("[aria-hidden=true]") || e.closest("[inert]") || e.getAttribute("aria-hidden") === "true";
  /* VISIBILITY IS AN ANCESTOR QUESTION, which this asked of the element
     alone — and so got wrong the first time it was pointed at the whole
     product. The world's composer sits in a slot the destinations fade to
     zero opacity; the buttons inside it keep an opacity of 1 of their own,
     so a check on the element reported three invisible controls as visible
     on every page in the product. Fifteen findings about things nobody can
     see, and a gate that cries wolf gets an exemption added to shut it up
     and then guards nothing.

     display and visibility collapse or hide the subtree outright, so
     walking for them is belt and braces; opacity is the one that genuinely
     only ever exists on the ancestor. */
  const visible = (e) => {
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    for (let at = e; at && at !== document.documentElement; at = at.parentElement) {
      const cs = getComputedStyle(at);
      if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return false;
    }
    return true;
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
  title: string;
  lang: string;
  disabled: string[];
}

/**
 * H3 IS NOT ASKED HERE ANY MORE, AND THE REASON IS A RULING.
 *
 * This file used to walk the tab order and call focus invisible unless the
 * focused control computed an OUTLINE — `outlineStyle !== "none" &&
 * outlineWidth > 0`. It had already survived one correction: the first
 * version called `element.focus()` from a script, which does not match
 * `:focus-visible` in Chromium, and reported thirteen controls broken and
 * went on reporting twelve of them after the ring was added. Pressing Tab
 * fixed that. Nobody revisited the VERDICT.
 *
 * Then the founder ruled the ring away — "never show the white focus box
 * anywhere" — with the argument that this world already says where you are
 * the way it says everything else: with light. `global.css` sets
 * `:focus-visible { outline: none }` and every control was given its own
 * answer instead. So this check has since been demanding the one thing the
 * product is not allowed to do, and failing fourteen controls for obeying a
 * decision. An instrument that fails the build for following a ruling is
 * worse than no instrument; it teaches people to ignore it.
 *
 * The floor still stands, asked correctly, in `e2e:answers-the-hand`: it
 * tabs the same way and asks whether ANYTHING about the control changes
 * against its own resting state — colour, underline, glow, whatever the
 * design chose — which is the real question and the one an outline was only
 * ever a proxy for. It walks the door, the world, the poster's band, the
 * mouth and the account, so nothing this file used to cover is lost.
 *
 * `noFocus` went with it: the probe declared the field and never once pushed
 * to it, so every H3 finding this file ever printed came from the tab walk.
 */

async function audit(page: Page, surface: string): Promise<Finding[]> {
  const p = JSON.parse((await page.evaluate(PROBE)) as string) as Probe;
  const found: Finding[] = [];
  const add = (check: string, detail: string): void => void found.push({ check, surface, detail });

  for (const d of p.unnamed) add("H1 control has no name", d);
  for (const d of p.unlabelled) add("H2 field has no label", d);
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

  /* ═══ AND THE PLACES THE PRODUCT ACTUALLY HAS ═════════════════════════
   *
   * This walked three surfaces — the door, the world, and the composer —
   * and had done since it was written. In the meantime the product grew a
   * bar with four destinations, a notepad, an opened note and a
   * conversation, and NONE of them was ever audited: every finding this
   * gate has ever reported came from a third of the product.
   *
   * That blindness is not a gap in coverage, it is the MECHANISM. On
   * 2026-10-11 a founder session turned up, in one sitting, a list the gate
   * should have caught and could not have: three tab stops that were
   * invisible, a destination list with `outline: none` on every row, a bar
   * whose focus state was a colour change that did nothing on the row you
   * were standing on, and an open conversation with no way back to its own
   * list. Each one is an H3 or an H1 — exactly what the probe below asks —
   * on a surface the probe had never been pointed at.
   *
   * So the walk follows the dock. Every destination, the two things the
   * plus makes, one of each opened, and the account page. A surface that
   * cannot be reached is reported by name rather than skipped silently,
   * because "the gate did not visit it" and "the gate found nothing" have
   * looked identical here for too long.
   */
  await openTheNotepad(page);
  await page.waitForTimeout(900);
  found.push(...(await audit(page, "the notepad")));

  /** Press a row in the dock by its own words, and say so if it is not there. */
  const toDock = async (label: string): Promise<boolean> => {
    const row = page.locator(".waka-dock-item", { hasText: new RegExp(`^${label}$`) }).first();
    if ((await row.count()) === 0) {
      found.push({ check: "the dock does not offer this place", surface: label, detail: "no row with this name" });
      return false;
    }
    await row.click();
    await page.waitForTimeout(1_800);
    return true;
  };

  /* Something to open, so the archive and a note are audited with content
     in them rather than as empty states — an empty list has no rows, and a
     row is where the unnamed controls live. */
  await page.fill(".jar-composer-text", "A thought kept so the archive has something in it.");
  await page.waitForTimeout(400);
  await page.locator(".waka-dock-tool--keep").click();
  await page.waitForTimeout(4_500);

  if (await toDock("Inspirations")) {
    found.push(...(await audit(page, "your inspirations")));
    const row = page.locator(".waka-list-row").first();
    if (await row.count()) {
      await row.click();
      await page.waitForTimeout(1_200);
      found.push(...(await audit(page, "a note opened")));
      await page.locator(".waka-over-back").first().click();
      await page.waitForTimeout(1_200);
    }
  }

  if (await toDock("Chats")) {
    found.push(...(await audit(page, "your chats")));
  }

  /* A conversation, from the door the product offers rather than an address:
     the gate should break when the door breaks. */
  await page.locator(".waka-dock-item--new").first().click();
  await page.waitForTimeout(500);
  await page.locator(".waka-new-one").last().click();
  await page.waitForTimeout(2_500);
  found.push(...(await audit(page, "a conversation")));

  if (await toDock("Principles")) {
    found.push(...(await audit(page, "your principles")));
  }

  await page.goto(`${BASE}/profile`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3_000);
  found.push(...(await audit(page, "your account")));

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
      ? "\n[usability] clean — every control named, every field labelled, errors legible (focus is `e2e:answers-the-hand`'s floor)"
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
