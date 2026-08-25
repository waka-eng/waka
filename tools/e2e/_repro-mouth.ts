/** The mouth's two faces, the panel's pair and verbs, and the dial's place. */
import { chromium } from "playwright";
import { signUp, capture } from "./organic.js";

const BASE = process.env.WAKA_BASE ?? "http://localhost:3010";
const PASSWORD = "repro-mouth-2026";

async function main(): Promise<number> {
  const s = await signUp({ baseUrl: BASE, password: PASSWORD, name: "Mouth Repro" });
  for (const text of ["A first thing I kept.", "A second thing I kept."]) await capture(s, { text });

  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`PAGEERROR ${e.message}`));
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("input[name=email]", s.email);
  await page.fill("input[name=password]", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForTimeout(9_000);

  await page.mouse.move(720, 450);
  for (let i = 0; i < 14; i++) { await page.mouse.wheel(0, 300); await page.waitForTimeout(90); }
  await page.waitForTimeout(1_500);

  const dial = await page.locator(".jar-dial").boundingBox();
  const axis = await page.locator(".jar-axis").boundingBox();
  console.log("[dial] band:", JSON.stringify(dial));
  console.log("[dial] axis:", JSON.stringify(axis));
  console.log("[dial] stacked above the axis:", !!dial && !!axis && dial.y + dial.height <= axis.y + 2);

  const rest = page.locator(".jar-mouth-rest");
  console.log("[mouth] resting face:", await rest.count());
  await rest.click();
  await page.waitForTimeout(400);
  await page.keyboard.type("a short one");
  await page.waitForTimeout(500);
  console.log("[mouth] one-line verbs:", JSON.stringify(await page.locator(".jar-mouth-do button").allTextContents()));
  console.log("[mouth] one-line where:", JSON.stringify(await page.locator(".jar-mouth-where:not(.jar-mouth-do) button").allTextContents()));
  await page.screenshot({ path: "/tmp/claude-0/-home-user/5b396cd9-e561-5eb6-a278-c5f71e440799/scratchpad/mouth-line.png" });

  await page.keyboard.press("Enter");
  await page.waitForTimeout(2_500);
  console.log("[mouth] kept on Enter, mouth back at rest:", await page.locator(".jar-mouth-rest").count());

  await page.locator(".jar-mouth-rest").click();
  await page.waitForTimeout(300);
  await page.keyboard.type("a long one.\n" + "x".repeat(220));
  await page.waitForTimeout(900);
  console.log("[sheet] verbs:", JSON.stringify(await page.locator(".jar-mouth-do button").allTextContents()));
  console.log("[sheet] shoulder pair:", JSON.stringify(await page.locator(".jar-mouth-where--sheet button").allTextContents()));
  console.log("[sheet] minimize:", JSON.stringify(await page.locator(".jar-mouth-step").allTextContents()));
  await page.screenshot({ path: "/tmp/claude-0/-home-user/5b396cd9-e561-5eb6-a278-c5f71e440799/scratchpad/sheet.png" });
  await page.locator(".jar-mouth-step").click();
  await page.waitForTimeout(700);
  console.log("[sheet] minimized:", ((await page.locator(".jar-mouth-slot").getAttribute("class")) ?? "").includes("--min"));
  await page.locator(".jar-mouth-lift").click();
  await page.waitForTimeout(700);
  console.log("[sheet] restored:", !((await page.locator(".jar-mouth-slot").getAttribute("class")) ?? "").includes("--min"));
  await page.locator(".jar-mouth-do button", { hasText: /^save$/ }).click();
  await page.waitForTimeout(3_000);
  console.log("[sheet] saved, back at rest:", await page.locator(".jar-mouth-rest").count());

  // a memory panel: the pair at the top right, three verbs at the bottom
  let opened = false;
  outer: for (let y = 380; y <= 840 && !opened; y += 34) {
    for (let x = 160; x <= 1300; x += 46) {
      await page.mouse.click(x, y);
      await page.waitForTimeout(110);
      if (await page.locator(".jar-panel--in").count()) { opened = true; break outer; }
    }
  }
  console.log("[panel] opened:", opened);
  if (opened) {
    console.log("[panel] visibility pair:", JSON.stringify(await page.locator(".jar-panel-vis button").allTextContents()));
    const vis = await page.locator(".jar-panel-vis").boundingBox();
    const panel = await page.locator(".jar-panel--in").boundingBox();
    console.log("[panel] pair is top-right:", !!vis && !!panel && vis.x > panel.x + panel.width / 2 && vis.y < panel.y + 60);
    console.log("[panel] verbs:", JSON.stringify(await page.locator(".jar-neb-ask--after button").allTextContents()));
    await page.screenshot({ path: "/tmp/claude-0/-home-user/5b396cd9-e561-5eb6-a278-c5f71e440799/scratchpad/panel.png" });
    await page.locator(".jar-neb-ask--after button", { hasText: /^delete$/ }).click();
    await page.waitForTimeout(2_500);
    console.log("[panel] ask sheet (should be 0 — nothing was read from it):", await page.locator(".jar-forget-ask").count());
    console.log("[panel] panel closed by the delete:", await page.locator(".jar-panel--in").count() === 0);
  }
  console.log("[all] boundary:", await page.locator("#surface-error-title").count());
  console.log("[all] page errors:", JSON.stringify(errors));
  await browser.close();
  return 0;
}
main().then((c) => process.exit(c)).catch((e) => { console.error("FAILED", e); process.exit(3); });
