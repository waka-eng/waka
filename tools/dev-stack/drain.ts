#!/usr/bin/env tsx
/** One manual queue drain, then exit. The local API already wakes work on
 * enqueue and schedules known pending deadlines; an idle serverless database
 * must not be kept awake by a second polling worker.
 *
 *     pnpm dev:drain
 */
if (process.argv.includes("--watch")) {
  console.error("[drain] Periodic database checks are disabled. Run dev:drain once when needed.");
  process.exit(1);
}
// The CLI owns this bounded pass. Leave future work to the API's known-work
// wakes or an explicit later invocation, without starting local auto-drains.
process.env.WAKA_BACKGROUND_JOB_AUTODRAIN = "0";
const { handler } = await import("../../packages/api/src/background-worker.js");
try {
  const result = await handler();
  console.log("[drain] one pass complete", result);
  process.exit(0);
} catch (error) {
  console.error("[drain]", error instanceof Error ? error.message : String(error));
  process.exit(1);
}
