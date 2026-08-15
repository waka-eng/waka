/**
 * Cron entry point for the background queue.
 *
 * On Lambda the container is frozen the instant a response is returned, so
 * the in-process drain timer in lib/queue.ts cannot be relied on there. This
 * handler is the deployed sweeper: it claims a bounded batch, runs it, and
 * exits. The bound matters — an unbounded drain would let one busy profile
 * hold a scheduled invocation open past its timeout and lose the batch.
 */

import { runBackgroundJobWorker } from "./lib/queue.js";

const DEFAULT_CRON_LIMIT = 5;
const MAX_CRON_LIMIT = 25;

function parseCronLimit(raw: string | undefined): number {
  if (!raw) return DEFAULT_CRON_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_CRON_LIMIT;
  return Math.min(parsed, MAX_CRON_LIMIT);
}

export async function handler() {
  const limit = parseCronLimit(process.env.WAKA_BACKGROUND_JOB_CRON_LIMIT);
  const result = await runBackgroundJobWorker({ limit });
  console.log("[background-worker] drained background jobs", result);
  return result;
}
