/**
 * ONE RULE FOR "THIS QUEUED ROW WAS ROOM WORK" (room engine retired 2026-10-17).
 *
 * Legacy derive/review/assess rows aimed at a room's mind carry
 * `deriveIntoProfileId` in their payload. The worker settles such a row
 * unrun, and the SQL that counts a person's own pending work must exclude
 * exactly the same rows — so both sides read this one definition: the field
 * is a room destination when present and not blank. Absent, JSON null, or a
 * whitespace-only string all mean "no destination" in both.
 *
 * JS `\s` and Postgres `\s` ([[:space:]]) agree on ASCII whitespace; a
 * payload made of exotic Unicode spaces was never written by any producer.
 */
import { sql, type SQL } from "drizzle-orm";

const BLANK = "^\\s*$";

export function hasLegacyGroupDestination(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const value = (payload as Record<string, unknown>).deriveIntoProfileId;
  if (value === undefined || value === null) return false;
  return typeof value !== "string" || !new RegExp(BLANK).test(value);
}

/** SQL twin of `hasLegacyGroupDestination`, negated: true for own-profile rows. */
export function withoutLegacyGroupDestination(payload: SQL): SQL {
  return sql`(${payload}->>'deriveIntoProfileId' IS NULL OR ${payload}->>'deriveIntoProfileId' ~ ${BLANK})`;
}
