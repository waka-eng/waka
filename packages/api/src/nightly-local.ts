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
 * This entry calls THE SAME handler the cron invokes — nothing here
 * enqueues generation itself, so the owner's ruling that the cron handler
 * is the sole enqueuer stays exactly one function wide. Idempotency keys
 * (day for principles, ISO week for the garden) make repeated boots
 * collapse into the rows already there, so running this on every
 * `pnpm dev:local` is safe and, on an ordinary day, free: the cheap gates
 * answer "not yet" with zero model calls.
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
await handler();
process.exit(0);
