#!/usr/bin/env tsx
/**
 * Turn density — how often does a board's reading actually change?
 *
 * The room timeline shows marks on an axis. If a board turns over weekly, a
 * three-year room is ~150 marks and no instrument holds them; if it turns
 * every few weeks, the whole succession fits and the timeline can show every
 * reading. That number decides Phase 2's visual density, and it is a fact
 * about this data rather than something to guess at.
 *
 * Read-only. Prints nothing but counts and dates — no reading text — so its
 * output is safe to paste into the goal doc.
 *
 * What it measures, per group:
 *   - the room's age, and how many readings it has ever held
 *   - generations: distinct moments at which readings were retired, which is
 *     what a scrub would actually snap to
 *   - membership hinges: joins, leaves, removals
 *   - marks/month, the number Phase 2 needs
 *
 * A caveat it prints for itself: lifecycle only began recording on 2026-08-01
 * (migration 0038). Before that, refresh deleted superseded notes outright, so
 * every board's history starts empty and fills from now on. A board whose
 * `oldestReading` is that date or later has a complete record; anything
 * earlier is a floor, not a count.
 *
 * Usage:
 *   pnpm tsx tools/turn-density.ts
 *   pnpm tsx tools/turn-density.ts --group <uuid>
 */

import { config as loadDotenv } from "dotenv";

loadDotenv({ path: ".env.local" });
loadDotenv();

import { asc, eq } from "drizzle-orm";

import {
  groupMemberEvents,
  groupTopOfMindNotes,
  groups,
} from "../packages/api/src/db/index";
import { getDb } from "../packages/api/src/lib/db";

/** When migration 0038 started preserving retired readings. */
const LIFECYCLE_EPOCH = new Date("2026-08-01T00:00:00.000Z");

/** Retirements within this window are one refresh, not two turns. */
const GENERATION_BUCKET_MS = 60_000;

function monthsBetween(from: Date, to: Date): number {
  const ms = Math.max(0, to.getTime() - from.getTime());
  return Math.max(ms / (1000 * 60 * 60 * 24 * 30.44), 1 / 30.44);
}

function fmt(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "—";
}

async function main(): Promise<void> {
  const groupIdArg = process.argv.indexOf("--group");
  const onlyGroupId = groupIdArg >= 0 ? process.argv[groupIdArg + 1] : null;

  const db = getDb();
  const rooms = await db
    .select({ id: groups.id, name: groups.name, createdAt: groups.createdAt })
    .from(groups)
    .orderBy(asc(groups.createdAt));

  const targets = onlyGroupId ? rooms.filter((r) => r.id === onlyGroupId) : rooms;
  if (targets.length === 0) {
    console.log(onlyGroupId ? "No such group." : "No groups.");
    return;
  }

  const now = new Date();
  console.log("");
  console.log(
    "room                      age(mo)  readings  active  generations  hinges  marks/mo  oldest",
  );
  console.log("".padEnd(100, "-"));

  for (const room of targets) {
    const notes = await db
      .select({
        createdAt: groupTopOfMindNotes.createdAt,
        replacedAt: groupTopOfMindNotes.replacedAt,
        lifecycleStatus: groupTopOfMindNotes.lifecycleStatus,
      })
      .from(groupTopOfMindNotes)
      .where(eq(groupTopOfMindNotes.groupId, room.id))
      .orderBy(asc(groupTopOfMindNotes.createdAt));

    const events = await db
      .select({ at: groupMemberEvents.at, event: groupMemberEvents.event })
      .from(groupMemberEvents)
      .where(eq(groupMemberEvents.groupId, room.id));

    // A scrub snaps to moments the board changed, not to individual notes: a
    // refresh retiring four readings at once is ONE mark.
    const retirements = notes
      .map((n) => n.replacedAt)
      .filter((d): d is Date => d instanceof Date)
      .sort((a, b) => a.getTime() - b.getTime());
    let generations = 0;
    let lastBucket = -Infinity;
    for (const at of retirements) {
      if (at.getTime() - lastBucket > GENERATION_BUCKET_MS) {
        generations += 1;
        lastBucket = at.getTime();
      }
    }

    const active = notes.filter((n) => n.lifecycleStatus === "active").length;
    const oldest = notes[0]?.createdAt ?? null;
    const months = monthsBetween(room.createdAt, now);
    // What the timeline would actually draw: one mark per generation, one per
    // membership hinge, plus the room's formation.
    const marks = generations + events.length + 1;

    console.log(
      [
        room.name.slice(0, 24).padEnd(24),
        months.toFixed(1).padStart(8),
        String(notes.length).padStart(9),
        String(active).padStart(7),
        String(generations).padStart(12),
        String(events.length).padStart(7),
        (marks / months).toFixed(1).padStart(9),
        `  ${fmt(oldest)}`,
      ].join(""),
    );
  }

  const anyPreEpoch = targets.some((r) => r.createdAt < LIFECYCLE_EPOCH);
  console.log("");
  if (anyPreEpoch) {
    console.log(
      `NOTE: lifecycle recording began ${fmt(LIFECYCLE_EPOCH)} (migration 0038).`,
    );
    console.log(
      "      Rooms older than that lost every superseded reading to the old",
    );
    console.log(
      "      DELETE-on-refresh, so their counts are a floor and marks/mo will",
    );
    console.log("      climb toward the true rate as history accumulates.");
    console.log("");
  }
  console.log(
    "Phase 2 reads this as: <~30 marks total → show every generation;",
  );
  console.log(
    "  more → show turns only (drift above threshold), hinges always.",
  );
  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
