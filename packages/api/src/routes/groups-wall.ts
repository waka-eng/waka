/**
 * A room's wall — the signals its members have shared into it.
 *
 * This is layer 2 crossing between people, and the query is written to stop
 * there. It joins shares to signals and goes no further: `inspirations` and
 * `signal_evidence` are not reachable from this file and must not become so.
 * A member sees the pattern someone arrived at, never the raw captures it was
 * distilled from.
 */

import { and, asc, desc, eq, ne } from "drizzle-orm";

import { groupMembers, profiles, signalShares, signals } from "../db/index.js";
import { getDb } from "../lib/db.js";
import { labelMembersByProfileId } from "../lib/member-labels.js";

type WakaDb = ReturnType<typeof getDb>;

const MAX_WALL_SIGNALS = 200;

/**
 * One shared signal on a group's wall.
 *
 * The distilled statement and who it belongs to — nothing else. There is
 * deliberately no field here for what the statement was derived from.
 */
export interface GroupWallSignal {
  signalId: string;
  statement: string;
  /**
   * Confidence AS THE OWNER'S SYSTEM LAST WROTE IT — the one documented
   * staleness in the system, named so no consumer mistakes it for a live
   * value. Live confidence is a pure function of the evidence rows and the
   * clock, and this query is deliberately unable to reach those rows (a
   * member must never touch another member's private layers), so the wall
   * serves the snapshot written when the evidence last changed. A signal
   * that has gone quiet since then reads stronger here than it is.
   */
  confidenceAsWritten: number;
  ownerProfileId: string;
  ownerName: string;
  sharedAt: string;
}

/**
 * The group's wall: the signals its members have shared here.
 *
 * Evidence stays with its owner. This query joins shares to signals and stops
 * — `inspirations` and `signal_evidence` are not reachable from it, and must
 * not become so. A member sees the pattern someone arrived at, never the raw
 * captures it was distilled from.
 *
 * Shares are filtered to *current* members: a share is a standing choice made
 * from inside the group, so leaving withdraws it from the wall even though the
 * row survives. Retired signals drop off too — the owner hid it or its support
 * disappeared, and neither is something a wall should keep displaying.
 */
export async function loadGroupWall(
  db: WakaDb,
  groupId: string,
): Promise<GroupWallSignal[]> {
  const rows = await db
    .select({
      signalId: signals.id,
      statement: signals.statement,
      confidence: signals.confidence,
      ownerProfileId: signalShares.profileId,
      ownerName: profiles.name,
      sharedAt: signalShares.createdAt,
    })
    .from(signalShares)
    .innerJoin(signals, eq(signals.id, signalShares.signalId))
    .innerJoin(
      groupMembers,
      and(
        eq(groupMembers.groupId, signalShares.groupId),
        eq(groupMembers.profileId, signalShares.profileId),
      ),
    )
    .innerJoin(profiles, eq(profiles.id, signalShares.profileId))
    .where(and(eq(signalShares.groupId, groupId), ne(signals.status, "retired")))
    .orderBy(desc(signalShares.createdAt), asc(signals.id))
    .limit(MAX_WALL_SIGNALS);

  const labels = labelMembersByProfileId(
    rows.map((row) => ({ profileId: row.ownerProfileId, name: row.ownerName })),
  );

  return rows.map((row) => ({
    signalId: row.signalId,
    statement: row.statement,
    confidenceAsWritten: row.confidence,
    ownerProfileId: row.ownerProfileId,
    ownerName: labels.get(row.ownerProfileId)?.displayName ?? row.ownerName,
    sharedAt: row.sharedAt.toISOString(),
  }));
}
