/**
 * The demo world, verified scene by scene — the same headless walk that
 * produced the 2026-08-23 screenshots, committed. goal: no-quiet-corners,
 * Track D.
 *
 * Reads the seed's credentials JSON from DEMO_CREDS (the seed prints it as
 * its last line) or from a file path in argv[2]. Logs in, walks the three
 * scenes of the README's shot list, screenshots each into
 * tools/demo/shots/, and exits non-zero naming any scene whose marker is
 * not on screen. Everything on screen within a minute of login is the
 * gate; the timeouts below sum well under it.
 *
 *   node tools/demo/walk.mjs creds.json
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/* `PLAYWRIGHT_MODULE` lets a sandbox point at a shared install; a normal
   checkout resolves the plain package. */
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const HERE = dirname(fileURLToPath(new URL(import.meta.url)));
const OUT = join(HERE, "shots");
mkdirSync(OUT, { recursive: true });

const BASE = process.env.WAKA_DEMO_BASE_URL ?? "http://localhost:3010";
const creds = process.env.DEMO_CREDS
  ? JSON.parse(process.env.DEMO_CREDS)
  : JSON.parse(readFileSync(process.argv[2], "utf8"));

const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: creds.email, password: creds.password }),
});
if (!loginRes.ok) {
  console.error(`login failed: ${loginRes.status}`);
  process.exit(1);
}
const cookies = loginRes.headers.getSetCookie().map((line) => {
  const [pair] = line.split(";");
  const eq = pair.indexOf("=");
  return {
    name: pair.slice(0, eq),
    value: pair.slice(eq + 1),
    /* THE DOMAIN HAS TO BE THE ONE WE ARE ACTUALLY DIALLING.
       This said `"localhost"` while `BASE` is configurable, so pointing the
       walk at 127.0.0.1 — the address the gates use, because `localhost`
       resolves IPv6-first on some machines and IPv4-first on others — put a
       cookie on a host the browser never visits. The walk then loads a signed
       OUT world and dies thirty seconds later waiting for a poster, which
       says nothing about the cause. Take the host from the URL. */
    domain: new URL(BASE).hostname,
    path: "/",
    httpOnly: true,
    secure: false,
    sameSite: "Lax",
  };
});

const browser = await chromium.launch({
  /* the same rule `tools/e2e/browser.ts` states for the gates: an explicit
     answer wins, then Playwright's own resolution, and the container's flat
     layout only if that file is really on this disk. A path asserted rather
     than checked is a machine's name embedded in a script. */
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM ??
    (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined),
  args: ["--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addCookies(cookies);
/* offline-safe: font hosts answer empty rather than hanging a sandboxed run */
for (const host of [
  "https://cdn.jsdelivr.net/**",
  "https://fonts.googleapis.com/**",
  "https://fonts.gstatic.com/**",
]) {
  await context.route(host, (route) =>
    route.fulfill({ status: 200, contentType: "text/css", body: "/* stubbed */" }),
  );
}
const page = await context.newPage();
page.on("pageerror", (e) => console.error("pageerror:", String(e).slice(0, 200)));

const failures = [];
let shot = 0;
async function scene(name, marker) {
  shot += 1;
  const label = `${String(shot).padStart(2, "0")}-${name}`;
  let ok = false;
  try {
    ok = await marker();
  } catch (err) {
    console.error(`${label}: ${String(err).slice(0, 200)}`);
  }
  await page.screenshot({ path: join(OUT, `${label}.png`) });
  console.log(`${ok ? "OK  " : "MISS"} ${label}`);
  if (!ok) failures.push(label);
}

const visible = async (text, timeout = 15_000) => {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
};

await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
/* the pour: the world draws before anything moves */
await page.waitForSelector('h1.jar-poster[data-jar-chrome="1"]', { timeout: 30_000 });
await page.waitForTimeout(2_500);

/* Scene 1 — the poster: one sentence, the person's headquarters. */
await scene("poster", async () => {
  const words = await page
    .locator('h1.jar-poster[data-jar-chrome="1"]')
    .first()
    .textContent();
  return Boolean(words && words.trim().length > 0);
});

/* Scene 2 — what it stands on: press the poster; the grounds light by who
   holds them, the memories beneath carry their quoted spans. */
await scene("standing-on", async () => {
  /* element-level click: the world's canvas layers can sit over the poster
     at pointer level, and the scene is about what renders, not hit-testing */
  await page.$eval('h1.jar-poster[data-jar-chrome="1"]', (el) => el.click());
  await page.waitForTimeout(800);
  return (await visible("standing on", 8_000)) || (await visible("built from", 8_000));
});

/* Scene 3 — how it reads you: the loop's rules, drift-pinned. */
await scene("the-reading", async () => {
  /* THE `≡` MENU IS GONE and has been since Phase 1 of
     everything-in-the-world — "the control is gone; nothing matches
     jar-flatmenu in packages/web/src". This clicked it anyway, and
     `page.$eval` THROWS on a selector that matches nothing, so this scene
     failed outright rather than reporting a missing door. The reading lives
     behind the account panel now, which is where the world's own
     housekeeping went. */
  /* AND `.jar-account` WENT THE SAME WAY AS `.jar-flatmenu` BEFORE IT.
     The pill in the top bar was removed when settings stopped being a page
     — founder: "I want all setting-related stuff to be only accessible
     through the drop down and not be its own thing" — so `page.$eval`
     threw on it exactly as the comment above describes, and this scene
     failed outright again. The cog in the right corner is the door now;
     `e2e:first-sixty` presses the same one, by its modifier, because that
     corner has held two buttons since 2026-10-11. */
  await page.$eval("button.waka-corner--settings", (el) => el.click());
  await page.waitForTimeout(400);
  await page.getByText("how it reads you", { exact: false }).first().click();
  const ok = await visible("never rewritten", 10_000);
  /* leave the world as we found it: the panel's own close button */
  await page
    .getByRole("button", { name: "close" })
    .first()
    .click()
    .catch(() => {});
  await page.waitForTimeout(400);
  return ok;
});

/* ═══════════════════════════════════════════════════════════════════════
   SCENES 4, 5 AND 6 ARE DELETED — ALL THREE WERE THE ROOM (2026-10-15)
   ═══════════════════════════════════════════════════════════════════════

     4. `the-room`        travel to "the reading circle" and read its wall
     5. `counted-stance`  the open proposal with its one counted no
     6. `the-door`        who is in the room, and the mark of who passed
                          through — "Bo", "Dee", "the room so far"

   Rooms came out of the web in `405ee4aa`, and with them every door these
   three went through: `.jar-here-more` and `.jar-here-row` (the walls list
   this used to travel by), `.jar-here` (the name pill `openRoomPanel`
   toggled), and the whole proposals flow and member ground that scenes 5
   and 6 read. None of those classes has a renderer.

   THE DEMO IS WHERE THIS KIND OF ROT LIVES LONGEST, and this file already
   knew it: the tombstone for `.jar-eyebrow-door` says the demo "has been
   failing this scene, ten seconds at a time, for four days" because "the
   demo is not a gate and nobody runs it between demos". Three scenes were
   about to be in exactly that state again — four failures of ten seconds
   each, then `3 scene(s) missing`, read by whoever is about to present.

   WHAT COVERAGE WENT: the demo no longer shows a room, a shared reading, a
   counted stance or the door's marks. That is the demo following the
   product rather than a gap — none of those surfaces exists to be shown.
   `openRoomPanel` went with them; it had no other caller.

   The first three scenes stand: the poster, the wall you are standing on,
   and how the reading reads you. */

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} scene(s) missing: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nall three scenes on screen — the demo world stands");
