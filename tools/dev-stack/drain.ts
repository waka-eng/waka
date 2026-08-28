#!/usr/bin/env tsx
/**
 * THE QUEUE, DRAINED, ON A LAPTOP.
 *
 * In production the worker is a Lambda: the API invokes it the moment work is
 * enqueued, and a daily cron sweeps up the error paths. Neither of those
 * exists locally, so `pnpm dev:local` on its own gives you an app where
 * NOTHING EVER DERIVES — you capture a memory and no signal ever forms, no
 * room wall ever fills, no top of mind is ever written. Everything past
 * layer 1 is invisible, and it looks like the product is broken rather than
 * like the worker is missing.
 *
 * This is that missing worker: the same `handler()` the Lambda runs, on a
 * timer. Nothing here is production code — it is the local substitute for an
 * invocation the cloud does for you.
 *
 * Run it beside the server:
 *
 *     pnpm dev:local     # terminal 1 — API + web on :3010
 *     pnpm dev:drain     # terminal 2 — this
 *
 * The interval is short because the point is to feel the loop while you are
 * clicking. Set WAKA_DRAIN_INTERVAL_MS to slow it down.
 */
import { handler } from "../../packages/api/src/background-worker.js";

const INTERVAL_MS = Number.parseInt(process.env.WAKA_DRAIN_INTERVAL_MS ?? "3000", 10);

let running = false;
let stopping = false;

async function tick(): Promise<void> {
  /* Never overlap: a drain that is still working when the next tick fires
     would claim the same jobs twice and race its own locks. */
  if (running || stopping) return;
  running = true;
  try {
    const result = await handler();
    const moved =
      (result?.succeeded ?? 0) + (result?.failed ?? 0) + (result?.retried ?? 0);
    if (moved > 0) {
      console.log(
        `[drain] ${result?.succeeded ?? 0} done, ${result?.retried ?? 0} retried, ` +
          `${result?.failed ?? 0} failed, ${result?.deferred ?? 0} deferred`,
      );
    }
  } catch (err) {
    /* Keep looping. A drain that exits on the first error is a worker you
       have to remember to restart, which is the thing this exists to avoid. */
    console.error("[drain]", err instanceof Error ? err.message : String(err));
  } finally {
    running = false;
  }
}

console.log(`[drain] draining the queue every ${INTERVAL_MS}ms. Ctrl+C to stop.`);
const timer = setInterval(() => void tick(), INTERVAL_MS);
void tick();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
    clearInterval(timer);
    console.log("\n[drain] stopped.");
    process.exit(0);
  });
}
