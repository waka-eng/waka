/**
 * The room timeline — what a wall used to think, and when it changed its mind.
 *
 * Phase 0 made time exist: notes and readings are retired rather than deleted,
 * and joins and departures are recorded. Nothing read any of it back, so a room
 * accumulated a history that was structurally invisible. This module is the
 * read model.
 *
 * Two things live here.
 *
 * **The board as of T.** A note belongs to the board at time T when it had been
 * written by then and had not yet been replaced: `created_at <= T AND
 * (replaced_at IS NULL OR replaced_at > T)`. The boundary is deliberately
 * half-open — a note replaced exactly at T is already gone at T — so scrubbing
 * to the instant of a change shows the state *after* it, which is what "what
 * did this become?" means to someone dragging a rail.
 *
 * **The events.** Formed, readings turning, people arriving and leaving, in one
 * ordered list. Departures distinguish `left` from `removed`, because a
 * timeline should not put someone's own words in their mouth.
 *
 * Membership gates everything, like every other group read.
 */

import { and, asc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";

import {
  groupMemberEvents,
  groupTopOfMindNoteSignals,
  groupTopOfMindNotes,
  groups,
  signals,
  users,
} from "../db/index.js";
import { loadGroupWithMembers } from "./group-top-of-mind.js";
import type { WakaDb } from "./inspiration-embeddings.js";

/** A note, as it stood at some moment. */
export interface TimelineNote {
  id: string;
  title: string;
  why: string;
  /**
   * Stable across revisions of the same idea. The wall keys its animation on
   * this: a note that persists across a scrubbed boundary must stay perfectly
   * still, and only identity can tell "unchanged" from "replaced by something
   * that reads similarly".
   */
  idempotencyKey: string;
  createdAt: string;
  replacedAt: string | null;
  /**
   * Whose saves this reading rests on, and what they said.
   *
   * A past board without its faces is a different product from the present
   * one: the whole claim is that a reading exists because these particular
   * collections sat next to each other, and a card that cannot say whose is
   * back to being an observation from nowhere.
   */
  evidence: TimelineEvidence[];
}

export interface TimelineEvidence {
  signalId: string;
  ownerUserId: string;
  ownerName: string;
  textPreview: string;
  reason: string;
}

export type TimelineEvent =
  | { kind: "formed"; at: string }
  | { kind: "note_written"; at: string; noteId: string; title: string }
  | { kind: "note_replaced"; at: string; noteId: string; title: string }
  | {
      kind: "member";
      at: string;
      event: "joined" | "left" | "removed";
      userId: string;
      name: string;
    };

export interface RoomTimeline {
  groupId: string;
  formedAt: string;
  events: TimelineEvent[];
}

/**
 * Does this note belong to the board at `at`?
 *
 * Pure, and separated from the SQL that fetches rows, because it is the whole
 * decision — everything around it is plumbing. Tested directly.
 */
export function noteIsOnBoardAt(
  note: { createdAt: Date; replacedAt: Date | null },
  at: Date,
): boolean {
  if (note.createdAt.getTime() > at.getTime()) return false;
  if (note.replacedAt === null) return true;
  // Half-open: replaced AT this instant means already gone at this instant.
  return note.replacedAt.getTime() > at.getTime();
}

/**
 * The board as it stood at `at`, or now when `at` is omitted.
 *
 * Null when the caller is not a member — the same answer as for a room that
 * does not exist.
 */
export async function boardAsOf(
  db: WakaDb,
  input: { userId: string; groupId: string; at?: Date },
): Promise<{ at: string; notes: TimelineNote[] } | null> {
  const loaded = await loadGroupWithMembers(db, {
    userId: input.userId,
    groupId: input.groupId,
  });
  if (!loaded) return null;

  const at = input.at ?? new Date();

  /**
   * Asking the database the same question `noteIsOnBoardAt` asks.
   *
   * Deliberately NOT "fetch everything and filter in JS": a room that has run
   * for a year has far more retired notes than live ones, and the index on
   * (group_id, created_at, replaced_at) exists to make this cheap.
   */
  const rows = await db
    .select({
      id: groupTopOfMindNotes.id,
      title: groupTopOfMindNotes.title,
      why: groupTopOfMindNotes.why,
      idempotencyKey: groupTopOfMindNotes.idempotencyKey,
      createdAt: groupTopOfMindNotes.createdAt,
      replacedAt: groupTopOfMindNotes.replacedAt,
    })
    .from(groupTopOfMindNotes)
    .where(
      and(
        eq(groupTopOfMindNotes.groupId, input.groupId),
        lte(groupTopOfMindNotes.createdAt, at),
        or(
          isNull(groupTopOfMindNotes.replacedAt),
          gt(groupTopOfMindNotes.replacedAt, at),
        ),
      ),
    )
    .orderBy(asc(groupTopOfMindNotes.createdAt), asc(groupTopOfMindNotes.id));

  if (rows.length === 0) return { at: at.toISOString(), notes: [] };

  /**
   * The faces behind each reading.
   *
   * Filtered exactly as the live board filters: a signal that has since gone
   * private, or whose owner has left the room, is not shown to anyone still in
   * it. Travelling backwards must not become a way to read what the present
   * refuses to show — the timeline is a record of what happened, never a hole
   * in the privacy contract.
   */
  const currentMemberIds = new Set(loaded.members.map((member) => member.userId));
  const evidenceRows = await db
    .select({
      noteId: groupTopOfMindNoteSignals.groupTopOfMindNoteId,
      signalId: groupTopOfMindNoteSignals.signalId,
      ownerUserId: groupTopOfMindNoteSignals.ownerUserId,
      ownerName: users.name,
      reason: groupTopOfMindNoteSignals.reason,
      sortOrder: groupTopOfMindNoteSignals.sortOrder,
      text: signals.text,
      shared: signals.sharedToGroups,
    })
    .from(groupTopOfMindNoteSignals)
    .innerJoin(signals, eq(signals.id, groupTopOfMindNoteSignals.signalId))
    .innerJoin(users, eq(users.id, groupTopOfMindNoteSignals.ownerUserId))
    .where(
      inArray(
        groupTopOfMindNoteSignals.groupTopOfMindNoteId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(groupTopOfMindNoteSignals.sortOrder));

  const evidenceByNote = new Map<string, TimelineEvidence[]>();
  for (const row of evidenceRows) {
    if (!row.shared) continue;
    if (!currentMemberIds.has(row.ownerUserId)) continue;
    const bucket = evidenceByNote.get(row.noteId) ?? [];
    bucket.push({
      signalId: row.signalId,
      ownerUserId: row.ownerUserId,
      ownerName: row.ownerName,
      textPreview: row.text.replace(/\s+/g, " ").trim().slice(0, 240),
      reason: row.reason ?? "",
    });
    evidenceByNote.set(row.noteId, bucket);
  }

  return {
    at: at.toISOString(),
    notes: rows.map((row) => ({
      id: row.id,
      title: row.title,
      why: row.why,
      idempotencyKey: row.idempotencyKey,
      createdAt: row.createdAt.toISOString(),
      replacedAt: row.replacedAt?.toISOString() ?? null,
      evidence: evidenceByNote.get(row.id) ?? [],
    })),
  };
}

/**
 * Everything that ever happened to this room, oldest first.
 *
 * Null for a non-member. Note that a note contributes up to TWO events — the
 * moment it was written and the moment it was replaced — because both are
 * things the room did, and a timeline that only showed arrivals would read as
 * a board that only ever grew.
 */
export async function loadRoomTimeline(
  db: WakaDb,
  input: { userId: string; groupId: string },
): Promise<RoomTimeline | null> {
  const loaded = await loadGroupWithMembers(db, {
    userId: input.userId,
    groupId: input.groupId,
  });
  if (!loaded) return null;

  const [group] = await db
    .select({ createdAt: groups.createdAt })
    .from(groups)
    .where(eq(groups.id, input.groupId))
    .limit(1);
  if (!group) return null;

  const notes = await db
    .select({
      id: groupTopOfMindNotes.id,
      title: groupTopOfMindNotes.title,
      createdAt: groupTopOfMindNotes.createdAt,
      replacedAt: groupTopOfMindNotes.replacedAt,
    })
    .from(groupTopOfMindNotes)
    .where(eq(groupTopOfMindNotes.groupId, input.groupId));

  const memberRows = await db
    .select({
      userId: groupMemberEvents.userId,
      event: groupMemberEvents.event,
      at: groupMemberEvents.at,
      name: users.name,
    })
    .from(groupMemberEvents)
    .innerJoin(users, eq(users.id, groupMemberEvents.userId))
    .where(eq(groupMemberEvents.groupId, input.groupId));

  const events: TimelineEvent[] = [
    { kind: "formed", at: group.createdAt.toISOString() },
  ];
  for (const note of notes) {
    events.push({
      kind: "note_written",
      at: note.createdAt.toISOString(),
      noteId: note.id,
      title: note.title,
    });
    if (note.replacedAt) {
      events.push({
        kind: "note_replaced",
        at: note.replacedAt.toISOString(),
        noteId: note.id,
        title: note.title,
      });
    }
  }
  for (const row of memberRows) {
    events.push({
      kind: "member",
      at: row.at.toISOString(),
      event: row.event,
      userId: row.userId,
      name: row.name,
    });
  }

  events.sort((a, b) => a.at.localeCompare(b.at));

  return {
    groupId: input.groupId,
    formedAt: group.createdAt.toISOString(),
    events,
  };
}
