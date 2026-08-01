#!/usr/bin/env tsx
/**
 * Phase 0 gate — does a refresh retire readings instead of deleting them?
 *
 * The unit tests prove the decision logic; only a real pass against a real
 * board proves the write. This snapshots a room's readings, runs one genuine
 * refresh, and reports what happened to each one.
 *
 * It MUTATES the board it is pointed at: one real synthesis pass. That is the
 * point — but point it deliberately. It also prints reading titles, which are
 * derived from real people's saved signals and do not belong in a pasted log.
 *
 * Usage:
 *   pnpm tsx tools/verify-timeline-phase0.ts --list
 *   pnpm tsx tools/verify-timeline-phase0.ts --group <uuid>
 */

import { config as loadDotenv } from "dotenv";

loadDotenv({ path: ".env.local" });
loadDotenv();

import { asc, eq } from "drizzle-orm";

import {
  groupMembers,
  groupTopOfMindNotes,
  groups,
} from "../packages/api/src/db/index";
import { getDb } from "../packages/api/src/lib/db";
import { refreshGroupTopOfMind } from "../packages/api/src/lib/group-top-of-mind";

async function main(): Promise<void> {
  const db = getDb();
  const argv = process.argv;

  if (argv.includes("--list")) {
    const rooms = await db
      .select({ id: groups.id, name: groups.name })
      .from(groups)
      .orderBy(asc(groups.createdAt));
    for (const room of rooms) console.log(`${room.id}  ${room.name}`);
    return;
  }

  const groupId = argv[argv.indexOf("--group") + 1];
  if (!groupId) throw new Error("Pass --group <uuid> (or --list)");

  const [room] = await db
    .select({ id: groups.id, name: groups.name })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  if (!room) throw new Error("No such group");

  const [member] = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId))
    .limit(1);
  if (!member) throw new Error("Group has no members");

  const snapshot = async () =>
    db
      .select({
        id: groupTopOfMindNotes.id,
        title: groupTopOfMindNotes.title,
        lifecycleStatus: groupTopOfMindNotes.lifecycleStatus,
        replacedAt: groupTopOfMindNotes.replacedAt,
      })
      .from(groupTopOfMindNotes)
      .where(eq(groupTopOfMindNotes.groupId, groupId))
      .orderBy(asc(groupTopOfMindNotes.createdAt));

  const before = await snapshot();
  const beforeIds = new Set(before.map((n) => n.id));
  console.log(`\n=== ${room.name} — before ===`);
  console.log(`${before.length} readings, ${before.filter((n) => n.lifecycleStatus === "active").length} active`);
  for (const note of before) console.log(`  [${note.lifecycleStatus}] ${note.title}`);

  console.log("\nrunning refresh (real synthesis pass)...");
  const result = await refreshGroupTopOfMind(db, {
    userId: member.userId,
    groupId,
    limit: 12,
  });
  if (!result) throw new Error("refresh returned null (membership check failed)");
  if (!result.refreshed) {
    console.log(
      `\nDECLINED by cooldown. Next eligible: ${result.nextEligibleAt ?? "unknown"}`,
    );
    console.log("Nothing was written. Re-run after the cooldown to test the gate.");
    return;
  }

  const after = await snapshot();
  const kept = after.filter((n) => beforeIds.has(n.id));
  const lost = [...beforeIds].filter((id) => !after.some((n) => n.id === id));
  const added = after.filter((n) => !beforeIds.has(n.id));

  console.log(`\n=== after ===`);
  console.log(`${after.length} readings, ${after.filter((n) => n.lifecycleStatus === "active").length} active`);
  for (const note of after) {
    const tag = beforeIds.has(note.id) ? " " : "+";
    console.log(`  ${tag} [${note.lifecycleStatus}] ${note.title}`);
  }

  console.log(`\n=== THE GATE ===`);
  console.log(`pre-existing readings still present: ${kept.length}/${before.length}`);
  console.log(`DELETED (must be 0):                 ${lost.length}`);
  console.log(`newly created:                       ${added.length}`);
  console.log(
    `retired this pass:                   ${
      kept.filter((n) => n.lifecycleStatus === "replaced").length
    }`,
  );
  console.log(lost.length === 0 ? "\nPASS — nothing was destroyed." : "\nFAIL — readings were deleted.");

}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
