import { launchChromium } from "/Users/yunjichung/waka-fix-dev-sst-v3/tools/e2e/browser";
import { writeFileSync } from "node:fs";

const OUT = "/Users/yunjichung/waka-fix-dev-sst-v3/packages/web/scratch";
const b = await launchChromium({ headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
p.on("console", (m) => { if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 200)); });
await p.goto("http://localhost:3010/login");
await p.click("#login-tab-signup");
const email = `s-${Date.now()}@example.test`;
await p.fill("input[name=email]", email);
await p.fill("input[name=password]", "s-local-password-1");
await p.fill("input[name=name]", "S");
await p.click("button[type=submit]");
await p.waitForTimeout(9000);
console.log("after signup url:", p.url());
writeFileSync(`${OUT}/email.txt`, email);

await p.goto("http://localhost:3010/?compose=1");
await p.waitForTimeout(3000);
await p.screenshot({ path: `${OUT}/01-compose-empty.png` });

// Does a Save exist on an empty note?
const emptyCount = await p.locator('[aria-label="Save inspiration"]').count();
console.log("Save count on EMPTY new note:", emptyCount);

// type something
const ta = p.locator("textarea").first();
await ta.click();
await ta.type("probe words for the save button");
await p.waitForTimeout(1200);
await p.screenshot({ path: `${OUT}/02-compose-typed.png` });
const typedCount = await p.locator('[aria-label="Save inspiration"]').count();
console.log("Save count on TYPED new note:", typedCount);

const probe = async () => p.evaluate(() => {
  const el = document.querySelector('[aria-label="Save inspiration"]') as HTMLElement | null;
  if (!el) return null;
  const cs = getComputedStyle(el);
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let list: CSSRuleList;
    try { list = sheet.cssRules; } catch { continue; }
    const walk = (rs: CSSRuleList, layer: string) => {
      for (const r of Array.from(rs)) {
        const anyr = r as any;
        if (anyr.cssRules && anyr.selectorText === undefined) {
          walk(anyr.cssRules, anyr.name !== undefined ? `@layer ${anyr.name}` : layer);
          continue;
        }
        if (!anyr.selectorText) continue;
        let matches = false;
        try { matches = el.matches(anyr.selectorText); } catch { continue; }
        if (!matches) continue;
        const t = anyr.style.cssText as string;
        if (/border|outline|box-shadow|opacity|background/.test(t)) {
          rules.push(`${layer} | ${anyr.selectorText} {${t}}`);
        }
      }
    };
    walk(list, "(unlayered)");
  }
  const parents: string[] = [];
  let n: HTMLElement | null = el;
  while (n && parents.length < 12) { parents.push(`${n.tagName.toLowerCase()}.${n.className || "-"}`); n = n.parentElement; }
  return {
    disabled: (el as HTMLButtonElement).disabled,
    computed: {
      border: cs.border, borderTopWidth: cs.borderTopWidth, borderTopColor: cs.borderTopColor,
      borderTopStyle: cs.borderTopStyle, borderRadius: cs.borderRadius,
      outline: cs.outline, boxShadow: cs.boxShadow, opacity: cs.opacity,
      background: cs.backgroundColor, color: cs.color,
      minHeight: cs.minHeight, minWidth: cs.minWidth, padding: cs.padding,
    },
    rules, parents,
  };
});

// clear the textarea to get the disabled state while Save is present (if it stays)
console.log("=== ENABLED (typed) ===");
console.log(JSON.stringify(await probe(), null, 2));

await ta.fill("");
await p.waitForTimeout(1200);
await p.screenshot({ path: `${OUT}/03-compose-cleared.png` });
console.log("Save count after CLEARING:", await p.locator('[aria-label="Save inspiration"]').count());

// Now make it disabled-but-present: type then trigger a blocked state? Instead, type a space-only? no.
// Use a recording-free path: temporarily disable via DOM is not representative.
// Instead save it, go to archive.
await ta.fill("probe inspiration one about bridges and clusters");
await p.waitForTimeout(1200);
await p.click('[aria-label="Save inspiration"]');
await p.waitForTimeout(5000);
console.log("after save url:", p.url());
await p.goto("http://localhost:3010/?open=saves");
await p.waitForTimeout(4000);
await p.screenshot({ path: `${OUT}/04-archive.png`, fullPage: false });
const html = await p.evaluate(() => document.body.innerHTML.length);
console.log("archive body len", html);
await b.close();
