/**
 * A room's wall — the signals its members have shared into it.
 *
 * This is layer 2 crossing between people, and the query is written to stop
 * there. It joins shares to signals and goes no further: `inspirations` and
 * `signal_evidence` are not reachable from this file and must not become so.
 * A member sees the pattern someone arrived at, never the raw captures it was
 * distilled from.
 */

import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";

import {
  feedback,
  groupMembers,
  profiles,
  signalShares,
  signals,
  type FeedbackValue,
} from "../db/index.js";
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
/**
 * One member's answer to a statement on the wall — the latest they gave.
 * Named, per the founder's law: the room reads WHO stands where, never a
 * tally. The owner's own verdicts on their own statement do not appear
 * here — answering yourself is private curation, not a reaction the room
 * heard.
 */
export interface GroupWallReaction {
  profileId: string;
  name: string;
  value: FeedbackValue;
}

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
  /** Latest verdict per current member; the reactor is never the owner. */
  reactions: GroupWallReaction[];
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

  /**
   * WHO ANSWERED WHAT. Feedback is the one thing this file may reach beyond
   * the share itself, because a reaction is a statement-level fact the room
   * is meant to hear — it names no memory and carries no span. The reach is
   * scoped twice: only verdicts by CURRENT members of this group (leaving a
   * room ends your voice in it, same as the tally), and only the latest per
   * member per statement, because feedback is append-only history and the
   * newest word is the one that stands. The owner's own verdicts are
   * filtered below: those are private curation. `inspirations` and
   * `signal_evidence` remain unreachable from this file, as the header
   * promises.
   */
  const reactionRows =
    rows.length === 0
      ? []
      : await db
          .select({
            targetId: feedback.targetId,
            reactorProfileId: feedback.profileId,
            reactorName: profiles.name,
            value: feedback.value,
            createdAt: feedback.createdAt,
          })
          .from(feedback)
          .innerJoin(
            groupMembers,
            and(
              eq(groupMembers.groupId, groupId),
              eq(groupMembers.profileId, feedback.profileId),
            ),
          )
          .innerJoin(profiles, eq(profiles.id, feedback.profileId))
          .where(
            and(
              eq(feedback.targetType, "signal"),
              inArray(
                feedback.targetId,
                rows.map((row) => row.signalId),
              ),
            ),
          )
          .orderBy(desc(feedback.createdAt));

  const ownerBySignal = new Map(rows.map((row) => [row.signalId, row.ownerProfileId]));
  const reactorLabels = labelMembersByProfileId(
    reactionRows.map((row) => ({ profileId: row.reactorProfileId, name: row.reactorName })),
  );
  /** newest-first rows: the first (signal, reactor) pair seen is the standing one */
  const latestBySignal = new Map<string, GroupWallReaction[]>();
  const seenPair = new Set<string>();
  for (const row of reactionRows) {
    if (ownerBySignal.get(row.targetId) === row.reactorProfileId) continue;
    const pair = `${row.targetId}:${row.reactorProfileId}`;
    if (seenPair.has(pair)) continue;
    seenPair.add(pair);
    const reaction: GroupWallReaction = {
      profileId: row.reactorProfileId,
      name: reactorLabels.get(row.reactorProfileId)?.displayName ?? row.reactorName,
      value: row.value,
    };
    const bucket = latestBySignal.get(row.targetId);
    if (bucket) bucket.push(reaction);
    else latestBySignal.set(row.targetId, [reaction]);
  }

  return rows.map((row) => ({
    signalId: row.signalId,
    statement: row.statement,
    confidenceAsWritten: row.confidence,
    ownerProfileId: row.ownerProfileId,
    ownerName: labels.get(row.ownerProfileId)?.displayName ?? row.ownerName,
    sharedAt: row.sharedAt.toISOString(),
    reactions: latestBySignal.get(row.signalId) ?? [],
  }));
}
