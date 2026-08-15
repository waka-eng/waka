/**
 * Stable display labels for the people in a group.
 *
 * A member is a profile, and a profile's name is free text someone typed:
 * empty, whitespace-only, and emoji-only are all legal values. Every surface
 * that renders a member — the roster, wall attribution, per-entry
 * contributors — needs the same answer to "what do we call them", so the
 * fallback lives in one place. Two surfaces disagreeing about a person's name
 * reads as two different people, which is a correctness bug wearing a style
 * bug's clothes.
 *
 * The nameless fallback is assigned by sorted profile id so a group produces
 * the same labels on every pass; a label that moved between reads would make
 * two views of one roster impossible to line up.
 */

export interface MemberLabel {
  profileId: string;
  /** What to print. Never empty. */
  displayName: string;
  /** One or two characters for an avatar chip. Never empty. */
  initials: string;
}

/** 0 → A, 25 → Z, 26 → AA. Groups larger than the alphabet are not special. */
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
 * First letters of the first two words, uppercased.
 *
 * Code points rather than UTF-16 units, because a name can begin with an
 * emoji or an astral-plane character and slicing one in half yields a
 * replacement glyph rather than a person's initial.
 */
export function memberInitials(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((word) => [...word][0] ?? "");
  const initials = letters.join("").toUpperCase();
  return initials.length > 0 ? initials : "?";
}

/**
 * Label every member of a group, keyed by profile id.
 *
 * Members are passed in whole rather than looked up here: the caller already
 * read the roster to authorize the request, and a second round-trip for names
 * it is holding would be latency bought for nothing.
 */
export function labelMembersByProfileId(
  members: ReadonlyArray<{ profileId: string; name?: string | null }>,
): Map<string, MemberLabel> {
  const byProfileId = new Map<string, { name?: string | null }>();
  for (const member of members) {
    if (!byProfileId.has(member.profileId)) byProfileId.set(member.profileId, member);
  }

  const ordered = [...byProfileId.keys()].sort();
  const labels = new Map<string, MemberLabel>();
  ordered.forEach((profileId, index) => {
    const name = (byProfileId.get(profileId)?.name ?? "").trim();
    const displayName = name.length > 0 ? name : `Member ${memberLetter(index)}`;
    labels.set(profileId, {
      profileId,
      displayName,
      initials: memberInitials(displayName),
    });
  });
  return labels;
}
