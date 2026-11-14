import { sql } from 'drizzle-orm';
import type { getDb } from './db.js';

export const RECALL_ATTEMPTS_PER_MINUTE = 10;
export const RECALL_ATTEMPTS_PER_HOUR = 60;
export const RECALL_TIMEOUT_MS = 5000;

/** One atomic account-wide reservation commits BEFORE provider dispatch.
 * Failures consume their attempt. No retries or dollar-cap claim. */
export async function reserveRecallAttempt(db: Pick<ReturnType<typeof getDb>, 'execute'>, accountId: string) {
  const rows = await db.execute(sql`INSERT INTO account_recall_limits AS r
    (account_id, minute_started_at, minute_count, hour_started_at, hour_count)
    VALUES (${accountId}::uuid, clock_timestamp(), 1, clock_timestamp(), 1)
    ON CONFLICT (account_id) DO UPDATE SET
      minute_started_at = CASE WHEN r.minute_started_at <= clock_timestamp()-interval '1 minute' THEN clock_timestamp() ELSE r.minute_started_at END,
      minute_count = CASE WHEN r.minute_started_at <= clock_timestamp()-interval '1 minute' THEN 1 ELSE r.minute_count+1 END,
      hour_started_at = CASE WHEN r.hour_started_at <= clock_timestamp()-interval '1 hour' THEN clock_timestamp() ELSE r.hour_started_at END,
      hour_count = CASE WHEN r.hour_started_at <= clock_timestamp()-interval '1 hour' THEN 1 ELSE r.hour_count+1 END
    WHERE (r.minute_started_at <= clock_timestamp()-interval '1 minute' OR r.minute_count < ${RECALL_ATTEMPTS_PER_MINUTE})
      AND (r.hour_started_at <= clock_timestamp()-interval '1 hour' OR r.hour_count < ${RECALL_ATTEMPTS_PER_HOUR})
    RETURNING account_id`);
  if(rows.length)return {allowed:true as const,retryAfter:0};
  const [blocked]=await db.execute<{seconds:number}>(sql`SELECT greatest(1,ceil(greatest(
    CASE WHEN minute_count >= ${RECALL_ATTEMPTS_PER_MINUTE} THEN extract(epoch FROM minute_started_at + interval '1 minute' - clock_timestamp()) ELSE 0 END,
    CASE WHEN hour_count >= ${RECALL_ATTEMPTS_PER_HOUR} THEN extract(epoch FROM hour_started_at + interval '1 hour' - clock_timestamp()) ELSE 0 END)))::int AS seconds
    FROM account_recall_limits WHERE account_id=${accountId}::uuid`);
  return {allowed:false as const,retryAfter:blocked?.seconds??3600};
}
