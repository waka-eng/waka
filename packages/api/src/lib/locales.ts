import { z } from "zod";

/**
 * English is the product's only language — a founder ruling (2026-08-22).
 * Rows that stored "ko-KR" before the ruling normalize to the default on
 * read, so generation and the UI both speak English without a migration.
 */
export const supportedLocaleValues = ["en-US"] as const;

export type SupportedLocale = (typeof supportedLocaleValues)[number];

export const DEFAULT_LOCALE: SupportedLocale = "en-US";

export const supportedLocaleSchema = z.enum(supportedLocaleValues, {
  errorMap: () => ({ message: "Unsupported locale. Expected en-US." }),
});

const supportedLocaleSet = new Set<string>(supportedLocaleValues);

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === "string" && supportedLocaleSet.has(value);
}

export function normalizeSupportedLocale(value: unknown): SupportedLocale {
  return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
}
