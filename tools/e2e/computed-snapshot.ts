#!/usr/bin/env tsx
/**
 * EVERY COMPUTED STYLE ON EVERY ELEMENT, WRITTEN DOWN SO A CHANGE CAN BE
 * PROVED INERT RATHER THAN ARGUED TO BE.
 *
 * goal: one-product-one-system, audit A4. `e2e:dead-css` finds rules whose
 * every declaration was beaten; this is what you run to show that deleting
 * them changed nothing. It was written for exactly that: fifteen rules across
 * `global.css`, `chrome.css` and `system.css` came out on the strength of it,
 * and the diff over 163 elements on four surfaces was ZERO.
 *
 * The recipe, which is the whole point of the file:
 *
 *     pnpm e2e:snapshot /tmp/after.json     # with your change applied
 *     git stash push -- packages/web/src/styles/
 *     pnpm e2e:snapshot /tmp/before.json    # without it
 *     git stash pop
 *     # then diff the two by element and property
 *
 * WHY A SNAPSHOT AND NOT AN ASSERTION. A gate says a rule holds; this says
 * nothing at all moved. For a deletion those are different claims, and the
 * second is the one that matters: a deletion cannot be checked against a
 * remembered intention, only against what the browser did before it. The
 * properties are the ones a deleted rule could plausibly have decided, plus
 * the element's own box, because a layout property going missing shows up as
 * geometry long before it shows up as a colour.
 *
 * It walks the door on both tabs, the account page, the welcome, the world
 * and the world with its mouth open.
 *
 * READ THE WORLD'S GEOMETRY WITH ONE EYE CLOSED. Each run signs up a NEW
 * account, and the world generates its poster from what that account has
 * kept — so `.jar-word` widths and the poster's height differ between any two
 * runs whether or not anything changed. That is content, not style, and a
 * fourth CSS deletion showed up as 49 world differences of which every single
 * one was `width`, `height` or the box, with no `font-size`, `letter-spacing`
 * or `color` among them.
 *
 * So: on the four chrome surfaces, expect zero differences of any kind. On
 * the two world surfaces, judge the TYPE and COLOUR properties, and treat a
 * geometry difference as evidence only when a type property moved with it.
 */
import { writeFileSync } from "node:fs";
import { launchChromium } from "./browser";

async function main() {
  const out = process.argv[2] ?? "snap.json";
  const base = "http://127.0.0.1:3010";
  const b = await launchChromium();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const PROBE = `(() => {
    const out = [];
    const want = ["display","position","color","background-color","font-size","font-weight","letter-spacing",
      "text-transform","padding-top","padding-bottom","padding-left","padding-right","margin-top","border-bottom-color",
      "border-width","border-radius","min-height","width","height","opacity","outline-color","align-items","justify-content","gap","flex"];
    let i = 0;
    for (const e of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      const cls = typeof e.className === "string" ? e.className : "";
      const key = e.tagName.toLowerCase() + "." + cls.trim().replace(/\\s+/g, ".") + "#" + (i++);
      const vals = {};
      for (const w of want) vals[w] = cs.getPropertyValue(w);
      vals["_box"] = Math.round(r.width) + "x" + Math.round(r.height) + "@" + Math.round(r.x) + "," + Math.round(r.y);
      out.push([key, vals]);
    }
    return JSON.stringify(out);
  })()`;
  const snap: Record<string, Array<[string, Record<string, string>]>> = {};
  await p.goto(base + "/login", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(3000);
  snap["door-signin"] = JSON.parse((await p.evaluate(PROBE)) as string);
  await p.click("#login-tab-signup");
  await p.waitForTimeout(1200);
  snap["door-signup"] = JSON.parse((await p.evaluate(PROBE)) as string);
  await p.fill("input[name=email]", `snap-${Date.now()}@example.test`);
  await p.fill("input[name=password]", "snap-password-1");
  await p.fill("input[name=name]", "Snap");
  await p.click("button[type=submit]");
  await p.waitForTimeout(8000);
  await p.goto(base + "/profile", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(4000);
  snap["profile"] = JSON.parse((await p.evaluate(PROBE)) as string);
  await p.goto(base + "/onboarding", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(3000);
  snap["onboarding"] = JSON.parse((await p.evaluate(PROBE)) as string);

  /* AND THE WORLD, because a change to the type register is not a chrome
     change: the same register is worn by the signposts, the quiet verbs and
     the card. The first version of this walked only the door and the account
     page, which was right for proving a chrome-only deletion inert and would
     be quietly blind to half of a design-system edit. */
  await p.goto(base + "/", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(6000);
  for (const text of [
    "a register worn in two places is two registers",
    "the same words, the same voice, on every surface",
  ]) {
    await p.locator(".jar-mouth-rest").first().click();
    await p.waitForTimeout(700);
    await p.fill('textarea.jar-mouth-field', text);
    await p.locator(".jar-mouth-where button", { hasText: /^save$/ }).first().click();
    await p.waitForTimeout(4500);
  }
  await p.goto(base + "/", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(6000);
  snap["world"] = JSON.parse((await p.evaluate(PROBE)) as string);
  await p.locator(".jar-mouth-rest").first().click();
  await p.waitForTimeout(1200);
  snap["world-mouth"] = JSON.parse((await p.evaluate(PROBE)) as string);
  writeFileSync(out, JSON.stringify(snap));
  console.log("wrote", out, Object.entries(snap).map(([k, v]) => `${k}:${v.length}`).join(" "));
  await b.close();
}
main().then(() => process.exit(0));
