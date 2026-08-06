/**
 * Group Top of Mind (US-052 boards + US-053 synthesis).
 *
 * Group creation/membership plus reading the group board. The board itself is
 * genuinely synthesized from the POOL of all members' *shared* inspirations by
 * `group-top-of-mind-synthesis.ts` (embeddings → cross-member candidate pool →
 * model judge → persisted group notes). This module reads those persisted notes
 * and serializes them with per-evidence owner tags; private inspirations are
 * excluded at the query layer so they never surface.
 */

import { randomBytes } from "node:crypto";

import { and, asc, desc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";

import {
  groupMemberEvents,
  groupMembers,
  groups,
  groupTopOfMindNoteSignals,
  groupTopOfMindNotes,
  signals,
  users,
} from "../db/index.js";
import { getDb } from "./db.js";
import type { WakaDb } from "./inspiration-embeddings.js";
import type { SupportedLocale } from "./locales.js";
import { dedupeTopOfMindNotes } from "./top-of-mind-dedupe.js";
import { topOfMindNoteFromWowMoment } from "./top-of-mind-notes.js";
import {
  generateGroupTopOfMind,
  type GroupSynthesisResult,
} from "./group-top-of-mind-synthesis.js";
import { scoreReadingDivergencesForGroup } from "./reading-divergence.js";
import type {
  TopOfMindEvidencePreview,
  TopOfMindNoteSurface,
  TopOfMindRelatedSignalReference,
} from "../routes/top-of-mind.js";

const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I
const JOIN_CODE_LENGTH = 8;
const MAX_JOIN_CODE_ATTEMPTS = 6;
const PREVIEW_LENGTH = 180;

/**
 * How long a synthesis attempt suppresses the next one.
 *
 * Synthesis is a bounded run of sequential model calls, and "produced nothing"
 * is a normal, repeatable outcome rather than a failure to retry: a group whose
 * members' collections genuinely do not combine will return nothing every time,
 * and a solo group cannot produce a note at all. Without a cooldown that group
 * pays for a full pass on every board open, forever.
 */
const SYNTHESIS_COOLDOWN_MS = 15 * 60 * 1000;

/**
 * How long a *failed* attempt suppresses the next one.
 *
 * A run that completed and produced nothing is a real answer, and asking again
 * in a minute will produce the same one — that earns the full cooldown. A run
 * that threw answered nothing at all, usually because the model provider was
 * briefly unavailable, and holding a board hostage for fifteen minutes over a
 * blip is the wrong trade. Short enough to recover from, long enough that a
 * persistent outage is not hammered.
 */
const SYNTHESIS_FAILURE_RETRY_MS = 60 * 1000;

export interface GroupSummary {
  id: string;
  name: string;
  role: string;
  joinCode: string;
  memberCount: number;
  createdAt: string;
}

export interface GroupMemberSummary {
  userId: string;
  name: string;
  role: string;
}

/** Evidence inspiration on a group note, tagged with the member who saved it. */
export type GroupEvidencePreview = TopOfMindEvidencePreview & {
  authorUserId: string;
  authorName: string;
};

export type GroupRelatedSignalReference = TopOfMindRelatedSignalReference & {
  authorUserId: string;
  authorName: string;
};

export type GroupTopOfMindNote = Omit<
  TopOfMindNoteSurface,
  "evidencePreviews" | "relatedSignals"
> & {
  evidencePreviews: GroupEvidencePreview[];
  relatedSignals: GroupRelatedSignalReference[];
  /** The member whose inspiration seeded this note (first evidence owner). */
  authorUserId: string;
  authorName: string;
};

export interface GroupTopOfMindResult {
  group: GroupSummary;
  members: GroupMemberSummary[];
  notes: GroupTopOfMindNote[];
}

/**
 * A refresh, plus whether it actually ran.
 *
 * Pressing refresh and receiving the same board back is ambiguous: it can mean
 * "we looked and found nothing new" or "we declined to look". Those deserve
 * different words on screen, so the caller is told which happened rather than
 * being left to infer it from an unchanged list.
 */
export interface GroupTopOfMindRefreshResult extends GroupTopOfMindResult {
  /** False when the cooldown declined this run and nothing was regenerated. */
  refreshed: boolean;
  /** ISO timestamp the next run becomes possible, or null if it can run now. */
  nextEligibleAt: string | null;
}

function generateJoinCode(): string {
  const bytes = randomBytes(JOIN_CODE_LENGTH);
  let code = "";
  for (let i = 0; i < JOIN_CODE_LENGTH; i += 1) {
    code += JOIN_CODE_ALPHABET[bytes[i]! % JOIN_CODE_ALPHABET.length];
  }
  return code;
}

async function countMembersByGroup(
  db: WakaDb,
  groupIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (groupIds.length === 0) return counts;
  const rows = await db
    .select({
      groupId: groupMembers.groupId,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(groupMembers)
    .where(inArray(groupMembers.groupId, groupIds))
    .groupBy(groupMembers.groupId);
  for (const row of rows) counts.set(row.groupId, Number(row.count));
  return counts;
}

/** Groups the user belongs to, newest first, with member counts. */
export async function listGroupsForUser(
  db: WakaDb,
  userId: string,
): Promise<GroupSummary[]> {
  const rows = await db
    .select({
      id: groups.id,
      name: groups.name,
      joinCode: groups.joinCode,
      role: groupMembers.role,
      createdAt: groups.createdAt,
    })
    .from(groupMembers)
    .innerJoin(groups, eq(groupMembers.groupId, groups.id))
    .where(eq(groupMembers.userId, userId))
    .orderBy(desc(groups.createdAt));

  const counts = await countMembersByGroup(
    db,
    rows.map((row) => row.id),
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    role: row.role,
    joinCode: row.joinCode,
    memberCount: counts.get(row.id) ?? 1,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** Create a group; the caller becomes its owner. */
export async function createGroupForUser(
  db: WakaDb,
  input: { userId: string; name: string },
): Promise<GroupSummary> {
  const now = new Date();
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_JOIN_CODE_ATTEMPTS; attempt += 1) {
    const joinCode = generateJoinCode();
    try {
      const group = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(groups)
          .values({
            ownerUserId: input.userId,
            name: input.name,
            joinCode,
            createdAt: now,
            updatedAt: now,
          })
          .returning({
            id: groups.id,
            name: groups.name,
            joinCode: groups.joinCode,
            createdAt: groups.createdAt,
          });
        if (!created) throw new Error("Failed to create group");

        await tx.insert(groupMembers).values({
          groupId: created.id,
          userId: input.userId,
          role: "owner",
          createdAt: now,
        });
        // The room's first hinge: it began when its first heart arrived.
        await tx.insert(groupMemberEvents).values({
          groupId: created.id,
          userId: input.userId,
          event: "joined",
          at: now,
        });
        return created;
      });

      return {
        id: group.id,
        name: group.name,
        role: "owner",
        joinCode: group.joinCode,
        memberCount: 1,
        createdAt: group.createdAt.toISOString(),
      };
    } catch (err) {
      // Retry only on join-code uniqueness collisions; rethrow anything else.
      const message = err instanceof Error ? err.message : String(err);
      if (!/join_code/i.test(message) && !/unique/i.test(message)) throw err;
      lastError = err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Could not allocate a unique join code");
}

export type JoinGroupResult =
  | { ok: true; group: GroupSummary; alreadyMember: boolean }
  | { ok: false; reason: "not_found" };

/** Join a group by its shareable code. Idempotent for existing members. */
export async function joinGroupByCode(
  db: WakaDb,
  input: { userId: string; joinCode: string },
): Promise<JoinGroupResult> {
  const normalized = input.joinCode.trim().toUpperCase();
  const [group] = await db
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.joinCode, normalized))
    .limit(1);
  if (!group) return { ok: false, reason: "not_found" };

  const [existing] = await db
    .select({ id: groupMembers.id })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, group.id),
        eq(groupMembers.userId, input.userId),
      ),
    )
    .limit(1);

  if (!existing) {
    const joinedAt = new Date();
    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(groupMembers)
        .values({
          groupId: group.id,
          userId: input.userId,
          role: "member",
          createdAt: joinedAt,
        })
        .onConflictDoNothing()
        .returning({ id: groupMembers.id });
      // Only record the hinge if this call is the one that made it. A
      // concurrent join takes the conflict path and must not write a second
      // arrival for the same person at the same moment.
      if (inserted.length > 0) {
        await tx.insert(groupMemberEvents).values({
          groupId: group.id,
          userId: input.userId,
          event: "joined",
          at: joinedAt,
        });
      }
    });
  }

  const summaries = await listGroupsForUser(db, input.userId);
  const summary = summaries.find((s) => s.id === group.id);
  // The membership can vanish between the insert and this read (a concurrent
  // leave, a deleted group). Previously a `!` asserted that away and handed the
  // route `group: undefined` with a 200 attached; say not-found instead.
  if (!summary) return { ok: false, reason: "not_found" };
  return { ok: true, group: summary, alreadyMember: Boolean(existing) };
}

export type DeleteGroupResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_owner" };

/**
 * Delete a group outright. Owner only.
 *
 * Deleting is not a bigger version of leaving: leaving removes you, deleting
 * removes a board other people are still reading, along with every note the
 * group's collections produced together. So it belongs to the one person who
 * created it, and members get {@link leaveGroup} instead.
 *
 * `groups.owner_user_id` is the authority rather than the `owner` role on the
 * membership row — the role describes a seat at the table, the column names who
 * the table belongs to, and only the second survives an owner leaving.
 *
 * Everything below the group goes with it via ON DELETE CASCADE: memberships,
 * the group's Top of Mind notes, and each note's evidence rows. Members' own
 * signals are untouched; a group note only ever referenced them.
 */
export async function deleteGroup(
  db: WakaDb,
  input: { userId: string; groupId: string },
): Promise<DeleteGroupResult> {
  const owner = await assertGroupOwner(db, input);
  if (!owner.ok) return owner as DeleteGroupResult;

  await db.delete(groups).where(eq(groups.id, input.groupId));
  return { ok: true };
}

/**
 * Which readings stop being the room's when one member leaves?
 *
 * A group reading must span two members, so one that no longer does stops
 * being one. Split out from the SQL around it because it is the decision —
 * everything else is fetching rows and writing a status.
 */
export function retiredNoteIdsAfterDeparture(
  activeNoteIds: string[],
  remainingOwnerCountByNote: Map<string, number>,
): string[] {
  return activeNoteIds.filter((id) => (remainingOwnerCountByNote.get(id) ?? 0) < 2);
}

/**
 * Take a departing member's readings off the wall — without unmaking them.
 *
 * Leaving stops future contribution, not past fact. A reading this member's
 * signals helped make still happened, and the room's timeline has to be able
 * to show the era it belonged to, faces intact. So the evidence rows stay and
 * the note is *retired*: it leaves the present tense, not the record.
 *
 * Which readings retire is unchanged — a group reading must span two members,
 * so one that no longer does stops being one. It is computed against the
 * departing member rather than by deleting their rows first, because the rows
 * are now the thing we are keeping.
 */
async function pruneMemberFromBoard(
  tx: Parameters<Parameters<WakaDb["transaction"]>[0]>[0],
  input: { userId: string; groupId: string },
): Promise<void> {
  const noteIds = (
    await tx
      .select({ id: groupTopOfMindNotes.id })
      .from(groupTopOfMindNotes)
      .where(
        and(
          eq(groupTopOfMindNotes.groupId, input.groupId),
          eq(groupTopOfMindNotes.lifecycleStatus, "active"),
        ),
      )
  ).map((row) => row.id);
  if (noteIds.length === 0) return;

  const remaining = await tx
    .select({
      noteId: groupTopOfMindNoteSignals.groupTopOfMindNoteId,
      owners: sql<number>`cast(count(distinct ${groupTopOfMindNoteSignals.ownerUserId}) as int)`,
    })
    .from(groupTopOfMindNoteSignals)
    .where(
      and(
        inArray(groupTopOfMindNoteSignals.groupTopOfMindNoteId, noteIds),
        // Count the owners who are still here, without removing the one who
        // is not: the departing member's evidence rows are kept for the
        // timeline, so they must be excluded from the count instead.
        ne(groupTopOfMindNoteSignals.ownerUserId, input.userId),
      ),
    )
    .groupBy(groupTopOfMindNoteSignals.groupTopOfMindNoteId);

  const retired = retiredNoteIdsAfterDeparture(
    noteIds,
    new Map(remaining.map((row) => [row.noteId, Number(row.owners)])),
  );
  if (retired.length > 0) {
    await tx
      .update(groupTopOfMindNotes)
      .set({ lifecycleStatus: "replaced", replacedAt: new Date() })
      .where(inArray(groupTopOfMindNotes.id, retired));
  }
}

export async function leaveGroup(
  db: WakaDb,
  input: { userId: string; groupId: string },
): Promise<{ ok: boolean }> {
  return db.transaction(async (tx) => {
    const deleted = await tx
      .delete(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, input.groupId),
          eq(groupMembers.userId, input.userId),
        ),
      )
      .returning({ id: groupMembers.id });
    if (deleted.length === 0) return { ok: false };
    await tx.insert(groupMemberEvents).values({
      groupId: input.groupId,
      userId: input.userId,
      event: "left",
    });
    await pruneMemberFromBoard(tx, input);
    return { ok: true };
  });
}

export type GroupOwnerActionResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_owner" | "invalid" };

/**
 * Is this caller the group's owner?
 *
 * Returns the same shape the owner-only mutations report, so each of them can
 * start with one line and they cannot drift apart on what "not found" means: a
 * non-member never learns whether an id names a real room, while a member who
 * simply is not the owner gets the real reason.
 */
async function assertGroupOwner(
  db: WakaDb,
  input: { userId: string; groupId: string },
): Promise<GroupOwnerActionResult> {
  const [group] = await db
    .select({ ownerUserId: groups.ownerUserId })
    .from(groups)
    .where(eq(groups.id, input.groupId))
    .limit(1);
  if (!group) return { ok: false, reason: "not_found" };
  if (group.ownerUserId === input.userId) return { ok: true };

  const [membership] = await db
    .select({ id: groupMembers.id })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, input.groupId),
        eq(groupMembers.userId, input.userId),
      ),
    )
    .limit(1);
  return { ok: false, reason: membership ? "not_owner" : "not_found" };
}

/** Rename a room. Owner only. */
export async function renameGroup(
  db: WakaDb,
  input: { userId: string; groupId: string; name: string },
): Promise<GroupOwnerActionResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, reason: "invalid" };

  const owner = await assertGroupOwner(db, input);
  if (!owner.ok) return owner;

  await db
    .update(groups)
    .set({ name, updatedAt: new Date() })
    .where(eq(groups.id, input.groupId));
  return { ok: true };
}

/**
 * Remove someone else from a room. Owner only.
 *
 * The owner cannot remove themselves: that is either leaving or deleting, and
 * both already exist. Allowing it here would produce a room whose
 * `owner_user_id` names a non-member, which nothing downstream expects.
 *
 * The removed member's contributions come off the board with them, exactly as
 * if they had left — the board should not record who chose.
 */
export async function removeGroupMember(
  db: WakaDb,
  input: { userId: string; groupId: string; memberUserId: string },
): Promise<GroupOwnerActionResult> {
  if (input.memberUserId === input.userId) return { ok: false, reason: "invalid" };

  const owner = await assertGroupOwner(db, input);
  if (!owner.ok) return owner;

  return db.transaction(async (tx) => {
    const removed = await tx
      .delete(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, input.groupId),
          eq(groupMembers.userId, input.memberUserId),
        ),
      )
      .returning({ id: groupMembers.id });
    if (removed.length === 0) return { ok: false, reason: "not_found" } as const;

    // `removed`, not `left` — the timeline should not put someone's own
    // words in their mouth.
    await tx.insert(groupMemberEvents).values({
      groupId: input.groupId,
      userId: input.memberUserId,
      event: "removed",
    });

    await pruneMemberFromBoard(tx, {
      userId: input.memberUserId,
      groupId: input.groupId,
    });
    return { ok: true } as const;
  });
}

export async function loadGroupWithMembers(
  db: WakaDb,
  input: { userId: string; groupId: string },
): Promise<{ group: GroupSummary; members: GroupMemberSummary[] } | null> {
  // One round-trip, not a roster read followed by a group read. This helper is
  // on every room surface (board, ambition and timeline), so the old two-query
  // shape multiplied remote-database latency before any useful data rendered.
  const rows = await db
    .select({
      userId: groupMembers.userId,
      role: groupMembers.role,
      name: users.name,
      groupId: groups.id,
      groupName: groups.name,
      joinCode: groups.joinCode,
      groupCreatedAt: groups.createdAt,
    })
    .from(groups)
    .innerJoin(groupMembers, eq(groupMembers.groupId, groups.id))
    .innerJoin(users, eq(groupMembers.userId, users.id))
    .where(eq(groups.id, input.groupId));

  const me = rows.find((row) => row.userId === input.userId);
  if (!me) return null; // not a member → caller must treat as 404/403

  return {
    group: {
      id: me.groupId,
      name: me.groupName,
      role: me.role,
      joinCode: me.joinCode,
      memberCount: rows.length,
      createdAt: me.groupCreatedAt.toISOString(),
    },
    members: rows.map((row) => ({
      userId: row.userId,
      name: row.name,
      role: row.role,
    })),
  };
}

/**
 * Exported so the timeline truncates identically.
 *
 * A past board that showed more of someone's save than today's board does
 * would make travelling backwards a way to read what the present withholds —
 * the read model had 240 characters against this 180 before it was caught.
 */
export function truncatePreview(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > PREVIEW_LENGTH
    ? `${normalized.slice(0, PREVIEW_LENGTH - 1)}…`
    : normalized;
}

interface GroupNoteRow {
  id: string;
  groupId: string;
  title: string;
  kind: TopOfMindNoteSurface["legacy"]["wowKind"];
  why: string;
  beliefStatement: string | null;
  reflectionQuestion: string | null;
  reflectionGuide: string | null;
  locale: string;
  wowScore: number;
  createdAt: Date;
  updatedAt: Date;
}

interface GroupEvidenceRow {
  /** The words that carried the reading, verified present in the save. */
  quote?: string | null;
  /** Whose words: the person's own, or the page they linked. */
  quoteSource?: string | null;
  noteId: string;
  signalId: string;
  ownerUserId: string;
  ownerName: string;
  role: string;
  reason: string;
  sortOrder: number;
  signalText: string;
  signalKind: string | null;
  signalCreatedAt: Date;
  signalWowScore: number;
  signalShared: boolean;
}

/** Build the board surface for one persisted group note with owner-tagged evidence. */
function serializeGroupNote(
  row: GroupNoteRow,
  evidence: GroupEvidenceRow[],
): GroupTopOfMindNote {
  // Serialize in the note's OWN generation locale, not the viewer's — otherwise
  // a note generated in English blanks its title for a Korean viewer (and vice
  // versa), which would filter it off the board entirely.
  const noteLocale = (row.locale || "en-US") as SupportedLocale;
  const base = topOfMindNoteFromWowMoment({
    moment: {
      id: row.id,
      userId: row.groupId, // group notes belong to the group, not a user
      title: row.title,
      kind: row.kind,
      why: row.why,
      beliefStatement: row.beliefStatement,
      reflectionQuestion: row.reflectionQuestion,
      reflectionGuide: row.reflectionGuide,
      wowScore: row.wowScore,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
    relatedSignalIds: evidence.map((e) => e.signalId),
    preferredLocale: noteLocale,
  });
  // Guarantee a visible title so a synthesized note is never filtered out for an
  // empty label.
  const title = base.title?.trim() ? base.title : row.title;
  const ambientSignal = base.ambientSignal?.trim() ? base.ambientSignal : title;

  const evidencePreviews: GroupEvidencePreview[] = evidence.map((e) => ({
    signalId: e.signalId,
    role: e.role,
    reason: e.reason,
    /**
     * The words that carried it, when the judge named them and they were
     * really there. Otherwise the opening of the save, which is only ever
     * whatever happened to be written first.
     */
    textPreview: e.quote ? truncatePreview(e.quote) : truncatePreview(e.signalText),
    quote: e.quote ?? null,
    quoteSource: (e.quoteSource as "own" | "enrichment" | null) ?? null,
    kind: e.signalKind,
    createdAt: e.signalCreatedAt.toISOString(),
    resonanceScore: e.signalWowScore,
    authorUserId: e.ownerUserId,
    authorName: e.ownerName,
  }));

  const relatedSignals: GroupRelatedSignalReference[] = evidence.map((e) => ({
    id: e.signalId,
    preview: truncatePreview(e.signalText),
    kind: e.signalKind,
    createdAt: e.signalCreatedAt.toISOString(),
    resonanceScore: e.signalWowScore,
    authorUserId: e.ownerUserId,
    authorName: e.ownerName,
  }));

  const primary = evidence[0];

  return {
    ...base,
    title,
    ambientSignal,
    isPinned: false,
    userFeedbackValue: null,
    evidencePreviews,
    relatedSignals,
    authorUserId: primary?.ownerUserId ?? "",
    authorName: primary?.ownerName ?? "",
  };
}

/** Read persisted group notes (with owner-tagged evidence), deduped and capped. */
async function readGroupNotes(
  db: WakaDb,
  groupId: string,
  limit: number,
  /**
   * Who is in the group right now. Passed in rather than re-queried: every
   * caller has just loaded the roster via `loadGroupWithMembers`, and this
   * function can be called three times in one request.
   */
  currentMemberIds: Set<string>,
): Promise<GroupTopOfMindNote[]> {
  const noteRows = await db
    .select({
      id: groupTopOfMindNotes.id,
      groupId: groupTopOfMindNotes.groupId,
      title: groupTopOfMindNotes.title,
      kind: groupTopOfMindNotes.kind,
      why: groupTopOfMindNotes.why,
      beliefStatement: groupTopOfMindNotes.beliefStatement,
      reflectionQuestion: groupTopOfMindNotes.reflectionQuestion,
      reflectionGuide: groupTopOfMindNotes.reflectionGuide,
      locale: groupTopOfMindNotes.locale,
      wowScore: groupTopOfMindNotes.wowScore,
      createdAt: groupTopOfMindNotes.createdAt,
      updatedAt: groupTopOfMindNotes.updatedAt,
    })
    .from(groupTopOfMindNotes)
    // The wall is the present tense. Retired readings stay in the table for
    // the room's timeline and are never shown as what the room reads now.
    .where(
      and(
        eq(groupTopOfMindNotes.groupId, groupId),
        eq(groupTopOfMindNotes.lifecycleStatus, "active"),
      ),
    )
    .orderBy(desc(groupTopOfMindNotes.wowScore), desc(groupTopOfMindNotes.createdAt))
    .limit(Math.max(limit * 3, limit + 10));

  if (noteRows.length === 0) return [];

  const evidenceRows = await db
    .select({
      noteId: groupTopOfMindNoteSignals.groupTopOfMindNoteId,
      signalId: groupTopOfMindNoteSignals.signalId,
      ownerUserId: groupTopOfMindNoteSignals.ownerUserId,
      ownerName: users.name,
      role: groupTopOfMindNoteSignals.role,
      reason: groupTopOfMindNoteSignals.reason,
      sortOrder: groupTopOfMindNoteSignals.sortOrder,
      signalText: signals.text,
      signalKind: signals.kind,
      signalCreatedAt: signals.createdAt,
      signalWowScore: signals.wowScore,
      signalShared: signals.sharedToGroups,
      quote: groupTopOfMindNoteSignals.quote,
      quoteSource: groupTopOfMindNoteSignals.quoteSource,
    })
    .from(groupTopOfMindNoteSignals)
    .innerJoin(signals, eq(groupTopOfMindNoteSignals.signalId, signals.id))
    .innerJoin(users, eq(groupTopOfMindNoteSignals.ownerUserId, users.id))
    .where(
      inArray(
        groupTopOfMindNoteSignals.groupTopOfMindNoteId,
        noteRows.map((n) => n.id),
      ),
    )
    .orderBy(asc(groupTopOfMindNoteSignals.sortOrder), asc(groupTopOfMindNoteSignals.createdAt));

  const evidenceByNote = new Map<string, GroupEvidenceRow[]>();
  for (const row of evidenceRows) {
    // Defense in depth: never surface an inspiration that has since gone private.
    if (!row.signalShared) continue;
    // Nor one whose author has left. `leaveGroup` clears these at the source;
    // this makes a missed cleanup a note that disappears rather than one that
    // keeps showing an ex-member's saves.
    if (!currentMemberIds.has(row.ownerUserId)) continue;
    const bucket = evidenceByNote.get(row.noteId) ?? [];
    bucket.push(row);
    evidenceByNote.set(row.noteId, bucket);
  }

  const serialized = noteRows
    .map((row) => serializeGroupNote(row, evidenceByNote.get(row.id) ?? []))
    // A note whose every inspiration went private drops off the board entirely.
    .filter((note) => note.evidencePreviews.length > 0)
    // Group boards only show SHARED notes: evidence must span >= 2 members.
    // (Defense in depth; generation already enforces this.)
    .filter(
      (note) => new Set(note.evidencePreviews.map((e) => e.authorUserId)).size >= 2,
    );

  return dedupeTopOfMindNotes(serialized).slice(0, limit);
}

/**
 * Take the right to run synthesis for this group, if it is free.
 *
 * A single conditional UPDATE, so two concurrent readers cannot both decide the
 * board is empty and both start a pass — the second one's WHERE no longer
 * matches and it gets `false`. Returns whether the caller may proceed.
 */
async function claimSynthesisRun(db: WakaDb, groupId: string): Promise<boolean> {
  const now = new Date();
  const hasNewSharedMaterial = sql<boolean>`exists (
    select 1
    from ${signals} as changed_signal
    inner join ${groupMembers} as changed_member
      on changed_member.user_id = changed_signal.user_id
    where changed_member.group_id = ${groups.id}
      and changed_signal.shared_to_groups = true
      and changed_signal.updated_at > ${groups.lastSynthesisAt}
  )`;
  const claimed = await db
    .update(groups)
    .set({ lastSynthesisAt: now })
    .where(
      and(
        eq(groups.id, groupId),
        or(
          isNull(groups.lastSynthesisAt),
          lt(groups.lastSynthesisAt, new Date(now.getTime() - SYNTHESIS_COOLDOWN_MS)),
          // A cooldown protects an unchanged room from repeated model calls;
          // it must not suppress the first read after somebody adds or edits
          // shared material. That made the explicit "read again" control look
          // broken for the exact fifteen minutes after a new member arrived.
          hasNewSharedMaterial,
        ),
      ),
    )
    .returning({ id: groups.id });
  return claimed.length > 0;
}

/**
 * Hand back most of a claim after the run threw.
 *
 * The claim is stamped before generating, so a failure would otherwise hold the
 * full cooldown having produced no answer — and because an explicit refresh
 * honours the same cooldown, that left a board with no way to recover from a
 * provider blip. Rewinds the stamp so the next attempt is allowed after
 * {@link SYNTHESIS_FAILURE_RETRY_MS} instead of the full window.
 */
async function releaseSynthesisClaim(db: WakaDb, groupId: string): Promise<void> {
  const retryAt = new Date(
    Date.now() - SYNTHESIS_COOLDOWN_MS + SYNTHESIS_FAILURE_RETRY_MS,
  );
  await db
    .update(groups)
    .set({ lastSynthesisAt: retryAt })
    .where(eq(groups.id, groupId));
}

/** When this group may next run synthesis, or null if it may run now. */
async function nextSynthesisEligibleAt(
  db: WakaDb,
  groupId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ lastSynthesisAt: groups.lastSynthesisAt })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  if (!row?.lastSynthesisAt) return null;
  const next = new Date(row.lastSynthesisAt.getTime() + SYNTHESIS_COOLDOWN_MS);
  return next.getTime() > Date.now() ? next.toISOString() : null;
}

/**
 * Best-effort divergence measurement after a synthesis run.
 *
 * Nothing user-facing reads these rows: the founder's call was that a save
 * should say which top of mind it led to in which room, not carry a separate
 * score about it. They remain because the ambition reader ranks a
 * combination's evidence by them — a signal that reads differently here than
 * alone is the strongest evidence that the reading is combination-only.
 *
 * The board never waits on a failed measurement and never fails because of one.
 */
async function measureReadingDivergences(db: WakaDb, groupId: string): Promise<void> {
  try {
    await scoreReadingDivergencesForGroup(db, { groupId });
  } catch (err) {
    console.warn("[group-top-of-mind] reading-divergence pass failed:", {
      groupId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * A group's Top of Mind: notes newly synthesized from the pool of all members'
 * shared inspirations (US-053), read from the persisted group tables.
 *
 * This is deliberately stored-only. Generation belongs to the durable room
 * reading job: a wall opening should be a database read, never a chain of model
 * calls whose worst case becomes the page's loading time.
 */
export async function listGroupTopOfMind(
  db: WakaDb,
  input: {
    userId: string;
    groupId: string;
    limit: number;
    preferredLocale?: SupportedLocale;
  },
): Promise<GroupTopOfMindResult | null> {
  const loaded = await loadGroupWithMembers(db, {
    userId: input.userId,
    groupId: input.groupId,
  });
  if (!loaded) return null;

  const { group, members } = loaded;
  const memberIds = new Set(members.map((member) => member.userId));

  const notes = await readGroupNotes(db, input.groupId, input.limit, memberIds);
  return { group, members, notes };
}

/**
 * Force a fresh synthesis pass for a group, then return the updated board.
 * Returns null when the caller is not a member.
 */
export async function refreshGroupTopOfMind(
  db: WakaDb,
  input: {
    userId: string;
    groupId: string;
    limit: number;
    preferredLocale?: SupportedLocale;
    /** A background pass stays bounded; legacy/manual callers retain the full default. */
    maxTriggers?: number;
  },
): Promise<GroupTopOfMindRefreshResult | null> {
  const loaded = await loadGroupWithMembers(db, {
    userId: input.userId,
    groupId: input.groupId,
  });
  if (!loaded) return null;
  const memberIds = new Set(loaded.members.map((member) => member.userId));

  // An explicit refresh still respects the cooldown: it is a member-triggered
  // run of model calls, and any member can press it as often as they like.
  // Declining is not a failure — but it is also not a refresh, so say so
  // rather than returning an unchanged board that looks like one.
  if (!(await claimSynthesisRun(db, input.groupId))) {
    const notes = await readGroupNotes(db, input.groupId, input.limit, memberIds);
    return {
      group: loaded.group,
      members: loaded.members,
      notes,
      refreshed: false,
      nextEligibleAt: await nextSynthesisEligibleAt(db, input.groupId),
    };
  }

  // Note the ids that exist BEFORE generating, then prune exactly those — but
  // only if the run actually produced something. If the model is unavailable
  // (0 created) we keep the existing board rather than emptying it.
  //
  // Identifying the previous generation by id rather than by "created before
  // this timestamp" matters twice over: `created_at` comes from the database
  // clock while the cutoff would come from the app's, so a lagging database
  // let a run delete its own fresh notes; and a concurrent refresh could
  // delete notes the other one had just written.
  const priorNoteIds = (
    await db
      .select({ id: groupTopOfMindNotes.id })
      .from(groupTopOfMindNotes)
      .where(
        and(
          eq(groupTopOfMindNotes.groupId, input.groupId),
          eq(groupTopOfMindNotes.lifecycleStatus, "active"),
        ),
      )
  ).map((row) => row.id);

  let result: GroupSynthesisResult;
  try {
    result = await generateGroupTopOfMind(db, {
      groupId: input.groupId,
      locale: input.preferredLocale,
      ...(input.maxTriggers === undefined ? {} : { maxTriggers: input.maxTriggers }),
    });
  } catch (err) {
    // Same reasoning as the read path: a throw is not an answer, so hand the
    // claim back rather than charging a full cooldown for it. The error still
    // propagates — an explicit refresh that failed should say so.
    await releaseSynthesisClaim(db, input.groupId).catch(() => {});
    throw err;
  }

  // Retire the previous generation — except the readings this pass reached
  // again. A note the run re-derived has been confirmed, not superseded, and
  // retiring it loses exactly what the group found most stable: the reading
  // arrives at the same idempotency key, is skipped as a duplicate, and was
  // then removed as a "prior". Refresh took the board from six notes to four
  // that way.
  //
  // Marked, never deleted. What the room used to read is the timeline, and it
  // is the one thing that cannot be reconstructed later.
  const stale = priorNoteIds.filter((id) => !result.reconfirmedNoteIds.includes(id));
  if (result.notesCreated > 0 && stale.length > 0) {
    // `result.passAt`, not a fresh clock reading: the new notes carry that
    // instant, so retiring the old ones at the same moment makes the handover
    // atomic in the timeline. Reading the clock here instead left a window —
    // 62 seconds on a real run — where the board appeared to hold both
    // generations at once, which no one ever saw.
    await db
      .update(groupTopOfMindNotes)
      .set({ lifecycleStatus: "replaced", replacedAt: result.passAt })
      .where(
        and(
          eq(groupTopOfMindNotes.groupId, input.groupId),
          inArray(groupTopOfMindNotes.id, stale),
        ),
      );
  }

  await measureReadingDivergences(db, input.groupId);

  const notes = await readGroupNotes(db, input.groupId, input.limit, memberIds);
  return {
    group: loaded.group,
    members: loaded.members,
    notes,
    refreshed: true,
    nextEligibleAt: await nextSynthesisEligibleAt(db, input.groupId),
  };
}
