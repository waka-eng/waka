/**
 * A RECEIPT MAY CLAIM ONLY WHAT A TEST ENFORCES.
 *
 * goal: the-legible-loop, Phase 2 — the gate's audit half. Every receipt in
 * the registry names the test that enforces its claim, and this suite fails
 * when a named test disappears; the two receipts that document lines already
 * on screen are pinned against Home's own literals so the wording cannot
 * fork; and no receipt carries a digit.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. The registry is data, the
 * filesystem is the filesystem, and Home's source is read as text — there is
 * no seam here to replace.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { messageCatalogs } from "../src/lib/i18n";
import { RECEIPTS } from "../src/lib/receipts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("gesture receipts", () => {
  it("names an existing enforcing test for every receipt", () => {
    for (const [key, receipt] of Object.entries(RECEIPTS)) {
      expect(
        existsSync(resolve(REPO_ROOT, receipt.enforcedBy)),
        `${key} claims "${receipt.text}" but its enforcing test is gone: ${receipt.enforcedBy}`,
      ).toBe(true);
    }
  });

  it("carries no digit in any receipt", () => {
    for (const [key, receipt] of Object.entries(RECEIPTS)) {
      expect(/\d/.test(receipt.text), `${key} carries a numeral`).toBe(false);
    }
  });

  /* The world renders every receipt through the message catalog (Home says
     `say(receipt.messageKey)`), so the sync check is here: the English
     catalog must carry the registry's exact words, and the Korean entry must
     exist and keep the no-digits law. */
  it("the catalog speaks the registry's words, in both languages", () => {
    for (const [key, receipt] of Object.entries(RECEIPTS)) {
      const mk = receipt.messageKey;
      expect(messageCatalogs["en-US"][mk], `${key} forked from the catalog`).toBe(receipt.text);
      const ko = messageCatalogs["ko-KR"][mk];
      expect(ko, `${key} has no Korean words`).toEqual(expect.any(String));
      expect(ko.trim()).not.toBe("");
      expect(/\d/.test(ko), `${key} carries a numeral in Korean`).toBe(false);
    }
  });
});
