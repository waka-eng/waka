import enUsMessages from "./messages/en-US.json";

/**
 * English is the product's only language — a founder ruling (2026-08-22).
 * The catalog machinery stays so a future locale is an entry here rather
 * than an unpicking; stored "ko-KR" preferences from before the ruling
 * normalize to the default on read.
 */
export const supportedLocaleValues = ["en-US"] as const;

export type SupportedLocale = (typeof supportedLocaleValues)[number];

export const DEFAULT_LOCALE: SupportedLocale = "en-US";
export const LOCALE_STORAGE_KEY = "waka.ui.locale";

export const supportedLocales: Array<{ code: SupportedLocale; label: string; nativeLabel: string }> = [
  { code: "en-US", label: "English", nativeLabel: "English" },
];

const supportedLocaleSet = new Set<string>(supportedLocaleValues);

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === "string" && supportedLocaleSet.has(value);
}

export function normalizeSupportedLocale(value: unknown): SupportedLocale {
  return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
}

export function readStoredLocale(): SupportedLocale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;

  try {
    const stored = window.localStorage?.getItem?.(LOCALE_STORAGE_KEY);
    if (isSupportedLocale(stored)) return stored;
  } catch {
    // Ignore storage failures in privacy-mode browsers and tests.
  }

  return normalizeSupportedLocale(window.navigator.language);
}

export function writeStoredLocale(locale: SupportedLocale): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem?.(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Best-effort only; React state still applies the locale for this render.
  }
}

export type MessageKey = keyof typeof enUsMessages;

type ExactCatalog<T extends Record<MessageKey, string>> = T & Record<Exclude<keyof T, MessageKey>, never>;

function exactCatalog<T extends Record<MessageKey, string>>(catalog: ExactCatalog<T>): T {
  return catalog;
}

export const messageCatalogs = {
  "en-US": exactCatalog(enUsMessages),
} satisfies Record<SupportedLocale, Record<MessageKey, string>>;


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


export function formatResultsCount(
  locale: SupportedLocale | null | undefined,
  totalCount: number,
  filteredCount: number,
): string {
  return formatMessage(locale, "resultsCount", { totalCount, filteredCount });
}


export function formatBestRecentMirrorMoments(locale: SupportedLocale | null | undefined, count: number): string {
  return formatMessage(locale, "bestRecentMirrorMomentsShownCount", { count });
}


export function formatGeneratedFieldCounts(
  locale: SupportedLocale | null | undefined,
  countsOrSourceCount: number | { sources: number; fields: number },
  maybeFieldCount?: number,
): string {
  const sourceCount = typeof countsOrSourceCount === "number" ? countsOrSourceCount : countsOrSourceCount.sources;
  const fieldCount = typeof countsOrSourceCount === "number" ? (maybeFieldCount ?? 0) : countsOrSourceCount.fields;
  return formatMessage(locale, "generatedFieldCounts", { sourceCount, fieldCount });
}
