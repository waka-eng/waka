/**
 * Classifier background worker.
 *
 * The product path is DB-backed: `lib/queue.ts` writes durable
 * `background_jobs` rows and drains them in-process by calling
 * `runClassificationJob`. The small Lambda/SQS-shaped `handler` at the bottom
 * remains only as a compatibility/unit-test wrapper around the same core job
 * function; SST no longer provisions or links an external queue for this workflow.
 *
 * Scope of this file
 * ------------------
 * Closes the classification loop end-to-end:
 *   1. Receive an `{ inspirationId }` job from the DB-backed worker.
 *   2. SELECT the corresponding `inspirations` row by id + job user id via Drizzle ORM.
 *   3. Ask the configured model provider to classify the row's text and let
 *      the result cascade through this file's retry/permanent decision tree.
 *   4. UPDATE the row's `cluster` + `classified_at` (+ `updated_at`) when a
 *      validated label comes back, guarded by `WHERE cluster IS NULL` for
 *      idempotency under at-least-once worker execution.
 *   5. Best-effort automatic top-of-mind generation after classification reaches a
 *      success/permanent-skip outcome. top-of-mind provider/runtime failures are
 *      swallowed here and must not alter classification retry semantics.
 *
 * Error & retry semantics (the contract)
 * --------------------------------------
 * `runClassificationJob` succeeds for permanent outcomes and throws for
 * transient ones. The DB-backed worker records retry/backoff/failure state in
 * `background_jobs`; the compatibility handler translates thrown transient
 * failures into a partial-batch-style response for existing tests.
 *
 *   - Malformed body (compatibility handler only)
 *     → permanent failure, NOT retried. Logged and treated as success.
 *
 *   - Inspiration row not found
 *     → also treated as success. The row was deleted between enqueue and
 *       consume (e.g. user removed it). There is nothing to classify, and
 *       retrying will only repeat the same SELECT.
 *
 *   - Row already classified (`cluster IS NOT NULL`)
 *     → no-op success. We never re-classify, and we save the Gemini round-
 *       trip entirely. The UPDATE below also re-checks `cluster IS NULL` so
 *       a second worker that races past this guard still cannot clobber the
 *       first writer.
 *
 *   - Provider returns null cluster (safety block, schema drift, out-of-set
 *     label, empty text)
 *     → permanent skip. Leave `cluster` NULL on the row. The same input on a
 *       retry would produce the same null; the row is reachable for a future
 *       backfill via the `inspirations_cluster_null_idx` partial index.
 *
 *   - Provider throws (non-2xx HTTP, network error, non-JSON body, missing
 *     API key)
 *   - Drizzle / Postgres throws (SELECT or UPDATE)
 *     → transient. The DB-backed worker retries with backoff up to the job's
 *       configured `max_attempts`, then marks the row failed for inspection.
 */

import { and, eq, isNull } from "drizzle-orm";

import { backgroundJobs, type Inspiration, inspirations } from "../db/index.js";
import { generateAutoWowMomentForInspiration } from "../lib/auto-wow-generation.js";
import { getDb } from "../lib/db.js";
import {
  getDefaultModelProvider,
  type ModelProvider,
} from "../lib/model-provider.js";
import { spreadCaptureActivation } from "../lib/signal-activation.js";

// ---------------------------------------------------------------------------
// Legacy Lambda/SQS-shaped event types (minimal subset)
// ---------------------------------------------------------------------------

/**
 * Minimal subset of the legacy AWS Lambda SQS event shape we depend on. Inlining
 * this avoids adding `@types/aws-lambda` as a dependency just for the two
 * fields legacy tests read. Replace with the full type from `aws-lambda` if/when other
 * handlers in this package start needing richer Lambda typings.
 */
interface SQSRecordLike {
  messageId: string;
  body: string;
}

interface SQSEventLike {
  Records: SQSRecordLike[];
}

interface SQSBatchResponse {
  batchItemFailures: { itemIdentifier: string }[];
}

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------

/**
 * Legacy compatibility payload accepted by `handler` below.
 *
 * Kept narrow on purpose — the worker re-reads the row from Postgres by id,
 * so the message and the row can never drift out of sync. The current
 * DB-backed worker stores tenant scope on `background_jobs.user_id`
 * and passes it separately to `runClassificationJob`.
 */
interface ClassificationJob {
  inspirationId: string;
}

export interface ClassificationJobDependencies {
  generateAutoWowMoment?: typeof generateAutoWowMomentForInspiration;
  spreadActivation?: typeof spreadCaptureActivation;
  modelProvider?: ModelProvider;
  userId?: string;
  backgroundJobId?: string;
}

/**
 * Parse and minimally validate a raw legacy message body.
 *
 * Returns `null` for any structural problem (non-JSON, missing field, wrong
 * type, blank string). The caller treats `null` as a permanent failure and
 * does NOT add the record to `batchItemFailures` — see the file header for
 * the rationale.
 *
 * We intentionally do NOT use zod here. The schema is one field, and pulling
 * zod into the queue worker bundle just to validate `{ inspirationId: string }`
 * is dead weight on cold start.
 */
function parseJob(body: string): ClassificationJob | null {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }

  if (
    raw === null ||
    typeof raw !== "object" ||
    !("inspirationId" in raw) ||
    typeof (raw as { inspirationId: unknown }).inspirationId !== "string"
  ) {
    return null;
  }

  const inspirationId = (raw as { inspirationId: string }).inspirationId.trim();
  if (inspirationId.length === 0) return null;

  return { inspirationId };
}

/**
 * Fetch the inspiration row referenced by a job, or `null` if the row no
 * longer exists. When `userId` is supplied by the DB-backed worker, the SELECT
 * is tenant-scoped so a forged/stale job cannot classify or WOW another user's
 * row. The legacy compatibility handler omits `userId` to preserve old tests.
 */
async function loadInspiration(
  inspirationId: string,
  userId?: string,
): Promise<Inspiration | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(inspirations)
    .where(
      userId
        ? and(eq(inspirations.id, inspirationId), eq(inspirations.userId, userId))
        : eq(inspirations.id, inspirationId),
    )
    .limit(1);

  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Single-job classification
// ---------------------------------------------------------------------------

/**
 * Process one classification job: SELECT the row, classify through the model provider, UPDATE
 * `cluster` + `classified_at` if a label comes back, all guarded by
 * `WHERE cluster IS NULL` for idempotency.
 *
 * Returns successfully on permanent outcomes (row missing, already
 * classified, Gemini returns null) so callers don't retry pointlessly.
 * Throws on transient failures (DB / provider / network) so the DB-backed
 * worker can apply retry/backoff policy. Compatibility batch behaviour also
 * lives at the call-site, not here.
 *
 * Reused from two places:
 *   1. `lib/queue.ts` for current DB-backed background jobs.
 *   2. The legacy-shaped `handler` below for compatibility tests.
 */
export async function runClassificationJob(
  inspirationId: string,
  deps: ClassificationJobDependencies = {},
): Promise<void> {
  const row = await loadInspiration(inspirationId, deps.userId);

  if (!row) {
    console.warn("[classifier] inspiration not found, skipping", {
      inspirationId,
      userId: deps.userId,
    });
    return;
  }

  if (row.cluster !== null) {
    console.log("[classifier] inspiration already classified, skipping classification", {
      inspirationId,
      cluster: row.cluster,
    });
    await runPostClassificationHooks(row, deps);
    return;
  }

  const modelProvider = deps.modelProvider ?? (await getDefaultModelProvider());
  const result = await modelProvider.classifySignalText(row.text);

  if (result.cluster === null) {
    console.warn("[classifier] no cluster from model provider, leaving NULL", {
      inspirationId: row.id,
      finishReason: result.finishReason,
      blockReason: result.blockReason,
    });
    await runPostClassificationHooks(row, deps);
    return;
  }

  const now = new Date();
  const db = getDb();
  const updated = await db
    .update(inspirations)
    .set({
      cluster: result.cluster,
      classifiedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(inspirations.id, row.id),
        eq(inspirations.userId, row.userId),
        isNull(inspirations.cluster),
      ),
    )
    .returning({ id: inspirations.id });

  if (updated.length === 0) {
    console.log("[classifier] update skipped, row already classified", {
      inspirationId: row.id,
    });
    await runPostClassificationHooks(row, deps);
    return;
  }

  console.log("[classifier] classified inspiration", {
    inspirationId: row.id,
    userId: row.userId,
    cluster: result.cluster,
    finishReason: result.finishReason,
  });

  await runPostClassificationHooks(row, deps);
}

/**
 * Best-effort tail of every classification pass: try the immediate pairwise
 * judgment (auto WOW), then spread activation to the capture's semantic
 * neighbors — the accumulation half of the spark engine. Both are fire-and-
 * forget: failures never affect classification retry semantics.
 */
async function runPostClassificationHooks(
  row: Inspiration,
  deps: ClassificationJobDependencies,
): Promise<void> {
  await attemptAutoWowGeneration(row, deps);
  await attemptActivationSpread(row, deps);
}

/**
 * Spreading activation: the new capture warms related old signals; when an
 * accumulated cluster of individually weak signals crosses its threshold,
 * the warmest of them is re-judged through the same generation seam. This
 * is how "signals that matter little alone" get their second look.
 */
async function attemptActivationSpread(
  row: Inspiration,
  deps: ClassificationJobDependencies,
): Promise<void> {
  const spreadActivation = deps.spreadActivation ?? spreadCaptureActivation;
  const generateAutoWowMoment =
    deps.generateAutoWowMoment ?? generateAutoWowMomentForInspiration;

  try {
    const result = await spreadActivation(getDb(), {
      userId: row.userId,
      inspirationId: row.id,
      generateForInspiration: (inspirationId) =>
        generateAutoWowMoment({ db: getDb(), userId: row.userId, inspirationId }),
    });
    if (result?.fired) {
      console.log("[classifier] convergence fired from accumulated activation", {
        triggerInspirationId: row.id,
        rejudgedInspirationId: result.rejudgedInspirationId,
        potential: result.evaluation.potential,
        threshold: result.evaluation.threshold,
        contributors: result.evaluation.contributorCount,
      });
    }
  } catch (err) {
    console.warn("[classifier] activation spread threw", {
      inspirationId: row.id,
      userId: row.userId,
      errorName: err instanceof Error ? err.name : typeof err,
    });
  }
}

async function attemptAutoWowGeneration(
  row: Inspiration,
  deps: ClassificationJobDependencies,
): Promise<void> {
  const generateAutoWowMoment =
    deps.generateAutoWowMoment ?? generateAutoWowMomentForInspiration;

  try {
    const result = await generateAutoWowMoment({
      db: getDb(),
      userId: row.userId,
      inspirationId: row.id,
    });

    await recordAutoWowGenerationResult(deps.backgroundJobId, row.id, result);

    if (result.status === "unavailable") {
      console.warn("[classifier] automatic top-of-mind generation unavailable", {
        inspirationId: row.id,
        userId: row.userId,
      });
    }
  } catch (err) {
    console.warn("[classifier] automatic top-of-mind generation threw", {
      inspirationId: row.id,
      userId: row.userId,
      errorName: err instanceof Error ? err.name : typeof err,
    });
  }
}

async function recordAutoWowGenerationResult(
  backgroundJobId: string | undefined,
  inspirationId: string,
  result: Awaited<ReturnType<typeof generateAutoWowMomentForInspiration>>,
): Promise<void> {
  if (!backgroundJobId) return;

  const falseJudgment = result.status === "not_wow" ? result.judgment : null;
  const summary = {
    status: result.status,
    generated: result.generated,
    ...(falseJudgment
      ? {
          judgment: {
            isWowMoment: false as const,
            reason: falseJudgment.reason,
            debugSummary: falseJudgment.debugSummary,
            ...(falseJudgment.rawGeminiPreview
              ? { rawGeminiPreview: falseJudgment.rawGeminiPreview }
              : {}),
            ...(falseJudgment.parseFailureStage
              ? { parseFailureStage: falseJudgment.parseFailureStage }
              : {}),
            ...(falseJudgment.finishReason ? { finishReason: falseJudgment.finishReason } : {}),
            ...(falseJudgment.schemaIssueSummary
              ? { schemaIssueSummary: falseJudgment.schemaIssueSummary }
              : {}),
          },
        }
      : {}),
  };

  await getDb()
    .update(backgroundJobs)
    .set({
      payload: { inspirationId, autoWowGeneration: summary },
      updatedAt: new Date(),
    } as Partial<typeof backgroundJobs.$inferInsert>)
    .where(eq(backgroundJobs.id, backgroundJobId));
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Legacy-shaped batch entry point retained as a compatibility wrapper around
 * `runClassificationJob`. SST no longer binds this function to a queue.
 *
 * Implementation note: we process records sequentially rather than via
 * `Promise.all`. Two reasons:
 *   1. The DB pool is sized at 1 connection per Lambda container (see
 *      `lib/db.ts`), so parallel SELECTs would just queue inside postgres-js.
 *   2. The downstream Gemini call (later sub-AC) has its own per-key rate
 *      limit; serializing here keeps that cost obvious in the log timeline.
 *
 * The return value preserves the partial-batch-response shape: any message id
 * placed in `batchItemFailures` represents a transient failure.
 */
export const handler = async (
  event: SQSEventLike,
): Promise<SQSBatchResponse> => {
  const failures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    const job = parseJob(record.body);
    if (!job) {
      // Malformed payload — see header comment. Do NOT retry; log and drop.
      console.error("[classifier] dropping malformed message", {
        messageId: record.messageId,
      });
      continue;
    }

    try {
      await runClassificationJob(job.inspirationId);
    } catch (err) {
      // Transient DB / Gemini / network failure. Current DB-backed workers
      // record retry/backoff state in `background_jobs`; this compatibility
      // wrapper reports the same transient outcome via `batchItemFailures`.
      console.error("[classifier] transient failure, will retry", {
        messageId: record.messageId,
        inspirationId: job.inspirationId,
        error: err instanceof Error ? err.message : String(err),
      });
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures: failures };
};
