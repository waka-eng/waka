import { launchChromium } from "/Users/yunjichung/waka-fix-dev-sst-v3/tools/e2e/browser";
const OUT = "/Users/yunjichung/waka-fix-dev-sst-v3/packages/web/scratch";

const SNIFF = (sel: string, force: boolean) => `(() => {
  var el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return "ABSENT";
  if (${force}) el.disabled = true;
  var cs = getComputedStyle(el);
  var rules = [];
  var sheets = Array.from(document.styleSheets);
  for (var i = 0; i < sheets.length; i++) {
    var list; try { list = sheets[i].cssRules; } catch (e) { continue; }
    var stack = [[list, "(unlayered)"]];
    while (stack.length) {
      var top = stack.pop(); var rs = top[0]; var layer = top[1];
      for (var j = 0; j < rs.length; j++) {
        var a = rs[j];
        if (a.cssRules && a.selectorText === undefined) { stack.push([a.cssRules, a.name !== undefined ? "@layer " + a.name : layer]); continue; }
        if (!a.selectorText) continue;
        var m = false; try { m = el.matches(a.selectorText); } catch (e) { continue; }
        if (!m) continue;
        var t = a.style.cssText;
        if (/border|outline|box-shadow|opacity|background/.test(t)) rules.push(layer + " || " + a.selectorText + " {" + t + "}");
      }
    }
  }
  var parents = []; var n = el;
  while (n && parents.length < 14) { parents.push(n.tagName.toLowerCase() + "." + (n.className || "-")); n = n.parentElement; }
  return { disabled: el.disabled, cs: { border: cs.border, borderColor: cs.borderTopColor, borderStyle: cs.borderTopStyle, borderWidth: cs.borderTopWidth, borderRadius: cs.borderRadius, outline: cs.outline, boxShadow: cs.boxShadow, opacity: cs.opacity, bg: cs.backgroundColor, color: cs.color, minHeight: cs.minHeight, padding: cs.padding }, rules: rules, parents: parents };
})()`;

const b = await launchChromium({ headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto("http://localhost:3010/login");
await p.click("#login-tab-signup");
await p.fill("input[name=email]", `s-${Date.now()}@example.test`);
await p.fill("input[name=password]", "s-local-password-1");
await p.fill("input[name=name]", "S"); await p.click("button[type=submit]");
await p.waitForTimeout(9000);
await p.goto("http://localhost:3010/?compose=1");
await p.waitForTimeout(3000);
await p.fill(".jar-composer-text", "probe words for the save button");
await p.waitForTimeout(1500);
console.log("=== ENABLED SAVE ===");
console.log(JSON.stringify(await p.evaluate(SNIFF('[aria-label="Save inspiration"]', false)), null, 2));
await p.locator(".waka-dock-making").screenshot({ path: `${OUT}/10-dock-enabled.png` });
console.log("=== FORCED-DISABLED (same element) ===");
console.log(JSON.stringify(await p.evaluate(SNIFF('[aria-label="Save inspiration"]', true)), null, 2));
await p.locator(".waka-dock-making").screenshot({ path: `${OUT}/11-dock-forced-disabled.png` });
await b.close();
