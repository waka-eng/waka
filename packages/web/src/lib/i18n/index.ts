import enUsMessages from "./messages/en-US.json";
import koKrMessages from "./messages/ko-KR.json";

export const supportedLocaleValues = ["en-US", "ko-KR"] as const;

export type SupportedLocale = (typeof supportedLocaleValues)[number];

export const DEFAULT_LOCALE: SupportedLocale = "en-US";

export const supportedLocales: Array<{ code: SupportedLocale; label: string; nativeLabel: string }> = [
  { code: "en-US", label: "English", nativeLabel: "English" },
  { code: "ko-KR", label: "Korean", nativeLabel: "한국어" },
];

const supportedLocaleSet = new Set<string>(supportedLocaleValues);

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === "string" && supportedLocaleSet.has(value);
}

export function normalizeSupportedLocale(value: unknown): SupportedLocale {
  return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
}

export type MessageKey = keyof typeof enUsMessages;

type ExactCatalog<T extends Record<MessageKey, string>> = T & Record<Exclude<keyof T, MessageKey>, never>;

function exactCatalog<T extends Record<MessageKey, string>>(catalog: ExactCatalog<T>): T {
  return catalog;
}

export const messageCatalogs = {
  "en-US": exactCatalog(enUsMessages),
  "ko-KR": exactCatalog(koKrMessages),
} satisfies Record<SupportedLocale, Record<MessageKey, string>>;

export const translationKeys = Object.keys(enUsMessages).sort() as MessageKey[];

export function t(locale: unknown, key: MessageKey): string {
  return messageCatalogs[normalizeSupportedLocale(locale)][key];
}

type MessageValues = Record<string, string | number>;

function formatPluralChoice(count: number, options: string): string {
  const oneMatch = options.match(/one \{([^{}]*)\}/u);
  const otherMatch = options.match(/other \{([^{}]*)\}/u);
  return count === 1 ? (oneMatch?.[1] ?? otherMatch?.[1] ?? "") : (otherMatch?.[1] ?? oneMatch?.[1] ?? "");
}

export function formatMessage(
  locale: SupportedLocale | null | undefined,
  key: MessageKey,
  values: MessageValues = {},
): string {
  return t(locale, key)
    .replace(/\{(\w+),\s*plural,\s*((?:(?:one|other) \{[^{}]*\}\s*)+)\}/gu, (_match, name: string, options: string) => {
      const count = Number(values[name]);
      return formatPluralChoice(Number.isFinite(count) ? count : 0, options);
    })
    .replace(/\{(\w+)\}/gu, (_match, name: string) => String(values[name] ?? ""));
}

export function formatSavedCount(locale: SupportedLocale | null | undefined, count: number): string {
  return formatMessage(locale, "savedCount", { count });
}

export const formatInspirationSavedCount = formatSavedCount;

export function formatResultsCount(
  locale: SupportedLocale | null | undefined,
  totalCount: number,
  filteredCount: number,
): string {
  return formatMessage(locale, "resultsCount", { totalCount, filteredCount });
}

export function formatResultCount(
  locale: SupportedLocale | null | undefined,
  counts: { total: number; filtered: number },
): string {
  return formatResultsCount(locale, counts.total, counts.filtered);
}

export function formatBestRecentMirrorMoments(locale: SupportedLocale | null | undefined, count: number): string {
  return formatMessage(locale, "bestRecentMirrorMomentsShownCount", { count });
}

export const formatBestRecentMirrorMomentsShown = formatBestRecentMirrorMoments;

export function formatGeneratedFieldCounts(
  locale: SupportedLocale | null | undefined,
  countsOrSourceCount: number | { sources: number; fields: number },
  maybeFieldCount?: number,
): string {
  const sourceCount = typeof countsOrSourceCount === "number" ? countsOrSourceCount : countsOrSourceCount.sources;
  const fieldCount = typeof countsOrSourceCount === "number" ? (maybeFieldCount ?? 0) : countsOrSourceCount.fields;
  return formatMessage(locale, "generatedFieldCounts", { sourceCount, fieldCount });
}
