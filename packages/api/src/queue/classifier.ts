/**
 * Classifier queue worker.
 *
 * SST wires this module via `sst.config.ts`:
 *
 *   const classifierQueue = new sst.aws.Queue("ClassifierQueue");
 *   classifierQueue.subscribe({
 *     handler: "packages/api/src/queue/classifier.handler",
 *     link: [dbConnectionUrl, geminiApiKey],
 *   });
 *
 * The Hono API Lambda is granted `sqs:SendMessage` on this queue because the
 * queue is included in the API's `link` array. That binding is the *enqueue
 * side*: any code path running inside the API Lambda can publish a
 * `{ inspirationId }` job to the queue without provisioning extra IAM, and
 * `Resource.ClassifierQueue.url` resolves at runtime to the queue URL the
 * SDK needs.
 *
 * Scope of this file (Sub-AC 10.3.4)
 * ----------------------------------
 * Closes the classification loop end-to-end:
 *   1. Consume SQS records from the standard Lambda batch event.
 *   2. Parse each `record.body` as JSON `{ inspirationId: string }`.
 *   3. SELECT the corresponding `inspirations` row by id via Drizzle ORM.
 *   4. Call Gemini (`classifyInspirationText`) with the row's text and let
 *      the result cascade through this file's retry/permanent decision tree.
 *   5. UPDATE the row's `cluster` + `classified_at` (+ `updated_at`) when a
 *      validated label comes back, guarded by `WHERE cluster IS NULL` for
 *      idempotency under SQS at-least-once delivery.
 *   6. Best-effort automatic WOW generation after classification reaches a
 *      success/permanent-skip outcome. WOW provider/runtime failures are
 *      swallowed here and must not alter SQS classification retry semantics.
 *
 * Error & retry semantics (the contract)
 * --------------------------------------
 * The handler uses the SQS partial-batch-response contract: any record id
 * placed in `batchItemFailures` stays on the queue (re-delivered after the
 * visibility timeout); everything else is deleted by the Lambda runtime.
 *
 *   - Malformed body (non-JSON, missing/blank `inspirationId`)
 *     → permanent failure, NOT retried. Logged and treated as success so
 *       SQS deletes it. A retry of a poisoned message just burns budget
 *       until the redrive policy gives up; better to surface in logs once.
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
 *   - Gemini returns null cluster (safety block, schema drift, out-of-set
 *     label, empty text)
 *     → permanent skip. Leave `cluster` NULL on the row, ack the message.
 *       The same input on a retry would produce the same null; the row is
 *       reachable for a future backfill via the `inspirations_cluster_null_idx`
 *       partial index. Retrying through SQS would just burn the redrive
 *       budget for no behavioural change.
 *
 *   - Gemini throws (non-2xx HTTP, network error, non-JSON body, missing
 *     API key)
 *   - Drizzle / Postgres throws (SELECT or UPDATE)
 *     → transient. Pushed onto `batchItemFailures` so SQS retries after
 *       the visibility timeout. Neon hiccups, Gemini 5xx / 429, network
 *       blips, and cold-start races all fall in this bucket. Eventually the
 *       SQS redrive policy moves a permanently-broken message to the DLQ.
 */

import { and, eq, isNull } from "drizzle-orm";

import { type Inspiration, inspirations } from "../db/index.js";
import { generateAutoWowMomentForInspiration } from "../lib/auto-wow-generation.js";
import { getDb } from "../lib/db.js";
import { classifyInspirationText } from "./gemini.js";

// ---------------------------------------------------------------------------
// Lambda SQS event types (minimal subset)
// ---------------------------------------------------------------------------

/**
 * Minimal subset of the AWS Lambda SQS event shape we depend on. Inlining
 * this avoids adding `@types/aws-lambda` as a dependency just for the two
 * fields we read. Replace with the full type from `aws-lambda` if/when other
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
 * Payload published to the classifier queue by `lib/queue.ts:enqueueClassification`.
 *
 * Kept narrow on purpose — the worker re-reads the row from Postgres by id,
 * so the message and the row can never drift out of sync. Adding fields here
 * (e.g. `userId`, `correlationId`) only requires a matching change in the
 * producer; nothing else needs to know.
 */
interface ClassificationJob {
  inspirationId: string;
}

export interface ClassificationJobDependencies {
  generateAutoWowMoment?: typeof generateAutoWowMomentForInspiration;
}

/**
 * Parse and minimally validate a raw SQS message body.
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
 * longer exists. Scoped to a single SELECT by primary key — there is no
 * tenant filtering here on purpose: the worker runs out-of-band of any user
 * session, and the only way an id arrives on this queue is via the API's
 * authenticated POST handler, which has already enforced ownership.
 */
async function loadInspiration(
  inspirationId: string,
): Promise<Inspiration | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(inspirations)
    .where(eq(inspirations.id, inspirationId))
    .limit(1);

  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Single-job classification
// ---------------------------------------------------------------------------

/**
 * Process one classification job: SELECT the row, call Gemini, UPDATE
 * `cluster` + `classified_at` if a label comes back, all guarded by
 * `WHERE cluster IS NULL` for idempotency.
 *
 * Returns successfully on permanent outcomes (row missing, already
 * classified, Gemini returns null) so callers don't retry pointlessly.
 * Throws on transient failures (DB / Gemini / network) so the SQS handler
 * can push the record onto `batchItemFailures` and the inline (dev)
 * caller can log + drop without retrying — both behaviours sit at the
 * call-site, not here.
 *
 * Reused from two places:
 *   1. The SQS `handler` below (production path, async via SST queue).
 *   2. `lib/queue.ts:enqueueClassification` when SQS is not configured
 *      (local dev / `pnpm dev` without SST).
 */
export async function runClassificationJob(
  inspirationId: string,
  deps: ClassificationJobDependencies = {},
): Promise<void> {
  const row = await loadInspiration(inspirationId);

  if (!row) {
    console.warn("[classifier] inspiration not found, skipping", {
      inspirationId,
    });
    return;
  }

  if (row.cluster !== null) {
    console.log("[classifier] inspiration already classified, skipping classification", {
      inspirationId,
      cluster: row.cluster,
    });
    await attemptAutoWowGeneration(row, deps);
    return;
  }

  const result = await classifyInspirationText(row.text);

  if (result.cluster === null) {
    console.warn("[classifier] no cluster from gemini, leaving NULL", {
      inspirationId: row.id,
      finishReason: result.finishReason,
      blockReason: result.blockReason,
    });
    await attemptAutoWowGeneration(row, deps);
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
    .where(and(eq(inspirations.id, row.id), isNull(inspirations.cluster)))
    .returning({ id: inspirations.id });

  if (updated.length === 0) {
    console.log("[classifier] update skipped, row already classified", {
      inspirationId: row.id,
    });
    await attemptAutoWowGeneration(row, deps);
    return;
  }

  console.log("[classifier] classified inspiration", {
    inspirationId: row.id,
    userId: row.userId,
    cluster: result.cluster,
    finishReason: result.finishReason,
  });

  await attemptAutoWowGeneration(row, deps);
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

    if (result.status === "unavailable") {
      console.warn("[classifier] automatic WOW generation unavailable", {
        inspirationId: row.id,
        userId: row.userId,
      });
    }
  } catch (err) {
    console.warn("[classifier] automatic WOW generation threw", {
      inspirationId: row.id,
      userId: row.userId,
      errorName: err instanceof Error ? err.name : typeof err,
    });
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * SQS Lambda entry-point. SST's `Queue.subscribe` binds this function as the
 * queue consumer.
 *
 * Implementation note: we process records sequentially rather than via
 * `Promise.all`. Two reasons:
 *   1. The DB pool is sized at 1 connection per Lambda container (see
 *      `lib/db.ts`), so parallel SELECTs would just queue inside postgres-js.
 *   2. The downstream Gemini call (later sub-AC) has its own per-key rate
 *      limit; serializing here keeps that cost obvious in the log timeline.
 *
 * The return value uses the partial-batch-response contract: any message id
 * placed in `batchItemFailures` is left on the queue and will be retried;
 * everything else is treated as successfully processed and deleted.
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
      // Transient DB / Gemini / network failure. Push onto batchItemFailures
      // so SQS re-delivers the message after the visibility timeout. The
      // SQS redrive policy on the queue (configured in `sst.config.ts`)
      // bounds the retry budget — once exceeded, the message lands in the
      // DLQ instead of looping forever.
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
