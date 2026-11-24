import { sql, type SQL } from 'drizzle-orm';
import type { getDb } from './db.js';
import { withoutLegacyGroupDestination } from './retired-group-work.js';

type Database = Pick<ReturnType<typeof getDb>, 'execute'>;

const unresolvedEmbedding = (profile: SQL, source: SQL, account: SQL) => sql`
  EXISTS (SELECT 1 FROM embedding_index_attempts e
    WHERE e.account_id = ${account} AND e.profile_id = ${profile} AND e.source_id = ${source}
      AND e.source_kind = 'inspiration' AND e.input_scope = 'personal'
      AND e.status IN ('reserved','received','unknown'))
  OR EXISTS (SELECT 1 FROM embedding_index_work w
    WHERE w.profile_id = ${profile} AND w.source_id = ${source}
      AND w.source_kind = 'inspiration' AND w.input_scope = 'personal'
      AND w.completed_version < w.requested_version
      AND w.failure_code IN ('outcome_unknown','commit_unconfirmed','current_vector_unavailable'))`;

const ownedCurrentSource = sql`
  FROM inspiration_processing p
  JOIN inspirations i ON i.id = p.inspiration_id AND i.profile_id = p.owner_profile_id
  JOIN inspiration_revisions r ON r.inspiration_id = i.id AND r.profile_id = i.profile_id
  JOIN profiles owner ON owner.id = i.profile_id
  WHERE p.derivation_job_id = j.id AND p.derivation_request_version = j.request_version
    AND p.profile_id = j.profile_id AND p.owner_profile_id = j.profile_id
    AND p.material_revision = r.personal_revision AND p.completed_at IS NULL
    AND i.id::text = j.payload->>'inspirationId' AND i.memory_excluded_at IS NULL
    AND owner.type::text IN ('human','agent') AND owner.account_id IS NOT NULL`;
const sourceHasUnresolvedEmbedding = unresolvedEmbedding(sql`i.profile_id`, sql`i.id`, sql`owner.account_id`);

/** Distinguishes an old embedding-related ambiguous failure in notice scans. */
export const legacyDerivationEmbeddingHeld = sql`
  j.status = 'failed' AND j.type = 'derive_signals'
  AND jsonb_typeof(j.payload) = 'object' AND ${withoutLegacyGroupDestination(sql`j.payload`)}
  AND EXISTS (SELECT 1 ${ownedCurrentSource} AND (${sourceHasUnresolvedEmbedding}))`;

/** Shared with terminal notices. Alias the background job as j. A bounded or
 * contended sweep leaves the other eligible rows for the next existing sweep. */
export const legacyDerivationRecoveryEligible = sql`
  j.status = 'failed' AND j.type = 'derive_signals'
  AND j.last_error IS NOT DISTINCT FROM '{"category":"database","code":"55P03"}'
  AND j.attempts = 3 AND j.max_attempts = 3 AND j.completed_version < j.request_version
  AND j.malformed_retry_version IS DISTINCT FROM j.request_version
  AND NOT j.rerun_requested AND j.result IS NULL
  AND jsonb_typeof(j.payload) = 'object' AND ${withoutLegacyGroupDestination(sql`j.payload`)}
  AND (j.payload->>'reason' IN ('created','edited')) IS TRUE
  AND j.idempotency_key IS NOT DISTINCT FROM 'derive_signals:' || (j.payload->>'inspirationId')
  AND NOT (j.payload ?| ARRAY['lockDeferral','failureDisposition','terminalRecoveryVersion'])
  AND EXISTS (SELECT 1 ${ownedCurrentSource} AND NOT (${sourceHasUnresolvedEmbedding}))`;

/** A one-time extension of the queue budget. Earlier actual starts remain in
 * background_job_runs, and a new source request keeps its usual max_attempts. */
export async function reconcileLegacyDerivationFailures(db: Database, now = new Date()): Promise<number> {
  const rows = await db.execute(sql`
    WITH candidates AS (
      SELECT j.id FROM background_jobs j WHERE ${legacyDerivationRecoveryEligible}
      ORDER BY j.updated_at, j.id LIMIT 8 FOR UPDATE OF j SKIP LOCKED
    ), ready AS MATERIALIZED (
      SELECT j.id FROM candidates c JOIN background_jobs j ON j.id = c.id
      WHERE EXISTS (SELECT 1 ${ownedCurrentSource}
        AND NOT (${sourceHasUnresolvedEmbedding}) FOR SHARE OF i, r SKIP LOCKED)
    )
    UPDATE background_jobs j
    SET status = 'pending', attempts = j.attempts - 1, locked_at = NULL,
      run_after = ${new Date(now.getTime() + 30_000).toISOString()}::timestamptz,
      updated_at = ${now.toISOString()}::timestamptz,
      payload = (j.payload - ARRAY['leaseWake','pendingWake'])
        || jsonb_build_object('terminalRecoveryVersion', j.request_version::text)
    FROM ready WHERE j.id = ready.id AND ${legacyDerivationRecoveryEligible}
    RETURNING j.id`);
  return rows.length;
}

/** Re-check just before the worker calls the derivation, since material can
 * change and embedding work can start between the sweep and this claim. */
export async function derivationRetryDispatchState(db: Database, input: {
  jobId: string; profileId: string; requestVersion: string; attempts: number; lockedAt: Date | null;
}): Promise<'stale' | 'blocked' | 'ready'> {
  const [row] = await db.execute<{ blocked: boolean }>(sql`
    SELECT source.blocked FROM background_jobs j
    JOIN LATERAL (SELECT (${sourceHasUnresolvedEmbedding}) AS blocked ${ownedCurrentSource} LIMIT 1) source ON true
    WHERE j.id = ${input.jobId}::uuid AND j.profile_id = ${input.profileId}::uuid
      AND j.status = 'running' AND j.request_version = ${input.requestVersion}::bigint
      AND j.locked_at = ${input.lockedAt?.toISOString() ?? null}::timestamptz AND j.attempts = ${input.attempts}`);
  return row ? row.blocked ? 'blocked' : 'ready' : 'stale';
}
