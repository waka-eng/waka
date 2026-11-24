import { sql, type SQL } from 'drizzle-orm';
import { principles } from '../db/index.js';
import { evidenceSupportCurrent } from './signal-support-state.js';

export const FIRST_PRINCIPLE_SIGNAL_COUNT = 2;

export interface FirstPrincipleOrigin {
  id: string;
  fingerprint: string;
  revision: string;
}

export interface FirstPrincipleSignal {
  id: string;
  wording: string;
  origins: FirstPrincipleOrigin[];
}

export function firstPrincipleWording(statement: SQL) {
  return sql`regexp_replace(lower(normalize(${statement}, NFKC) COLLATE pg_catalog."und-x-icu"), '[^[:alnum:]]', '', 'g')`;
}

/** The fixed ICU root collation works on both CI PG16 and deployed PG17.
 * Direct, current, human-initiated original material. Compare the entire
 * capture, independent of its URL, quote, attached text or excerpt length. Two
 * distinct fingerprints per signal suffice for deciding a two-signal match. */
export function firstPrincipleOrigins(profileId: string, signal: SQL) {
  return sql`SELECT DISTINCT ON (origin.fingerprint) origin.id, origin.fingerprint, origin.revision
    FROM (
      SELECT i.id,i.created_at,r.personal_revision::text AS revision,encode(sha256(convert_to(${firstPrincipleWording(sql`i.text`)}, 'UTF8')), 'hex') AS fingerprint
      FROM signal_evidence e JOIN inspirations i ON i.id=e.inspiration_id AND i.profile_id=e.owner_profile_id
      JOIN inspiration_revisions r ON r.inspiration_id=i.id AND r.profile_id=i.profile_id
      WHERE e.signal_id=${signal} AND e.profile_id=${profileId}::uuid AND e.owner_profile_id=e.profile_id
        AND i.source='app' AND i.created_at<=now() AND ${evidenceSupportCurrent('e','signals')}
    ) origin
    WHERE origin.fingerprint <> 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    ORDER BY origin.fingerprint,origin.created_at,origin.id LIMIT 2`;
}

/** Same origin-assignability rule for eligibility and for the chosen pair. */
export function assignFirstPrincipleOrigins(signals: readonly FirstPrincipleSignal[]) {
  for (const [index, left] of signals.entries()) {
    if (!left.wording) continue;
    for (const right of signals.slice(index+1)) {
      if (!right.wording || left.id===right.id || left.wording===right.wording) continue;
      for (const a of left.origins) {
        const b=right.origins.find(origin=>origin.id!==a.id && origin.fingerprint!==a.fingerprint);
        if (b) return [{signalId:left.id,origin:a},{signalId:right.id,origin:b}];
      }
    }
  }
  return null;
}

export function usesFirstPrincipleBar(profileId: string) {
  return sql<boolean>`EXISTS (SELECT 1 FROM profile_principle_history h
    WHERE h.profile_id=${profileId}::uuid AND h.first_principle_id=${principles.id})`;
}

/** All citations are checked by personal-output. Here prove that at least two
 * different current statements can still be assigned different owned origins. */
export function firstPrincipleCitationsIndependent(profileId: string) {
  return sql<boolean>`EXISTS (
    WITH origins AS MATERIALIZED (
      SELECT signals.id AS signal_id,${firstPrincipleWording(sql`signals.statement`)} AS wording,
        origin.id AS source_id,origin.fingerprint
      FROM principle_signals pc JOIN signals ON signals.id=pc.signal_id AND signals.profile_id=pc.profile_id
      CROSS JOIN LATERAL (${firstPrincipleOrigins(profileId,sql`signals.id`)}) origin
      WHERE pc.principle_id=${principles.id} AND pc.profile_id=${profileId}::uuid
    ) SELECT 1 FROM origins a JOIN origins b ON a.signal_id<b.signal_id
      AND a.wording<>b.wording AND a.source_id<>b.source_id AND a.fingerprint<>b.fingerprint
    WHERE a.wording<>'' AND b.wording<>'' LIMIT 1)`;
}
