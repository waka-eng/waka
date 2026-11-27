/**
 * YOUR WEEK, IN ONE LINE (insight goal, phase 5; founder, 2026-11-26: "build
 * all except 5").
 *
 * No new model work: the line is the person's lead reading as it stands,
 * offered for the week only when the week actually moved it. Two things must
 * both be true, or there is no card ("nothing invented"):
 *
 *   - the reading was written or confirmed in the last seven days (any new
 *     version, including one that found nothing to change, or an edit to
 *     the lead entry), and
 *   - it rests on at least two saves made in those seven days.
 *
 * The saves come back by id only. Their words never travel with the card
 * unless the person chooses to share them.
 */
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";

import { inspirations, signalEvidence, signals, topOfMinds } from "../db/index.js";
import { evidenceSupportCurrent } from "./signal-support-state.js";
import type { getDb } from "./db.js";

type WakaDb = ReturnType<typeof getDb>;

export const WEEK_DAYS = 7;
const DAY_MS = 86_400_000;
/** The fewest saves of this week a line must rest on to be this week's. */
export const WEEK_MIN_SAVES = 2;

export interface WeeklyLine {
  week: { from: string; to: string };
  line: string;
  saveIds: string[];
}

/** The live reading as the route already reads it (pinned lead, else first). */
export interface ReadingForWeek {
  entries: Array<{ body: string; pinned: boolean; dismissed: boolean; sortOrder: number; citedSignals: Array<{ id: string }> }>;
  createdAt: string;
  contentUpdatedAt?: string;
}

export async function loadWeeklyLine(db: WakaDb, profileId: string, reading: ReadingForWeek | null, now: Date): Promise<WeeklyLine | null> {
  if (!reading) return null;
  const from = new Date(now.getTime() - WEEK_DAYS * DAY_MS);
  const lead = [...reading.entries].filter((entry) => !entry.dismissed)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.sortOrder - b.sortOrder)[0];
  if (!lead || !lead.body.trim()) return null;

  const [latest] = await db.select({ at: topOfMinds.createdAt }).from(topOfMinds)
    .where(eq(topOfMinds.profileId, profileId)).orderBy(desc(topOfMinds.createdAt)).limit(1);
  const touched = [latest?.at, reading.contentUpdatedAt ? new Date(reading.contentUpdatedAt) : null]
    .some((at) => at && at.getTime() >= from.getTime());
  if (!touched) return null;

  const signalIds = lead.citedSignals.map((signal) => signal.id);
  if (!signalIds.length) return null;
  const rows = await db.selectDistinct({ id: inspirations.id, at: inspirations.createdAt })
    .from(signalEvidence)
    .innerJoin(inspirations, and(eq(inspirations.id, signalEvidence.inspirationId), eq(inspirations.profileId, profileId)))
    .innerJoin(signals, eq(signals.id, signalEvidence.signalId))
    /* Only support that still stands, from saves still in memory (code
       review, 2026-11-26). */
    .where(and(eq(signalEvidence.profileId, profileId), inArray(signalEvidence.signalId, signalIds), gte(inspirations.createdAt, from),
      isNull(inspirations.memoryExcludedAt), evidenceSupportCurrent()))
    .orderBy(desc(inspirations.createdAt));
  if (rows.length < WEEK_MIN_SAVES) return null;

  return { week: { from: from.toISOString(), to: now.toISOString() }, line: lead.body, saveIds: rows.map((row) => row.id) };
}
