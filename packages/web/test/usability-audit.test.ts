/**
 * THE CASCADE HALF OF THE OCTOBER USABILITY AUDIT (f2afcbe2).
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. It reads the stylesheets off
 * disk as text, because every finding here was a rule that LOST or WON the
 * cascade in a real browser while jsdom — which computes no specificity and
 * hit-tests nothing — would have pressed the control and reported success.
 * Each case names the audit screenshot it answers, so a regression can be
 * read against the picture that found it.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const STYLES = resolve(dirname(fileURLToPath(import.meta.url)), "../src/styles");
const sheet = (name: string) => readFileSync(resolve(STYLES, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
/** Every rule whose selector list contains `selector`, as [selector, body]. */
function rules(css: string, test: (selector: string) => boolean): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1]!.trim();
    if (selector.split(",").some((part) => test(part.trim()))) found.push([selector, match[2]!]);
  }
  return found;
}

describe("the chosen shelf tab keeps its label under the pointer (#39)", () => {
  it("no hover rule on .waka-tab can repaint the lit tab", () => {
    const hovers = rules(sheet("claims.css"), (s) => /\.waka-tab(?![-\w])[^ ]*:hover/.test(s));
    expect(hovers.length).toBeGreaterThan(0);
    for (const [selector, body] of hovers) {
      if (!/color\s*:/.test(body)) continue;
      expect(selector, "a .waka-tab:hover colour must exclude .waka-tab--on").toMatch(/:not\(\.waka-tab--on\)/);
    }
  });
});
