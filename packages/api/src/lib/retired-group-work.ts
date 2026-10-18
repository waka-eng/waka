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

/** ASCII whitespace at either end, stripped the same way on both sides. */
const EDGE_WHITESPACE_REGEX_SOURCE = "^[ \\t\\n\\r\\f\\v]+|[ \\t\\n\\r\\f\\v]+$";
const EDGE_WHITESPACE = new RegExp(EDGE_WHITESPACE_REGEX_SOURCE, "g");

/** A principles request naming another profile than its tenant — a room
 * mind's, billed to a member. Only a STRING that is non-blank after ASCII
 * trimming counts, compared case-insensitively; anything else names no one. */
function namesAnotherProfile(payload: unknown, tenantProfileId: string): boolean {
  if (!payload || typeof payload !== "object") return false;
  const value = (payload as Record<string, unknown>).profileId;
  if (typeof value !== "string") return false;
  const named = value.replace(EDGE_WHITESPACE, "");
  return named !== "" && named.toLowerCase() !== tenantProfileId.toLowerCase();
}

const DESTINATION_TYPES = ["derive_signals", "review_signal_support", "assess_signal_support"];

/**
 * THE ONE RULE: is this queued row retired room work? A row is when it is a
 * `refresh_group_top_of_mind`; or its tenant is a room's mind; or it is
 * derive/review/assess work with a legacy room destination; or it is a
 * principles request naming another profile. `retiredGroupWork` below is the
 * same rule in SQL, for the queue head, the budget meter and the budget
 * deferral; a db test holds the two to the same answers.
 */
export function isRetiredGroupWork(job: {
  type: string; profileId: string; payload: unknown; tenantIsGroup?: boolean;
}): boolean {
  return job.type === "refresh_group_top_of_mind" || job.tenantIsGroup === true ||
    (DESTINATION_TYPES.includes(job.type) && hasLegacyGroupDestination(job.payload)) ||
    (job.type === "refresh_principles" && namesAnotherProfile(job.payload, job.profileId));
}

/** SQL twin of `isRetiredGroupWork` over a `background_jobs` row alias. */
export function retiredGroupWork(job: SQL): SQL {
  const named = sql`regexp_replace(${job}.payload->>'profileId', ${EDGE_WHITESPACE_REGEX_SOURCE}, '', 'g')`;
  // COALESCE: a missing field must read as "not room work", never as NULL —
  // a NULL here would vanish from both sides of a NOT.
  return sql`coalesce((${job}.type::text = 'refresh_group_top_of_mind'
    OR EXISTS (SELECT 1 FROM profiles tenant WHERE tenant.id = ${job}.profile_id AND tenant.type::text = 'group')
    OR (${job}.type::text IN ('derive_signals', 'review_signal_support', 'assess_signal_support')
      AND NOT ${withoutLegacyGroupDestination(sql`${job}.payload`)})
    OR (${job}.type::text = 'refresh_principles' AND jsonb_typeof(${job}.payload->'profileId') = 'string'
      AND ${named} <> '' AND lower(${named}) <> lower(${job}.profile_id::text))), false)`;
}

/** SQL twin of `hasLegacyGroupDestination`, negated: true for own-profile rows. */
export function withoutLegacyGroupDestination(payload: SQL): SQL {
  return sql`(${payload}->>'deriveIntoProfileId' IS NULL OR ${payload}->>'deriveIntoProfileId' ~ ${WHITESPACE_ONLY_REGEX_SOURCE})`;
}
