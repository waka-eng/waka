/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. It reads `claims.css` as text
 * and asserts one property of its rules; there is no seam to replace.
 *
 * THE CORNER WORDS STEP ASIDE FOR A MODAL (code review, 2026-11-09). A chat's
 * "<" (`.waka-page-back`) and its "Past chats" (`.waka-page-aside`) are both
 * fixed at z-60 over the page. The "<" was hidden while a modal sheet, the
 * account card or a menu is open; "Past chats" was not, so it stood on top of
 * them. One rule for the class: every fixed corner word hides under the same
 * condition. */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../src/styles/claims.css"), "utf8");
const HIDE = /body:has\(\[aria-modal="true"\], \.waka-account, \[role="menu"\]\)\s*([^{]+)\{\s*visibility:\s*hidden;?\s*\}/;

it("hides both corner words while a modal, the account card or a menu is open", () => {
  const rule = css.match(HIDE);
  expect(rule, "the corner-hiding rule is gone").toBeTruthy();
  const selectors = rule![1]!.trim().replace(/^:is\((.*)\)$/s, "$1").split(",").map((part) => part.trim());
  expect(selectors).toContain(".waka-page-back");
  expect(selectors, "Past chats stands over an open modal").toContain(".waka-page-aside");
});
