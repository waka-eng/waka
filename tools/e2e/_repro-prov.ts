/** Walk the founder's five: the way up, the room of grounds (which must not
 *  move the world), the mouth's verbs, and the panel's private/public pair. */
import { chromium } from "playwright";
import { signUp, capture } from "./organic.js";

const BASE = process.env.WAKA_BASE ?? "http://localhost:3010";
const PASSWORD = "repro-prov-2026";
const LINES = [
  "The pull between short-term financial gains and keeping users engaged.",
  "Every quarter the same argument: revenue now, or the thing people come back for.",
  "I keep choosing the long game and then apologising for it in the numbers meeting.",
  "Retention is the only number I actually believe, and it is the slowest one.",
  "We shipped the engagement hack and I have felt bad about it for a month.",
];

async function main(): Promise<number> {
  const s = await signUp({ baseUrl: BASE, password: PASSWORD, name: "Prov Repro" });
  for (const text of LINES) await capture(s, { text });
  // wait for the sky to actually have something in it
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 4_000));
    const res = await fetch(`${BASE}/api/signals`, { headers: { authorization: `Bearer ${s.token}` } });
    const body = (await res.json()) as { signals?: Array<{ status: string }> };
    const rows = body.signals ?? [];
    console.log("[prov] signals so far:", rows.length, JSON.stringify(rows.map((x) => x.status)));
    if (rows.some((x) => x.status === "emerging")) break;
  }

  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`PAGEERROR ${e.message}\n${e.stack ?? ""}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("input[name=email]", s.email);
  await page.fill("input[name=password]", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForTimeout(10_000);

  const up = page.locator(".jar-overhead");
  console.log("[prov] way up at top:", await up.count(), JSON.stringify((await up.allTextContents()).join("")));
  if (await up.count()) {
    const box = await up.boundingBox();
    console.log("[prov] way up box:", JSON.stringify(box));
    await up.click();
    await page.waitForTimeout(4_000);
  }

  // read a signal, then ask where from
  const sentences = page.locator(".jar-neb-text");
  console.log("[prov] statements overhead:", await sentences.count());
  if (await sentences.count()) {
    await sentences.first().click();
    await page.waitForTimeout(1_500);
    const verb = page.locator(".jar-neb-ask button", { hasText: /^where from$/ });
    console.log("[prov] where-from present:", await verb.count());
    if (await verb.count()) {
      const camBefore = await page.evaluate(() => document.querySelector(".jar-hq")?.getAttribute("style") ?? "");
      await verb.first().click();
      await page.waitForTimeout(1_200);
      const room = page.locator(".jar-prov-room");
      console.log("[prov] room open:", await room.count());
      console.log("[prov] room lead:", JSON.stringify((await page.locator(".jar-prov-room-lead").allTextContents()).join("")).slice(0, 120));
      const rows = page.locator(".jar-prov-room .jar-prov-row");
      console.log("[prov] rows:", await rows.count());
      console.log("[prov] idle copy:", JSON.stringify((await page.locator(".jar-prov-room-idle").allTextContents()).join("")));
      if (await rows.count()) {
        await rows.first().click();
        await page.waitForTimeout(2_500);
        const full = (await page.locator(".jar-prov-room-text").allTextContents()).join("");
        console.log("[prov] full memory shown:", JSON.stringify(full).slice(0, 140));
      }
      const camAfter = await page.evaluate(() => document.querySelector(".jar-hq")?.getAttribute("style") ?? "");
      console.log("[prov] world moved while reading grounds:", camBefore !== camAfter);
      await page.screenshot({ path: "/tmp/claude-0/-home-user/5b396cd9-e561-5eb6-a278-c5f71e440799/scratchpad/prov-room.png" });
      await page.locator(".jar-prov-room button", { hasText: /^enough$/ }).click();
      await page.waitForTimeout(600);
    }
  }

  // the mouth: verbs on the short face, then the long sheet
  await page.mouse.move(720, 450);
  for (let i = 0; i < 14; i++) { await page.mouse.wheel(0, 300); await page.waitForTimeout(100); }
  await page.waitForTimeout(1_500);
  const rest = page.locator(".jar-mouth-rest");
  if (await rest.count()) {
    await rest.click();
    await page.waitForTimeout(500);
    await page.keyboard.type("a short one");
    await page.waitForTimeout(600);
    console.log("[mouth] short face verbs:", JSON.stringify(await page.locator(".jar-mouth-do button").allTextContents()));
    console.log("[mouth] short face where:", JSON.stringify(await page.locator(".jar-mouth-where:not(.jar-mouth-do) button").allTextContents()));
    await page.keyboard.type("\n" + "x".repeat(200));
    await page.waitForTimeout(800);
    console.log("[mouth] sheet verbs:", JSON.stringify(await page.locator(".jar-mouth-do button").allTextContents()));
    console.log("[mouth] minimize present:", await page.locator(".jar-mouth-step").count(), JSON.stringify(await page.locator(".jar-mouth-step").allTextContents()));
    await page.screenshot({ path: "/tmp/claude-0/-home-user/5b396cd9-e561-5eb6-a278-c5f71e440799/scratchpad/mouth-sheet.png" });
    await page.locator(".jar-mouth-step").click();
    await page.waitForTimeout(700);
    console.log("[mouth] minimized:", (await page.locator(".jar-mouth-slot").getAttribute("class") ?? "").includes("--min"));
    await page.locator(".jar-mouth-lift").click();
    await page.waitForTimeout(700);
    console.log("[mouth] restored:", !((await page.locator(".jar-mouth-slot").getAttribute("class") ?? "").includes("--min")));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }

  console.log("[prov] dial at bottom:", await page.locator(".jar-dial").count(),
    JSON.stringify(await page.locator(".jar-dial").boundingBox()));
  console.log("[prov] boundary:", await page.locator("#surface-error-title").count());
  console.log("[prov] errors:\n" + errors.filter((e) => !/jsdelivr|fonts\.googleapis|401/.test(e)).join("\n---\n"));
  await browser.close();
  return 0;
}
main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(3); });
