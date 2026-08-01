/**
 * Readings of a signal — every Top of Mind note that cited it, alone and
 * beside each room's other hearts.
 *
 * This is the first surface built directly on the product's central claim:
 * the same signal points to a different ambition depending on which other
 * signals it sits next to. The judge already wrote the halves of that
 * sentence — a solo note's belief statement, a group note's belief statement,
 * and per-citation `reason` rows explaining what role the signal played in
 * each. This module only arranges them side by side; it never generates
 * anything.
 *
 * Visibility contract (decided with the founder, Aug 2026):
 *   - Solo readings come from the caller's own `top_of_mind_notes`, so they
 *     are inherently private. The route mounts this owner-only.
 *   - Group readings are included ONLY for rooms the caller currently
 *     belongs to — enforced here by the `group_members` join, not left to
 *     the route. Leaving a room removes its readings from this surface.
 *
 * "Active" means different things per scope on purpose. Solo notes carry a
 * lifecycle (`active` / `replaced`); group boards hold only their current
 * notes, refresh replaces rows in place. So solo filters on lifecycle and
 * group takes the table as-is.
 */

import { and, asc, eq, inArray } from "drizzle-orm";

import {
  groupMembers,
  groupTopOfMindNoteSignals,
  groupTopOfMindNotes,
  groups,
  signals,
  topOfMindNoteSignals,
  topOfMindNotes,
  users,
} from "../db/index.js";
import type { WakaDb } from "./inspiration-embeddings.js";

/** Matches the group boards' preview budget so the two surfaces read alike. */
const PREVIEW_LENGTH = 180;

function truncatePreview(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > PREVIEW_LENGTH
    ? `${normalized.slice(0, PREVIEW_LENGTH - 1)}…`
    : normalized;
}

/** One co-cited signal — what the caller's signal sat next to in a note. */
export interface SignalReadingNeighbor {
  signalId: string;
  /** One normalized line of the neighboring save. */
  textPreview: string;
  ownerUserId: string;
  ownerName: string;
  ownerAvatarUrl: string | null;
  /** True when the neighbor is also the caller's own save. */
  isMine: boolean;
}

export type SignalReadingContext =
  | { scope: "alone" }
  | { scope: "group"; groupId: string; groupName: string };

/** One note that cited the signal, with the citation's own role and reason. */
export interface SignalReading {
  context: SignalReadingContext;
  note: {
    id: string;
    title: string;
    kind: string;
    beliefStatement: string | null;
    why: string;
    createdAt: string;
  };
  /** The judge's sentence about what role THIS signal played in the note. */
  myRole: { role: string; reason: string };
  neighbors: SignalReadingNeighbor[];
}

/**
 * All active readings of one signal visible to its owner: solo first, then
 * group readings for every room the owner is currently a member of, each in
 * the note's evidence order.
 *
 * Callers must already have verified the signal belongs to `userId` — this
 * function scopes every solo query by owner but takes that ownership as
 * given rather than re-checking the signals table.
 */
export async function listReadingsForSignal(
  db: WakaDb,
  input: { userId: string; signalId: string },
): Promise<SignalReading[]> {
  const [soloReadings, groupReadings] = await Promise.all([
    listSoloReadings(db, input),
    listGroupReadings(db, input),
  ]);
  return [...soloReadings, ...groupReadings];
}

async function listSoloReadings(
  db: WakaDb,
  input: { userId: string; signalId: string },
): Promise<SignalReading[]> {
  const citations = await db
    .select({
      noteId: topOfMindNotes.id,
      title: topOfMindNotes.title,
      kind: topOfMindNotes.kind,
      beliefStatement: topOfMindNotes.beliefStatement,
      why: topOfMindNotes.why,
      createdAt: topOfMindNotes.createdAt,
      role: topOfMindNoteSignals.role,
      reason: topOfMindNoteSignals.reason,
    })
    .from(topOfMindNoteSignals)
    .innerJoin(
      topOfMindNotes,
      eq(topOfMindNoteSignals.wowMomentId, topOfMindNotes.id),
    )
    .where(
      and(
        eq(topOfMindNoteSignals.userId, input.userId),
        eq(topOfMindNoteSignals.inspirationId, input.signalId),
        eq(topOfMindNotes.lifecycleStatus, "active"),
      ),
    )
    .orderBy(asc(topOfMindNotes.createdAt), asc(topOfMindNotes.id));

  if (citations.length === 0) return [];

  // Every neighbor in a solo note is the caller's own save, so one user row
  // covers all of them.
  const [me] = await db
    .select({ name: users.name, avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  const noteIds = citations.map((row) => row.noteId);
  const neighborRows = await db
    .select({
      noteId: topOfMindNoteSignals.wowMomentId,
      signalId: topOfMindNoteSignals.inspirationId,
      sortOrder: topOfMindNoteSignals.sortOrder,
      text: signals.text,
    })
    .from(topOfMindNoteSignals)
    .innerJoin(signals, eq(topOfMindNoteSignals.inspirationId, signals.id))
    .where(
      and(
        eq(topOfMindNoteSignals.userId, input.userId),
        inArray(topOfMindNoteSignals.wowMomentId, noteIds),
      ),
    )
    .orderBy(asc(topOfMindNoteSignals.sortOrder), asc(topOfMindNoteSignals.id));

  const neighborsByNote = new Map<string, SignalReadingNeighbor[]>();
  for (const row of neighborRows) {
    if (row.signalId === input.signalId) continue;
    const list = neighborsByNote.get(row.noteId) ?? [];
    list.push({
      signalId: row.signalId,
      textPreview: truncatePreview(row.text),
      ownerUserId: input.userId,
      ownerName: me?.name ?? "",
      ownerAvatarUrl: me?.avatarUrl ?? null,
      isMine: true,
    });
    neighborsByNote.set(row.noteId, list);
  }

  return citations.map((row) => ({
    context: { scope: "alone" as const },
    note: {
      id: row.noteId,
      title: row.title,
      kind: row.kind,
      beliefStatement: row.beliefStatement,
      why: row.why,
      createdAt: row.createdAt.toISOString(),
    },
    myRole: { role: row.role, reason: row.reason },
    neighbors: neighborsByNote.get(row.noteId) ?? [],
  }));
}

async function listGroupReadings(
  db: WakaDb,
  input: { userId: string; signalId: string },
): Promise<SignalReading[]> {
  // The `group_members` join IS the visibility rule: a room the caller left
  // (or was removed from) contributes nothing, even though its notes may
  // still cite the signal.
  const citations = await db
    .select({
      noteId: groupTopOfMindNotes.id,
      groupId: groups.id,
      groupName: groups.name,
      title: groupTopOfMindNotes.title,
      kind: groupTopOfMindNotes.kind,
      beliefStatement: groupTopOfMindNotes.beliefStatement,
      why: groupTopOfMindNotes.why,
      createdAt: groupTopOfMindNotes.createdAt,
      role: groupTopOfMindNoteSignals.role,
      reason: groupTopOfMindNoteSignals.reason,
    })
    .from(groupTopOfMindNoteSignals)
    .innerJoin(
      groupTopOfMindNotes,
      eq(groupTopOfMindNoteSignals.groupTopOfMindNoteId, groupTopOfMindNotes.id),
    )
    .innerJoin(groups, eq(groupTopOfMindNotes.groupId, groups.id))
    .innerJoin(
      groupMembers,
      and(
        eq(groupMembers.groupId, groups.id),
        eq(groupMembers.userId, input.userId),
      ),
    )
    .where(
      and(
        eq(groupTopOfMindNoteSignals.signalId, input.signalId),
        // Only what each room reads *now*. Retired readings belong to the
        // room's timeline, which is where the founder chose to show how a
        // reading changed rather than stacking every past one here.
        eq(groupTopOfMindNotes.lifecycleStatus, "active"),
      ),
    )
    .orderBy(asc(groupTopOfMindNotes.createdAt), asc(groupTopOfMindNotes.id));

  if (citations.length === 0) return [];

  const noteIds = citations.map((row) => row.noteId);
  const neighborRows = await db
    .select({
      noteId: groupTopOfMindNoteSignals.groupTopOfMindNoteId,
      signalId: groupTopOfMindNoteSignals.signalId,
      sortOrder: groupTopOfMindNoteSignals.sortOrder,
      text: signals.text,
      ownerUserId: groupTopOfMindNoteSignals.ownerUserId,
      ownerName: users.name,
      ownerAvatarUrl: users.avatarUrl,
    })
    .from(groupTopOfMindNoteSignals)
    .innerJoin(signals, eq(groupTopOfMindNoteSignals.signalId, signals.id))
    .innerJoin(users, eq(groupTopOfMindNoteSignals.ownerUserId, users.id))
    // The same two guards the wall applies to evidence, for the same reasons.
    //
    // The membership join used to be redundant here, because leaving a room
    // deleted your evidence rows outright. Keeping those rows so the room's
    // timeline can render the era a departed member belonged to means this
    // surface would otherwise start showing an ex-member's saves to everyone
    // still in the room — visible here and nowhere else.
    .innerJoin(
      groupTopOfMindNotes,
      eq(groupTopOfMindNoteSignals.groupTopOfMindNoteId, groupTopOfMindNotes.id),
    )
    .innerJoin(
      groupMembers,
      and(
        eq(groupMembers.groupId, groupTopOfMindNotes.groupId),
        eq(groupMembers.userId, groupTopOfMindNoteSignals.ownerUserId),
      ),
    )
    .where(
      and(
        inArray(groupTopOfMindNoteSignals.groupTopOfMindNoteId, noteIds),
        // A save its owner has since made private stops being the room's to
        // show, even though the note that cited it still stands.
        eq(signals.sharedToGroups, true),
      ),
    )
    .orderBy(
      asc(groupTopOfMindNoteSignals.sortOrder),
      asc(groupTopOfMindNoteSignals.id),
    );

  const neighborsByNote = new Map<string, SignalReadingNeighbor[]>();
  for (const row of neighborRows) {
    if (row.signalId === input.signalId) continue;
    const list = neighborsByNote.get(row.noteId) ?? [];
    list.push({
      signalId: row.signalId,
      textPreview: truncatePreview(row.text),
      ownerUserId: row.ownerUserId,
      ownerName: row.ownerName,
      ownerAvatarUrl: row.ownerAvatarUrl,
      isMine: row.ownerUserId === input.userId,
    });
    neighborsByNote.set(row.noteId, list);
  }

  return citations.map((row) => ({
    context: {
      scope: "group" as const,
      groupId: row.groupId,
      groupName: row.groupName,
    },
    note: {
      id: row.noteId,
      title: row.title,
      kind: row.kind,
      beliefStatement: row.beliefStatement,
      why: row.why,
      createdAt: row.createdAt.toISOString(),
    },
    myRole: { role: row.role, reason: row.reason },
    neighbors: neighborsByNote.get(row.noteId) ?? [],
  }));
}
