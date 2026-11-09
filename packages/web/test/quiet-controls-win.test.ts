/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. It reads the stylesheets off
 * disk as text and compares selector specificity, the way
 * `stylesheets-parse.test.ts` reads them. No browser, no bundler.
 *
 * WHY IT EXISTS (code review, 2026-11-09): three quiet controls were written
 * with a rule that LOST to a container's rule of higher specificity, so the
 * control drew as something else: Stop drew as Send, and the sheet's "<"
 * picked up the search sheet's and the reading sheet's button boxes. Every
 * case here names the rule that must win and the rule it must beat. */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const STYLES = resolve(dirname(fileURLToPath(import.meta.url)), "../src/styles");
const ALL = readdirSync(STYLES).filter((name) => name.endsWith(".css"))
  .map((name) => readFileSync(resolve(STYLES, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ")).join("\n");

/** Every selector in the sheets, one per comma part, with its declarations. */
function selectors(): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = [];
  for (const match of ALL.matchAll(/([^{}@;]+)\{([^{}]*)\}/g)) {
    for (const part of match[1]!.split(",")) out.push({ selector: part.trim(), body: match[2]! });
  }
  return out;
}

/** [ids, classes/attributes/pseudo-classes, elements]; :not() counts its argument. */
export function specificity(selector: string): [number, number, number] {
  const s = selector.replace(/:not\(([^)]*)\)/g, " $1");
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const classes = (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
  const elements = (s.replace(/\.[\w-]+|\[[^\]]+\]|:+[\w-]+|#[\w-]+/g, " ").match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
  return [ids, classes, elements];
}
const beats = (a: [number, number, number], b: [number, number, number]) =>
  a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] >= b[2];

describe("a quiet control's own rule wins over its container's", () => {
  it("draws Stop in the chat's bar as Stop, not as Send", () => {
    const send = specificity(".waka-note-bar .waka-note-bar-row .waka-note-bar-action");
    const stop = selectors().filter(({ selector, body }) => /chat-send--stop(?![\w-])/.test(selector) && /(^|;)\s*color:/.test(body)
      && !/:hover|:focus/.test(selector));
    expect(stop.length, "no rule colours Stop").toBeGreaterThan(0);
    expect(stop.some(({ selector }) => beats(specificity(selector), send)),
      `Stop's colour loses to the bar's action rule: ${stop.map((row) => row.selector).join(" | ")}`).toBe(true);
  });
});
