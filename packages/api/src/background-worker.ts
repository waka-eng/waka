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
