/**
 * Relative dates, in the words a person would use.
 *
 * Shared by the wall and the profile page: a board you return to daily needs
 * "today" and "yesterday" to read instantly, where "3 Aug" has to be decoded.
 * Past a week the exact date is the more useful thing.
 */
export function whenShort(at: string): string {
  const then = new Date(at);
  if (Number.isNaN(then.getTime())) return "";
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
