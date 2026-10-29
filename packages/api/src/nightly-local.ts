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
 * This entry calls the deployed recovery handler once, then exits. Local
 * maintenance must not poll a shared serverless database while idle. Material
 * keys for principles and weekly garden keys keep repeat manual runs bounded.
 *
 * The explicit exit matters: the db pool keeps node alive after the work
 * is done (learned the long way — the first hand-run zombied for fifteen
 * minutes on an idle pool).
 */
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";

if (process.argv.includes("--watch")) {
  console.error("[principle-refresh] Periodic database checks are disabled. Run nightly once when needed.");
  process.exit(1);
}

const dotenvPath = process.env.WAKA_API_DOTENV_PATH ?? resolve(process.cwd(), "../../.env");
loadDotenv({ path: dotenvPath });

/* The handler drains everything it enqueues itself; the in-process
   auto-drain would race it from a timer and be guillotined by the exit
   below mid-claim, stranding a `running` row for the stale-lock reclaim
   to rescue a boot later (observed on this entry's first smoke). One
   drain loop per process: the handler's own. */
process.env.WAKA_BACKGROUND_JOB_AUTODRAIN = "0";

const { handler } = await import("./principle-refresh.js");
try { await handler(); }
catch (error) {
  console.error("[principle-refresh] local pass failed", error);
  process.exit(1);
}
process.exit(0);
