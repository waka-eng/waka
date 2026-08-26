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
 * It walks the chrome — the door on both tabs, the account page and the
 * welcome — because the world has its own gates and the chrome had none.
 */
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";
async function main() {
  const out = process.argv[2] ?? "snap.json";
  const base = "http://127.0.0.1:3010";
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
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
  writeFileSync(out, JSON.stringify(snap));
  console.log("wrote", out, Object.entries(snap).map(([k, v]) => `${k}:${v.length}`).join(" "));
  await b.close();
}
main().then(() => process.exit(0));
