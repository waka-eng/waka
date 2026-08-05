/**
 * Neutral scheduler/worker for durable background classification work.
 *
 * The public name remains `enqueueClassification` for the existing route call
 * site, but this module no longer talks to a broker. It writes a Postgres
 * `background_jobs` row and schedules an in-process drain tick. If the process
 * exits before the tick runs, the pending DB row is still inspectable and can
 * be drained manually or by future cron via `drainBackgroundJobs`.
 */

import { createHash, randomUUID } from "node:crypto";

import { and, asc, desc, eq, sql } from "drizzle-orm";

import {
  type BackgroundJob,
  backgroundJobs,
  type BackgroundJobStatus,
  groupMembers,
  groupTopOfMindNotes,
  type GroupReadingRefreshPayload,
  groupDirectionContributions,
  type MeaningGraphRebuildPayload,
  type ProcessInspirationPayload,
  signals,
  users,
} from "../db/index.js";
import { runClassificationJob } from "../queue/classifier.js";
import { getDb } from "./db.js";
import { refreshGroupCombinationReading } from "./group-combination-reading.js";
import {
  loadGroupWithMembers,
  refreshGroupTopOfMind,
} from "./group-top-of-mind.js";
import {
  normalizeSupportedLocale,
  type SupportedLocale,
} from "./locales.js";
import {
  createInitialMeaningGraphRebuildPayload,
  rebuildMeaningGraphForUser,
} from "./meaning-graph-rebuild.js";
import { refreshTopOfMindNotesFromContextGraph } from "./top-of-mind-refresh.js";

const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_ERROR_LENGTH = 1_000;
const STALE_LOCK_SECONDS = 15 * 60;
const GROUP_READING_PIPELINE_VERSION = "group-reading-v3";
const GROUP_READING_MAX_TRIGGERS = 6;

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

export interface EnqueueClassificationResult {
  jobId: string;
}

export interface EnqueueMeaningGraphRebuildResult {
  jobId: string;
  job: BackgroundJobSummary;
}

export type GroupReadingGenerationPhase =
  | "processing"
  | "ready"
  | "needs_people"
  | "needs_more_context"
  | "failed";

export interface GroupReadingGenerationStatus {
  phase: GroupReadingGenerationPhase;
  message: string;
  memberCount: number;
  sharedSignalCount: number;
  noteCount: number;
  job: {
    id: string;
    type: "group_reading_refresh";
    status: BackgroundJobStatus;
    lastError: string | null;
    updatedAt: string;
  } | null;
}

export type GroupReadingRefreshReason = GroupReadingRefreshPayload["reason"];

interface GroupReadingMaterialSnapshot {
  memberUserIds: string[];
  sharedSignalCount: number;
  materialFingerprint: string;
  preferredLocale: SupportedLocale;
}

interface EnqueueGroupReadingRefreshResult {
  snapshot: GroupReadingMaterialSnapshot;
  job: BackgroundJobSummary | null;
}

export interface EnqueueClassificationOptions {
  /**
   * Optional idempotency scope for re-processing the same inspiration after a
   * meaningful user event (for example, a reflection). The default keeps the
   * original create-path behaviour: only one create classification job exists
   * per inspiration.
   */
  idempotencyScope?: string;
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

export interface GroupReadingRefreshJobDependencies {
  db?: ReturnType<typeof getDb>;
  loadGroup?: typeof loadGroupWithMembers;
  refreshNotes?: typeof refreshGroupTopOfMind;
  refreshCombination?: typeof refreshGroupCombinationReading;
}

export async function enqueueClassification(
  inspirationId: string,
  userId: string,
  options: EnqueueClassificationOptions = {},
): Promise<EnqueueClassificationResult> {
  const db = getDb();
  const idempotencyKey = options.idempotencyScope
    ? `process_inspiration:${inspirationId}:${options.idempotencyScope}`
    : `process_inspiration:${inspirationId}`;
  const rows = await db.execute(sql<{ id: string }>`
    INSERT INTO background_jobs (user_id, type, payload, max_attempts, idempotency_key)
    VALUES (
      ${userId}::uuid,
      'process_inspiration'::background_job_type,
      ${JSON.stringify({ inspirationId })}::jsonb,
      ${DEFAULT_MAX_ATTEMPTS},
      ${idempotencyKey}
    )
    ON CONFLICT (idempotency_key)
    WHERE idempotency_key IS NOT NULL
    DO UPDATE SET updated_at = now()
    RETURNING id
  `);
  const [job] = rows as unknown as Array<{ id: string }>;

  if (shouldAutoDrainBackgroundJobs()) {
    scheduleBackgroundJobDrain();
  }
  return { jobId: job!.id };
}

export async function enqueueMeaningGraphRebuild(
  userId: string,
): Promise<EnqueueMeaningGraphRebuildResult> {
  const payload = createInitialMeaningGraphRebuildPayload(userId);
  const [job] = await upsertMeaningGraphRebuildJob(userId, payload);
  if (!job) {
    throw new Error("Failed to enqueue meaning graph rebuild job");
  }

  if (shouldAutoDrainBackgroundJobs()) {
    scheduleBackgroundJobDrain();
  }

  return { jobId: job.id, job: summarizeBackgroundJob(job) };
}

/**
 * Request one complete room read (shared notes, then ambition) for the exact
 * material currently in the room.
 *
 * The fingerprint is the idempotency boundary: repeated page opens and
 * multiple members capturing against the same room all converge on one durable
 * job. A manual reread gets a unique suffix so it remains an actual retry even
 * after a failed job for unchanged material.
 */
export async function enqueueGroupReadingRefresh(input: {
  groupId: string;
  requestedByUserId: string;
  preferredLocale?: SupportedLocale;
  reason?: GroupReadingRefreshReason;
  force?: boolean;
}): Promise<EnqueueGroupReadingRefreshResult | null> {
  const db = getDb();
  const preferredLocale = normalizeSupportedLocale(input.preferredLocale);
  const snapshot = await loadGroupReadingMaterial(db, {
    groupId: input.groupId,
    requestedByUserId: input.requestedByUserId,
    preferredLocale,
  });
  if (!snapshot) return null;

  // There is no cross-person claim to look for yet. Avoid a doomed model pass,
  // but still return the snapshot so the status endpoint can explain why.
  if (snapshot.memberUserIds.length < 2 || snapshot.sharedSignalCount === 0) {
    return { snapshot, job: null };
  }

  const reason = input.reason ?? "bootstrap";
  const payload: GroupReadingRefreshPayload = {
    groupId: input.groupId,
    requestedByUserId: input.requestedByUserId,
    preferredLocale,
    materialFingerprint: snapshot.materialFingerprint,
    reason,
  };
  const stableKey = [
    "group_reading_refresh",
    input.groupId,
    preferredLocale,
    snapshot.materialFingerprint,
  ].join(":");
  const idempotencyKey = input.force ? `${stableKey}:${randomUUID()}` : stableKey;
  const rows = await db.execute(sql<BackgroundJob>`
    WITH inserted AS (
      INSERT INTO background_jobs (user_id, type, payload, max_attempts, idempotency_key)
      VALUES (
        ${input.requestedByUserId}::uuid,
        'group_reading_refresh'::background_job_type,
        ${JSON.stringify(payload)}::jsonb,
        ${DEFAULT_MAX_ATTEMPTS},
        ${idempotencyKey}
      )
      ON CONFLICT (idempotency_key)
      WHERE idempotency_key IS NOT NULL
      DO NOTHING
      RETURNING *
    )
    SELECT
      inserted.id,
      inserted.user_id AS "userId",
      inserted.type,
      inserted.payload,
      inserted.status,
      inserted.attempts,
      inserted.max_attempts AS "maxAttempts",
      inserted.run_after AS "runAfter",
      inserted.locked_at AS "lockedAt",
      inserted.last_error AS "lastError",
      inserted.idempotency_key AS "idempotencyKey",
      inserted.created_at AS "createdAt",
      inserted.updated_at AS "updatedAt"
    FROM inserted
    UNION ALL
    SELECT
      existing.id,
      existing.user_id AS "userId",
      existing.type,
      existing.payload,
      existing.status,
      existing.attempts,
      existing.max_attempts AS "maxAttempts",
      existing.run_after AS "runAfter",
      existing.locked_at AS "lockedAt",
      existing.last_error AS "lastError",
      existing.idempotency_key AS "idempotencyKey",
      existing.created_at AS "createdAt",
      existing.updated_at AS "updatedAt"
    FROM background_jobs AS existing
    WHERE existing.idempotency_key = ${idempotencyKey}
      AND NOT EXISTS (SELECT 1 FROM inserted)
    LIMIT 1
  `);
  const [job] = rows as unknown as BackgroundJob[];
  if (!job) throw new Error("Failed to enqueue room reading refresh job");

  if (shouldAutoDrainBackgroundJobs()) scheduleBackgroundJobDrain();
  return { snapshot, job: summarizeBackgroundJob(job) };
}

/** Enqueue every room affected after one member's signal has finished processing. */
export async function enqueueGroupReadingRefreshesForUser(
  userId: string,
): Promise<void> {
  const db = getDb();
  const [membershipRows, userRows] = await Promise.all([
    db
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(eq(groupMembers.userId, userId)),
    db
      .select({ preferredLocale: users.preferredLocale })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),
  ]);
  const preferredLocale = normalizeSupportedLocale(userRows[0]?.preferredLocale);
  await Promise.all(
    membershipRows.map((membership) =>
      enqueueGroupReadingRefresh({
        groupId: membership.groupId,
        requestedByUserId: userId,
        preferredLocale,
        reason: "material_changed",
      }),
    ),
  );
}

/**
 * Membership changes can be requested by someone who is no longer in the room
 * (leave). Pick a remaining member as the durable job owner.
 */
export async function enqueueGroupReadingRefreshForGroup(
  groupId: string,
  reason: GroupReadingRefreshReason = "membership_changed",
): Promise<void> {
  const [member] = await getDb()
    .select({ userId: groupMembers.userId, preferredLocale: users.preferredLocale })
    .from(groupMembers)
    .innerJoin(users, eq(groupMembers.userId, users.id))
    .where(eq(groupMembers.groupId, groupId))
    .orderBy(asc(groupMembers.createdAt))
    .limit(1);
  if (!member) return;
  await enqueueGroupReadingRefresh({
    groupId,
    requestedByUserId: member.userId,
    preferredLocale: normalizeSupportedLocale(member.preferredLocale),
    reason,
  });
}

/** Stored state plus the durable pass currently responsible for advancing it. */
export async function getGroupReadingGenerationStatus(input: {
  groupId: string;
  requestedByUserId: string;
  preferredLocale?: SupportedLocale;
  force?: boolean;
  /** False for progress polling: authorize/count without re-hashing all material. */
  ensure?: boolean;
}): Promise<GroupReadingGenerationStatus | null> {
  const preferredLocale = normalizeSupportedLocale(input.preferredLocale);
  const ensured =
    input.ensure === false
      ? null
      : await enqueueGroupReadingRefresh({
          ...input,
          preferredLocale,
          reason: input.force ? "manual" : "bootstrap",
        });
  const snapshot =
    ensured?.snapshot ??
    (input.ensure === false
      ? await loadGroupReadingStatusSnapshot(getDb(), {
          groupId: input.groupId,
          requestedByUserId: input.requestedByUserId,
          preferredLocale,
        })
      : null);
  if (!snapshot) return null;

  const db = getDb();
  const [latestRows, noteRows] = await Promise.all([
    db
      .select()
      .from(backgroundJobs)
      .where(
        and(
          eq(backgroundJobs.type, "group_reading_refresh"),
          sql`${backgroundJobs.payload} ->> 'groupId' = ${input.groupId}`,
        ),
      )
      .orderBy(desc(backgroundJobs.createdAt))
      .limit(1),
    db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(groupTopOfMindNotes)
      .where(
        and(
          eq(groupTopOfMindNotes.groupId, input.groupId),
          eq(groupTopOfMindNotes.lifecycleStatus, "active"),
        ),
      ),
  ]);
  const latest = latestRows[0] ?? null;
  const noteCount = Number(noteRows[0]?.count ?? 0);
  return groupReadingStatusFrom({
    snapshot,
    latest,
    noteCount,
  });
}

export async function getLatestMeaningGraphRebuildJob(
  userId: string,
): Promise<BackgroundJobSummary | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(backgroundJobs)
    .where(and(eq(backgroundJobs.userId, userId), eq(backgroundJobs.type, "meaning_graph_rebuild")))
    .orderBy(desc(backgroundJobs.createdAt))
    .limit(1);
  const job = rows[0];
  return job ? summarizeBackgroundJob(job) : null;
}

export async function getMeaningGraphRebuildJob(
  userId: string,
  jobId: string,
): Promise<BackgroundJobSummary | null> {
  const rows = await getDb()
    .select()
    .from(backgroundJobs)
    .where(
      and(
        eq(backgroundJobs.userId, userId),
        eq(backgroundJobs.id, jobId),
        eq(backgroundJobs.type, "meaning_graph_rebuild"),
      ),
    )
    .limit(1);
  const job = rows[0];
  return job ? summarizeBackgroundJob(job) : null;
}

async function upsertMeaningGraphRebuildJob(
  userId: string,
  payload: MeaningGraphRebuildPayload,
): Promise<BackgroundJob[]> {
  const payloadJson = JSON.stringify(payload);
  const rows = await getDb().execute(sql<BackgroundJob>`
    INSERT INTO background_jobs (user_id, type, payload, max_attempts, idempotency_key)
    VALUES (
      ${userId}::uuid,
      'meaning_graph_rebuild'::background_job_type,
      ${payloadJson}::jsonb,
      ${DEFAULT_MAX_ATTEMPTS},
      NULL
    )
    ON CONFLICT (user_id, type)
    WHERE "public"."background_job_type_label"(type) = 'meaning_graph_rebuild'
      AND status IN ('pending'::background_job_status, 'running'::background_job_status)
    DO UPDATE SET
      max_attempts = GREATEST(background_jobs.max_attempts, ${DEFAULT_MAX_ATTEMPTS}),
      updated_at = now()
    RETURNING
      id,
      user_id AS "userId",
      type,
      payload,
      status,
      attempts,
      max_attempts AS "maxAttempts",
      run_after AS "runAfter",
      locked_at AS "lockedAt",
      last_error AS "lastError",
      idempotency_key AS "idempotencyKey",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
  `);
  return rows as unknown as BackgroundJob[];
}

function summarizeBackgroundJob(job: BackgroundJob): BackgroundJobSummary {
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

async function loadGroupReadingMaterial(
  db: ReturnType<typeof getDb>,
  input: {
    groupId: string;
    requestedByUserId: string;
    preferredLocale: SupportedLocale;
  },
): Promise<GroupReadingMaterialSnapshot | null> {
  const memberRows = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, input.groupId))
    .orderBy(asc(groupMembers.userId));
  if (!memberRows.some((member) => member.userId === input.requestedByUserId)) {
    return null;
  }

  const [sharedRows, contributionRows] = await Promise.all([
    db
      .select({
        id: signals.id,
        userId: signals.userId,
        text: signals.text,
        enrichment: signals.enrichment,
        kind: signals.kind,
        captureElapsedMs: signals.captureElapsedMs,
      })
      .from(signals)
      .innerJoin(
        groupMembers,
        and(
          eq(groupMembers.userId, signals.userId),
          eq(groupMembers.groupId, input.groupId),
        ),
      )
      .where(eq(signals.sharedToGroups, true))
      .orderBy(asc(signals.userId), asc(signals.id)),
    db
      .select({
        id: groupDirectionContributions.id,
        readingId: groupDirectionContributions.readingId,
        userId: groupDirectionContributions.userId,
        kind: groupDirectionContributions.kind,
        body: groupDirectionContributions.body,
        updatedAt: groupDirectionContributions.updatedAt,
      })
      .from(groupDirectionContributions)
      .where(eq(groupDirectionContributions.groupId, input.groupId))
      .orderBy(asc(groupDirectionContributions.createdAt), asc(groupDirectionContributions.id)),
  ]);

  const memberUserIds = memberRows.map((member) => member.userId);
  const materialFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        version: GROUP_READING_PIPELINE_VERSION,
        preferredLocale: input.preferredLocale,
        memberUserIds,
        signals: sharedRows.map((signal) => ({
          id: signal.id,
          userId: signal.userId,
          text: signal.text,
          enrichment: signal.enrichment,
          kind: signal.kind,
          captureElapsedMs: signal.captureElapsedMs,
        })),
        contributions: contributionRows,
      }),
    )
    .digest("hex");

  return {
    memberUserIds,
    sharedSignalCount: sharedRows.length,
    materialFingerprint,
    preferredLocale: input.preferredLocale,
  };
}

/**
 * Polling only needs authorization and counts. Do not pull every signal's text
 * back across the network and hash it again every two seconds while a model is
 * already working on the durable job created by the first request.
 */
async function loadGroupReadingStatusSnapshot(
  db: ReturnType<typeof getDb>,
  input: {
    groupId: string;
    requestedByUserId: string;
    preferredLocale: SupportedLocale;
  },
): Promise<GroupReadingMaterialSnapshot | null> {
  const [row] = await db
    .select({
      memberUserIds: sql<string[]>`
        coalesce(
          array_agg(distinct ${groupMembers.userId})
            filter (where ${groupMembers.userId} is not null),
          array[]::uuid[]
        )
      `,
      sharedSignalCount: sql<number>`cast(count(${signals.id}) as int)`,
    })
    .from(groupMembers)
    .leftJoin(
      signals,
      and(
        eq(signals.userId, groupMembers.userId),
        eq(signals.sharedToGroups, true),
      ),
    )
    .where(eq(groupMembers.groupId, input.groupId));
  const memberUserIds = row?.memberUserIds ?? [];
  if (!memberUserIds.includes(input.requestedByUserId)) return null;
  return {
    memberUserIds,
    sharedSignalCount: Number(row?.sharedSignalCount ?? 0),
    materialFingerprint: "",
    preferredLocale: input.preferredLocale,
  };
}

function groupReadingStatusFrom(input: {
  snapshot: GroupReadingMaterialSnapshot;
  latest: BackgroundJob | null;
  noteCount: number;
}): GroupReadingGenerationStatus {
  const { snapshot, latest, noteCount } = input;
  const job = latest
    ? {
        id: latest.id,
        type: "group_reading_refresh" as const,
        status: latest.status,
        lastError: latest.lastError,
        updatedAt:
          latest.updatedAt instanceof Date
            ? latest.updatedAt.toISOString()
            : String(latest.updatedAt),
      }
    : null;
  const base = {
    memberCount: snapshot.memberUserIds.length,
    sharedSignalCount: snapshot.sharedSignalCount,
    noteCount,
    job,
  };

  if (snapshot.memberUserIds.length < 2) {
    return {
      ...base,
      phase: "needs_people",
      message: "Invite someone. A room needs two people before it can form a shared top of mind.",
    };
  }
  if (snapshot.sharedSignalCount === 0) {
    return {
      ...base,
      phase: "needs_more_context",
      message: "No shared inspiration material has reached this room yet.",
    };
  }
  if (latest?.status === "pending" || latest?.status === "running") {
    return {
      ...base,
      phase: "processing",
      message: "Reading the room's new shared material. The saved wall stays available while it works.",
    };
  }
  if (latest?.status === "failed") {
    return {
      ...base,
      phase: "failed",
      message:
        noteCount > 0
          ? "The current room reading is still here, but the latest reread did not finish. Try again."
          : "The room's latest reading did not finish. Try reading it again.",
    };
  }
  if (noteCount > 0) {
    return {
      ...base,
      phase: "ready",
      message: "This room is up to date with its shared material.",
    };
  }
  return {
    ...base,
    phase: "needs_more_context",
    message:
      "The room read what is shared, but no cross-person pattern holds strongly enough yet.",
  };
}

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
      console.error("[background-jobs] drain tick failed", {
        error: sanitizeError(err),
      });
    });
  }, normalizedDelay);
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

/**
 * Derive the next local wake-up from Postgres instead of from the batch that
 * happened to run. That preserves both cases at once: a ready eleventh job is
 * drained immediately, while a failed job remains scheduled for its backoff
 * even when the current batch was full.
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

export async function runBackgroundJobWorker(
  options: DrainBackgroundJobsOptions = {},
): Promise<DrainBackgroundJobsResult> {
  return drainBackgroundJobs(options);
}

/** Execute both stages of one room pass; exported so the ordering is testable. */
export async function runGroupReadingRefreshJob(
  payload: GroupReadingRefreshPayload,
  deps: GroupReadingRefreshJobDependencies = {},
): Promise<void> {
  const db = deps.db ?? getDb();
  const loadGroup = deps.loadGroup ?? loadGroupWithMembers;
  const refreshNotes = deps.refreshNotes ?? refreshGroupTopOfMind;
  const refreshCombination =
    deps.refreshCombination ?? refreshGroupCombinationReading;
  const loaded = await loadGroup(db, {
    userId: payload.requestedByUserId,
    groupId: payload.groupId,
  });
  // The room may have been deleted or the requesting member may have left
  // while this durable job waited. That is obsolete work, not a retryable
  // failure.
  if (!loaded || loaded.members.length < 2) return;

  let noteError: unknown = null;
  try {
    await refreshNotes(db, {
      userId: payload.requestedByUserId,
      groupId: payload.groupId,
      limit: 5,
      preferredLocale: normalizeSupportedLocale(payload.preferredLocale),
      maxTriggers: GROUP_READING_MAX_TRIGGERS,
    });
  } catch (err) {
    noteError = err;
  }

  let combinationError: unknown = null;
  try {
    // Always run this stage. In particular, a note refresh legitimately
    // declined by cooldown must not suppress the ambition reading — that was
    // the wiring bug that left "What this room is after" blank.
    await refreshCombination(db, {
      userId: payload.requestedByUserId,
      groupId: payload.groupId,
      preferredLocale: normalizeSupportedLocale(payload.preferredLocale),
    });
  } catch (err) {
    combinationError = err;
  }

  if (noteError) throw noteError;
  if (combinationError) throw combinationError;
}

async function processBackgroundJob(job: BackgroundJob): Promise<void> {
  if (job.type === "process_inspiration") {
    const payload = parseProcessInspirationPayload(job.payload);
    if (!payload) {
      // Permanent poison payload: do not throw/retry. Mark as succeeded so the
      // queue does not loop forever; the sanitized warning stays in logs.
      console.warn("[background-jobs] dropping malformed process_inspiration job", {
        jobId: job.id,
      });
      return;
    }

    await runClassificationJob(payload.inspirationId, { userId: job.userId, backgroundJobId: job.id });
    // Classification/embedding is now durable. Only then schedule room work so
    // a room job cannot race the signal job and conclude the new save has no
    // usable vector yet.
    await enqueueGroupReadingRefreshesForUser(job.userId);
    return;
  }

  if (job.type === "meaning_graph_rebuild") {
    await rebuildMeaningGraphForUser({
      userId: job.userId,
      initialPayload: job.payload,
      onProgress: (progress) => updateMeaningGraphRebuildProgress(job.id, progress),
    });
    const refresh = await refreshTopOfMindNotesFromContextGraph(getDb(), {
      userId: job.userId,
      synthesisTrigger: "weekly_refresh",
    });
    if (refresh.synthesis.failed > 0 && refresh.synthesis.synthesized === 0) {
      throw new Error("Top-of-mind synthesis did not complete");
    }
    return;
  }

  if (job.type === "group_reading_refresh") {
    const payload = parseGroupReadingRefreshPayload(job.payload);
    if (!payload) {
      console.warn("[background-jobs] dropping malformed group_reading_refresh job", {
        jobId: job.id,
      });
      return;
    }

    await runGroupReadingRefreshJob(payload);
    return;
  }

  throw new Error(`Unsupported background job type: ${job.type}`);
}

async function updateMeaningGraphRebuildProgress(
  jobId: string,
  payload: MeaningGraphRebuildPayload,
): Promise<void> {
  await getDb().execute(sql`
    UPDATE background_jobs
    SET payload = ${JSON.stringify(payload)}::jsonb,
        updated_at = now()
    WHERE id = ${jobId}::uuid
  `);
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

function parseGroupReadingRefreshPayload(
  payload: unknown,
): GroupReadingRefreshPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Partial<GroupReadingRefreshPayload>;
  if (
    typeof value.groupId !== "string" ||
    typeof value.requestedByUserId !== "string" ||
    typeof value.preferredLocale !== "string" ||
    typeof value.materialFingerprint !== "string" ||
    typeof value.reason !== "string"
  ) {
    return null;
  }
  if (
    !["bootstrap", "material_changed", "membership_changed", "manual"].includes(
      value.reason,
    )
  ) {
    return null;
  }
  return value as GroupReadingRefreshPayload;
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
  const lockedAt = exhausted ? coerceNullableDate(job.lockedAt)?.toISOString() ?? null : null;
  const runAfter = (exhausted ? coerceDate(job.runAfter) : calculateBackoffRunAfter(job.attempts, now)).toISOString();
  const updatedAt = now.toISOString();
  await getDb().execute(sql`
    UPDATE background_jobs
    SET status = ${status}::background_job_status,
        locked_at = ${lockedAt}::timestamptz,
        run_after = ${runAfter}::timestamptz,
        last_error = ${sanitizeError(err)},
        updated_at = ${updatedAt}::timestamptz
    WHERE id = ${job.id}::uuid
  `);
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
