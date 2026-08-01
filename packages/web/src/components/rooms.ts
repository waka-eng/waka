/**
 * What a room is, shared by the surfaces that touch them.
 *
 * The rail shows the set of rooms, the title's settings panel changes one and
 * adds to the set, and Home resolves an invite arriving in the URL. All three
 * need the same two answers, so they live here rather than in whichever
 * component happened to own them last.
 */

/** Your own wall, which is a room with one member rather than a special case. */
export const MINE_BOARD_ID = "__mine__";

/**
 * Does this look like an invitation rather than a name?
 *
 * Matched against the exact shape a join code has — eight characters from the
 * generator's alphabet — rather than "a word with no spaces". The looser rule
 * read any word of six or more characters as a code, so naming a room
 * `builders` or `studio` looked up a code that did not exist and failed with
 * "No group matches that join code", with no way to say "I meant a name".
 * One-word names are the common case, not the edge one. The alphabet excludes
 * I, O, 0 and 1, which is what keeps ordinary words out: `builders` has an i.
 */
const JOIN_CODE_SHAPE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/i;

export function looksLikeInvite(raw: string): boolean {
  const trimmed = raw.trim();
  if (/[?&]join=/i.test(trimmed)) return true;
  if (/\s/.test(trimmed)) return false;
  return JOIN_CODE_SHAPE.test(trimmed);
}

/** Accept either a bare code or a full `?join=CODE` link and return the code. */
export function extractJoinCode(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/[?&]join=([^&\s]+)/i);
  if (match?.[1]) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }
  return trimmed;
}
