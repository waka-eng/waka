/**
 * Postgres is the queue.
 *
 * There is no broker. Work is a row in `background_jobs`, claimed with an
 * atomic `UPDATE … FOR UPDATE SKIP LOCKED`, retried with exponential backoff,
 * and swept by two things: an in-process timer for the single-process case
 * (local dev, the monolith) and a cron-driven Lambda for the deployed case.
 *
 * Keeping the queue in the same transaction-capable store as the data is what
 * makes it correct: a job can never reference a row that was rolled back, and
 * an enqueue that participates in the caller's transaction is atomic with the
 * write that motivated it.
 *
 * Three mechanics carry the weight, and all three are worth keeping in mind
 * when changing anything here:
 *
 *   - **Idempotency keys.** A unique partial index on `idempotency_key`
 *     collapses duplicate enqueues of the same work into one row, so a route
 *     that fires on every save does not need to know whether it already did.
 *   - **Stale-lock reclaim.** A worker that dies mid-job leaves a `running`
 *     row locked. Anything locked longer than `STALE_LOCK_SECONDS` is
 *     claimable again — without it, one crashed Lambda strands the job.
 *   - **Backoff to a terminal state.** Attempts are counted at claim time;
 *     once they exceed `maxAttempts` the row becomes `failed` and stays put,
 *     with its sanitized error, rather than looping forever.
 *
 * The four job types are the pipeline:
 *   enrich_attachment          → read what was saved (page body, image text)
 *   derive_signals             → extract → embed → match-or-mint (layer 2)
 *   refresh_top_of_mind        → re-synthesize a profile's artifact (layer 3)
 *   refresh_group_top_of_mind  → the same for a group's shared signals
 */

import { asc, eq, sql } from "drizzle-orm";

import {
  type BackgroundJob,
  backgroundJobs,
  type BackgroundJobStatus,
  type DeriveSignalsPayload,
  type EnrichAttachmentPayload,
  type RefreshGroupTopOfMindPayload,
  type RefreshTopOfMindPayload,
} from "../db/index.js";
import { getDb } from "./db.js";
import { enrichAttachment } from "./signal-enrichment.js";
import {
  describeSignalDerivation,
  deriveSignalsForInspiration,
} from "./signal-derivation.js";
import {
  refreshTopOfMindForGroup,
  refreshTopOfMindForProfile,
} from "./top-of-mind-synthesis.js";

const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_ERROR_LENGTH = 1_000;
const STALE_LOCK_SECONDS = 15 * 60;

let drainScheduled = false;
let drainTimer: ReturnType<typeof setTimeout> | null = null;
let drainDueAt = 0;

export interface BackgroundJobSummary {
  id: string;
  type: BackgroundJob["type"];
  status: BackgroundJobStatus;
  payload: BackgroundJob["payload"];
  attempts: number;
  maxAttempts: number;
  runAfter: Date | string;
  lockedAt: Date | string | null;
  lastError: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface EnqueueResult {
  jobId: string;
  /**
   * False when an equivalent job was already waiting and this request joined
   * it. Callers surface it so a second "refresh" click can say the pass is
   * already coming rather than implying it started a new one.
   */
  created: boolean;
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

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------

/**
 * An idempotency key coalesces work that is *still in flight*. It does not
 * mean "this was done once, never again": a capture edited twice needs
 * distilling twice, and a job row that already succeeded is a record of the
 * previous edit, not a reason to skip the current one.
 *
 * Hence the split below. While the existing row is `pending` or `running`,
 * a second enqueue is the same work arriving twice and is absorbed — that is
 * the debounce a burst of saves depends on. Once the row is terminal
 * (`succeeded` or `failed`) the same key means new work, so the row is reset
 * to pending with the fresh payload, a cleared error, and a zeroed attempt
 * count, which is what makes it a retry rather than a resurrection carrying
 * the old failure's budget.
 */
const TERMINAL_JOB_STATUS = sql`background_jobs.status IN ('succeeded'::background_job_status, 'failed'::background_job_status)`;

/**
 * One enqueue path for every keyed job type, so the ON CONFLICT clause and
 * the drain scheduling cannot drift between call sites.
 */
async function enqueueKeyedJob(input: {
  profileId: string;
  type: "enrich_attachment" | "derive_signals" | "refresh_group_top_of_mind";
  payload: EnrichAttachmentPayload | DeriveSignalsPayload | RefreshGroupTopOfMindPayload;
  idempotencyKey: string;
}): Promise<EnqueueResult> {
  const rows = await getDb().execute(sql<{ id: string }>`
    INSERT INTO background_jobs (profile_id, type, payload, max_attempts, idempotency_key)
    VALUES (
      ${input.profileId}::uuid,
      ${input.type}::background_job_type,
      ${JSON.stringify(input.payload)}::jsonb,
      ${DEFAULT_MAX_ATTEMPTS},
      ${input.idempotencyKey}
    )
    ON CONFLICT (idempotency_key)
    WHERE idempotency_key IS NOT NULL
    DO UPDATE SET
      status = CASE
        WHEN ${TERMINAL_JOB_STATUS} THEN 'pending'::background_job_status
        ELSE background_jobs.status
      END,
      payload = CASE
        WHEN ${TERMINAL_JOB_STATUS} THEN EXCLUDED.payload
        ELSE background_jobs.payload
      END,
      attempts = CASE WHEN ${TERMINAL_JOB_STATUS} THEN 0 ELSE background_jobs.attempts END,
      run_after = CASE WHEN ${TERMINAL_JOB_STATUS} THEN now() ELSE background_jobs.run_after END,
      locked_at = CASE WHEN ${TERMINAL_JOB_STATUS} THEN NULL ELSE background_jobs.locked_at END,
      last_error = CASE WHEN ${TERMINAL_JOB_STATUS} THEN NULL ELSE background_jobs.last_error END,
      max_attempts = GREATEST(background_jobs.max_attempts, EXCLUDED.max_attempts),
      updated_at = now()
    RETURNING id, (xmax = 0) AS created
  `);
  const [job] = rows as unknown as Array<{ id: string; created: boolean }>;
  if (!job) throw new Error(`Failed to enqueue ${input.type} job`);

  if (shouldAutoDrainBackgroundJobs()) scheduleBackgroundJobDrain();
  return { jobId: job.id, created: job.created };
}

/**
 * Read a link's page body or describe an image, so extraction can see what
 * the person saved and not only what they typed.
 *
 * Keyed on the attachment: an attachment is enriched once, and a second
 * enqueue for the same one is the same work.
 */
export async function enqueueEnrichAttachment(
  profileId: string,
  attachmentId: string,
  inspirationId: string,
): Promise<EnqueueResult> {
  return enqueueKeyedJob({
    profileId,
    type: "enrich_attachment",
    payload: { attachmentId, inspirationId },
    idempotencyKey: `enrich_attachment:${attachmentId}`,
  });
}

/**
 * Distill one capture into signals.
 *
 * The reason is part of the key: a re-derivation after an edit is genuinely
 * different work from the original pass, and collapsing the two would mean an
 * edited capture never gets re-read. Editing the same capture again re-arms
 * the row rather than colliding with it — see the conflict clause above; the
 * cascade rule in the data model requires every edit to re-derive.
 */
export async function enqueueDeriveSignals(
  profileId: string,
  inspirationId: string,
  reason: DeriveSignalsPayload["reason"],
): Promise<EnqueueResult> {
  return enqueueKeyedJob({
    profileId,
    type: "derive_signals",
    payload: { inspirationId, reason },
    idempotencyKey: `derive_signals:${inspirationId}:${reason}`,
  });
}

/**
 * Re-synthesize a profile's top of mind.
 *
 * Debounced by the database rather than by a key: a partial unique index
 * permits one pending-or-running refresh per profile, so a burst of captures
 * collapses into a single synthesis instead of paying for one per capture.
 * The conflict target below mirrors that index predicate exactly.
 */
export async function enqueueTopOfMindRefresh(
  profileId: string,
  reason: RefreshTopOfMindPayload["reason"],
): Promise<EnqueueResult> {
  const payload: RefreshTopOfMindPayload = { reason };
  const rows = await getDb().execute(sql<{ id: string }>`
    INSERT INTO background_jobs (profile_id, type, payload, max_attempts)
    VALUES (
      ${profileId}::uuid,
      'refresh_top_of_mind'::background_job_type,
      ${JSON.stringify(payload)}::jsonb,
      ${DEFAULT_MAX_ATTEMPTS}
    )
    ON CONFLICT (profile_id, type)
    WHERE type = 'refresh_top_of_mind'::background_job_type
      AND status IN ('pending'::background_job_status, 'running'::background_job_status)
    DO UPDATE SET updated_at = now()
    RETURNING id, (xmax = 0) AS created
  `);
  const [job] = rows as unknown as Array<{ id: string; created: boolean }>;
  if (!job) throw new Error("Failed to enqueue refresh_top_of_mind job");

  if (shouldAutoDrainBackgroundJobs()) scheduleBackgroundJobDrain();
  return { jobId: job.id, created: job.created };
}

/**
 * Re-synthesize a group's top of mind from the signals its members share.
 *
 * Keyed on the group rather than on the group and the reason: whatever moved
 * — a new share, a member joining, an accepted proposal — the work is the
 * same single pass over that group's current shared set, and a live job for
 * it already covers a second request.
 *
 * The owning profile is the member whose action prompted the pass. It is the
 * job's tenant for audit and cleanup; the synthesis itself reads the group.
 */
export async function enqueueGroupTopOfMindRefresh(
  profileId: string,
  groupId: string,
  reason: RefreshGroupTopOfMindPayload["reason"],
): Promise<EnqueueResult> {
  return enqueueKeyedJob({
    profileId,
    type: "refresh_group_top_of_mind",
    payload: { groupId, reason },
    idempotencyKey: `refresh_group_top_of_mind:${groupId}`,
  });
}

// ---------------------------------------------------------------------------
// Drain scheduling
// ---------------------------------------------------------------------------

/**
 * The in-process drain is for processes that stay alive. Under vitest it
 * would leave timers running past the test that created them, and on Lambda
 * the container is frozen the moment the response is returned, so the timer
 * fires late or never — cron owns draining there.
 */
function shouldAutoDrainBackgroundJobs(): boolean {
  if (process.env.WAKA_BACKGROUND_JOB_AUTODRAIN === "1") return true;
  if (process.env.WAKA_BACKGROUND_JOB_AUTODRAIN === "0") return false;
  return process.env.NODE_ENV !== "test" && !process.env.AWS_LAMBDA_FUNCTION_NAME;
}

export function scheduleBackgroundJobDrain(delayMs = 0): void {
  const normalizedDelay = Math.max(0, Math.trunc(delayMs));
  const dueAt = Date.now() + normalizedDelay;
  if (drainScheduled && drainDueAt <= dueAt) return;
  if (drainTimer) clearTimeout(drainTimer);
  drainScheduled = true;
  drainDueAt = dueAt;
  drainTimer = setTimeout(() => {
    drainScheduled = false;
    drainTimer = null;
    drainDueAt = 0;
    drainBackgroundJobs().catch((err) => {
      console.error("[background-jobs] drain tick failed", { error: sanitizeError(err) });
    });
  }, normalizedDelay);
}

/**
 * Derive the next local wake-up from Postgres rather than from the batch that
 * happened to run. That preserves both cases at once: a ready eleventh job is
 * drained immediately, while a job that just failed stays scheduled for its
 * backoff even when the batch was full.
 */
async function scheduleNextPendingBackgroundJobDrain(): Promise<void> {
  const [next] = await getDb()
    .select({ runAfter: backgroundJobs.runAfter })
    .from(backgroundJobs)
    .where(eq(backgroundJobs.status, "pending"))
    .orderBy(asc(backgroundJobs.runAfter))
    .limit(1);
  if (!next) return;
  const runAfter = coerceDate(next.runAfter);
  scheduleBackgroundJobDrain(Math.max(0, runAfter.getTime() - Date.now() + 25));
}

// ---------------------------------------------------------------------------
// Drain
// ---------------------------------------------------------------------------

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
    if (!job) break;
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

  if (shouldAutoDrainBackgroundJobs()) {
    await scheduleNextPendingBackgroundJobDrain();
  }

  return result;
}

/** The cron entry point. Named separately so the Lambda reads as a worker. */
export async function runBackgroundJobWorker(
  options: DrainBackgroundJobsOptions = {},
): Promise<DrainBackgroundJobsResult> {
  return drainBackgroundJobs(options);
}

// ---------------------------------------------------------------------------
// The job router
// ---------------------------------------------------------------------------

export async function processBackgroundJob(job: BackgroundJob): Promise<void> {
  switch (job.type) {
    case "enrich_attachment": {
      const payload = parseEnrichAttachmentPayload(job.payload);
      if (!payload) return dropPoisonPayload(job);

      const enrichment = await enrichAttachment(payload.attachmentId);

      // `enrichAttachment` never throws, because a login wall or a page of
      // pure JavaScript is an ordinary outcome of saving things from the
      // internet. Exactly one of its verdicts is worth another attempt:
      // `failed` means the page was never reached. Throwing here is what
      // hands that case to the backoff already built into the drain — without
      // it, one timed-out fetch leaves the attachment unenriched forever and
      // the job row claims it succeeded.
      if (enrichment.status === "failed") {
        throw new Error(
          `Attachment enrichment failed for ${payload.attachmentId}: ${enrichment.reason}`,
        );
      }

      // `unavailable` and `missing` are settled answers — the page has nothing
      // to give, or the attachment is gone. Both are terminal, and both still
      // leave the capture worth distilling with whatever it does have.
      //
      // Enqueued rather than called inline: a slow page fetch and a model
      // extraction should not share one attempt budget.
      await enqueueDeriveSignals(job.profileId, payload.inspirationId, "edited");
      return;
    }

    case "derive_signals": {
      const payload = parseDeriveSignalsPayload(job.payload);
      if (!payload) return dropPoisonPayload(job);

      const result = await deriveSignalsForInspiration(payload);
      console.log("[background-jobs] derived signals", {
        jobId: job.id,
        inspirationId: payload.inspirationId,
        summary: describeSignalDerivation(result),
      });

      // The artifact only needs reconsidering when the signal set actually
      // moved. A capture that yielded nothing must not cost a synthesis.
      const changed =
        result.matchedSignalIds.length > 0 ||
        result.mintedSignalIds.length > 0 ||
        result.promotedSignalIds.length > 0;
      if (changed) {
        await enqueueTopOfMindRefresh(job.profileId, "signals_changed");
      }
      return;
    }

    case "refresh_top_of_mind": {
      const payload = parseRefreshTopOfMindPayload(job.payload);
      if (!payload) return dropPoisonPayload(job);

      const result = await refreshTopOfMindForProfile({
        profileId: job.profileId,
        reason: payload.reason,
      });
      console.log("[background-jobs] refreshed top of mind", {
        jobId: job.id,
        profileId: job.profileId,
        status: result.status,
        version: result.version,
        reason: result.reason,
        entryCount: result.entryCount,
      });
      return;
    }

    case "refresh_group_top_of_mind": {
      const payload = parseRefreshGroupTopOfMindPayload(job.payload);
      if (!payload) return dropPoisonPayload(job);

      await refreshTopOfMindForGroup({
        groupId: payload.groupId,
        reason: payload.reason,
      });
      return;
    }

    default: {
      // Exhaustive over the enum: adding a job type without a branch is a
      // compile error rather than a runtime surprise on a Friday.
      const unhandled: never = job.type;
      throw new Error(`Unsupported background job type: ${String(unhandled)}`);
    }
  }
}

/**
 * A payload that cannot be parsed will not parse on retry either. Marking the
 * job succeeded stops the loop; the sanitized warning is what makes the drop
 * visible.
 */
function dropPoisonPayload(job: BackgroundJob): void {
  console.warn("[background-jobs] dropping malformed job payload", {
    jobId: job.id,
    type: job.type,
  });
}

function readString(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>)[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseEnrichAttachmentPayload(payload: unknown): EnrichAttachmentPayload | null {
  const attachmentId = readString(payload, "attachmentId");
  const inspirationId = readString(payload, "inspirationId");
  if (!attachmentId || !inspirationId) return null;
  return { attachmentId, inspirationId };
}

function parseDeriveSignalsPayload(payload: unknown): DeriveSignalsPayload | null {
  const inspirationId = readString(payload, "inspirationId");
  const reason = readString(payload, "reason");
  if (!inspirationId) return null;
  if (reason !== "created" && reason !== "edited") return null;
  return { inspirationId, reason };
}

function parseRefreshTopOfMindPayload(payload: unknown): RefreshTopOfMindPayload | null {
  const reason = readString(payload, "reason");
  if (reason !== "signals_changed" && reason !== "manual") return null;
  return { reason };
}

function parseRefreshGroupTopOfMindPayload(
  payload: unknown,
): RefreshGroupTopOfMindPayload | null {
  const groupId = readString(payload, "groupId");
  const reason = readString(payload, "reason");
  if (!groupId) return null;
  if (
    reason !== "shares_changed" &&
    reason !== "membership_changed" &&
    reason !== "proposal_accepted" &&
    reason !== "manual"
  ) {
    return null;
  }
  return { groupId, reason };
}

// ---------------------------------------------------------------------------
// Claim / complete
// ---------------------------------------------------------------------------

/**
 * Claim one job atomically.
 *
 * `FOR UPDATE SKIP LOCKED` is what lets several workers drain the same table
 * without coordination: each takes a different row instead of blocking on the
 * same one. The second arm of the WHERE is the stale-lock reclaim — a
 * `running` row whose lock has aged past the ceiling belongs to a worker that
 * is not coming back.
 */
async function claimNextBackgroundJob(now = new Date()): Promise<BackgroundJob | null> {
  const nowIso = now.toISOString();
  const rows = await getDb().execute(sql<BackgroundJob>`
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
      job.profile_id AS "profileId",
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
  await getDb().execute(sql`
    UPDATE background_jobs
    SET status = 'succeeded'::background_job_status,
        locked_at = NULL,
        last_error = NULL,
        updated_at = now()
    WHERE id = ${jobId}::uuid
  `);
}

async function markJobFailedOrPending(
  job: BackgroundJob,
  err: unknown,
  exhausted: boolean,
  now: Date,
): Promise<void> {
  const status: BackgroundJobStatus = exhausted ? "failed" : "pending";
  const lockedAt = exhausted ? (coerceNullableDate(job.lockedAt)?.toISOString() ?? null) : null;
  const runAfter = (
    exhausted ? coerceDate(job.runAfter) : calculateBackoffRunAfter(job.attempts, now)
  ).toISOString();
  await getDb().execute(sql`
    UPDATE background_jobs
    SET status = ${status}::background_job_status,
        locked_at = ${lockedAt}::timestamptz,
        run_after = ${runAfter}::timestamptz,
        last_error = ${sanitizeError(err)},
        updated_at = ${now.toISOString()}::timestamptz
    WHERE id = ${job.id}::uuid
  `);
}

export function summarizeBackgroundJob(job: BackgroundJob): BackgroundJobSummary {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    payload: job.payload,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    runAfter: job.runAfter,
    lockedAt: job.lockedAt,
    lastError: job.lastError,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function coerceDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function coerceNullableDate(value: Date | string | null): Date | null {
  return value === null ? null : coerceDate(value);
}

/** 30s, 60s, 120s, … capped at 15 minutes. */
function calculateBackoffRunAfter(attempts: number, now: Date): Date {
  const delaySeconds = Math.min(15 * 60, 30 * 2 ** Math.max(0, attempts - 1));
  return new Date(now.getTime() + delaySeconds * 1_000);
}

/**
 * Errors are stored on the row and read by whoever is on call, so anything
 * that looks like a credential is stripped before it lands in a column that
 * outlives the incident.
 */
function sanitizeError(err: unknown): string {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return raw
    .replace(/(api[_-]?key|token|secret|password)=([^\s&]+)/gi, "$1=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .slice(0, MAX_ERROR_LENGTH);
}
