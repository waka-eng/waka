import { and, eq, sql } from 'drizzle-orm';
import type { getDb } from './db.js';
import type { EnqueueResult } from './queue.js';
import { inspirationRevisions, type InspirationEmbeddingScope } from '../db/index.js';

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
