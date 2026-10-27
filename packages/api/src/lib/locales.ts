import { z } from "zod";

/**
 * The two languages the product speaks. English-only was a founder ruling
 * (2026-08-22); REVERSED 2026-08-31 — the person chooses at signup and can
 * change it on their profile, and the choice drives generation: every
 * prompt already carries `Locale:`, so signals, the top of mind, and
 * principles come back in the profile's own language. Rows that stored
 * "ko-KR" through the English-only year simply come back to life.
 */
export const supportedLocaleValues = ["en-US", "ko-KR"] as const;

export type SupportedLocale = (typeof supportedLocaleValues)[number];

export const DEFAULT_LOCALE: SupportedLocale = "en-US";

export const supportedLocaleSchema = z.enum(supportedLocaleValues, {
  error: "Unsupported locale. Expected en-US or ko-KR.",
});

const supportedLocaleSet = new Set<string>(supportedLocaleValues);

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === "string" && supportedLocaleSet.has(value);
}

export function normalizeSupportedLocale(value: unknown): SupportedLocale {
  return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
}
