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

import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import {
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

/**
 * Trigger budget for synthesis kicked off by a *read*.
 *
 * A read has someone waiting on it, so it gets a small budget — enough to fill
 * an empty board on first open without turning a GET into a request that
 * outlives its own timeout. An explicit refresh, where the wait is the point,
 * gets the full budget.
 */
const READ_PATH_MAX_TRIGGERS = 6;

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
    await db
      .insert(groupMembers)
      .values({
        groupId: group.id,
        userId: input.userId,
        role: "member",
        createdAt: new Date(),
      })
      .onConflictDoNothing();
  }

  const summaries = await listGroupsForUser(db, input.userId);
  const summary = summaries.find((s) => s.id === group.id);
  // The membership can vanish between the insert and this read (a concurrent
  // leave, a deleted group). Previously a `!` asserted that away and handed the
  // route `group: undefined` with a 200 attached; say not-found instead.
  if (!summary) return { ok: false, reason: "not_found" };
  return { ok: true, group: summary, alreadyMember: Boolean(existing) };
}

/**
 * Remove the caller from a group, and their contributions with them. Owners
 * leaving does not delete the group.
 *
 * Leaving previously deleted only the membership row, which left previews of
 * the departing member's signals — and their name — on the board indefinitely.
 * Taking their evidence out can strand a note below the two-member bar that
 * justified it existing, so those notes go too: a note that now rests on one
 * person's signals is that person's, not the group's.
 */
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

    const noteIds = (
      await tx
        .select({ id: groupTopOfMindNotes.id })
        .from(groupTopOfMindNotes)
        .where(eq(groupTopOfMindNotes.groupId, input.groupId))
    ).map((row) => row.id);
    if (noteIds.length === 0) return { ok: true };

    await tx
      .delete(groupTopOfMindNoteSignals)
      .where(
        and(
          inArray(groupTopOfMindNoteSignals.groupTopOfMindNoteId, noteIds),
          eq(groupTopOfMindNoteSignals.ownerUserId, input.userId),
        ),
      );

    const survivors = await tx
      .select({
        noteId: groupTopOfMindNoteSignals.groupTopOfMindNoteId,
        owners: sql<number>`cast(count(distinct ${groupTopOfMindNoteSignals.ownerUserId}) as int)`,
      })
      .from(groupTopOfMindNoteSignals)
      .where(inArray(groupTopOfMindNoteSignals.groupTopOfMindNoteId, noteIds))
      .groupBy(groupTopOfMindNoteSignals.groupTopOfMindNoteId);

    const stillShared = new Set(
      survivors.filter((row) => Number(row.owners) >= 2).map((row) => row.noteId),
    );
    const orphaned = noteIds.filter((id) => !stillShared.has(id));
    if (orphaned.length > 0) {
      await tx
        .delete(groupTopOfMindNotes)
        .where(inArray(groupTopOfMindNotes.id, orphaned));
    }
    return { ok: true };
  });
}

async function loadGroupWithMembers(
  db: WakaDb,
  input: { userId: string; groupId: string },
): Promise<{ group: GroupSummary; members: GroupMemberSummary[] } | null> {
  const memberRows = await db
    .select({
      userId: groupMembers.userId,
      role: groupMembers.role,
      name: users.name,
    })
    .from(groupMembers)
    .innerJoin(users, eq(groupMembers.userId, users.id))
    .where(eq(groupMembers.groupId, input.groupId));

  const me = memberRows.find((row) => row.userId === input.userId);
  if (!me) return null; // not a member → caller must treat as 404/403

  const [group] = await db
    .select({
      id: groups.id,
      name: groups.name,
      joinCode: groups.joinCode,
      createdAt: groups.createdAt,
    })
    .from(groups)
    .where(eq(groups.id, input.groupId))
    .limit(1);
  if (!group) return null;

  return {
    group: {
      id: group.id,
      name: group.name,
      role: me.role,
      joinCode: group.joinCode,
      memberCount: memberRows.length,
      createdAt: group.createdAt.toISOString(),
    },
    members: memberRows.map((row) => ({
      userId: row.userId,
      name: row.name,
      role: row.role,
    })),
  };
}

function truncatePreview(value: string): string {
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
    textPreview: truncatePreview(e.signalText),
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
    .where(eq(groupTopOfMindNotes.groupId, groupId))
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
  const claimed = await db
    .update(groups)
    .set({ lastSynthesisAt: now })
    .where(
      and(
        eq(groups.id, groupId),
        or(
          isNull(groups.lastSynthesisAt),
          lt(groups.lastSynthesisAt, new Date(now.getTime() - SYNTHESIS_COOLDOWN_MS)),
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
 * A group's Top of Mind: notes newly synthesized from the pool of all members'
 * shared inspirations (US-053), read from the persisted group tables. When the
 * board is empty, best-effort synthesis runs first so the board fills without a
 * manual step. Returns null when the caller is not a member.
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

  let notes = await readGroupNotes(db, input.groupId, input.limit, memberIds);

  // Best-effort first fill, on a cooldown and a small trigger budget.
  //
  // An empty board is not evidence that synthesis has not been tried: a group
  // whose collections do not combine returns nothing every time, so without the
  // cooldown every open of that board pays for a fresh pass. `claimSynthesisRun`
  // is a conditional UPDATE, so concurrent readers cannot both start one.
  if (notes.length === 0 && (await claimSynthesisRun(db, input.groupId))) {
    try {
      await generateGroupTopOfMind(db, {
        groupId: input.groupId,
        locale: input.preferredLocale,
        maxTriggers: READ_PATH_MAX_TRIGGERS,
      });
      notes = await readGroupNotes(db, input.groupId, input.limit, memberIds);
    } catch (err) {
      // Give the claim back. A throw is not an answer, and holding the full
      // cooldown over one would leave the board stuck for fifteen minutes.
      await releaseSynthesisClaim(db, input.groupId).catch(() => {});
      console.warn("[group-top-of-mind] best-effort synthesis failed:", {
        groupId: input.groupId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

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
      .where(eq(groupTopOfMindNotes.groupId, input.groupId))
  ).map((row) => row.id);

  let result: GroupSynthesisResult;
  try {
    result = await generateGroupTopOfMind(db, {
      groupId: input.groupId,
      locale: input.preferredLocale,
    });
  } catch (err) {
    // Same reasoning as the read path: a throw is not an answer, so hand the
    // claim back rather than charging a full cooldown for it. The error still
    // propagates — an explicit refresh that failed should say so.
    await releaseSynthesisClaim(db, input.groupId).catch(() => {});
    throw err;
  }

  if (result.notesCreated > 0 && priorNoteIds.length > 0) {
    await db
      .delete(groupTopOfMindNotes)
      .where(
        and(
          eq(groupTopOfMindNotes.groupId, input.groupId),
          inArray(groupTopOfMindNotes.id, priorNoteIds),
        ),
      );
  }

  const notes = await readGroupNotes(db, input.groupId, input.limit, memberIds);
  return {
    group: loaded.group,
    members: loaded.members,
    notes,
    refreshed: true,
    nextEligibleAt: await nextSynthesisEligibleAt(db, input.groupId),
  };
}
