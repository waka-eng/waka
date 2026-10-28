import { sql } from 'drizzle-orm';
import { getDb } from './db.js';
import { effectiveAttachmentStatus } from './attachment-material.js';
import { STALE_LOCK_SECONDS } from './queue.js';

/** One bounded, metadata-only read for this profile's current material. No
 * archived revision, foreign source, provider error or memory text escapes. */
export async function loadProfileProcessing(db: ReturnType<typeof getDb>, profileId: string) {
  const rows = await db.execute<{ inspiration_id: string; created_at: Date | string; stage: string;
    phase: string; run_after: Date | string | null; total: number; failed: number }>(sql`
    WITH latest AS (
      SELECT DISTINCT ON (p.inspiration_id) p.*
      FROM inspiration_processing p JOIN inspiration_revisions r
        ON r.inspiration_id=p.inspiration_id AND r.profile_id=p.owner_profile_id AND r.personal_revision=p.material_revision
      JOIN inspirations i ON i.id=p.inspiration_id AND i.profile_id=p.owner_profile_id
      WHERE p.profile_id=${profileId}::uuid AND p.owner_profile_id=${profileId}::uuid
      ORDER BY p.inspiration_id, p.created_at DESC, p.derivation_request_version DESC, p.id DESC
    ), work AS (
      SELECT p.inspiration_id, p.created_at,
        CASE WHEN p.derived_at IS NULL THEN 'derivation' ELSE 'reading' END AS stage,
        CASE WHEN j.status::text='failed' OR (j.status::text='running' AND
          (j.locked_at IS NULL OR j.locked_at<now()-${STALE_LOCK_SECONDS}*interval '1 second') AND j.attempts>=j.max_attempts) THEN 'failed'
          WHEN j.status::text='pending' AND j.attempts>=j.max_attempts THEN 'failed'
          WHEN j.id IS NULL OR j.status::text='succeeded' THEN 'unknown'
          WHEN j.status::text='running' AND j.locked_at>=now()-${STALE_LOCK_SECONDS}*interval '1 second' THEN 'processing'
          WHEN j.run_after>now() THEN 'waiting' ELSE 'queued' END AS phase, j.run_after
      FROM latest p LEFT JOIN background_jobs j ON j.profile_id=p.profile_id
        AND j.id=CASE WHEN p.derived_at IS NULL THEN p.derivation_job_id ELSE p.reading_job_id END
        AND j.type::text=CASE WHEN p.derived_at IS NULL THEN 'derive_signals' ELSE 'refresh_top_of_mind' END
      WHERE p.completed_at IS NULL
      UNION ALL
      SELECT a.inspiration_id, min(a.created_at), 'enrichment',
        CASE WHEN bool_or(j.status::text='failed' OR (j.attempts>=j.max_attempts AND
          (j.status::text='pending' OR j.locked_at IS NULL OR j.locked_at<now()-${STALE_LOCK_SECONDS}*interval '1 second'))) THEN 'failed'
          WHEN bool_or(j.id IS NULL OR j.status::text='succeeded') THEN 'unknown'
          WHEN bool_or(j.status::text='running' AND j.locked_at>=now()-${STALE_LOCK_SECONDS}*interval '1 second') THEN 'processing'
          WHEN min(j.run_after)>now() THEN 'waiting' ELSE 'queued' END, min(j.run_after)
      FROM (SELECT attachments.*, ${effectiveAttachmentStatus} AS material_status FROM attachments
        WHERE profile_id=${profileId}::uuid) a
      JOIN inspirations i ON i.id=a.inspiration_id AND i.profile_id=a.profile_id
      LEFT JOIN background_jobs j ON j.profile_id=a.profile_id AND j.idempotency_key='enrich_attachment:'||a.id::text
        AND j.type::text='enrich_attachment' AND j.payload->>'inspirationId'=a.inspiration_id::text
      WHERE a.material_status IS NULL OR a.material_status::text IN ('pending','failed')
      GROUP BY a.inspiration_id
    ), current_work AS (
      SELECT DISTINCT ON (inspiration_id) * FROM work
      ORDER BY inspiration_id, (stage='enrichment') DESC
    )
    SELECT *, count(*) OVER()::int AS total,
      count(*) FILTER (WHERE phase IN ('failed','unknown')) OVER()::int AS failed
    FROM current_work ORDER BY (phase IN ('failed','unknown')) DESC, created_at, inspiration_id LIMIT 20
  `);
  return { profileId, total: rows[0]?.total ?? 0, failed: rows[0]?.failed ?? 0,
    items: rows.map(row => ({ inspirationId: row.inspiration_id, createdAt: new Date(row.created_at).toISOString(),
      stage: row.stage, phase: row.phase, runAfter: row.run_after ? new Date(row.run_after).toISOString() : null })) };
}
