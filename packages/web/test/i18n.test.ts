/**
 * TWO LANGUAGES, THE SAME SENTENCES, AND NO GAPS IN THEM.
 *
 * This header used to say English was the product's only language, citing a
 * founder ruling of 2026-08-22 that retired the Korean catalog. THAT RULING
 * WAS REVERSED on 2026-08-31, and Korean now drives what the memory itself is
 * written in rather than only the chrome — `ko-KR.json` sits at full key
 * parity with `en-US.json`. A test header that describes a retired catalog as
 * retired, while the suite below tests it as live, is the kind of false claim
 * this repo treats as a defect; corrected here because this file's own
 * subject is the thing that changed.
 *
 * The failure modes it keeps visible: an unsupported preference must
 * normalize to the default rather than crash or leak, the catalog must never
 * ship a blank or missing line, and no concept may wear two names.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing, and there is nothing under it
 * to mock. `lib/locales` is a message catalog and the pure functions that
 * read it — no fetch, no storage, no clock, no DOM. Give it a locale and a
 * number and it hands back a string. The seam a mock would go at IS the
 * subject, so replacing anything would leave nothing being tested.
 *
 * That absence is also why the expected strings below are written out in
 * full instead of computed. A case that compared against `t(locale, key)`
 * would pass on a catalog that had lost every line, because both sides would
 * be reading the same wrong row.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  messageCatalogs,
  normalizeSupportedLocale,
  supportedLocaleValues,
  t,
} from "../src/lib/locales";

describe("i18n catalog", () => {
  it("supports English and Korean, defaulting to English", () => {
    // REVERSED 2026-08-31: ko-KR returned as a first-class choice — the
    // person picks the language their memory is WRITTEN in. The chrome
    // catalog for ko-KR is an explicit alias of English until translated.
    expect(supportedLocaleValues).toEqual(["en-US", "ko-KR"]);
    expect(DEFAULT_LOCALE).toBe("en-US");
  });

  /**
   * ONE CONCEPT, ONE USER-FACING NAME — layer four, in both languages.
   *
   * Measured on `dev` at b9c4cd9: the sky's signpost said "philosophies &
   * values" (`worldPhilosophiesValues`) and its lead line said "Your
   * philosophies and values will form here", while the verbs INSIDE that same
   * sky said "this principle in your own words" and "a principle of your
   * own", and the profile, the aria labels, the schema, the routes and the
   * MCP door all said principles. One object, two names, two feet apart on
   * one screen. Korean carried the split intact: 철학과 가치 against 원칙.
   *
   * `principles` won because it is what everything that is not a label
   * already says — the canon, the API, the docs — and because it is one word
   * that translates to one word. "Philosophies & values" is a good subtitle
   * and a poor name, and a name is what a signpost is.
   *
   * The rule is deliberately narrow in two ways, both chosen rather than
   * overlooked.
   *
   * IT GOVERNS VALUES, NOT KEYS. `worldPhilosophiesValues` keeps its name and
   * now holds "principles", which reads oddly for about a second and buys
   * something worth more: not one call site moves, so this change is five
   * strings in two JSON files and can be reverted by reverting them. A key is
   * not a name a person meets.
   *
   * IT GOVERNS THE CATALOGS, NOT PROSE. Comments and docs may still say
   * philosophies — several quote founder rulings verbatim, and rewriting a
   * quotation to match a later decision is how a record stops being one.
   * Describing is not naming.
   */
  it("gives layer four one name, in both languages", () => {
    const BANNED = {
      "en-US": { word: /philosoph/i, say: "principles" },
      "ko-KR": { word: /철학/, say: "원칙" },
    } as const;
    const offenders: string[] = [];
    for (const locale of supportedLocaleValues) {
      const { word, say } = BANNED[locale];
      for (const [key, value] of Object.entries(messageCatalogs[locale])) {
        if (typeof value === "string" && word.test(value)) {
          offenders.push(`${locale} ${key}: "${value.slice(0, 60)}" — say ${say}`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("does not ship undefined or blank catalog values", () => {
    for (const locale of supportedLocaleValues) {
      for (const [key, value] of Object.entries(messageCatalogs[locale])) {
        expect(value, `${locale}.${key}`).toEqual(expect.any(String));
        expect(value.trim(), `${locale}.${key}`).not.toBe("");
      }
    }
  });

  it("normalizes null, undefined, and unsupported locales to the default — and honors ko-KR", () => {
    // ko-KR rows that waited out the English-only year come back to life:
    // the stored value reads as itself again, never coerced to the default.
    expect(isSupportedLocale("ko-KR")).toBe(true);
    expect(isSupportedLocale("fr-FR")).toBe(false);
    expect(normalizeSupportedLocale("ko-KR")).toBe("ko-KR");
    expect(normalizeSupportedLocale(null)).toBe(DEFAULT_LOCALE);
    expect(normalizeSupportedLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(normalizeSupportedLocale("fr-FR")).toBe(DEFAULT_LOCALE);
    expect(t(null, "signOut")).toBe(t(DEFAULT_LOCALE, "signOut"));
    // and the ko-KR chrome genuinely speaks Korean now
    expect(t("ko-KR", "signOut")).not.toBe(t(DEFAULT_LOCALE, "signOut"));
    expect(/[가-힣]/.test(t("ko-KR", "signOut"))).toBe(true);
  });
});
