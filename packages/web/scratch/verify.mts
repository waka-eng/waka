import { launchChromium } from "/Users/yunjichung/waka-fix-dev-sst-v3/tools/e2e/browser";
const OUT = "/Users/yunjichung/waka-fix-dev-sst-v3/packages/web/scratch";
const b = await launchChromium({ headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto("http://localhost:3010/login");
await p.click("#login-tab-signup");
await p.fill("input[name=email]", `v-${Date.now()}@example.test`);
await p.fill("input[name=password]", "s-local-password-1");
await p.fill("input[name=name]", "V"); await p.click("button[type=submit]");
await p.waitForTimeout(9000);
await p.evaluate(`fetch('/api/profiles',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Probe Agent'})}).then(function(r){return r.status})`);
await p.waitForTimeout(800);

const SAVE = '[aria-label="Save inspiration"]';
const look = `(() => {
  var el = document.querySelector('${SAVE}');
  if (!el) return 'ABSENT';
  var cs = getComputedStyle(el);
  var r = el.getBoundingClientRect();
  return { disabled: el.disabled, border: cs.border, outline: cs.outline, boxShadow: cs.boxShadow, opacity: cs.opacity, bg: cs.backgroundColor, color: cs.color, w: Math.round(r.width), h: Math.round(r.height) };
})()`;

// ── 1. NEW NOTE, EMPTY ────────────────────────────────────────────────
await p.goto("http://localhost:3010/?compose=1"); await p.waitForTimeout(3000);
console.log("NEW/EMPTY:", JSON.stringify(await p.evaluate(look)));
await p.locator(".waka-dock-making").screenshot({ path: `${OUT}/A1-new-empty.png` });
await p.screenshot({ path: `${OUT}/A1-full-new-empty.png` });

// ── 2. NEW NOTE, TYPED ────────────────────────────────────────────────
await p.fill(".jar-composer-text", "A probe inspiration about bridges"); await p.waitForTimeout(1500);
console.log("NEW/TYPED:", JSON.stringify(await p.evaluate(look)));
await p.locator(".waka-dock-making").screenshot({ path: `${OUT}/A2-new-typed.png` });
await p.click(SAVE); await p.waitForTimeout(6000);

// ── 3. ARCHIVE, OPEN NOTE, UNCHANGED ──────────────────────────────────
await p.goto("http://localhost:3010/?open=saves"); await p.waitForTimeout(4000);
await p.screenshot({ path: `${OUT}/A3-archive-list.png` });
const card = p.locator("button").filter({ hasText: "bridges" }).first();
await card.click({ timeout: 10000 }).catch(() => console.log("!! could not click the card"));
await p.waitForTimeout(2500);
console.log("SAVED/UNCHANGED:", JSON.stringify(await p.evaluate(look)));
await p.locator(`#waka-note-tools`).screenshot({ path: `${OUT}/A4-saved-unchanged.png` });
await p.screenshot({ path: `${OUT}/A4-full-saved-unchanged.png` });

// ── 4. ARCHIVE, OPEN NOTE, EDITED ─────────────────────────────────────
await p.fill(".waka-note-page", "A probe inspiration about bridges and clusters");
await p.waitForTimeout(1200);
console.log("SAVED/EDITED:", JSON.stringify(await p.evaluate(look)));
await p.locator(`#waka-note-tools`).screenshot({ path: `${OUT}/A5-saved-edited.png` });
await p.screenshot({ path: `${OUT}/A5-full-saved-edited.png` });

// ── 5. PRESS IT: it should write and dim again ────────────────────────
await p.click(SAVE); await p.waitForTimeout(4000);
console.log("SAVED/AFTER PRESS:", JSON.stringify(await p.evaluate(look)));
await p.locator(`#waka-note-tools`).screenshot({ path: `${OUT}/A6-saved-after-press.png` });
// and it really persisted
await p.goto("http://localhost:3010/?open=saves"); await p.waitForTimeout(4000);
console.log("PERSISTED:", await p.evaluate(`document.body.innerText.indexOf('bridges and clusters') >= 0`));

// ── 6. THE SWITCHER ───────────────────────────────────────────────────
const dump = `(() => {
  var g = document.querySelector('.jar-char-form');
  if (!g) return 'NO SWITCHER';
  return Array.from(g.querySelectorAll('button')).map(function(x){ return x.textContent + ' pressed=' + x.getAttribute('aria-pressed') + ' lit=' + /--standing/.test(x.className) + ' vis=' + !!x.offsetParent; });
})()`;
await p.goto("http://localhost:3010/"); await p.waitForTimeout(4000);
console.log("HOME:", await p.evaluate(dump));
await p.goto("http://localhost:3010/?open=conversations"); await p.waitForTimeout(4000);
console.log("CONVERSATIONS:", await p.evaluate(dump));
await p.screenshot({ path: `${OUT}/A7-conversations.png` });
await p.goto("http://localhost:3010/chat/new"); await p.waitForTimeout(4000);
console.log("IN A CHAT:", await p.evaluate(dump));
await p.screenshot({ path: `${OUT}/A8-in-chat.png` });
await p.goto("http://localhost:3010/?open=saves"); await p.waitForTimeout(3500);
console.log("SAVES (must still light Me):", await p.evaluate(dump));
await b.close();
