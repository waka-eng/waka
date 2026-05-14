/**
 * Neutral scheduler/worker for durable background classification work.
 *
 * The public name remains `enqueueClassification` for the existing route call
 * site, but this module no longer talks to a broker. It writes a Postgres
 * `background_jobs` row and schedules an in-process drain tick. If the process
 * exits before the tick runs, the pending DB row is still inspectable and can
 * be drained manually or by future cron via `drainBackgroundJobs`.
 */

import { eq, sql } from "drizzle-orm";

import {
  type BackgroundJob,
  backgroundJobs,
  type BackgroundJobStatus,
  type ProcessInspirationPayload,
} from "../db/index.js";
import { runClassificationJob } from "../queue/classifier.js";
import { getDb } from "./db.js";

const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_ERROR_LENGTH = 1_000;
const STALE_LOCK_SECONDS = 15 * 60;

let drainScheduled = false;

export interface EnqueueClassificationResult {
  jobId: string;
}

export interface DrainBackgroundJobsOptions {
  limit?: number;
  now?: Date;
  processor?: (job: BackgroundJob) => Promise<void>;
}

export interface DrainBackgroundJobsResult {
  claimed: number;
  succeeded: number;
  retried: number;
  failed: number;
}

export async function enqueueClassification(
  inspirationId: string,
  userId: string,
): Promise<EnqueueClassificationResult> {
  const db = getDb();
  const idempotencyKey = `process_inspiration:${inspirationId}`;
  const [job] = await db
    .insert(backgroundJobs)
    .values({
      userId,
      type: "process_inspiration",
      payload: { inspirationId },
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      idempotencyKey,
    })
    .onConflictDoUpdate({
      target: backgroundJobs.idempotencyKey,
      targetWhere: sql`${backgroundJobs.idempotencyKey} IS NOT NULL`,
      set: {
        updatedAt: new Date(),
      },
    })
    .returning({ id: backgroundJobs.id });

  if (shouldAutoDrainBackgroundJobs()) {
    scheduleBackgroundJobDrain();
  }
  return { jobId: job!.id };
}

function shouldAutoDrainBackgroundJobs(): boolean {
  if (process.env.WAKA_BACKGROUND_JOB_AUTODRAIN === "1") return true;
  if (process.env.WAKA_BACKGROUND_JOB_AUTODRAIN === "0") return false;
  return process.env.NODE_ENV !== "test";
}

export function scheduleBackgroundJobDrain(): void {
  if (drainScheduled) return;
  drainScheduled = true;
  setImmediate(() => {
    drainScheduled = false;
    drainBackgroundJobs().catch((err) => {
      console.error("[background-jobs] drain tick failed", {
        error: sanitizeError(err),
      });
    });
  });
}

export async function drainBackgroundJobs(
  options: DrainBackgroundJobsOptions = {},
): Promise<DrainBackgroundJobsResult> {
  const limit = Math.max(0, Math.min(Math.trunc(options.limit ?? 10), 100));
  const result: DrainBackgroundJobsResult = {
    claimed: 0,
    succeeded: 0,
    retried: 0,
    failed: 0,
  };

  for (let processed = 0; processed < limit; processed += 1) {
    const job = await claimNextBackgroundJob(options.now);
    if (!job) return result;
    result.claimed += 1;

    try {
      await (options.processor ?? processBackgroundJob)(job);
      await markJobSucceeded(job.id);
      result.succeeded += 1;
    } catch (err) {
      const exhausted = job.attempts >= job.maxAttempts;
      await markJobFailedOrPending(job, err, exhausted, options.now ?? new Date());
      if (exhausted) result.failed += 1;
      else result.retried += 1;
    }
  }

  return result;
}

export async function runBackgroundJobWorker(
  options: DrainBackgroundJobsOptions = {},
): Promise<DrainBackgroundJobsResult> {
  return drainBackgroundJobs(options);
}

async function processBackgroundJob(job: BackgroundJob): Promise<void> {
  if (job.type !== "process_inspiration") {
    throw new Error(`Unsupported background job type: ${job.type}`);
  }

  const payload = parseProcessInspirationPayload(job.payload);
  if (!payload) {
    // Permanent poison payload: do not throw/retry. Mark as succeeded so the
    // queue does not loop forever; the sanitized warning stays in logs.
    console.warn("[background-jobs] dropping malformed process_inspiration job", {
      jobId: job.id,
    });
    return;
  }

  await runClassificationJob(payload.inspirationId, { userId: job.userId });
}

function parseProcessInspirationPayload(
  payload: unknown,
): ProcessInspirationPayload | null {
  if (
    !payload ||
    typeof payload !== "object" ||
    typeof (payload as { inspirationId?: unknown }).inspirationId !== "string"
  ) {
    return null;
  }
  const inspirationId = (payload as { inspirationId: string }).inspirationId.trim();
  if (!inspirationId) return null;
  return { inspirationId };
}

async function claimNextBackgroundJob(now = new Date()): Promise<BackgroundJob | null> {
  const db = getDb();
  const nowIso = now.toISOString();
  const rows = await db.execute(sql<BackgroundJob>`
    UPDATE background_jobs AS job
    SET
      status = 'running'::background_job_status,
      attempts = job.attempts + 1,
      locked_at = ${nowIso}::timestamptz,
      updated_at = ${nowIso}::timestamptz
    WHERE job.id = (
      SELECT candidate.id
      FROM background_jobs AS candidate
      WHERE
        (
          candidate.status = 'pending'::background_job_status
          AND candidate.run_after <= ${nowIso}::timestamptz
        )
        OR (
          candidate.status = 'running'::background_job_status
          AND candidate.locked_at < ${nowIso}::timestamptz - (${STALE_LOCK_SECONDS} || ' seconds')::interval
        )
      ORDER BY candidate.run_after ASC, candidate.created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING
      job.id,
      job.user_id AS "userId",
      job.type,
      job.payload,
      job.status,
      job.attempts,
      job.max_attempts AS "maxAttempts",
      job.run_after AS "runAfter",
      job.locked_at AS "lockedAt",
      job.last_error AS "lastError",
      job.idempotency_key AS "idempotencyKey",
      job.created_at AS "createdAt",
      job.updated_at AS "updatedAt"
  `);

  const result = rows as unknown as BackgroundJob[];
  return result[0] ?? null;
}

async function markJobSucceeded(jobId: string): Promise<void> {
  const now = new Date();
  await getDb()
    .update(backgroundJobs)
    .set({
      status: "succeeded",
      lockedAt: null,
      lastError: null,
      updatedAt: now,
    })
    .where(eq(backgroundJobs.id, jobId));
}

async function markJobFailedOrPending(
  job: BackgroundJob,
  err: unknown,
  exhausted: boolean,
  now: Date,
): Promise<void> {
  const status: BackgroundJobStatus = exhausted ? "failed" : "pending";
  await getDb()
    .update(backgroundJobs)
    .set({
      status,
      lockedAt: exhausted ? coerceNullableDate(job.lockedAt) : null,
      runAfter: exhausted ? coerceDate(job.runAfter) : calculateBackoffRunAfter(job.attempts, now),
      lastError: sanitizeError(err),
      updatedAt: now,
    })
    .where(eq(backgroundJobs.id, job.id));
}

function coerceDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function coerceNullableDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  return coerceDate(value);
}

function calculateBackoffRunAfter(attempts: number, now: Date): Date {
  const delaySeconds = Math.min(15 * 60, 30 * 2 ** Math.max(0, attempts - 1));
  return new Date(now.getTime() + delaySeconds * 1_000);
}

function sanitizeError(err: unknown): string {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return raw
    .replace(/(api[_-]?key|token|secret|password)=([^\s&]+)/gi, "$1=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .slice(0, MAX_ERROR_LENGTH);
}
