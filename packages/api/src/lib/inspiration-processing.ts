import { and, eq, sql } from 'drizzle-orm';
import type { getDb } from './db.js';
import type { EnqueueResult } from './queue.js';
import { inspirationRevisions, type InspirationEmbeddingScope, type BackgroundJobResult } from '../db/index.js';
import { parseTopOfMindRefreshResult } from './top-of-mind-refresh-status.js';

type Transaction = Pick<ReturnType<typeof getDb>, 'execute'>;
export interface InspirationProcessingReceipt {
  id: string;
  profileId: string;
  inspirationId: string;
  materialRevision: string;
  jobId: string;
  requestVersion: string;
}

export class InspirationProcessingUnavailableError extends Error {
  constructor() {
    super('Source processing request could not bind current authorized material');
    this.name = 'InspirationProcessingUnavailableError';
  }
}

export interface ClaimedDerivationRequest { jobId: string; requestVersion: string }
export interface DerivationProcessingInput {
  profileId: string;
  ownerProfileId: string;
  inspirationId: string;
  materialRevision: string;
  request: ClaimedDerivationRequest;
}

const materialJoins = sql`JOIN inspirations i ON i.id = p.inspiration_id AND i.profile_id = p.owner_profile_id
  JOIN inspiration_revisions r ON r.inspiration_id = i.id AND r.profile_id = i.profile_id`;
const currentMaterial = sql`p.material_revision = CASE WHEN p.profile_id = p.owner_profile_id THEN r.personal_revision ELSE r.public_revision END`;
const authorizedDestination = sql`(p.profile_id = p.owner_profile_id OR EXISTS (
  SELECT 1 FROM profiles d JOIN group_members m ON m.group_id = d.group_id
    JOIN profiles owner ON owner.id = m.profile_id AND owner.type::text = 'human'
  WHERE d.id = p.profile_id AND d.type::text = 'group' AND m.profile_id = p.owner_profile_id))`;
const allowedSource = sql`(p.profile_id = p.owner_profile_id OR i.visibility::text = 'public')`;
const derivationScope = (input: DerivationProcessingInput) => sql`p.profile_id = ${input.profileId}::uuid
  AND p.owner_profile_id = ${input.ownerProfileId}::uuid AND p.inspiration_id = ${input.inspirationId}::uuid
  AND p.derivation_job_id = ${input.request.jobId}::uuid
  AND p.derivation_request_version <= ${input.request.requestVersion}::bigint
  AND p.material_revision = ${input.materialRevision}::bigint`;

/** A retried worker need not buy extraction again after its successful data
 * transaction committed. Missing receipts/changed material never imply this. */
export async function isInspirationDerivationRecorded(tx: Transaction, input: DerivationProcessingInput): Promise<boolean> {
  const [row] = await tx.execute(sql`SELECT count(*) > 0 AND bool_and(p.derived_at IS NOT NULL) AS done
    FROM inspiration_processing p ${materialJoins}
    WHERE ${derivationScope(input)} AND ${currentMaterial} AND ${authorizedDestination} AND ${allowedSource}`);
  return row?.done === true;
}

/** Call with the evidence change and its enqueue, before the transaction can
 * publish either. A result from an earlier ticket cannot satisfy a later one. */
export async function bindInspirationReading(tx: Transaction, input: DerivationProcessingInput, reading: EnqueueResult): Promise<void> {
  await tx.execute(sql`UPDATE inspiration_processing p SET
    reading_job_id = ${reading.jobId}::uuid, reading_request_version = ${reading.requestVersion}::bigint,
    result = CASE WHEN p.reading_job_id = ${reading.jobId}::uuid AND p.reading_request_version = ${reading.requestVersion}::bigint THEN p.result ELSE NULL END
    FROM inspirations i, inspiration_revisions r
    WHERE i.id = p.inspiration_id AND i.profile_id = p.owner_profile_id AND r.inspiration_id = i.id AND r.profile_id = i.profile_id
      AND ${derivationScope(input)} AND p.completed_at IS NULL AND ${currentMaterial} AND ${authorizedDestination} AND ${allowedSource}`);
}

async function currentArtifactResult(tx: Transaction, profileId: string): Promise<BackgroundJobResult> {
  const [row] = await tx.execute(sql`SELECT m.id, m.version,
    EXISTS(SELECT 1 FROM top_of_mind_entries e WHERE e.top_of_mind_id = m.id AND e.dismissed_at IS NULL) AS has_entries
    FROM top_of_minds m JOIN profiles d ON d.id = ${profileId}::uuid
    WHERE m.status::text = 'live' AND (m.profile_id = d.id OR (d.type::text = 'group' AND m.group_id = d.group_id))
    ORDER BY m.version DESC LIMIT 1`);
  return { kind: 'top_of_mind', topOfMindId: row ? String(row.id) : null,
    version: row ? Number(row.version) : 0, outcome: row?.has_entries ? 'unchanged' : 'empty' };
}

/** Final source transaction, after all model/grounding work. An unchanged pass
 * must not forget an earlier read dependency, including one whose result
 * arrived during extraction. The caller owns source and worker commit fences. */
export async function finishInspirationDerivation(tx: Transaction, input: DerivationProcessingInput, options: {
  reading?: EnqueueResult;
  complete: boolean;
  requestReading: () => Promise<EnqueueResult>;
}): Promise<void> {
  if (options.reading) await bindInspirationReading(tx, input, options.reading);
  const current = await tx.execute(sql`SELECT p.id, p.result FROM inspiration_processing p ${materialJoins}
    WHERE ${derivationScope(input)} AND p.completed_at IS NULL AND ${currentMaterial} AND ${authorizedDestination} AND ${allowedSource}`);
  if (!current.length || !options.complete) return;
  for (const row of current) {
    if (row.result !== null && !parseTopOfMindRefreshResult(row.result)) {
      await tx.execute(sql`UPDATE inspiration_processing SET result = NULL WHERE id = ${row.id}::uuid AND completed_at IS NULL`);
    }
  }

  const [prior] = await tx.execute(sql`SELECT p.reading_job_id, p.reading_request_version::text, p.result, j.status, j.type AS job_type
    FROM inspiration_processing p LEFT JOIN background_jobs j ON j.id = p.reading_job_id
    WHERE p.profile_id = ${input.profileId}::uuid AND p.owner_profile_id = ${input.ownerProfileId}::uuid
      AND p.inspiration_id = ${input.inspirationId}::uuid AND p.completed_at IS NULL AND p.reading_request_version IS NOT NULL
    ORDER BY p.created_at DESC, p.id DESC LIMIT 1`);
  if (!options.reading && prior) {
    const priorResult = parseTopOfMindRefreshResult(prior.result);
    if (!prior.reading_job_id && priorResult) {
      // Job cleanup cannot erase a result already committed with publication.
      await tx.execute(sql`UPDATE inspiration_processing p SET reading_job_id = NULL,
        reading_request_version = ${prior.reading_request_version}::bigint, result = ${JSON.stringify(priorResult)}::jsonb
        WHERE ${derivationScope(input)} AND p.completed_at IS NULL`);
    } else {
      const reading = !prior.reading_job_id || (!priorResult && (prior.status === 'failed' ||
        (prior.status === 'succeeded' && prior.job_type === 'refresh_top_of_mind')))
        ? await options.requestReading()
        : { jobId: String(prior.reading_job_id), requestVersion: String(prior.reading_request_version), created: false };
      await bindInspirationReading(tx, input, reading);
      if (priorResult && reading.jobId === prior.reading_job_id && reading.requestVersion === prior.reading_request_version) {
        await tx.execute(sql`UPDATE inspiration_processing p SET result = ${JSON.stringify(priorResult)}::jsonb
          WHERE ${derivationScope(input)} AND p.completed_at IS NULL AND p.result IS NULL
            AND p.reading_job_id = ${reading.jobId}::uuid AND p.reading_request_version = ${reading.requestVersion}::bigint`);
      }
    }
  }
  const fallback = !prior && !options.reading ? await currentArtifactResult(tx, input.profileId) : null;
  await tx.execute(sql`UPDATE inspiration_processing p SET derived_at = coalesce(p.derived_at, clock_timestamp()),
    result = CASE WHEN p.reading_request_version IS NULL THEN ${fallback ? JSON.stringify(fallback) : null}::jsonb ELSE p.result END,
    completed_at = CASE WHEN p.result IS NOT NULL OR (p.reading_request_version IS NULL AND ${fallback !== null}) THEN clock_timestamp() ELSE NULL END
    FROM inspirations i, inspiration_revisions r
    WHERE i.id = p.inspiration_id AND i.profile_id = p.owner_profile_id AND r.inspiration_id = i.id AND r.profile_id = i.profile_id
      AND ${derivationScope(input)} AND p.completed_at IS NULL AND ${currentMaterial} AND ${authorizedDestination} AND ${allowedSource}`);
}

/** Inside artifact publication, never the later job-settlement callback. Keep
 * dependency results even while extraction is unfinished/superseded, but do
 * not turn them into material completion until both facts are current. */
export async function recordInspirationReadingResult(tx: Transaction, input: {
  profileId: string; jobId: string; requestVersion: string; result: BackgroundJobResult;
}): Promise<void> {
  const result = parseTopOfMindRefreshResult(input.result);
  if (!result) throw new Error('Invalid published reading result');
  if (result.topOfMindId) {
    const owned = await tx.execute(sql`SELECT m.id FROM top_of_minds m JOIN profiles d ON d.id = ${input.profileId}::uuid
      WHERE m.id = ${result.topOfMindId}::uuid AND m.version = ${result.version}
        AND (m.profile_id = d.id OR (d.type::text = 'group' AND m.group_id = d.group_id)) LIMIT 1`);
    if (!owned.length) throw new Error('Published reading does not belong to this destination');
  }
  await tx.execute(sql`UPDATE inspiration_processing p SET result = ${JSON.stringify(result)}::jsonb,
    completed_at = CASE WHEN p.derived_at IS NOT NULL AND ${currentMaterial} AND ${allowedSource} THEN clock_timestamp() ELSE NULL END
    FROM inspirations i, inspiration_revisions r
    WHERE i.id = p.inspiration_id AND i.profile_id = p.owner_profile_id AND r.inspiration_id = i.id AND r.profile_id = i.profile_id
      AND p.profile_id = ${input.profileId}::uuid AND p.reading_job_id = ${input.jobId}::uuid
      AND p.reading_request_version <= ${input.requestVersion}::bigint AND p.completed_at IS NULL AND p.result IS NULL AND ${authorizedDestination}`);
}

export async function readInspirationRevision(db: Pick<ReturnType<typeof getDb>, 'select'>,
  profileId: string, inspirationId: string, scope: InspirationEmbeddingScope): Promise<bigint | null> {
  const [row] = await db.select({ revision: scope === 'personal' ? inspirationRevisions.personalRevision : inspirationRevisions.publicRevision })
    .from(inspirationRevisions).where(and(eq(inspirationRevisions.profileId, profileId), eq(inspirationRevisions.inspirationId, inspirationId))).limit(1);
  return row?.revision ?? null;
}

/** Called in the same transaction as enqueue. The source, tenant, destination
 * permission and exact queue request are checked by the INSERT, not supplied
 * as facts by a caller. No completed/derived state is invented on request. */
export async function recordInspirationProcessingRequest(tx: Transaction, input: {
  ownerProfileId: string; inspirationId: string; profileId: string; job: EnqueueResult;
}): Promise<InspirationProcessingReceipt> {
  const rows = await tx.execute(sql`
    INSERT INTO inspiration_processing (profile_id, owner_profile_id, inspiration_id, material_revision,
      derivation_job_id, derivation_request_version)
    SELECT ${input.profileId}::uuid, i.profile_id, i.id,
      CASE WHEN ${input.profileId}::uuid = i.profile_id THEN r.personal_revision ELSE r.public_revision END,
      j.id, j.request_version
    FROM inspirations i JOIN inspiration_revisions r ON r.inspiration_id = i.id AND r.profile_id = i.profile_id
      JOIN background_jobs j ON j.id = ${input.job.jobId}::uuid AND j.profile_id = i.profile_id
    WHERE i.id = ${input.inspirationId}::uuid AND i.profile_id = ${input.ownerProfileId}::uuid
      AND j.type::text = 'derive_signals' AND j.request_version = ${input.job.requestVersion}::bigint
      AND j.status::text IN ('pending', 'running')
      AND j.payload->>'inspirationId' = i.id::text
      AND coalesce(j.payload->>'deriveIntoProfileId', i.profile_id::text) = ${input.profileId}
      AND ((${input.profileId}::uuid = i.profile_id AND j.payload->>'deriveIntoProfileId' IS NULL)
        OR (${input.profileId}::uuid <> i.profile_id AND i.visibility::text = 'public' AND EXISTS (
        SELECT 1 FROM profiles p JOIN group_members m ON m.group_id = p.group_id
        JOIN profiles owner ON owner.id = m.profile_id AND owner.type::text = 'human'
        WHERE p.id = ${input.profileId}::uuid AND p.type::text = 'group' AND m.profile_id = i.profile_id)))
    ON CONFLICT (profile_id, inspiration_id, derivation_job_id, derivation_request_version)
      DO UPDATE SET material_revision = inspiration_processing.material_revision
      WHERE inspiration_processing.material_revision = EXCLUDED.material_revision
        AND inspiration_processing.owner_profile_id = EXCLUDED.owner_profile_id
    RETURNING id, profile_id AS "profileId", inspiration_id AS "inspirationId", material_revision::text AS "materialRevision",
      derivation_job_id AS "jobId", derivation_request_version::text AS "requestVersion"
  `);
  const [receipt] = rows as unknown as InspirationProcessingReceipt[];
  if (!receipt) throw new InspirationProcessingUnavailableError();
  return receipt;
}
