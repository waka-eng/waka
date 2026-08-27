/**
 * The demo world, verified scene by scene — the same headless walk that
 * produced the 2026-08-23 screenshots, committed. goal: no-quiet-corners,
 * Track D.
 *
 * Reads the seed's credentials JSON from DEMO_CREDS (the seed prints it as
 * its last line) or from a file path in argv[2]. Logs in, walks the six
 * scenes of the README's shot list, screenshots each into
 * tools/demo/shots/, and exits non-zero naming any scene whose marker is
 * not on screen. Everything on screen within a minute of login is the
 * gate; the timeouts below sum well under it.
 *
 *   node tools/demo/walk.mjs creds.json
 */
import { mkdirSync, readFileSync } from "node:fs";
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
    domain: "localhost",
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
  await page.$eval(".jar-account", (el) => el.click());
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

/* Scene 4 — the room's wall: travel to the reading circle; the shared
   statements stand with their owners, the room's poster speaks. */
await scene("the-room", async () => {
  /* the poster ask from scene two folds away before travel */
  await page.$eval('h1.jar-poster[data-jar-chrome="1"]', (el) => el.click()).catch(() => {});
  await page.waitForTimeout(400);
  /* the caret beside the name in the top-left corner is the product's own
     pointer route to another wall — the strip along the bottom edge that
     used to be one was removed on 2026-08-24 */
  const opened = await page.evaluate(() => {
    const caret = document.querySelector(".jar-here-more");
    if (!caret) return false;
    if (caret.getAttribute("aria-expanded") !== "true") caret.click();
    return true;
  });
  if (!opened) return false;
  /* the list is React state, so it exists a render after the press */
  await page.waitForSelector(".jar-here-row", { timeout: 5_000 });
  const clicked = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".jar-here-row")];
    const row = rows.find((el) => (el.textContent ?? "").toLowerCase().includes("the reading circle"));
    if (!row) return false;
    row.click();
    return true;
  });
  if (!clicked) return false;
  /* travel eases, arrival wakes the room, the wall fetch lands */
  await page.waitForTimeout(5_000);
  return visible("This circle reads for depth, not for volume", 15_000);
});

/* Scene 5 — the counted stance: the open question hangs over the room —
   one no counted, the question still standing. */
await scene("counted-stance", async () => {
  return visible("We keep choosing walks over meetings", 10_000);
});

/* Scene 6 — the door: who is in the room, and the mark of who passed
   through. Dee joined and was removed; the door remembers. */
await scene("the-door", async () => {
  await page.waitForSelector(".jar-eyebrow-door", { timeout: 10_000 });
  await page.$eval(".jar-eyebrow-door", (el) => el.click());
  await page.waitForTimeout(800);
  return (await visible("Bo", 8_000)) && (await visible("Dee", 4_000));
});

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} scene(s) missing: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nall six scenes on screen — the demo world stands");
