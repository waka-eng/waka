/**
 * No dashes in the words a person reads.
 *
 * Founder rule (2026-11-08): "never use - in any description texts we have."
 * An em dash (—), an en dash (–), or a spaced hyphen standing in for
 * punctuation is rewritten as a period, comma or colon, keeping the meaning.
 * Hyphenated words ("sign-in", "re-read") are fine, so only a hyphen with a
 * space on both sides counts.
 *
 * Every value in both catalogues is checked, so a new key added anywhere
 * else is held to the same rule the moment it lands.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. It reads the two catalogue
 * files straight off disk, which are the real copy the app renders, so
 * there is no layer to replace.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOGUES = {
  "en-US": resolve(HERE, "../src/lib/i18n/messages/en-US.json"),
  "ko-KR": resolve(HERE, "../src/lib/i18n/messages/ko-KR.json"),
} as const;

const DASH = /[—–]| - /;

describe("no dashes in copy", () => {
  for (const [locale, path] of Object.entries(CATALOGUES)) {
    it(`${locale}: no message value contains an em dash, an en dash or a spaced hyphen`, () => {
      const messages = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      const offenders = Object.entries(messages)
        .filter(([, value]) => typeof value === "string" && DASH.test(value))
        .map(([key, value]) => `${key}: ${String(value)}`);
      expect(Object.keys(messages).length).toBeGreaterThan(100);
      expect(offenders).toEqual([]);
    });
  }
});
