/**
 * The background queue's worker.
 *
 * Woken two ways. Normally the API invokes it the moment work is enqueued, so
 * a capture starts deriving in the same second. Once a day a cron invokes it
 * as a safety net, for the error paths a push cannot cover: a job whose
 * backoff outlived the invocation that failed it, a row still locked by a
 * worker that died, an enqueue whose wake-up call never landed.
 *
 * Because nothing polls behind it, this drains until the queue is *dry*
 * rather than running a single batch. The pipeline enqueues as it goes — a
 * finished derivation asks for a synthesis — so stopping after one batch
 * would leave the second half of a person's pipeline waiting for tomorrow's
 * sweep. The passes are bounded: an unbounded loop plus a job that keeps
 * re-arming itself is a Lambda that runs until its timeout, every time.
 */

import { runBackgroundJobWorker } from "./lib/queue.js";

const DEFAULT_CRON_LIMIT = 5;
const MAX_CRON_LIMIT = 25;

/**
 * Enough passes for the deepest real chain (enrich → derive → synthesize,
 * plus a group refresh) across a burst of captures, and few enough that a
 * pathological re-arming job cannot hold the invocation open indefinitely.
 */
const MAX_DRAIN_PASSES = 12;

function parseCronLimit(raw: string | undefined): number {
  if (!raw) return DEFAULT_CRON_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_CRON_LIMIT;
  return Math.min(parsed, MAX_CRON_LIMIT);
}

export async function handler() {
  const limit = parseCronLimit(process.env.WAKA_BACKGROUND_JOB_CRON_LIMIT);
  const total = { claimed: 0, succeeded: 0, retried: 0, failed: 0 };
  let passes = 0;

  while (passes < MAX_DRAIN_PASSES) {
    const result = await runBackgroundJobWorker({ limit });
    passes += 1;
    total.claimed += result.claimed;
    total.succeeded += result.succeeded;
    total.retried += result.retried;
    total.failed += result.failed;

    // Nothing was due. Work scheduled for a future backoff is deliberately
    // left for the next wake-up rather than slept on: holding the invocation
    // open would also hold a database connection open, which is the cost this
    // whole design is avoiding.
    if (result.claimed === 0) break;
  }

  const drained = { ...total, passes, exhaustedPasses: passes >= MAX_DRAIN_PASSES };
  console.log("[background-worker] drained background jobs", drained);
  return drained;
}
