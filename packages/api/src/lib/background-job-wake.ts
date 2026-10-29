import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { CreateScheduleCommandInput } from '@aws-sdk/client-scheduler';
import { backgroundJobTypeValues, type BackgroundJob } from '../db/index.js';
import { getDb } from './db.js';
import { STALE_LOCK_SECONDS } from './queue.js';
import { BackgroundJobHeldError } from './background-job-hold.js';

export type BackgroundJobWake =
  | { kind: 'pending'; profileId: string; runAfter: string; token: string }
  | { kind: 'lease'; id: string; profileId: string; requestVersion: string; lockedAt: string; attempt: number };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const timestamp = (value: unknown): value is string => typeof value === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3,6}Z$/.test(value) && Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
export function readBackgroundJobWake(value: unknown): BackgroundJobWake | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.profileId !== 'string' || !uuid.test(row.profileId)) return null;
  if (row.kind === 'pending' && timestamp(row.runAfter) && typeof row.token === 'string' && uuid.test(row.token)) return { kind: 'pending', profileId: row.profileId, runAfter: row.runAfter, token: row.token };
  if (row.kind === 'lease' && typeof row.id === 'string' && uuid.test(row.id) && timestamp(row.lockedAt) &&
    typeof row.requestVersion === 'string' && /^[1-9]\d{0,18}$/.test(row.requestVersion) && BigInt(row.requestVersion) <= 9223372036854775807n &&
    typeof row.attempt === 'number' && Number.isSafeInteger(row.attempt) && row.attempt > 0 && row.attempt <= 2147483647) {
    return { kind: 'lease', id: row.id, profileId: row.profileId, requestVersion: row.requestVersion, lockedAt: row.lockedAt, attempt: row.attempt };
  }
  return null;
}
function wakeName(wake: BackgroundJobWake) {
  return `waka-job-${createHash('sha256').update(JSON.stringify(readBackgroundJobWake(wake))).digest('hex').slice(0, 40)}`;
}
export function backgroundJobWakesEnabled(targetArn?: string): boolean {
  return Boolean(targetArn && process.env.WAKA_BACKGROUND_JOB_WAKE_ROLE && process.env.WAKA_BACKGROUND_JOB_WAKE_GROUP);
}
export function backgroundJobWakeInput(wake: BackgroundJobWake, targetArn: string, roleArn: string, group: string, now = new Date()): CreateScheduleCommandInput {
  const due = wake.kind === 'pending' ? Date.parse(wake.runAfter) : Date.parse(wake.lockedAt) + STALE_LOCK_SECONDS * 1000;
  // An extra second protects microsecond SQL deadlines and strict lease expiry.
  const at = new Date(Math.max(Math.ceil(due / 1000) * 1000 + 1000, Math.ceil(now.getTime() / 1000) * 1000 + 1000));
  return { Name: wakeName(wake), GroupName: group, ScheduleExpression: `at(${at.toISOString().slice(0, 19)})`,
    ScheduleExpressionTimezone: 'UTC', FlexibleTimeWindow: { Mode: 'OFF' }, ActionAfterCompletion: 'DELETE',
    Target: { Arn: targetArn, RoleArn: roleArn, Input: JSON.stringify({ mode: 'job_wake', wake }),
      RetryPolicy: { MaximumEventAgeInSeconds: 3600, MaximumRetryAttempts: 5 } } };
}
let client: import('@aws-sdk/client-scheduler').SchedulerClient | undefined;
async function scheduler() {
  const sdk = await import('@aws-sdk/client-scheduler');
  client ??= new sdk.SchedulerClient({ maxAttempts: 2 });
  return { sdk, client };
}
async function createWake(wake: BackgroundJobWake, targetArn: string) {
  const { sdk, client } = await scheduler();
  try { await client.send(new sdk.CreateScheduleCommand(backgroundJobWakeInput(wake, targetArn,
    process.env.WAKA_BACKGROUND_JOB_WAKE_ROLE!, process.env.WAKA_BACKGROUND_JOB_WAKE_GROUP!)), { abortSignal: AbortSignal.timeout(5000) }); }
  catch (error) { if ((error as { name?: string }).name !== 'ConflictException') throw error; }
}
async function deleteWake(wake: BackgroundJobWake): Promise<boolean> {
  if (!process.env.WAKA_BACKGROUND_JOB_WAKE_GROUP) return false;
  const { sdk, client } = await scheduler();
  try { await client.send(new sdk.DeleteScheduleCommand({ Name: wakeName(wake), GroupName: process.env.WAKA_BACKGROUND_JOB_WAKE_GROUP }),
    { abortSignal: AbortSignal.timeout(5000) }); return true; }
  catch (error) {
    if ((error as { name?: string }).name !== 'ResourceNotFoundException') {
      console.warn('[background-job-wake] cancellation failed', { kind: wake.kind, error: (error as { name?: string }).name ?? 'unknown' });
      return false;
    }
    return true;
  }
}
function leaseWake(job: BackgroundJob): BackgroundJobWake | null {
  if (!job.lockedAt) return null;
  return readBackgroundJobWake({ kind: 'lease', id: job.id, profileId: job.profileId,
    requestVersion: job.requestVersion.toString(), attempt: job.attempts,
    lockedAt: timestamp(job.lockedAt) ? job.lockedAt : new Date(job.lockedAt).toISOString().replace(/(\.\d{3})Z$/, '$1000Z') });
}
const supported = (alias: string) => sql`${sql.identifier(alias)}.type::text IN (${sql.join(backgroundJobTypeValues.map(type => sql`${type}`), sql`, `)})`;
const stamp = (alias: string, column: 'run_after' | 'locked_at') =>
  sql`to_char(${sql.identifier(alias)}.${sql.identifier(column)} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** Arm before provider work; on a scheduling outage, hand back the unspent claim. */
export async function armBackgroundJobLease(job: BackgroundJob, targetArn?: string): Promise<boolean> {
  if (!backgroundJobWakesEnabled(targetArn)) return true;
  const wake = leaseWake(job); if (!wake || wake.kind !== 'lease') return false;
  try {
    await createWake(wake, targetArn!);
    const rows = await getDb().execute(sql`UPDATE background_jobs SET payload=jsonb_set(payload,'{leaseWake}',${JSON.stringify(wake)}::jsonb)
      WHERE id=${wake.id}::uuid AND profile_id=${wake.profileId}::uuid AND status='running'
        AND locked_at=${wake.lockedAt}::timestamptz AND attempts=${wake.attempt}
        AND request_version>=${wake.requestVersion}::bigint RETURNING id`);
    if (!rows.length) { await deleteWake(wake); return false; }
    const previous = readBackgroundJobWake(job.payload && (job.payload as unknown as Record<string, unknown>).leaseWake);
    if (previous?.kind === 'lease' && previous.id === wake.id && previous.profileId === wake.profileId && wakeName(previous) !== wakeName(wake)) await deleteWake(previous);
    return true;
  } catch (error) {
    console.warn('[background-job-wake] lease scheduling failed', { jobId: job.id, error: (error as { name?: string }).name ?? 'unknown' });
    throw new BackgroundJobHeldError(new Date(Date.now() + 30_000), 'Recovery scheduling unavailable', 'support');
  }
}
export async function cancelBackgroundJobLease(job: BackgroundJob): Promise<void> {
  if (!process.env.WAKA_BACKGROUND_JOB_WAKE_GROUP) return;
  const wake = leaseWake(job); if (!wake || wake.kind !== 'lease') return;
  try {
    const [row] = await getDb().execute<{ active: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM background_jobs
      WHERE id=${wake.id}::uuid AND profile_id=${wake.profileId}::uuid AND status='running'
        AND locked_at=${wake.lockedAt}::timestamptz AND attempts=${wake.attempt}) AS active`);
    if (!row?.active && await deleteWake(wake)) await clearWakeMarker(wake);
  } catch (error) { console.warn('[background-job-wake] cancellation check failed', { kind: 'lease', error: (error as { name?: string }).name ?? 'unknown' }); }
}

/** Post-commit cancellation. A shared profile/deadline wake stays while any
 * supported pending member remains; lease wakes belong to exactly one claim. */
export async function cancelBackgroundJobWakes(payloads: unknown[]): Promise<void> {
  if (!process.env.WAKA_BACKGROUND_JOB_WAKE_GROUP) return;
  const wakes = new Map<string, BackgroundJobWake>();
  for (const payload of payloads) {
    if (!payload || typeof payload !== 'object') continue;
    for (const value of [(payload as Record<string, unknown>).leaseWake, (payload as Record<string, unknown>).pendingWake]) {
      const wake = readBackgroundJobWake(value); if (wake) wakes.set(wakeName(wake), wake);
    }
  }
  for (const wake of wakes.values()) {
    try {
      if (wake.kind === 'pending') {
        const [held] = await getDb().execute<{ present: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM background_jobs job
          WHERE job.profile_id=${wake.profileId}::uuid AND job.status='pending' AND job.locked_at IS NULL
            AND job.attempts<job.max_attempts AND job.run_after=${wake.runAfter}::timestamptz
            AND job.payload->'pendingWake'->>'token'=${wake.token} AND ${supported('job')}) AS present`);
        if (held?.present) continue;
      }
      if (await deleteWake(wake) && wake.kind === 'pending') await clearWakeMarker(wake);
    } catch (error) { console.warn('[background-job-wake] cancellation check failed', { kind: wake.kind, error: (error as { name?: string }).name ?? 'unknown' }); }
  }
}

async function clearWakeMarker(wake: BackgroundJobWake) {
  if (wake.kind === 'pending') await getDb().execute(sql`UPDATE background_jobs SET payload=payload-'pendingWake'
    WHERE profile_id=${wake.profileId}::uuid AND payload->'pendingWake'->>'token'=${wake.token}`);
  else await getDb().execute(sql`UPDATE background_jobs SET payload=payload-'leaseWake'
    WHERE id=${wake.id}::uuid AND profile_id=${wake.profileId}::uuid AND payload->'leaseWake'=${JSON.stringify(wake)}::jsonb`);
}
export async function retireBackgroundJobWake(wake: BackgroundJobWake): Promise<void> {
  await deleteWake(wake);
  await clearWakeMarker(wake);
}

/** A delivery is a hint, never authority to publish or bypass budgets. Invalid,
 * early, superseded and cancelled events return before a normal queue drain. */
export async function prepareBackgroundJobWake(value: unknown, now = new Date()): Promise<boolean> {
  const wake = readBackgroundJobWake(value); if (!wake) return false;
  const at = now.toISOString();
  if (wake.kind === 'pending') {
    const [row] = await getDb().execute<{ ready: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM background_jobs job
      WHERE job.profile_id=${wake.profileId}::uuid AND job.status='pending' AND job.locked_at IS NULL AND job.attempts<job.max_attempts
        AND job.run_after=${wake.runAfter}::timestamptz AND job.run_after<=${at}::timestamptz AND ${supported('job')}
        AND (job.payload->'pendingWake'->>'token'=${wake.token} OR ${pendingMissing()})) AS ready`);
    return row?.ready === true;
  }
  const [row] = await getDb().execute<{ ready: boolean }>(sql`
    WITH settled AS (UPDATE background_jobs job SET
      status=CASE WHEN rerun_requested THEN 'pending'::background_job_status ELSE 'failed'::background_job_status END,
      attempts=CASE WHEN rerun_requested THEN 0 ELSE attempts END,
      locked_at=CASE WHEN rerun_requested THEN NULL ELSE locked_at END,
      run_after=CASE WHEN rerun_requested THEN ${at}::timestamptz ELSE run_after END,
      last_error=CASE WHEN rerun_requested THEN NULL ELSE 'abandoned_lease: the final attempt did not finish before lease expiry' END,
      rerun_requested=false,result=NULL,updated_at=${at}::timestamptz
      WHERE id=${wake.id}::uuid AND profile_id=${wake.profileId}::uuid AND status='running'
        AND locked_at=${wake.lockedAt}::timestamptz AND attempts=${wake.attempt} AND request_version>=${wake.requestVersion}::bigint
        AND locked_at<${at}::timestamptz-(${STALE_LOCK_SECONDS}||' seconds')::interval
        AND attempts>=max_attempts AND ${supported('job')} RETURNING status)
    SELECT EXISTS(SELECT 1 FROM settled WHERE status='pending') OR EXISTS(SELECT 1 FROM background_jobs job
      WHERE job.id=${wake.id}::uuid AND job.profile_id=${wake.profileId}::uuid AND job.status='running'
        AND job.locked_at=${wake.lockedAt}::timestamptz AND job.attempts=${wake.attempt} AND job.request_version>=${wake.requestVersion}::bigint
        AND job.attempts<job.max_attempts AND job.locked_at<${at}::timestamptz-(${STALE_LOCK_SECONDS}||' seconds')::interval
        AND ${supported('job')}) AS ready`);
  return row?.ready === true;
}

function pendingMissing() {
  return sql`job.status='pending' AND job.locked_at IS NULL AND job.attempts<job.max_attempts AND ${supported('job')}
    AND (job.payload->'pendingWake'->>'runAfter' IS DISTINCT FROM ${stamp('job', 'run_after')}
      OR job.payload->'pendingWake'->>'profileId' IS DISTINCT FROM job.profile_id::text
      OR job.payload->'pendingWake'->>'kind' IS DISTINCT FROM 'pending'
      OR job.payload->'pendingWake'->>'token' IS NULL OR NOT (job.payload->'pendingWake'->>'token' ~* ${uuid.source}))`;
}
function leaseMissing() {
  return sql`job.status='running' AND job.locked_at IS NOT NULL AND ${supported('job')} AND (
    job.payload->'leaseWake'->>'lockedAt' IS DISTINCT FROM ${stamp('job', 'locked_at')}
    OR job.payload->'leaseWake'->>'attempt' IS DISTINCT FROM job.attempts::text
    OR job.payload->'leaseWake'->>'id' IS DISTINCT FROM job.id::text
    OR job.payload->'leaseWake'->>'profileId' IS DISTINCT FROM job.profile_id::text
    OR job.payload->'leaseWake'->>'kind' IS DISTINCT FROM 'lease')`;
}
/** Runs only after real activity, an explicit recovery, or existing daily work.
 * A full batch continues once only when unarmed work is still proven to exist. */
export async function recoverBackgroundJobWakes(targetArn?: string, profileId?: string): Promise<void> {
  if (!backgroundJobWakesEnabled(targetArn)) return;
  const pending = await getDb().execute<{ profile_id: string; run_after: string }>(sql`
    SELECT job.profile_id,${stamp('job', 'run_after')} AS run_after FROM background_jobs job
    WHERE ${pendingMissing()} ${profileId ? sql`AND job.profile_id=${profileId}::uuid` : sql``} GROUP BY job.profile_id,job.run_after ORDER BY job.run_after,job.profile_id LIMIT 50`);
  for (const row of pending) {
    const wake: BackgroundJobWake = { kind: 'pending', profileId: row.profile_id, runAfter: row.run_after, token: randomUUID() };
    await createWake(wake, targetArn!);
    const ack = await getDb().execute<{ old_wake: unknown }>(sql`
      WITH previous AS (SELECT job.id,job.payload->'pendingWake' AS old_wake FROM background_jobs job
        WHERE profile_id=${wake.profileId}::uuid AND status='pending' AND locked_at IS NULL AND attempts<max_attempts
          AND run_after=${wake.runAfter}::timestamptz AND ${supported('job')} FOR UPDATE),
      updated AS (UPDATE background_jobs job SET payload=jsonb_set(job.payload,'{pendingWake}',${JSON.stringify(wake)}::jsonb)
        FROM previous WHERE job.id=previous.id RETURNING previous.old_wake)
      SELECT DISTINCT old_wake FROM updated`);
    if (!ack.length) await deleteWake(wake);
    for (const row of ack) {
      const previous = readBackgroundJobWake(row.old_wake);
      if (previous?.kind === 'pending' && previous.profileId === wake.profileId && wakeName(previous) !== wakeName(wake)) {
        await cancelBackgroundJobWakes([{ pendingWake: previous }]);
      }
    }
  }
  const leases = await getDb().execute<{ id: string; profile_id: string; request_version: string; attempts: number; locked_at: string }>(sql`
    SELECT job.id,job.profile_id,job.request_version::text,job.attempts,${stamp('job', 'locked_at')} AS locked_at
    FROM background_jobs job WHERE ${leaseMissing()} ${profileId ? sql`AND job.profile_id=${profileId}::uuid` : sql``} ORDER BY job.locked_at,job.id LIMIT 50`);
  for (const row of leases) {
    await armBackgroundJobLease({ id: row.id, profileId: row.profile_id, requestVersion: BigInt(row.request_version),
      attempts: row.attempts, lockedAt: row.locked_at as unknown as Date } as BackgroundJob, targetArn);
  }
  if (pending.length < 50 && leases.length < 50) return;
  const [more] = await getDb().execute<{ present: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM background_jobs job
    WHERE (${pendingMissing()} OR ${leaseMissing()}) ${profileId ? sql`AND job.profile_id=${profileId}::uuid` : sql``}) AS present`);
  if (!more?.present) return;
  const { sdk, client } = await scheduler();
  const at = new Date(Math.ceil((Date.now() + 5000) / 1000) * 1000);
  try { await client.send(new sdk.CreateScheduleCommand({ Name: `waka-job-batch-${at.getTime()}`,
    GroupName: process.env.WAKA_BACKGROUND_JOB_WAKE_GROUP, ScheduleExpression: `at(${at.toISOString().slice(0,19)})`,
    ScheduleExpressionTimezone: 'UTC', FlexibleTimeWindow: { Mode: 'OFF' }, ActionAfterCompletion: 'DELETE',
    Target: { Arn: targetArn!, RoleArn: process.env.WAKA_BACKGROUND_JOB_WAKE_ROLE!, Input: JSON.stringify({ mode: 'wake_recovery' }),
      RetryPolicy: { MaximumEventAgeInSeconds: 3600, MaximumRetryAttempts: 5 } } }), { abortSignal: AbortSignal.timeout(5000) }); }
  catch (error) { if ((error as { name?: string }).name !== 'ConflictException') throw error; }
}
