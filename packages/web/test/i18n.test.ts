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
  type MessageKey,
} from "../src/lib/locales";

function sortedKeys(locale: (typeof supportedLocaleValues)[number]): MessageKey[] {
  return Object.keys(messageCatalogs[locale]).sort() as MessageKey[];
}

describe("i18n catalogs", () => {
  it("keeps every supported locale on the exact same message keys", () => {
    const [baseLocale, ...otherLocales] = supportedLocaleValues;
    const baseKeys = sortedKeys(baseLocale);

    for (const locale of otherLocales) {
      expect(sortedKeys(locale)).toEqual(baseKeys);
    }
  });

  it("does not ship undefined or blank catalog values", () => {
    for (const locale of supportedLocaleValues) {
      for (const [key, value] of Object.entries(messageCatalogs[locale])) {
        expect(value, `${locale}.${key}`).toEqual(expect.any(String));
        expect(value.trim(), `${locale}.${key}`).not.toBe("");
      }
    }
  });

  it("normalizes null, undefined, and unsupported locales to the default locale", () => {
    expect(DEFAULT_LOCALE).toBe("en-US");
    expect(isSupportedLocale("ko-KR")).toBe(true);
    expect(isSupportedLocale("fr-FR")).toBe(false);
    expect(normalizeSupportedLocale(null)).toBe(DEFAULT_LOCALE);
    expect(normalizeSupportedLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(normalizeSupportedLocale("fr-FR")).toBe(DEFAULT_LOCALE);
    expect(t(null, "tagline")).toBe(t(DEFAULT_LOCALE, "tagline"));
  });

  it("formats saved-count and result-count phrases per locale", () => {
    expect(formatSavedCount("en-US", 1)).toBe("1 inspiration saved");
    expect(formatSavedCount("en-US", 2)).toBe("2 inspirations saved");
    expect(formatSavedCount("ko-KR", 2)).toBe("영감 2개 저장됨");

    expect(formatResultsCount("en-US", 1, 1)).toBe("1 of 1 inspiration");
    expect(formatResultsCount("en-US", 8, 3)).toBe("3 of 8 inspirations");
    expect(formatResultsCount("ko-KR", 8, 3)).toBe("전체 8개 중 3개 영감");
  });

  it("formats WOW count helpers as complete locale-owned phrases", () => {
    expect(formatBestRecentMirrorMoments("en-US", 9)).toBe("9 best-recent mirror moments shown.");
    expect(formatBestRecentMirrorMoments("ko-KR", 9)).toBe("9개의 최근 핵심 미러 순간이 표시됨.");

    expect(formatGeneratedFieldCounts("en-US", 1, 1)).toBe("1 source; 1 generated field present");
    expect(formatGeneratedFieldCounts("en-US", 2, 3)).toBe("2 sources; 3 generated fields present");
    expect(formatGeneratedFieldCounts("ko-KR", 2, 3)).toBe("2개 출처; 생성 필드 3개 있음");
  });
});
