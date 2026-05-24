import { z } from "zod";

export const supportedLocaleValues = ["en-US", "ko-KR"] as const;

export type SupportedLocale = (typeof supportedLocaleValues)[number];

export const DEFAULT_LOCALE: SupportedLocale = "en-US";

export const supportedLocaleSchema = z.enum(supportedLocaleValues, {
  errorMap: () => ({ message: "Unsupported locale. Expected en-US or ko-KR." }),
});

const supportedLocaleSet = new Set<string>(supportedLocaleValues);

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === "string" && supportedLocaleSet.has(value);
}

export function normalizeSupportedLocale(value: unknown): SupportedLocale {
  return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
}
