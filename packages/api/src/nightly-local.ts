/**
 * The nightly clock, for a stack with no EventBridge.
 *
 * Deployed stages get layer 4's cadence from the `PrincipleRefresh` cron
 * (sst.config.ts): once a day, enqueue the principles pass and the weekly
 * garden tend for every profile that could clear the bars, then drain. A
 * local stack has no cron, so principles and the gardener simply never ran
 * here — the sky stayed "forming" forever and duplicate proposals never
 * appeared, however real the material got (observed 2026-09-01: every local
 * layer-4 artifact in existence had been fired by hand).
 *
 * This entry calls the same recovery handler as the deployed cron. With
 * --watch it repeats hourly while the local stack stays up. Material keys
 * for principles and weekly garden keys keep unchanged work bounded.
 *
 * The explicit exit matters: the db pool keeps node alive after the work
 * is done (learned the long way — the first hand-run zombied for fifteen
 * minutes on an idle pool).
 */
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";

const dotenvPath = process.env.WAKA_API_DOTENV_PATH ?? resolve(process.cwd(), "../../.env");
loadDotenv({ path: dotenvPath });

/* The handler drains everything it enqueues itself; the in-process
   auto-drain would race it from a timer and be guillotined by the exit
   below mid-claim, stranding a `running` row for the stale-lock reclaim
   to rescue a boot later (observed on this entry's first smoke). One
   drain loop per process: the handler's own. */
process.env.WAKA_BACKGROUND_JOB_AUTODRAIN = "0";

const { handler } = await import("./principle-refresh.js");
const watch = process.argv.includes("--watch");
do {
  try { await handler(); }
  catch (error) {
    console.error("[principle-refresh] local pass failed", error);
    if (!watch) process.exit(1);
  }
  if (watch) await new Promise((resolve) => setTimeout(resolve, 60 * 60 * 1000));
} while (watch);
process.exit(0);
