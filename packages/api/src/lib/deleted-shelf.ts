/**
 * The deleted shelf's one clock. Every place that decides whether a copy has
 * passed its month — the delete that files a copy, the shelf's list and
 * restore, the export, and the worker's daily run — asks here, against the
 * same `now` its route was given, so there is one lapse and not three.
 */
import { lt } from "drizzle-orm";

import { DELETED_KEEP_DAYS, deletedInspirations } from "../db/index.js";
import type { getDb } from "./db.js";

const DAY_MS = 86_400_000;

/** Copies deleted before this moment have passed their month. */
export function deletedShelfCutoff(now: Date): Date {
  return new Date(now.getTime() - DELETED_KEEP_DAYS * DAY_MS);
}

/** When a copy deleted at `deletedAt` goes for good. */
export function deletedShelfGoneAt(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + DELETED_KEEP_DAYS * DAY_MS);
}

/**
 * Everyone's copies past their month, gone. The per-person deletes on the
 * shelf's own routes only reach people who come back; this is what keeps a
 * person who never returns from having their words held past the month they
 * were promised. Run by the worker's daily invocation.
 */
export async function sweepDeletedShelf(db: Pick<ReturnType<typeof getDb>, "delete">, now: Date): Promise<number> {
  const gone = await db.delete(deletedInspirations).where(lt(deletedInspirations.deletedAt, deletedShelfCutoff(now)))
    .returning({ id: deletedInspirations.id });
  return gone.length;
}
