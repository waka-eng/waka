/**
 * Nightly recovery for principle generation and the signal garden.
 *
 * Fires once per day at midnight PST (fixed 08:00 UTC; EventBridge crons do
 * not shift with daylight saving, so summer runs land at 01:00 Pacific —
 * documented, not hidden). Normal material changes also request principles;
 * the material fingerprint makes this recovery pass free for completed inputs.
 *
 * The handler enqueues one job per profile that could possibly clear the
 * longevity bar (a cheap count — the real bar arithmetic runs inside the
 * job), then drains its own queue to completion the same way the background
 * worker does: nothing polls behind it, so leaving the jobs pending would
 * mean they wait a day.
 */

import { and, eq, inArray, ne, sql } from "drizzle-orm";

import { profiles, signals } from "./db/index.js";
import { getDb } from "./lib/db.js";
import { PRINCIPLE_MIN_SIGNALS } from "./lib/principle-generation.js";
import {
  enqueueTendSignalGarden,
  runBackgroundJobWorker,
} from "./lib/queue.js";
import { requestPrincipleRefresh } from "./lib/principle-status.js";

const MAX_DRAIN_PASSES = 12;
const DRAIN_LIMIT = 25;

export async function handler() {
  const db = getDb();
  const dayKey = new Date().toISOString().slice(0, 10);

  // Profiles with enough active signals to conceivably clear the bar. The
  // full arithmetic (spans, top-of-mind survivals) belongs to the job; this
  // is only the "do not even wake up for it" filter.
  // The gardener scans the whole standing set — emerging rows too, since a
  // pattern split across two wordings is exactly what keeps each half below
  // promotion — so its gate counts those, while principles count actives.
  const eligible = await db
    .select({
      profileId: signals.profileId,
      actives: sql<number>`count(*) FILTER (WHERE ${signals.status} = 'active')`,
      standing: sql<number>`count(*) FILTER (WHERE ${signals.dismissedAt} IS NULL)`,
    })
    .from(signals)
    .innerJoin(profiles, eq(profiles.id, signals.profileId))
    /* room minds still hold active signals, but the room engine is retired
       (2026-10-17): neither principles nor the gardener tend them any more */
    .where(and(inArray(signals.status, ["active", "emerging"]), ne(profiles.type, "group")))
    .groupBy(signals.profileId);

  /* the garden pass rides the same night, keyed per ISO week — six of the
     seven nightly enqueues collapse into the row already there, so each
     profile's standing set is tended once a week. Two standing signals is
     the smallest set that can hold a duplicate. */
  const weekKey = isoWeekKey(new Date());

  let enqueued = 0;
  for (const row of eligible) {
    if (Number(row.standing) >= 2) {
      await enqueueTendSignalGarden(row.profileId, weekKey);
    }
    if (Number(row.actives) < PRINCIPLE_MIN_SIGNALS) continue;
    await requestPrincipleRefresh(db, row.profileId);
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
