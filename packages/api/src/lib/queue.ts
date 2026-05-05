/**
 * SQS enqueue helper for the classifier queue (Sub-AC 10.2).
 *
 * The Hono `POST /inspirations` handler calls `enqueueClassification(id)`
 * after the inspiration row is durable in Neon. The message is consumed by
 * the SST-managed worker bound in `sst.config.ts`:
 *
 *   const classifierQueue = new sst.aws.Queue("ClassifierQueue");
 *   classifierQueue.subscribe({
 *     handler: "packages/api/src/queue/classifier.handler",
 *     ...
 *   });
 *
 * Wire-format
 * -----------
 * The message body is JSON `{ inspirationId: string }`. The worker is the only
 * consumer — keep this contract local to the two endpoints (this file and
 * `queue/classifier.ts`) so a future schema change is a single PR rather than
 * a search-and-replace across handlers.
 *
 * Why a thin wrapper instead of inlining the SDK call?
 *   - One place to resolve the queue URL (env var → SST link fallback), so a
 *     misconfigured stack fails loudly here rather than silently no-oping in
 *     each call site.
 *   - One place to pin the message schema. If we add a `userId` or a
 *     `correlationId` later, every enqueue path picks it up automatically.
 *   - Singleton SQSClient — initialising the SDK is cheap but not free, and
 *     this helper is on the hot path of every save.
 *
 * Failure semantics
 * -----------------
 * The handler in `routes/inspirations.ts` wraps this call in a try/catch and
 * does NOT fail the HTTP request if enqueue throws. Rationale:
 *   - The Drizzle insert has already succeeded — the user's data is durable.
 *   - The classifier is *eventual*. The `inspirations_cluster_null_idx`
 *     partial index lets a future backfill scan rescue any rows whose enqueue
 *     was lost.
 *   - Returning 5xx after a successful save would tempt the client into
 *     retrying, producing duplicate rows.
 *
 * The catch site logs the error with the inspiration id so a missed enqueue is
 * visible in Lambda logs without taking down the save flow.
 */

import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";

import { runClassificationJob } from "../queue/classifier.js";

// ---------------------------------------------------------------------------
// Configuration resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the classifier queue's SQS URL.
 *
 * Resolution order mirrors `attachments.ts:getBucketName`:
 *
 *   1. `CLASSIFIER_QUEUE_URL` — set explicitly by `sst.config.ts` from
 *      `classifierQueue.url`. This is the contract: production code paths go
 *      through this env var so the dependency on the SST link is visible in
 *      the stack file and not buried in a runtime probe.
 *
 *   2. `SST_RESOURCE_ClassifierQueue` — auto-injected by SST when the Function
 *      is `link`ed to the Queue. JSON-encoded `{ url, ... }`. Kept as a
 *      fallback so the handler still works if a future engineer wires the
 *      link without re-exporting the env var.
 *
 * Throws if neither is present so a misconfigured deployment fails loudly the
 * first time someone tries to save an inspiration, rather than silently
 * dropping classification jobs.
 */
function getQueueUrl(): string {
  const fromEnv = process.env.CLASSIFIER_QUEUE_URL;
  if (fromEnv && fromEnv.length > 0) return fromEnv;

  const sstLink = process.env.SST_RESOURCE_ClassifierQueue;
  if (sstLink) {
    try {
      const parsed = JSON.parse(sstLink) as { url?: string };
      if (parsed?.url) return parsed.url;
    } catch {
      // fall through to error
    }
  }

  throw new Error(
    "Classifier queue URL is not configured (CLASSIFIER_QUEUE_URL / SST_RESOURCE_ClassifierQueue).",
  );
}

/**
 * Resolve the SQS region.
 *
 * Same shape as `attachments.ts:getRegion` — explicit env > Lambda runtime env
 * > us-west-2 default. SQS is regional; this MUST equal the region the queue
 * was provisioned in or the SDK request signs against the wrong endpoint.
 */
function getRegion(): string {
  return (
    process.env.CLASSIFIER_QUEUE_REGION ||
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    "us-west-2"
  );
}

// ---------------------------------------------------------------------------
// Client (lazy singleton)
// ---------------------------------------------------------------------------

/**
 * Lazily-instantiated SQS client. One per process; reused across warm Lambda
 * invocations. Credentials come from the standard provider chain — on Lambda
 * this is the execution role attached by SST when the Function is `link`ed to
 * the queue (which grants `sqs:SendMessage` on this queue's ARN).
 */
let cachedSqs: SQSClient | null = null;
function getSqs(): SQSClient {
  if (cachedSqs) return cachedSqs;
  cachedSqs = new SQSClient({ region: getRegion() });
  return cachedSqs;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Message body shape published to the classifier queue. Kept narrow on
 * purpose — the worker re-reads the row from Postgres by id, so we never have
 * to worry about the message and the row drifting out of sync.
 */
export interface ClassificationJob {
  inspirationId: string;
}

/**
 * Whether SQS is reachable in this runtime. SST production wires
 * `CLASSIFIER_QUEUE_URL` (or the `SST_RESOURCE_ClassifierQueue` JSON link)
 * into the Lambda environment; local dev (`pnpm dev` without SST) ships
 * neither. We branch on this so the same `enqueueClassification` call site
 * works in both worlds.
 */
function isQueueConfigured(): boolean {
  if (
    typeof process.env.CLASSIFIER_QUEUE_URL === "string" &&
    process.env.CLASSIFIER_QUEUE_URL.length > 0
  ) {
    return true;
  }
  return Boolean(process.env.SST_RESOURCE_ClassifierQueue);
}

/**
 * Publish a classification job for `inspirationId`.
 *
 * Production (SST) path: send the job to the SQS queue. Returns the
 * SQS-issued `MessageId` on success (handy for log correlation).
 *
 * Local dev path (no SQS configured): run the classifier inline as a
 * fire-and-forget background task. The HTTP request returns immediately —
 * `setImmediate` defers the work to the next tick of the Node event loop —
 * so the user's POST is unblocked, exactly like the SQS path. Errors are
 * swallowed and logged (the row keeps `cluster=NULL` and is reachable for
 * a future backfill via `inspirations_cluster_null_idx`); we never throw
 * out of the dev fallback because the caller treats every enqueue failure
 * as non-fatal anyway.
 *
 * Throws on configuration / transport / IAM failures in the SQS path —
 * callers wrap in try/catch and decide whether to surface to the user. See
 * `routes/inspirations.ts` POST handler for the canonical "log and continue"
 * pattern.
 */
export async function enqueueClassification(
  inspirationId: string,
): Promise<string | undefined> {
  if (!isQueueConfigured()) {
    // Local-dev fallback: run inline, fire-and-forget. `setImmediate`
    // ensures we yield back to the HTTP handler before classification
    // starts — the POST response goes out, then the worker logic runs.
    setImmediate(() => {
      runClassificationJob(inspirationId).catch((err) => {
        console.error("[queue] inline classification failed", {
          inspirationId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    });
    return undefined;
  }

  const queueUrl = getQueueUrl();
  const sqs = getSqs();

  const result = await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      // JSON.stringify is deterministic for a single-key object — no need for
      // a stable-stringify helper here.
      MessageBody: JSON.stringify({ inspirationId } satisfies ClassificationJob),
    }),
  );

  return result.MessageId;
}
