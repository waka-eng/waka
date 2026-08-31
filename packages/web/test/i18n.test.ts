/**
 * ONE LANGUAGE, THE SAME SENTENCES, AND NO GAPS IN THEM.
 *
 * English is the product's only language — a founder ruling (2026-08-22)
 * retired the Korean catalog. The machinery is still locale-shaped so a
 * future language is an entry, not an unpicking, and this suite keeps the
 * two failure modes that survive the ruling visible: a legacy "ko-KR"
 * preference must normalize to the default rather than crash or leak, and
 * the catalog must never ship a blank or missing line.
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
  formatBestRecentMirrorMoments,
  formatGeneratedFieldCounts,
  formatResultsCount,
  formatSavedCount,
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
    expect(t(null, "tagline")).toBe(t(DEFAULT_LOCALE, "tagline"));
    // and the ko-KR chrome genuinely speaks Korean now
    expect(t("ko-KR", "tagline")).not.toBe(t(DEFAULT_LOCALE, "tagline"));
    expect(/[가-힣]/.test(t("ko-KR", "tagline"))).toBe(true);
  });

  it("formats saved-count and result-count phrases", () => {
    expect(formatSavedCount("en-US", 1)).toBe("1 saved");
    expect(formatSavedCount("en-US", 2)).toBe("2 saved");

    expect(formatResultsCount("en-US", 1, 1)).toBe("1 of 1 inspiration");
    expect(formatResultsCount("en-US", 8, 3)).toBe("3 of 8 inspirations");
  });

  it("formats WOW count helpers as complete phrases", () => {
    expect(formatBestRecentMirrorMoments("en-US", 9)).toBe("9 recent mirror moments shown.");

    expect(formatGeneratedFieldCounts("en-US", 1, 1)).toBe("1 source; 1 generated field");
    expect(formatGeneratedFieldCounts("en-US", 2, 3)).toBe("2 sources; 3 generated fields");
  });
});
