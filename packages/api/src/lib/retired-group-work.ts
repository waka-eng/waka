/**
 * ONE RULE FOR "THIS QUEUED ROW WAS ROOM WORK" (room engine retired 2026-10-17).
 *
 * Legacy derive/review/assess rows aimed at a room's mind carry
 * `deriveIntoProfileId` in their payload. The worker settles such a row
 * unrun, and the SQL that counts a person's own pending work must exclude
 * exactly the same rows — so both sides read this one definition: the field
 * is a room destination when present and not blank. Absent, JSON null, or a
 * string of ASCII whitespace only all mean "no destination" in both.
 *
 * Blank is an explicit ASCII class on both sides, from one regex source,
 * because JS `\s` and Postgres `\s` disagree on Unicode spaces (U+00A0 is
 * whitespace to JS, not necessarily to the database's locale).
 */
import { sql, type SQL } from "drizzle-orm";

/** Postgres ARE and JS RegExp read these escapes identically inside []. */
const WHITESPACE_ONLY_REGEX_SOURCE = "^[ \\t\\n\\r\\f\\v]*$";
const WHITESPACE_ONLY = new RegExp(WHITESPACE_ONLY_REGEX_SOURCE);

export function hasLegacyGroupDestination(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const value = (payload as Record<string, unknown>).deriveIntoProfileId;
  if (value === undefined || value === null) return false;
  return typeof value !== "string" || !WHITESPACE_ONLY.test(value);
}

/** SQL twin of `hasLegacyGroupDestination`, negated: true for own-profile rows. */
export function withoutLegacyGroupDestination(payload: SQL): SQL {
  return sql`(${payload}->>'deriveIntoProfileId' IS NULL OR ${payload}->>'deriveIntoProfileId' ~ ${WHITESPACE_ONLY_REGEX_SOURCE})`;
}
