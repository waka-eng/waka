const { chromium } = require("/opt/node22/lib/node_modules/playwright");
(async () => {
  const [email, password, dir] = process.argv.slice(2);
  const b = await chromium.launch({ args: ["--no-proxy-server"] });
  const p = await b.newPage({ viewport: { width: 1512, height: 950 } });
  p.on("pageerror", (e) => console.log("PAGE ERROR:", e.message, "\n", (e.stack || "").split("\n").slice(0, 6).join("\n")));
  p.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE:", m.text().slice(0, 300)); });
  await p.goto("http://localhost:3010/login", { waitUntil: "domcontentloaded" });
  await p.fill('input[type="email"]', email);
  await p.fill('input[type="password"]', password);
  await p.click('button[type="submit"]');
  await p.waitForTimeout(7000);

  await p.locator(".jar-mouth-rest").click();
  await p.waitForTimeout(400);
  const ta = p.locator("textarea").first();
  await ta.click();
  await ta.fill("A real post pasted into a real world with orbs behind it.\n".repeat(20));
  await p.waitForTimeout(900);
  await p.locator(".jar-mouth-reflect").click();
  await p.waitForTimeout(6000);
  const state = await p.evaluate(() => ({
    boundary: /didn.t load/i.test(document.body.innerText),
    panel: !!document.querySelector(".jar-panel"),
    tail: document.body.innerText.slice(-200).replace(/\n+/g, " | "),
  }));
  console.log("boundary shown:", state.boundary, "| panel:", state.panel);
  console.log("tail:", state.tail);
  await p.screenshot({ path: `${dir}/crash-repro.png` });
  await b.close();
})();
