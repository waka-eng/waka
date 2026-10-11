/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. It reads every stylesheet off
 * disk and walks it character by character, the way `type-scale.test.ts` and
 * `phone-breakpoints.test.ts` do. No browser, no bundler, no network. */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const STYLES = resolve(dirname(fileURLToPath(import.meta.url)), "../src/styles");
const SHEETS = readdirSync(STYLES).filter((name) => name.endsWith(".css"));

/**
 * ═══ A COMMENT THAT ENDS WHERE NOBODY MEANT IT TO ═══
 *
 * On 2026-10-10 the founder's dev server started returning a blank error
 * screen. `chrome.css` was 500ing with `Unknown word sp.tier`, and the cause
 * was one phrase in a header comment:
 *
 *     Every name below was put to `src/ ** / *.tsx`, the test suite and...
 *                                        ^^
 *
 * The `*` and `/` in that glob ARE a comment close. Everything after it —
 * forty lines of English prose about which selectors were deleted and why —
 * was handed to the CSS parser as code.
 *
 * ── WHY THIS NEEDED A GATE AND NOT A LESSON ────────────────────────────────
 *
 * Nothing in the suite could see it, and the checks that exist all passed:
 *
 *   - `tsc` does not read CSS.
 *   - Brace counting said 376 and 376, because the prose contained no braces.
 *   - `type-scale`, `one-class-one-thing` and `phone-breakpoints` all blank
 *     comments with a regex before looking, so the broken comment simply
 *     swallowed more than they expected and they reported nothing.
 *   - The unit suite does not load stylesheets at all.
 *
 * So a change that typechecked, passed every gate and committed cleanly took
 * the entire product down to a blank screen. That is the Law 8 shape — it
 * rendered perfectly in every instrument and did nothing in the one place
 * that counts — and this product has now hit it in a JSX handler, in a
 * `pointer-events` chain, in an optional callback, and here.
 *
 * ── WHAT IT CHECKS, AND WHY THAT IS THE RIGHT CHECK ────────────────────────
 *
 * CSS comments do not nest. So every `*​/` must be closing a `/*​` that is
 * already open, and a `*​/` encountered while NOT inside a comment is a
 * decisive error — not a heuristic, not a style preference. It is the exact
 * signature of prose that terminated its own comment early, because the
 * stray close always arrives after the real one.
 *
 * It deliberately does not try to be a CSS parser. A parser would be a
 * second opinion about a language the browser already has an opinion about;
 * this is the one defect a parser would catch that nothing else here can.
 */
interface Stray {
  sheet: string;
  line: number;
  near: string;
}

/** Walks the file tracking comment state, and reports every `*​/` that closes
    nothing. Strings are skipped because `content: "*​/"` is legal and common
    enough in generated-content rules to matter. */
function strayCloses(source: string): Array<{ line: number; near: string }> {
  const out: Array<{ line: number; near: string }> = [];
  let inComment = false;
  let quote: string | null = null;
  let line = 1;
  for (let at = 0; at < source.length; at += 1) {
    const ch = source[at];
    if (ch === "\n") line += 1;
    if (inComment) {
      if (ch === "*" && source[at + 1] === "/") {
        inComment = false;
        at += 1;
      }
      continue;
    }
    if (quote !== null) {
      if (ch === "\\") at += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "/" && source[at + 1] === "*") {
      inComment = true;
      at += 1;
      continue;
    }
    if (ch === "*" && source[at + 1] === "/") {
      out.push({ line, near: source.slice(Math.max(0, at - 36), at + 10).replace(/\s+/g, " ").trim() });
      at += 1;
    }
  }
  return out;
}

describe("every stylesheet is a stylesheet", () => {
  it("reads the sheets at all", () => {
    /* The tripwire. A gate that globs nothing passes forever, which is the
       failure this whole file is about one level up. */
    expect(SHEETS.length, "no stylesheets found — has src/styles moved?").toBeGreaterThanOrEqual(5);
    for (const sheet of SHEETS) {
      expect(readFileSync(join(STYLES, sheet), "utf8").length).toBeGreaterThan(200);
    }
  });

  it("closes no comment that was never opened", () => {
    const strays: Stray[] = [];
    for (const sheet of SHEETS) {
      for (const hit of strayCloses(readFileSync(join(STYLES, sheet), "utf8"))) {
        strays.push({ sheet, ...hit });
      }
    }
    expect(
      strays.map((s) => `${s.sheet}:${s.line} … ${s.near}`),
      "a `*/` here closes nothing, which means a `/*` above it already ended " +
        "early and the prose after it is being parsed as CSS. The usual cause " +
        "is a glob or a path written inside a comment — `src/**/*.tsx` " +
        "contains a comment close. Write it in words.",
    ).toEqual([]);
  });

  it("leaves every brace it opens", () => {
    /* Weak on its own — it said 376 and 376 while the file was broken — but
       free beside the check above, and it catches the opposite slip. */
    for (const sheet of SHEETS) {
      const code = readFileSync(join(STYLES, sheet), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      expect([sheet, (code.match(/\{/g) ?? []).length]).toEqual([
        sheet,
        (code.match(/\}/g) ?? []).length,
      ]);
    }
  });
});
