import { createHash } from 'node:crypto';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { sql } from 'drizzle-orm';
import type { getDb } from './db.js';
import { legacyDerivationRecoveryEligible, legacyDerivationEmbeddingHeld } from './job-failure-recovery.js';
import { recordOperationalFault } from './operational-fault.js';
import { readJobFailureNotice, type JobFailureNotice } from '../monitoring/job-failure.js';

type Database = Pick<ReturnType<typeof getDb>, 'execute'>;
type Notify = (arn: string, notice: JobFailureNotice) => Promise<void>;

const client = new LambdaClient({ maxAttempts: 1 });
const notifyRelay: Notify = async (arn, notice) => {
  const response = await client.send(new InvokeCommand({
    FunctionName: arn, InvocationType: 'RequestResponse', Payload: Buffer.from(JSON.stringify(notice)),
  }), { abortSignal: AbortSignal.timeout(12_000) });
  if (response.StatusCode !== 200 || response.FunctionError || !response.Payload) throw Error('job_notice_unconfirmed');
  const ack = JSON.parse(Buffer.from(response.Payload).toString('utf8'));
  if (ack?.delivered !== notice.reference) throw Error('job_notice_unconfirmed');
};

/** Called after terminal settlement, or by the existing maintenance sweep. A
 * failed row stays eligible until the isolated relay acknowledges its incident.
 * No SQL transaction or row lock spans a network operation. */
export async function deliverTerminalJobNotices(db: Database, jobId?: string, notify: Notify = notifyRelay) {
  if (process.env.WAKA_STAGE !== 'production' || !process.env.AWS_LAMBDA_FUNCTION_NAME) return;
  try {
    const arn = process.env.WAKA_JOB_ALERT_RELAY_ARN ?? '';
    if (!/^arn:aws:lambda:us-west-2:\d{12}:function:waka-production-JobFailureAlertFunction-[a-zA-Z0-9_-]+$/.test(arn)) {
      throw Error('job_notice_destination_invalid');
    }
    const rows = await db.execute<{
      id: string; version: string; failedAt: string; jobType: JobFailureNotice['jobType']; disposition: JobFailureNotice['disposition']; diagnostic: JobFailureNotice['diagnostic'];
    }>(sql`SELECT j.id, j.request_version::text AS version, j.type::text AS "jobType",
      to_char(j.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "failedAt",
      CASE WHEN j.last_error IN ('provider_credit_refused','model_configuration') OR j.last_error ~ '^provider_http_[45][0-9]{2}$' THEN j.last_error
        WHEN j.last_error IN ('malformed_model_output','model_unusable_output') THEN 'invalid_model_output'
        WHEN j.last_error IN ('{"category":"database","code":"55P03"}','{"category":"database","code":"40P01"}') THEN 'database_lock'
        WHEN j.last_error IN ('embedding_outcome_unknown','embedding_commit_unconfirmed','embedding_current_vector_unavailable')
          OR ${legacyDerivationEmbeddingHeld} THEN 'embedding_unresolved'
        ELSE 'other' END AS diagnostic,
      CASE WHEN j.payload->>'failureDisposition' IN ('permanent','ambiguous','exhausted') THEN j.payload->>'failureDisposition'
        WHEN ${legacyDerivationEmbeddingHeld} THEN 'ambiguous' ELSE 'review' END AS disposition
      FROM background_jobs j
      WHERE j.status = 'failed' AND j.terminal_notice_sent_for IS DISTINCT FROM j.updated_at
        ${jobId ? sql`AND j.id = ${jobId}::uuid` : sql``}
        AND (${legacyDerivationRecoveryEligible}) IS NOT TRUE
      ORDER BY j.updated_at, j.id LIMIT 25`);
    const deadline = Date.now() + 20_000;
    for (const row of rows) {
      if (Date.now() >= deadline) break;
      const reference = createHash('sha256').update([row.id, row.version, row.failedAt].join('/')).digest('hex');
      try {
        const notice = readJobFailureNotice({ source: 'waka.job-failure.v1', reference, jobType: row.jobType,
          disposition: row.disposition, diagnostic: row.diagnostic, timestamp: Date.parse(row.failedAt) });
        if (!notice) throw Error('job_notice_invalid');
        console.info('[background-jobs] terminal incident', { reference, jobId: row.id, type: row.jobType, disposition: row.disposition });
        await notify(arn, notice);
        await db.execute(sql`UPDATE background_jobs SET terminal_notice_sent_for = updated_at
          WHERE id = ${row.id}::uuid AND status = 'failed' AND request_version = ${row.version}::bigint
            AND updated_at = ${row.failedAt}::timestamptz AND terminal_notice_sent_for IS DISTINCT FROM updated_at`);
      } catch {
        recordOperationalFault('maintenance');
        console.warn('[background-jobs] terminal notice unconfirmed', { reference });
      }
    }
  } catch {
    recordOperationalFault('maintenance');
    console.warn('[background-jobs] terminal notice check deferred');
  }
}
