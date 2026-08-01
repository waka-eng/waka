/**
 * Anonymous, stable labels for the members of a combination.
 *
 * Every stage that shows a model a group's material refers to people as
 * "member A" rather than by name. This lives in one place because two stages
 * doing it *almost* the same way is a correctness bug wearing a style bug's
 * clothes: the judge and the reader both map labels back to real people, so if
 * their lettering ever diverged, a reading's quotes would be attributed to the
 * wrong member and nothing would look broken.
 */

/** 0 → A, 25 → Z, 26 → AA. Rooms larger than the alphabet are not special. */
export function memberLetter(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/**
 * userId → "member A", assigned by sorted user id.
 *
 * Sorted so the same room produces the same labels on every pass: a label that
 * moved between runs would make two readings incomparable for no reason.
 */
export function labelMembersByUserId(userIds: string[]): Map<string, string> {
  const labels = new Map<string, string>();
  [...new Set(userIds)].sort().forEach((userId, index) => {
    labels.set(userId, `member ${memberLetter(index)}`);
  });
  return labels;
}
