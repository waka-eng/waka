/**
 * A room's wall — the signals the ROOM GREW from its members' pooled ground.
 *
 * Rewritten 2026-08-24 on the founder's rulings: a room distils its own
 * signals from its members' public memories (x+y+z), a signal appears only
 * once memories from at least two different CURRENT members stand under it,
 * and "say out loud" retires as the way statements reach a room. The
 * `signal_shares` record survives as history — the export carries it — but
 * the wall reads the room's own layer 2 now.
 *
 * The boundary holds in its new shape: the wall serves statements and WHO
 * CONTRIBUTED, never the raw captures. Evidence is reached here for exactly
 * two facts — the distinct-owner count that gates a signal onto the wall,
 * and the contributor names — and no text, quote, or memory id crosses.
 */

import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import {
  feedback,
  groupMembers,
  inspirations,
  profiles,
  signalEvidence,
  signals,
  type FeedbackValue,
} from "../db/index.js";
import { GROUP_SIGNAL_MIN_VOICES } from "../lib/signal-derivation-thresholds.js";
import { getDb } from "../lib/db.js";
import { feedbackWordingCurrent } from '../lib/feedback-revisions.js';
import { labelMembersByProfileId } from "../lib/member-labels.js";
import { groupSignalReadable } from "../lib/group-output.js";

type WakaDb = ReturnType<typeof getDb>;

const MAX_WALL_SIGNALS = 200;

/**
 * How many of the room's live statements are considered before the gate.
 *
 * The serve limit cannot be the fetch limit. Every statement the room mints
 * starts with ONE voice under it, and most never get a second — so the rows
 * nearest the top of `lastEvidenceAt` are mostly statements that will not be
 * served. Cutting at 200 before the gate lets that ordinary sediment push a
 * genuinely two-voiced statement off the wall for no reason a member could
 * ever see. The gate runs over this wider window and the serve limit is
 * applied to what survives it.
 */
const MAX_WALL_SIGNALS_SCANNED = MAX_WALL_SIGNALS * 10;

/**
 * One member's answer to a statement on the wall — the latest they gave.
 * Named, per the founder's law: the room reads WHO stands where, never a
 * tally. Every current member's stance counts, contributors included — a
 * room-grown statement has no single owner whose self-reaction would be
 * private curation.
 */
export interface GroupWallReaction {
  profileId: string;
  name: string;
  value: FeedbackValue;
}

export interface GroupWallSignal {
  signalId: string;
  statement: string;
  statementRevision?: string;
  /**
   * The room's own confidence, as its lifecycle last wrote it. The old
   * caveat ("stale by design — a member must never touch another member's
   * private layers") retired with the share channel: this is the ROOM's
   * signal, and its evidence lives with the room's mind.
   */
  confidenceAsWritten: number;
  /** The words are held (locked). No room verb sets this yet; served so the
      day one does, the wall already tells it. */
  locked: boolean;
  /**
   * WHOSE MEMORIES STAND UNDER IT — current members only, in first-contributed
   * order. Two or more by construction: fewer voices and the signal is not
   * on the wall at all (`GROUP_SIGNAL_MIN_VOICES`).
   */
  contributors: Array<{ profileId: string; name: string }>;
  /** When the room first held this statement. */
  sharedAt: string;
  /** Latest verdict per current member. */
  reactions: GroupWallReaction[];
}

export async function loadGroupWall(
  db: WakaDb,
  groupId: string,
): Promise<GroupWallSignal[]> {
  /* the room's own layer 2: live signals of the room's mind */
  const mindRows = await db
    .select({ mindId: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.groupId, groupId), eq(profiles.type, "group")))
    .limit(1);
  const mind = mindRows[0];
  if (!mind) return [];

  const rows = await db
    .select({
      signalId: signals.id,
      statement: signals.statement,
      statementRevision: signals.statementRevision,
      confidence: signals.confidence,
      lockedAt: signals.lockedAt,
      createdAt: signals.createdAt,
    })
    .from(signals)
    .where(
      and(
        eq(signals.profileId, mind.mindId),
        groupSignalReadable(groupId),
        ne(signals.status, "retired"),
        isNull(signals.dismissedAt),
      ),
    )
    .orderBy(desc(signals.lastEvidenceAt), asc(signals.id))
    .limit(MAX_WALL_SIGNALS_SCANNED);
  if (rows.length === 0) return [];

  /**
   * THE TWO-VOICES GATE, counted over CURRENT members and PUBLIC memories.
   * A pattern one person's memories support is that person's own signal,
   * already forming on their own wall, and must not wear the room's name —
   * and a departed member's voice no longer carries, the same rule the old
   * wall applied to a departed member's share. The signal row survives below
   * the bar; it is simply not served.
   *
   * The visibility join is the other half of the one switch. Sharing is a
   * memory being public — it fans out to every room its keeper is in — so
   * turning it private has to take the voice back, and the only honest place
   * for that is here, where the voice is counted. A withdrawal that deleted
   * evidence rows would be one-way: flipping public again would leave the
   * room silent until something re-derived it. Reading visibility at serve
   * time makes the switch work in both directions and leaves the record
   * intact, which is the law about fading.
   */
  const voiceRows = await db
    .select({
      signalId: signalEvidence.signalId,
      ownerProfileId: signalEvidence.ownerProfileId,
      ownerName: profiles.name,
      firstAt: sql<Date>`min(${signalEvidence.createdAt})`,
    })
    .from(signalEvidence)
    .innerJoin(
      groupMembers,
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.profileId, signalEvidence.ownerProfileId),
      ),
    )
    .innerJoin(profiles, eq(profiles.id, signalEvidence.ownerProfileId))
    .innerJoin(
      inspirations,
      and(
        eq(inspirations.id, signalEvidence.inspirationId),
        eq(inspirations.visibility, "public"),
      ),
    )
    .where(
      inArray(
        signalEvidence.signalId,
        rows.map((row) => row.signalId),
      ),
    )
    .groupBy(signalEvidence.signalId, signalEvidence.ownerProfileId, profiles.name);

  const contributorsBySignal = new Map<
    string,
    Array<{ profileId: string; name: string; firstAt: number }>
  >();
  for (const row of voiceRows) {
    const bucket = contributorsBySignal.get(row.signalId);
    const entry = {
      profileId: row.ownerProfileId,
      name: row.ownerName,
      firstAt: new Date(row.firstAt).getTime(),
    };
    if (bucket) bucket.push(entry);
    else contributorsBySignal.set(row.signalId, [entry]);
  }

  const served = rows
    .filter(
      (row) => (contributorsBySignal.get(row.signalId)?.length ?? 0) >= GROUP_SIGNAL_MIN_VOICES,
    )
    .slice(0, MAX_WALL_SIGNALS);
  if (served.length === 0) return [];

  const labels = labelMembersByProfileId(
    [...contributorsBySignal.values()].flat().map((c) => ({
      profileId: c.profileId,
      name: c.name,
    })),
  );

  /**
   * WHO ANSWERED WHAT. Only verdicts by CURRENT members of this group
   * (leaving a room ends your voice in it), and only the latest per member
   * per statement, because feedback is append-only history and the newest
   * word is the one that stands. Contributors' stances count like anyone
   * else's: affirming a statement the room grew partly from your memories
   * is an act toward the ROOM's statement, not curation of your own.
   */
  const reactionRows = await db
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
      and(eq(groupMembers.groupId, groupId), eq(groupMembers.profileId, feedback.profileId)),
    )
    .innerJoin(profiles, eq(profiles.id, feedback.profileId))
    .where(
      and(
        eq(feedback.targetType, "signal"),
        feedbackWordingCurrent(),
        inArray(
          feedback.targetId,
          served.map((row) => row.signalId),
        ),
      ),
    )
    .orderBy(desc(feedback.createdAt));

  const reactorLabels = labelMembersByProfileId(
    reactionRows.map((row) => ({ profileId: row.reactorProfileId, name: row.reactorName })),
  );
  /** newest-first rows: the first (signal, reactor) pair seen is the standing one */
  const latestBySignal = new Map<string, GroupWallReaction[]>();
  const seenPair = new Set<string>();
  for (const row of reactionRows) {
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

  return served.map((row) => ({
    signalId: row.signalId,
    statement: row.statement,
    statementRevision: row.statementRevision.toString(),
    confidenceAsWritten: row.confidence,
    locked: row.lockedAt !== null,
    contributors: (contributorsBySignal.get(row.signalId) ?? [])
      .sort((a, b) => a.firstAt - b.firstAt || (a.profileId < b.profileId ? -1 : 1))
      .map((c) => ({
        profileId: c.profileId,
        name: labels.get(c.profileId)?.displayName ?? c.name,
      })),
    sharedAt: row.createdAt.toISOString(),
    reactions: latestBySignal.get(row.signalId) ?? [],
  }));
}
