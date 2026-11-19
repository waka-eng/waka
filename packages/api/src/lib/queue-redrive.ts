import { sql } from 'drizzle-orm';
import type { getDb } from './db.js';

type Database = ReturnType<typeof getDb>;
export interface QueueRedriveTarget {
  accountId: string;
  profileId: string;
  jobId: string;
  replyRequestId: string;
  requestVersion: string;
}

/**
 * A reply reserves both possible provider attempts in the prepare transaction
 * before either network call. A current, pending request with neither stamp
 * therefore proves an unspent dispatch. Other work types need their own proof.
 */
export async function inspectQueueRedrive(db: Database, target: QueueRedriveTarget, apply = false) {
  const { accountId, profileId, jobId, replyRequestId, requestVersion } = target;
  const identity = sql`
    r.id = ${replyRequestId}::uuid AND r.profile_id = ${profileId}::uuid
    AND r.job_id = ${jobId}::uuid AND p.account_id = ${accountId}::uuid AND p.type = 'human'`;
  const rows = sql`
    conversation_reply_requests r
    JOIN conversations c ON c.id = r.conversation_id AND c.profile_id = r.profile_id
    JOIN profiles p ON p.id = c.profile_id`;
  const eligible = sql`
    ${identity}
    AND c.deleted_at IS NULL AND c.revision = r.conversation_revision
    AND r.status = 'pending' AND r.user_message_id IS NOT NULL AND r.assistant_message_id IS NULL
    AND r.dispatched_at IS NULL AND r.retrieval_dispatched_at IS NULL
    AND r.finished_at IS NULL AND r.failure_code IS NULL
    AND j.id = r.job_id AND j.profile_id = r.profile_id AND j.type = 'generate_conversation_reply'
    AND j.idempotency_key = 'generate_conversation_reply:' || p.id::text || ':' || r.id::text
    AND j.payload->>'replyRequestId' = r.id::text AND j.payload->>'conversationId' = c.id::text
    AND j.request_version = ${requestVersion}::bigint AND j.completed_version = 0
    AND j.status = 'failed' AND j.attempts = 3 AND j.max_attempts = 3
    AND j.result IS NULL AND NOT j.rerun_requested AND j.malformed_retry_version IS NULL
    AND j.last_error IN ('{"category":"database","code":"40001"}', '{"category":"database","code":"40P01"}',
      '{"category":"database","code":"55P03"}')`;

  if (!apply) {
    return db.transaction(async tx => {
      const [row] = await tx.execute<{ eligible: boolean }>(sql`SELECT EXISTS (
        SELECT 1 FROM ${rows} JOIN background_jobs j ON j.id = r.job_id WHERE ${eligible}
      ) AS eligible`);
      return { eligible: row?.eligible === true, queued: false };
    }, { accessMode: 'read only' });
  }

  return db.transaction(async tx => {
    // Stop, replacement and dispatch take this lock first. Re-read the
    // complete proof after acquiring it. Never wait behind an active writer.
    const conversation = await tx.execute(sql`SELECT c.id FROM ${rows} WHERE ${identity} FOR UPDATE OF c NOWAIT`);
    if (!conversation.length) return { eligible: false, queued: false };
    const job = await tx.execute(sql`
      SELECT j.id FROM ${rows} JOIN background_jobs j ON j.id = r.job_id
      WHERE ${eligible} FOR UPDATE OF j NOWAIT`);
    if (!job.length) return { eligible: false, queued: false };
    const updated = await tx.execute(sql`
      UPDATE background_jobs j SET status = 'pending', max_attempts = j.max_attempts + 1,
        locked_at = NULL, run_after = clock_timestamp(), updated_at = clock_timestamp(),
        payload = j.payload - ARRAY['leaseWake', 'pendingWake']
      FROM ${rows} WHERE ${eligible}
      RETURNING j.id`);
    return { eligible: updated.length === 1, queued: updated.length === 1 };
  }, { isolationLevel: 'read committed' });
}
