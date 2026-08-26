/**
 * HOW FAR ONE SHEET REACHES INTO ANOTHER'S SURFACE.
 *
 * goal: one-product-one-system, audit A4.
 *
 * `chrome.css` is imported by `main.tsx` unconditionally, so it is loaded on
 * EVERY route including the world's — and `layers.css` puts it in the last
 * layer, so it beats `home.css` at any specificity. That combination means a
 * bare ELEMENT selector in `chrome.css` is not a chrome rule at all. It is a
 * product-wide rule that happens to be written in the chrome's file, and it
 * wins.
 *
 * Four defects in one week came out of exactly that, and none of them looked
 * like a cascade problem from the file they were reported in:
 *
 *   THE WORLD'S HEADLINE, 6PX TOO BIG. `.jar-poster` is an `<h1>`, and a
 *   selector list here ended `h1, h2`. The poster won ONE of its own eight
 *   declarations; the other seven came from this sheet, including a
 *   `clamp(28px, 3vw, 40px)` over the world's `clamp(23px, 2.5vw, 34px)`.
 *
 *   THE ANSWER BOX WITH NO SIDE PADDING. `textarea` here gives `padding: 9px 0`
 *   and `background: none`, so the box rendered the person's words touching
 *   both edges of the sheet, and did not light when focused.
 *
 *   THE DRAWER'S WELL and THE MOUTH'S FONT SIZE, both found earlier and both
 *   fixed by moving one rule into `home.css`'s own `@layer chrome` block —
 *   twice, without either time sweeping for the siblings, which is why there
 *   were four.
 *
 * WHY THIS IS AN INVENTORY AND NOT A BAN. Some of these are legitimately
 * global: `:root` and `body` ARE the theme, and a theme is supposed to reach
 * everything. The rest are debt with a real cost, and the honest thing is to
 * list them so that the list can be argued with — and so that adding an
 * eighteenth requires deciding to, rather than typing a selector.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. The stylesheet is read as text.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = resolve(HERE, "../src/styles/chrome.css");

/**
 * Keyframe stops are `from`, `to` and percentages — they look like element
 * selectors to any regex and are not selectors at all, so the blocks that hold
 * them are removed before anything is counted.
 */
function withoutKeyframes(css: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf("@keyframes", i);
    if (at === -1) {
      out += css.slice(i);
      break;
    }
    out += css.slice(i, at);
    let depth = 0;
    let j = css.indexOf("{", at);
    if (j === -1) break;
    for (; j < css.length; j += 1) {
      if (css[j] === "{") depth += 1;
      else if (css[j] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    i = j + 1;
  }
  return out;
}

/** Every selector in the sheet that names no class, id or attribute. */
function bareSelectors(): string[] {
  const raw = readFileSync(CHROME, "utf8");
  const text = withoutKeyframes(raw).replace(/\/\*[\s\S]*?\*\//g, " ");
  const found = new Set<string>();
  for (const match of text.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    const list = (match[1] ?? "").split("}").pop() ?? "";
    if (list.trim().startsWith("@")) continue;
    for (const piece of list.split(",")) {
      const one = piece.trim().replace(/\s+/g, " ");
      if (one === "") continue;
      if (/[.#[]/.test(one)) continue;
      found.add(one);
    }
  }
  return [...found].sort();
}

/**
 * THE INVENTORY, AND WHY EACH ONE IS STILL HERE.
 *
 *   `:root`, `body`          the theme itself. A theme is meant to reach
 *                            everything, and this is the one case where a
 *                            bare selector says what it means.
 *   `a`, `a:hover`           links, product-wide. The world has few and they
 *                            are styled over the top; low cost, and splitting
 *                            it would mean naming every surface that has one.
 *   `button:disabled`        one disabled treatment everywhere is a decision,
 *                            not an accident.
 *   the field selectors      THIS IS THE DEBT. `textarea`, `select`,
 *                            `input:focus`, the placeholders and the four
 *                            `body`-prefixed copies reach every field in the
 *                            world, and three of the four defects above came
 *                            from them. They are still here because the
 *                            world's fields have been shown to depend on some
 *                            of what they set, and unpicking that safely
 *                            needs the field primitive itself unified — which
 *                            is the rest of A4, not this test.
 */
const KNOWN = [
  ":root",
  "a",
  "a:hover",
  "body",
  "body input",
  "body select",
  "body textarea",
  "button:disabled",
  "input::placeholder",
  "input:focus",
  "select",
  "select:focus",
  "textarea",
  "textarea::placeholder",
  "textarea:focus",
];

describe("chrome.css does not quietly style the whole product", () => {
  it("has no bare element selector that is not on the register", () => {
    const now = bareSelectors();
    const added = now.filter((sel) => !KNOWN.includes(sel));
    expect(
      added,
      "a new bare element selector in `chrome.css` is not a chrome rule. This " +
        "sheet is loaded on every route and sits in the last layer, so it wins " +
        "everywhere — the world's headline was six pixels too big for exactly " +
        "this reason, and the answer box had no side padding. Name the surface " +
        "you mean (`.login-shell h1`, `.profile-shell input`), or add it to " +
        "KNOWN with the reason it has to be global.",
    ).toEqual([]);
  });

  it("keeps the register from growing stale in the other direction", () => {
    /* If one is scoped or deleted, this fails and the entry comes out. A
       register that lists selectors which no longer exist is a description of
       a sheet that no longer exists. */
    const now = bareSelectors();
    const gone = KNOWN.filter((sel) => !now.includes(sel));
    expect(
      gone,
      "these are on the register and no longer in the sheet — good news, and " +
        "the register has to follow. Remove them from KNOWN.",
    ).toEqual([]);
  });

  it("still has the theme, which is the one that is meant to reach everything", () => {
    const now = bareSelectors();
    expect(now).toContain(":root");
    expect(now).toContain("body");
  });
});
