/**
 * Relative dates, in the words a person would use — and in their language.
 *
 * Shared by the door, the wall and the profile page: a board you return to
 * daily needs "today" and "yesterday" to read instantly, where "3 Aug" has to
 * be decoded. Past a week the exact date is the more useful thing.
 *
 * IT TOOK NO LOCALE UNTIL 2026-09-07, AND SAID SO IN ENGLISH REGARDLESS. The
 * Korean chrome (founder, 2026-08-31) moved every sentence in the product into
 * the catalogue and this function was missed, because the strings live in code
 * rather than in JSX where the sweep was looking. Measured on `/profile` in
 * Korean: `마지막 사용 today`. Half a sentence in each language, on a row about
 * a credential.
 *
 * The month-and-day fallback had the same hole one level down: it passed
 * `undefined` as its locale, which asks the BROWSER what language to use — so
 * it followed the machine's setting rather than the person's choice, and a
 * Korean speaker on an English laptop got "Aug 3" under a Korean label.
 */
import { formatMessage, t } from "./locales";
import type { SupportedLocale } from "./locales";

export function whenShort(at: string, locale: SupportedLocale): string {
  const then = new Date(at);
  if (Number.isNaN(then.getTime())) return "";
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 0) return t(locale, "whenToday");
  if (days === 1) return t(locale, "whenYesterday");
  if (days < 7) return formatMessage(locale, "whenDaysAgo", { count: days });
  return then.toLocaleDateString(locale, { month: "short", day: "numeric" });
}
