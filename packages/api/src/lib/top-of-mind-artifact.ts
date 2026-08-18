/**
 * Layer 3, stage 2 — reading the version that is standing now.
 *
 * A refresh never mutates: it reads the live artifact, decides what the next
 * one holds, and writes a new row. This module is the read half, and it is
 * separate from the write half because the two run at different moments —
 * once before the provider call to build the prompt, and again inside the
 * transaction under the artifact lock, because another pass may have landed a
 * version while this one was waiting on the model.
 *
 * What comes back is a snapshot, not live rows: entries with their human
 * marks (locked, pinned, dismissed) and the ids of the signals each one
 * cites. `isHumanTouched` is the whole definition of "the owner decided
 * something about this entry" and lives here next to the marks it reads, so
 * the versioning stage cannot quietly grow a fourth opinion about it.
 */

import { and, asc, eq, inArray } from "drizzle-orm";

import {
  topOfMindEntries,
  topOfMindEntrySignals,
  topOfMinds,
  type TopOfMindEntryType,
} from "../db/index.js";
import type { getDb } from "./db.js";

type WakaDb = ReturnType<typeof getDb>;
type WakaTx = Parameters<Parameters<WakaDb["transaction"]>[0]>[0];

export interface CarriedEntry {
  type: TopOfMindEntryType;
  body: string;
  belief: string | null;
  prompt: string | null;
  lockedAt: Date | null;
  pinnedAt: Date | null;
  dismissedAt: Date | null;
  sortOrder: number;
  citedSignalIds: string[];
}

export interface LiveArtifactSnapshot {
  id: string;
  version: number;
  entries: CarriedEntry[];
}

export async function loadLiveArtifact(
  db: WakaDb | WakaTx,
  profileId: string,
): Promise<LiveArtifactSnapshot | null> {
  const [artifact] = await db
    .select({ id: topOfMinds.id, version: topOfMinds.version })
    .from(topOfMinds)
    .where(and(eq(topOfMinds.profileId, profileId), eq(topOfMinds.status, "live")))
    .limit(1);
  if (!artifact) return null;

  const entryRows = await db
    .select()
    .from(topOfMindEntries)
    .where(eq(topOfMindEntries.topOfMindId, artifact.id))
    .orderBy(asc(topOfMindEntries.sortOrder));

  const citationRows =
    entryRows.length === 0
      ? []
      : await db
          .select({
            entryId: topOfMindEntrySignals.entryId,
            signalId: topOfMindEntrySignals.signalId,
          })
          .from(topOfMindEntrySignals)
          .where(
            inArray(
              topOfMindEntrySignals.entryId,
              entryRows.map((row) => row.id),
            ),
          );

  const citationsByEntry = new Map<string, string[]>();
  for (const row of citationRows) {
    const bucket = citationsByEntry.get(row.entryId);
    if (bucket) bucket.push(row.signalId);
    else citationsByEntry.set(row.entryId, [row.signalId]);
  }

  return {
    id: artifact.id,
    version: artifact.version,
    entries: entryRows.map((row) => ({
      type: row.type,
      body: row.body,
      belief: row.belief,
      prompt: row.prompt,
      lockedAt: row.lockedAt,
      pinnedAt: row.pinnedAt,
      dismissedAt: row.dismissedAt,
      sortOrder: row.sortOrder,
      citedSignalIds: citationsByEntry.get(row.id) ?? [],
    })),
  };
}

/** Locked, pinned, and dismissed are the three ways a human touched an entry. */
export function isHumanTouched(entry: CarriedEntry): boolean {
  return entry.lockedAt !== null || entry.pinnedAt !== null || entry.dismissedAt !== null;
}
