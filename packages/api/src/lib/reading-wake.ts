import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { getDb } from './db.js';
import { readBackgroundJobWakeReferences, type BackgroundJobWakeReference } from './queue.js';
import type { CreateScheduleCommandInput } from '@aws-sdk/client-scheduler';

/** One-time wake-ups carry identifiers only. Postgres still decides whether a
 * job is due, which profile owns it, and whether its budget permits a read. */
export function readingWakeInput(row: BackgroundJobWakeReference & { runAfter: Date | string },
  targetArn: string, roleArn: string, group: string) {
  const due = new Date(row.runAfter);
  // Round up: truncating milliseconds must never wake before the job is due.
  const at = new Date(Math.ceil(due.getTime() / 1000) * 1000).toISOString().slice(0, 19);
  const suffix = createHash('sha256').update(`${row.id}:${at}`).digest('hex').slice(0, 32);
  return { Name: `waka-reading-${suffix}`, GroupName: group,
    ScheduleExpression: `at(${at})`, ScheduleExpressionTimezone: 'UTC',
    FlexibleTimeWindow: { Mode: 'OFF' as const }, ActionAfterCompletion: 'DELETE' as const,
    Target: { Arn: targetArn, RoleArn: roleArn,
      Input: JSON.stringify({ mode: 'enqueue', wakes: [{ id: row.id, profileId: row.profileId, requestVersion: row.requestVersion }] }),
      RetryPolicy: { MaximumEventAgeInSeconds: 3600, MaximumRetryAttempts: 5 } } };
}

export async function scheduleDeferredReadings(wakes: BackgroundJobWakeReference[], targetArn?: string) {
  const role = process.env.WAKA_READING_WAKE_ROLE, group = process.env.WAKA_READING_WAKE_GROUP;
  const valid = readBackgroundJobWakeReferences(wakes);
  if (!role || !group || !targetArn || !valid.length) return;
  const hints = JSON.stringify(valid.map(row => ({ id: row.id, profile_id: row.profileId, request_version: row.requestVersion })));
  const rows = await getDb().execute<{ id: string; profile_id: string; request_version: string; run_after: Date | string }>(sql`
    SELECT job.id, job.profile_id, job.request_version::text, job.run_after::text
    FROM background_jobs job JOIN jsonb_to_recordset(${hints}::jsonb)
      AS hint(id uuid, profile_id uuid, request_version bigint) ON job.id=hint.id AND job.profile_id=hint.profile_id
    WHERE job.type::text='refresh_top_of_mind' AND job.status='pending' AND job.locked_at IS NULL
      AND job.attempts<job.max_attempts AND job.request_version>=hint.request_version
      AND job.completed_version<job.request_version AND job.run_after>now()+interval '2 minutes'
      AND job.payload->'wakeScheduledFor' IS DISTINCT FROM to_jsonb(job.run_after)
  `);
  if (!rows.length) return;
  for (const row of rows) {
    await sendSchedule(readingWakeInput({ id: row.id, profileId: row.profile_id,
      requestVersion: row.request_version, runAfter: row.run_after }, targetArn, role, group));
    await getDb().execute(sql`UPDATE background_jobs SET payload=jsonb_set(payload,'{wakeScheduledFor}',to_jsonb(run_after))
      WHERE id=${row.id}::uuid AND profile_id=${row.profile_id}::uuid AND status='pending'
        AND run_after=${String(row.run_after)}::timestamptz`);
  }
}
let client: import('@aws-sdk/client-scheduler').SchedulerClient | undefined;
async function sendSchedule(input: CreateScheduleCommandInput) {
  const { SchedulerClient, CreateScheduleCommand } = await import('@aws-sdk/client-scheduler');
  client ??= new SchedulerClient({});
  try { await client.send(new CreateScheduleCommand(input)); }
  catch (error) {
    // Concurrent drains may schedule the same deadline. The worker always
    // rechecks current queue state, so an existing wake is sufficient.
    if ((error as { name?: string }).name !== 'ConflictException') throw error;
  }
}

/** Recover an interrupted schedule request from durable queue state. This also
 * covers budget deferrals that never claimed a job. Recording the deadline in
 * job metadata avoids a new table and never changes the requested reading. */
export async function recoverDeferredReadingWakes(targetArn?: string) {
  if (!process.env.WAKA_READING_WAKE_ROLE || !process.env.WAKA_READING_WAKE_GROUP || !targetArn) return;
  const rows = await getDb().execute<{id:string;profile_id:string;request_version:string}>(sql`
    SELECT id,profile_id,request_version::text FROM background_jobs
    WHERE type::text='refresh_top_of_mind' AND status='pending' AND locked_at IS NULL
      AND attempts<max_attempts AND completed_version<request_version AND run_after>now()+interval '2 minutes'
      AND payload->'wakeScheduledFor' IS DISTINCT FROM to_jsonb(run_after)
    ORDER BY run_after,id LIMIT 50
  `);
  await scheduleDeferredReadings(rows.map(row=>({id:row.id,profileId:row.profile_id,requestVersion:row.request_version})),targetArn);
  if (rows.length === 50) {
    // Continue a bounded recovery batch even when there is no other traffic.
    // Otherwise a large burst could strand the 51st deferred profile until
    // the daily safety sweep. Empty recovery batches do not schedule again.
    const due = new Date(Math.ceil((Date.now() + 180_000) / 60_000) * 60_000);
    await sendSchedule({ Name: `waka-reading-recovery-${due.getTime()}`,
      GroupName: process.env.WAKA_READING_WAKE_GROUP,
      ScheduleExpression: `at(${due.toISOString().slice(0,19)})`, ScheduleExpressionTimezone: 'UTC',
      FlexibleTimeWindow: { Mode: 'OFF' }, ActionAfterCompletion: 'DELETE',
      Target: { Arn: targetArn, RoleArn: process.env.WAKA_READING_WAKE_ROLE!,
        Input: JSON.stringify({ mode: 'enqueue', wakes: [] }),
        RetryPolicy: { MaximumEventAgeInSeconds: 3600, MaximumRetryAttempts: 5 } } });
  }
}
