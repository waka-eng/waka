/**
 * The nightly principle cron — the SOLE enqueuer of principle generation.
 *
 * Fires once per day at midnight PST (fixed 08:00 UTC; EventBridge crons do
 * not shift with daylight saving, so summer runs land at 01:00 Pacific —
 * documented, not hidden). The layer's cadence is deliberate: a principle is
 * what months of history show, so there is no moment to catch live, and the
 * owner's decision is that nothing else may trigger generation. A source-scan
 * test pins `enqueueRefreshPrinciples` to this file.
 *
 * The handler enqueues one job per profile that could possibly clear the
 * longevity bar (a cheap count — the real bar arithmetic runs inside the
 * job), then drains its own queue to completion the same way the background
 * worker does: nothing polls behind it, so leaving the jobs pending would
 * mean they wait a day.
 */

import { count, eq } from "drizzle-orm";

import { profiles, signals } from "./db/index.js";
import { getDb } from "./lib/db.js";
import { PRINCIPLE_MIN_SIGNALS } from "./lib/principle-generation.js";
import {
  enqueueRefreshPrinciples,
  enqueueTendSignalGarden,
  runBackgroundJobWorker,
} from "./lib/queue.js";

const MAX_DRAIN_PASSES = 12;
const DRAIN_LIMIT = 25;

export async function handler() {
  const db = getDb();
  const dayKey = new Date().toISOString().slice(0, 10);

  // Profiles with enough active signals to conceivably clear the bar. The
  // full arithmetic (spans, top-of-mind survivals) belongs to the job; this
  // is only the "do not even wake up for it" filter.
  const eligible = await db
    .select({ profileId: signals.profileId, actives: count(signals.id) })
    .from(signals)
    .innerJoin(profiles, eq(profiles.id, signals.profileId))
    .where(eq(signals.status, "active"))
    .groupBy(signals.profileId);

  /* the garden pass rides the same night, keyed per ISO week — six of the
     seven nightly enqueues collapse into the row already there, so each
     profile's standing set is tended once a week. Two active signals is the
     smallest set that can hold a duplicate. */
  const weekKey = isoWeekKey(new Date());

  let enqueued = 0;
  for (const row of eligible) {
    if (Number(row.actives) >= 2) {
      await enqueueTendSignalGarden(row.profileId, weekKey);
    }
    if (Number(row.actives) < PRINCIPLE_MIN_SIGNALS) continue;
    await enqueueRefreshPrinciples(row.profileId, dayKey);
    enqueued += 1;
  }

  const total = { claimed: 0, succeeded: 0, retried: 0, failed: 0 };
  let passes = 0;
  while (passes < MAX_DRAIN_PASSES) {
    const result = await runBackgroundJobWorker({ limit: DRAIN_LIMIT });
    passes += 1;
    total.claimed += result.claimed;
    total.succeeded += result.succeeded;
    total.retried += result.retried;
    total.failed += result.failed;
    if (result.claimed === 0) break;
  }

  const summary = { dayKey, profiles: eligible.length, enqueued, ...total, passes };
  console.log("[principle-refresh] nightly run", summary);
  return summary;
}

/** ISO-8601 week key, e.g. "2026-W35" — the gardener's once-a-week lock. */
export function isoWeekKey(at: Date): string {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
