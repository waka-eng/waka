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
 * It walks the door on both tabs, the account card and each of its three
 * groups, the welcome, the world and the world with its mouth open.
 *
 * (It said "the account page" and walked `/profile`, which has not been a
 * route since 2026-10-11 and now redirects to the world — see the note at the
 * call. One of the four surfaces this file promises zero differences on was a
 * second copy of the world.)
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
import { openTheNotepad, saveAnInspiration } from "./keep";

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
  /* ═══ THE ACCOUNT SURFACE IS THE COG'S CARD, NOT `/profile` ══════════════
     THIS SNAPSHOTTED `/profile` AND CALLED THE RESULT `profile`, and the
     route stopped existing on 2026-10-11 — founder: "I want all
     setting-related stuff to be only accessible through the drop down and not
     be its own thing", with `main.tsx` carrying the ruling.

     WHY THAT IS PARTICULARLY BAD IN THIS FILE, AND IT IS NOT A TIMEOUT.
     `/profile` does not 404 and does not hang. `main.tsx` has a `/:handle`
     route, so the address matches it; `PublicProfile.tsx` sees a handle that
     does not start with `@` and answers `<Navigate to="/" replace />`. The
     walk lands on THE WORLD. So the snapshot under the key `profile` was a
     second snapshot of the world — nearly a duplicate of the `world` key
     taken two steps later, filed as a chrome surface.

     This file's whole purpose is to let a stylesheet deletion be PROVED INERT
     by diffing two snapshots, and the header promises "zero differences of
     any kind" on its four chrome surfaces while warning that the world's
     geometry legitimately moves between runs. One of those four WAS the
     world. So the recipe would have shown differences on a chrome surface and
     the reader would have gone looking for a deleted rule — and separately,
     every rule that only ever renders on the account card was outside the
     measurement entirely, so a deletion that broke one of them diffed clean.
     Wrong in both directions at once, from one address.

     The key is renamed with the surface, because a snapshot's key is how the
     two runs are lined up: keeping `profile` would have diffed a card against
     an error page the first time anyone ran this across the change. */
  await p.goto(base + "/", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(6000);
  /* BY THE MODIFIER, NOT `.first()` — the right corner has held two buttons
     since 2026-10-11, an "i" beside the cog, and the left corner has worn
     `.waka-corner` the whole time. */
  await p.locator("button.waka-corner--settings").click({ timeout: 8000 });
  await p.waitForTimeout(1200);
  snap["settings-card"] = JSON.parse((await p.evaluate(PROBE)) as string);
  /* AND EACH GROUP OPEN, because the card's three disclosures UNMOUNT their
     contents rather than hiding them — so a snapshot of the folded card holds
     none of the rules inside them, which is the same blindness the walk to
     `/profile` had and is worth not repeating one surface along. */
  const groups = await p.locator(".waka-settings-row").count();
  for (let i = 0; i < groups; i += 1) {
    await p.locator(".waka-settings-row").nth(i).click({ timeout: 5000 });
    await p.waitForTimeout(600);
    snap[`settings-group-${i + 1}`] = JSON.parse((await p.evaluate(PROBE)) as string);
    await p.locator(".waka-settings-row").nth(i).click({ timeout: 5000 });
    await p.waitForTimeout(300);
  }
  await p.keyboard.press("Escape");
  await p.waitForTimeout(400);
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
    await saveAnInspiration(p, text);
    await p.waitForTimeout(4500);
  }
  await p.goto(base + "/", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(6000);
  snap["world"] = JSON.parse((await p.evaluate(PROBE)) as string);
  await openTheNotepad(p);
  await p.waitForTimeout(1200);
  snap["world-mouth"] = JSON.parse((await p.evaluate(PROBE)) as string);
  writeFileSync(out, JSON.stringify(snap));
  console.log("wrote", out, Object.entries(snap).map(([k, v]) => `${k}:${v.length}`).join(" "));
  await b.close();
}
main().then(() => process.exit(0));
