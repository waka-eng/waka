/**
 * `/api/groups` — groups, their wall of shared signals, and the top of mind
 * they co-edit.
 *
 * A group is where layer 2 crosses between people. Members share **signals**
 * to it; the group's single top-of-mind artifact is generated from those
 * shared statements; members change that artifact together through proposals
 * and affirmations. Nothing from layer 1 is reachable here — an inspiration
 * never crosses an account boundary, so no query in this module touches the
 * `inspirations` or `signal_evidence` tables at all.
 *
 * Two authorization rules run in front of everything:
 *
 *   1. **Human profiles only.** Membership is between people; an agent
 *      profile's memory is its own stack, not a seat at someone's table. The
 *      gate is one middleware so no handler can forget it, and it answers 403
 *      because the caller is authenticated and the refusal is about who they
 *      are, not about what exists.
 *   2. **Membership first.** Every group-scoped handler resolves the caller's
 *      membership before reading anything, and a non-member gets 404 rather
 *      than 403 — "you may not see this group" would confirm the id names a
 *      real one. Owner-only actions answer 403 to a member who is simply not
 *      the owner, who already knows the group exists.
 *
 * The loaders below take an already-authorized group id. They are exported so
 * the worker and tests can reach them, but they are not a second authorization
 * layer: the gate in the handler is the one that decides.
 */

import { randomBytes } from "node:crypto";

import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import {
  backgroundJobs,
  groupMembers,
  groupProposalKindValues,
  groupProposalStatusValues,
  groups,
  groupTopOfMindAffirmations,
  groupTopOfMindProposals,
  profiles,
  signalShares,
  signals,
  topOfMindEntries,
  topOfMindEntrySignals,
  topOfMinds,
  type GroupMemberRole,
  type GroupProposalKind,
  type GroupProposalStatus,
  type RefreshGroupTopOfMindPayload,
  type TopOfMindEntryType,
  type TopOfMindRevisionReason,
  type TopOfMindStatus,
} from "../db/index.js";
import { getDb } from "../lib/db.js";
import { labelMembersByProfileId } from "../lib/member-labels.js";
import { requireAuth, type AuthEnv } from "../lib/middleware.js";
import { enqueueGroupTopOfMindRefresh as enqueueGroupRefreshJob } from "../lib/queue.js";

type WakaDb = ReturnType<typeof getDb>;

/** No ambiguous 0/O/1/I — the code is read aloud and typed by hand. */
const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const JOIN_CODE_LENGTH = 8;
const MAX_JOIN_CODE_ATTEMPTS = 6;
const DEFAULT_PROPOSAL_LIMIT = 50;
const MAX_PROPOSAL_LIMIT = 100;
const MAX_WALL_SIGNALS = 200;
const DEFAULT_MAX_JOB_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

const createGroupSchema = z
  .object({ name: z.string().trim().min(1, "Group name is required").max(120) })
  .strict();

const renameGroupSchema = z
  .object({ name: z.string().trim().min(1, "Group name is required").max(120) })
  .strict();

const joinGroupSchema = z
  .object({ joinCode: z.string().trim().min(4, "Join code is required").max(64) })
  .strict();

const groupParamsSchema = z.object({ groupId: z.string().uuid() }).strict();

const memberParamsSchema = z
  .object({ groupId: z.string().uuid(), memberProfileId: z.string().uuid() })
  .strict();

const proposalParamsSchema = z
  .object({ groupId: z.string().uuid(), proposalId: z.string().uuid() })
  .strict();

const createProposalSchema = z
  .object({
    kind: z.enum(groupProposalKindValues),
    entryId: z.string().uuid().optional(),
    body: z.string().trim().min(1).max(2000).optional(),
    rationale: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();

const listProposalsQuerySchema = z
  .object({
    status: z.enum(groupProposalStatusValues).optional(),
    limit: z
      .string()
      .regex(/^\d+$/, "limit must be an integer")
      .transform((value) => Number.parseInt(value, 10))
      .pipe(z.number().int().min(1).max(MAX_PROPOSAL_LIMIT))
      .optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export interface GroupSummary {
  id: string;
  name: string;
  joinCode: string;
  role: GroupMemberRole;
  memberCount: number;
  createdAt: string;
}

export interface GroupMemberSummary {
  profileId: string;
  name: string;
  initials: string;
  role: GroupMemberRole;
  joinedAt: string;
}

/**
 * One shared signal on a group's wall.
 *
 * The distilled statement and who it belongs to — nothing else. There is
 * deliberately no field here for what the statement was derived from.
 */
export interface GroupWallSignal {
  signalId: string;
  statement: string;
  confidence: number;
  ownerProfileId: string;
  ownerName: string;
  sharedAt: string;
}

export interface GroupTopOfMindEntryView {
  id: string;
  type: TopOfMindEntryType;
  body: string;
  belief: string | null;
  prompt: string | null;
  lockedAt: string | null;
  pinnedAt: string | null;
  sortOrder: number;
  createdAt: string;
  /** Which members' shared signals fed this entry. */
  contributors: Array<{ profileId: string; name: string }>;
}

export interface GroupTopOfMindView {
  topOfMind: {
    id: string;
    version: number;
    status: TopOfMindStatus;
    reason: TopOfMindRevisionReason;
    createdAt: string;
  } | null;
  entries: GroupTopOfMindEntryView[];
}

export interface GroupProposalView {
  id: string;
  kind: GroupProposalKind;
  status: GroupProposalStatus;
  entryId: string | null;
  body: string | null;
  rationale: string | null;
  proposedByProfileId: string;
  proposedByName: string;
  affirmations: Array<{ profileId: string; name: string; createdAt: string }>;
  viewerAffirmed: boolean;
  resolvedAt: string | null;
  createdAt: string;
}

export interface GroupMembership {
  groupId: string;
  profileId: string;
  role: GroupMemberRole;
}

export type JoinGroupResult =
  | { ok: true; group: GroupSummary; alreadyMember: boolean }
  | { ok: false; reason: "not_found" };

export type CreateProposalResult =
  | { ok: true; proposal: GroupProposalView }
  | { ok: false; reason: "entry_not_found" | "invalid" };

export type ResolveProposalResult =
  | { ok: true; proposal: GroupProposalView; accepted: boolean }
  | { ok: false; reason: "not_found" | "already_resolved" };

// ---------------------------------------------------------------------------
// Membership and group records
// ---------------------------------------------------------------------------

/**
 * The caller's seat at this group, or null if they have none.
 *
 * Every group-scoped handler starts here, so the answer to "may I?" and the
 * answer to "am I the owner?" come from one row rather than from two queries
 * that could disagree.
 */
export async function loadGroupMembership(
  db: WakaDb,
  input: { groupId: string; profileId: string },
): Promise<GroupMembership | null> {
  const [row] = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, input.groupId),
        eq(groupMembers.profileId, input.profileId),
      ),
    )
    .limit(1);
  if (!row) return null;
  return { groupId: input.groupId, profileId: input.profileId, role: row.role };
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

/** The groups this profile belongs to, newest first. */
export async function listGroupsForProfile(
  db: WakaDb,
  profileId: string,
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
    .where(eq(groupMembers.profileId, profileId))
    .orderBy(desc(groups.createdAt));

  const counts = await countMembersByGroup(
    db,
    rows.map((row) => row.id),
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    joinCode: row.joinCode,
    role: row.role,
    memberCount: counts.get(row.id) ?? 1,
    createdAt: row.createdAt.toISOString(),
  }));
}

function generateJoinCode(): string {
  const bytes = randomBytes(JOIN_CODE_LENGTH);
  let code = "";
  for (let i = 0; i < JOIN_CODE_LENGTH; i += 1) {
    code += JOIN_CODE_ALPHABET[bytes[i]! % JOIN_CODE_ALPHABET.length];
  }
  return code;
}

/** Create a group; the caller takes the owner seat. */
export async function createGroupForProfile(
  db: WakaDb,
  input: { profileId: string; name: string },
): Promise<GroupSummary> {
  const now = new Date();
  let lastError: unknown;

  // A join code is eight random characters, so collisions are rare and
  // uniqueness is a database constraint rather than a hope. Retry the draw a
  // few times instead of failing a creation on a coin flip.
  for (let attempt = 0; attempt < MAX_JOIN_CODE_ATTEMPTS; attempt += 1) {
    const joinCode = generateJoinCode();
    try {
      const created = await db.transaction(async (tx) => {
        const [group] = await tx
          .insert(groups)
          .values({
            name: input.name,
            joinCode,
            createdByProfileId: input.profileId,
            createdAt: now,
            updatedAt: now,
          })
          .returning({
            id: groups.id,
            name: groups.name,
            joinCode: groups.joinCode,
            createdAt: groups.createdAt,
          });
        if (!group) throw new Error("Failed to create group");

        await tx.insert(groupMembers).values({
          groupId: group.id,
          profileId: input.profileId,
          role: "owner",
          createdAt: now,
        });
        return group;
      });

      return {
        id: created.id,
        name: created.name,
        joinCode: created.joinCode,
        role: "owner",
        memberCount: 1,
        createdAt: created.createdAt.toISOString(),
      };
    } catch (err) {
      // Retry only on the join-code collision; anything else is a real failure
      // and redrawing a code would not fix it.
      const message = err instanceof Error ? err.message : String(err);
      if (!/join_code/i.test(message) && !/unique/i.test(message)) throw err;
      lastError = err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Could not allocate a unique join code");
}

/** Join by shareable code. Idempotent for someone who is already in. */
export async function joinGroupByCode(
  db: WakaDb,
  input: { profileId: string; joinCode: string },
): Promise<JoinGroupResult> {
  const normalized = input.joinCode.trim().toUpperCase();
  const [group] = await db
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.joinCode, normalized))
    .limit(1);
  if (!group) return { ok: false, reason: "not_found" };

  const existing = await loadGroupMembership(db, {
    groupId: group.id,
    profileId: input.profileId,
  });
  if (!existing) {
    await db
      .insert(groupMembers)
      .values({ groupId: group.id, profileId: input.profileId, role: "member" })
      .onConflictDoNothing();
  }

  const summaries = await listGroupsForProfile(db, input.profileId);
  const summary = summaries.find((candidate) => candidate.id === group.id);
  // The membership can vanish between the insert and this read — a concurrent
  // removal, a deleted group. Say not-found rather than answering 200 with an
  // undefined group attached.
  if (!summary) return { ok: false, reason: "not_found" };
  return { ok: true, group: summary, alreadyMember: Boolean(existing) };
}

/**
 * Leave a group.
 *
 * When the last owner walks out, the longest-standing remaining member takes
 * the seat: ownership is a role on a membership row, so a group whose only
 * owner left would otherwise have nobody who could rename or close it.
 */
export async function leaveGroup(
  db: WakaDb,
  input: { profileId: string; groupId: string },
): Promise<{ ok: boolean }> {
  const deleted = await db
    .delete(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, input.groupId),
        eq(groupMembers.profileId, input.profileId),
      ),
    )
    .returning({ id: groupMembers.id, role: groupMembers.role });
  const removed = deleted[0];
  if (!removed) return { ok: false };
  if (removed.role === "owner") await promoteSuccessorOwner(db, input.groupId);
  return { ok: true };
}

async function promoteSuccessorOwner(db: WakaDb, groupId: string): Promise<void> {
  const [remainingOwner] = await db
    .select({ id: groupMembers.id })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.role, "owner")))
    .limit(1);
  if (remainingOwner) return;

  const [successor] = await db
    .select({ id: groupMembers.id })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId))
    .orderBy(asc(groupMembers.createdAt), asc(groupMembers.id))
    .limit(1);
  if (!successor) return;

  await db
    .update(groupMembers)
    .set({ role: "owner" })
    .where(eq(groupMembers.id, successor.id));
}

/**
 * Delete a group outright.
 *
 * Deleting is not a bigger version of leaving: it takes down a wall other
 * people are still reading, and the top of mind they built on it. Members get
 * {@link leaveGroup} instead. Everything below the group goes with it by
 * cascade — memberships, shares, the artifact and its entries — while each
 * member's own signals are untouched, because a share only ever pointed at
 * them.
 */
export async function deleteGroup(db: WakaDb, groupId: string): Promise<void> {
  await db.delete(groups).where(eq(groups.id, groupId));
}

export async function renameGroup(
  db: WakaDb,
  input: { groupId: string; name: string },
): Promise<GroupSummary | null> {
  const [row] = await db
    .update(groups)
    .set({ name: input.name, updatedAt: new Date() })
    .where(eq(groups.id, input.groupId))
    .returning({
      id: groups.id,
      name: groups.name,
      joinCode: groups.joinCode,
      createdAt: groups.createdAt,
    });
  if (!row) return null;

  const counts = await countMembersByGroup(db, [row.id]);
  return {
    id: row.id,
    name: row.name,
    joinCode: row.joinCode,
    role: "owner",
    memberCount: counts.get(row.id) ?? 1,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Remove someone else. Returns false when they were not in the group. */
export async function removeGroupMember(
  db: WakaDb,
  input: { groupId: string; memberProfileId: string },
): Promise<boolean> {
  const removed = await db
    .delete(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, input.groupId),
        eq(groupMembers.profileId, input.memberProfileId),
      ),
    )
    .returning({ id: groupMembers.id, role: groupMembers.role });
  if (removed.length === 0) return false;
  if (removed[0]!.role === "owner") await promoteSuccessorOwner(db, input.groupId);
  return true;
}

export async function listGroupMembers(
  db: WakaDb,
  groupId: string,
): Promise<GroupMemberSummary[]> {
  const rows = await db
    .select({
      profileId: groupMembers.profileId,
      role: groupMembers.role,
      name: profiles.name,
      joinedAt: groupMembers.createdAt,
    })
    .from(groupMembers)
    .innerJoin(profiles, eq(profiles.id, groupMembers.profileId))
    .where(eq(groupMembers.groupId, groupId))
    .orderBy(asc(groupMembers.createdAt), asc(groupMembers.profileId));

  const labels = labelMembersByProfileId(rows);
  return rows.map((row) => {
    const label = labels.get(row.profileId);
    return {
      profileId: row.profileId,
      name: label?.displayName ?? row.name,
      initials: label?.initials ?? "?",
      role: row.role,
      joinedAt: row.joinedAt.toISOString(),
    };
  });
}

// ---------------------------------------------------------------------------
// The wall
// ---------------------------------------------------------------------------

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
    confidence: row.confidence,
    ownerProfileId: row.ownerProfileId,
    ownerName: labels.get(row.ownerProfileId)?.displayName ?? row.ownerName,
    sharedAt: row.sharedAt.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// The group's top of mind
// ---------------------------------------------------------------------------

/**
 * The group's live artifact and its entries.
 *
 * Entries carry per-member attribution: `top_of_mind_entry_signals` records
 * whose signal fed each entry, which is what lets a group entry say "this came
 * from you and from her" without exposing either side's evidence. Dismissed
 * entries are left out — the group took them down; they stay in the record
 * rather than on the wall.
 */
export async function loadGroupTopOfMind(
  db: WakaDb,
  groupId: string,
): Promise<GroupTopOfMindView> {
  const [artifact] = await db
    .select({
      id: topOfMinds.id,
      version: topOfMinds.version,
      status: topOfMinds.status,
      reason: topOfMinds.reason,
      createdAt: topOfMinds.createdAt,
    })
    .from(topOfMinds)
    .where(and(eq(topOfMinds.groupId, groupId), eq(topOfMinds.status, "live")))
    .limit(1);
  if (!artifact) return { topOfMind: null, entries: [] };

  const entryRows = await db
    .select({
      id: topOfMindEntries.id,
      type: topOfMindEntries.type,
      body: topOfMindEntries.body,
      belief: topOfMindEntries.belief,
      prompt: topOfMindEntries.prompt,
      lockedAt: topOfMindEntries.lockedAt,
      pinnedAt: topOfMindEntries.pinnedAt,
      sortOrder: topOfMindEntries.sortOrder,
      createdAt: topOfMindEntries.createdAt,
    })
    .from(topOfMindEntries)
    .where(
      and(
        eq(topOfMindEntries.topOfMindId, artifact.id),
        isNull(topOfMindEntries.dismissedAt),
      ),
    )
    .orderBy(asc(topOfMindEntries.sortOrder), asc(topOfMindEntries.createdAt));

  const entryIds = entryRows.map((row) => row.id);
  const contributorsByEntry = new Map<string, Array<{ profileId: string; name: string }>>();
  if (entryIds.length > 0) {
    const citationRows = await db
      .selectDistinct({
        entryId: topOfMindEntrySignals.entryId,
        ownerProfileId: topOfMindEntrySignals.ownerProfileId,
        ownerName: profiles.name,
      })
      .from(topOfMindEntrySignals)
      .innerJoin(profiles, eq(profiles.id, topOfMindEntrySignals.ownerProfileId))
      .where(inArray(topOfMindEntrySignals.entryId, entryIds))
      .orderBy(asc(topOfMindEntrySignals.entryId));

    const labels = labelMembersByProfileId(
      citationRows.flatMap((row) =>
        row.ownerProfileId
          ? [{ profileId: row.ownerProfileId, name: row.ownerName }]
          : [],
      ),
    );
    for (const row of citationRows) {
      if (!row.ownerProfileId) continue;
      const list = contributorsByEntry.get(row.entryId) ?? [];
      list.push({
        profileId: row.ownerProfileId,
        name: labels.get(row.ownerProfileId)?.displayName ?? row.ownerName,
      });
      contributorsByEntry.set(row.entryId, list);
    }
  }

  return {
    topOfMind: {
      id: artifact.id,
      version: artifact.version,
      status: artifact.status,
      reason: artifact.reason,
      createdAt: artifact.createdAt.toISOString(),
    },
    entries: entryRows.map((row) => ({
      id: row.id,
      type: row.type,
      body: row.body,
      belief: row.belief,
      prompt: row.prompt,
      lockedAt: row.lockedAt?.toISOString() ?? null,
      pinnedAt: row.pinnedAt?.toISOString() ?? null,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt.toISOString(),
      contributors: contributorsByEntry.get(row.id) ?? [],
    })),
  };
}

export interface EnqueueGroupRefreshResult {
  jobId: string;
  /** True when a pass was already waiting and this request joined it. */
  alreadyQueued: boolean;
}

/**
 * Ask for one regeneration of the group's artifact.
 *
 * A pending or running pass is reused rather than duplicated: synthesis is a
 * model call over the same shared pool, so a second job for material that has
 * not changed buys an identical answer twice. The job is owned by a profile
 * that is still in the group — a membership change is often requested by the
 * person leaving, and a job owned by a non-member would be invisible to
 * everyone left behind.
 */
export async function enqueueGroupTopOfMindRefresh(
  db: WakaDb,
  input: {
    groupId: string;
    requestedByProfileId: string;
    reason: RefreshGroupTopOfMindPayload["reason"],
  },
): Promise<EnqueueGroupRefreshResult | null> {
  // Who owns the job is a group question — the requester may be on their way
  // out, and a job owned by a former member would be invisible to everyone
  // left behind. How it is queued is the queue's question, and lives there.
  const ownerProfileId = await resolveJobOwnerProfileId(db, input);
  if (!ownerProfileId) return null;

  const { jobId, created } = await enqueueGroupRefreshJob(
    ownerProfileId,
    input.groupId,
    input.reason,
  );
  return { jobId, alreadyQueued: !created };
}

async function resolveJobOwnerProfileId(
  db: WakaDb,
  input: { groupId: string; requestedByProfileId: string },
): Promise<string | null> {
  const membership = await loadGroupMembership(db, {
    groupId: input.groupId,
    profileId: input.requestedByProfileId,
  });
  if (membership) return input.requestedByProfileId;

  const [successor] = await db
    .select({ profileId: groupMembers.profileId })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, input.groupId))
    .orderBy(asc(groupMembers.createdAt), asc(groupMembers.profileId))
    .limit(1);
  return successor?.profileId ?? null;
}

// ---------------------------------------------------------------------------
// Co-editing: proposals and affirmations
// ---------------------------------------------------------------------------

interface ProposalRow {
  id: string;
  kind: GroupProposalKind;
  status: GroupProposalStatus;
  entryId: string | null;
  body: string | null;
  rationale: string | null;
  proposedByProfileId: string;
  proposedByName: string;
  resolvedAt: Date | null;
  createdAt: Date;
}

async function loadProposalViews(
  db: WakaDb,
  input: { rows: ProposalRow[]; viewerProfileId: string },
): Promise<GroupProposalView[]> {
  if (input.rows.length === 0) return [];

  const affirmationRows = await db
    .select({
      proposalId: groupTopOfMindAffirmations.proposalId,
      profileId: groupTopOfMindAffirmations.profileId,
      name: profiles.name,
      createdAt: groupTopOfMindAffirmations.createdAt,
    })
    .from(groupTopOfMindAffirmations)
    .innerJoin(profiles, eq(profiles.id, groupTopOfMindAffirmations.profileId))
    .where(
      inArray(
        groupTopOfMindAffirmations.proposalId,
        input.rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(groupTopOfMindAffirmations.createdAt));

  const labels = labelMembersByProfileId([
    ...affirmationRows.map((row) => ({ profileId: row.profileId, name: row.name })),
    ...input.rows.map((row) => ({
      profileId: row.proposedByProfileId,
      name: row.proposedByName,
    })),
  ]);

  const byProposal = new Map<string, GroupProposalView["affirmations"]>();
  for (const row of affirmationRows) {
    const list = byProposal.get(row.proposalId) ?? [];
    list.push({
      profileId: row.profileId,
      name: labels.get(row.profileId)?.displayName ?? row.name,
      createdAt: row.createdAt.toISOString(),
    });
    byProposal.set(row.proposalId, list);
  }

  return input.rows.map((row) => {
    const affirmations = byProposal.get(row.id) ?? [];
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      entryId: row.entryId,
      body: row.body,
      rationale: row.rationale,
      proposedByProfileId: row.proposedByProfileId,
      proposedByName:
        labels.get(row.proposedByProfileId)?.displayName ?? row.proposedByName,
      affirmations,
      viewerAffirmed: affirmations.some(
        (affirmation) => affirmation.profileId === input.viewerProfileId,
      ),
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

function selectProposalRows(db: WakaDb) {
  return db
    .select({
      id: groupTopOfMindProposals.id,
      kind: groupTopOfMindProposals.kind,
      status: groupTopOfMindProposals.status,
      entryId: groupTopOfMindProposals.entryId,
      body: groupTopOfMindProposals.body,
      rationale: groupTopOfMindProposals.rationale,
      proposedByProfileId: groupTopOfMindProposals.proposedByProfileId,
      proposedByName: profiles.name,
      resolvedAt: groupTopOfMindProposals.resolvedAt,
      createdAt: groupTopOfMindProposals.createdAt,
    })
    .from(groupTopOfMindProposals)
    .innerJoin(profiles, eq(profiles.id, groupTopOfMindProposals.proposedByProfileId));
}

export async function listGroupProposals(
  db: WakaDb,
  input: {
    groupId: string;
    viewerProfileId: string;
    status?: GroupProposalStatus;
    limit?: number;
  },
): Promise<GroupProposalView[]> {
  const filters = [eq(groupTopOfMindProposals.groupId, input.groupId)];
  if (input.status) filters.push(eq(groupTopOfMindProposals.status, input.status));

  const rows = await selectProposalRows(db)
    .where(and(...filters))
    .orderBy(desc(groupTopOfMindProposals.createdAt))
    .limit(input.limit ?? DEFAULT_PROPOSAL_LIMIT);

  return loadProposalViews(db, { rows, viewerProfileId: input.viewerProfileId });
}

async function loadProposalView(
  db: WakaDb,
  input: { proposalId: string; groupId: string; viewerProfileId: string },
): Promise<GroupProposalView | null> {
  const rows = await selectProposalRows(db)
    .where(
      and(
        eq(groupTopOfMindProposals.id, input.proposalId),
        eq(groupTopOfMindProposals.groupId, input.groupId),
      ),
    )
    .limit(1);
  const [view] = await loadProposalViews(db, {
    rows,
    viewerProfileId: input.viewerProfileId,
  });
  return view ?? null;
}

/**
 * Does the proposal's shape match its kind?
 *
 * Split out because it is the decision rather than the plumbing: an
 * `add_entry` with an entry id, or a `remove_entry` with a body, is a caller
 * that means something other than what it said, and guessing which half to
 * honour is how a wall ends up with an edit nobody proposed.
 */
export function proposalShapeIsValid(input: {
  kind: GroupProposalKind;
  entryId?: string;
  body?: string;
}): boolean {
  if (input.kind === "add_entry") return Boolean(input.body) && !input.entryId;
  if (input.kind === "edit_entry") return Boolean(input.body) && Boolean(input.entryId);
  return Boolean(input.entryId) && !input.body;
}

/**
 * Open a proposal against the group's artifact.
 *
 * The proposer's own affirmation is written with it: proposing a change is
 * agreeing with it, and counting it separately would only invite a proposal
 * that its author never backed.
 */
export async function createGroupProposal(
  db: WakaDb,
  input: {
    groupId: string;
    profileId: string;
    kind: GroupProposalKind;
    entryId?: string;
    body?: string;
    rationale?: string;
  },
): Promise<CreateProposalResult> {
  if (!proposalShapeIsValid(input)) return { ok: false, reason: "invalid" };

  if (input.entryId) {
    // An entry id from a caller is untrusted: without this, a member could
    // aim a proposal at an entry belonging to a group they are not in.
    const [entry] = await db
      .select({ id: topOfMindEntries.id })
      .from(topOfMindEntries)
      .innerJoin(topOfMinds, eq(topOfMinds.id, topOfMindEntries.topOfMindId))
      .where(
        and(
          eq(topOfMindEntries.id, input.entryId),
          eq(topOfMinds.groupId, input.groupId),
        ),
      )
      .limit(1);
    if (!entry) return { ok: false, reason: "entry_not_found" };
  }

  const [created] = await db
    .insert(groupTopOfMindProposals)
    .values({
      groupId: input.groupId,
      entryId: input.entryId ?? null,
      proposedByProfileId: input.profileId,
      kind: input.kind,
      body: input.body ?? null,
      rationale: input.rationale ?? null,
    })
    .returning({ id: groupTopOfMindProposals.id });
  if (!created) return { ok: false, reason: "invalid" };

  await db
    .insert(groupTopOfMindAffirmations)
    .values({ proposalId: created.id, profileId: input.profileId })
    .onConflictDoNothing();

  const view = await loadProposalView(db, {
    proposalId: created.id,
    groupId: input.groupId,
    viewerProfileId: input.profileId,
  });
  if (!view) return { ok: false, reason: "invalid" };
  return { ok: true, proposal: view };
}

/**
 * Back a proposal.
 *
 * Acceptance takes the proposer plus at least one other member: a change to
 * what a group says about itself is not something one person makes alone, and
 * requiring unanimity in a growing group would mean nothing ever passes.
 * An accepted proposal does not edit the artifact here — it asks for the next
 * version, which regeneration writes.
 */
export async function affirmGroupProposal(
  db: WakaDb,
  input: { groupId: string; proposalId: string; profileId: string },
): Promise<ResolveProposalResult> {
  const [proposal] = await db
    .select({
      id: groupTopOfMindProposals.id,
      status: groupTopOfMindProposals.status,
      proposedByProfileId: groupTopOfMindProposals.proposedByProfileId,
    })
    .from(groupTopOfMindProposals)
    .where(
      and(
        eq(groupTopOfMindProposals.id, input.proposalId),
        eq(groupTopOfMindProposals.groupId, input.groupId),
      ),
    )
    .limit(1);
  if (!proposal) return { ok: false, reason: "not_found" };
  if (proposal.status !== "open") return { ok: false, reason: "already_resolved" };

  await db
    .insert(groupTopOfMindAffirmations)
    .values({ proposalId: proposal.id, profileId: input.profileId })
    .onConflictDoNothing();

  const [seconded] = await db
    .select({ id: groupTopOfMindAffirmations.id })
    .from(groupTopOfMindAffirmations)
    .where(
      and(
        eq(groupTopOfMindAffirmations.proposalId, proposal.id),
        ne(groupTopOfMindAffirmations.profileId, proposal.proposedByProfileId),
      ),
    )
    .limit(1);

  if (seconded) {
    const now = new Date();
    await db
      .update(groupTopOfMindProposals)
      .set({ status: "accepted", resolvedAt: now, updatedAt: now })
      .where(eq(groupTopOfMindProposals.id, proposal.id));
  }

  const view = await loadProposalView(db, {
    proposalId: proposal.id,
    groupId: input.groupId,
    viewerProfileId: input.profileId,
  });
  if (!view) return { ok: false, reason: "not_found" };
  return { ok: true, proposal: view, accepted: Boolean(seconded) };
}

/**
 * Turn a proposal down.
 *
 * Any member can close an open proposal, including its author withdrawing it.
 * The mechanism is agreement: a change nobody will second is already dead, and
 * saying so plainly beats leaving it open forever as if it were still live.
 */
export async function declineGroupProposal(
  db: WakaDb,
  input: { groupId: string; proposalId: string; profileId: string },
): Promise<ResolveProposalResult> {
  const now = new Date();
  const declined = await db
    .update(groupTopOfMindProposals)
    .set({ status: "declined", resolvedAt: now, updatedAt: now })
    .where(
      and(
        eq(groupTopOfMindProposals.id, input.proposalId),
        eq(groupTopOfMindProposals.groupId, input.groupId),
        eq(groupTopOfMindProposals.status, "open"),
      ),
    )
    .returning({ id: groupTopOfMindProposals.id });

  if (declined.length === 0) {
    const [existing] = await db
      .select({ id: groupTopOfMindProposals.id })
      .from(groupTopOfMindProposals)
      .where(
        and(
          eq(groupTopOfMindProposals.id, input.proposalId),
          eq(groupTopOfMindProposals.groupId, input.groupId),
        ),
      )
      .limit(1);
    return { ok: false, reason: existing ? "already_resolved" : "not_found" };
  }

  const view = await loadProposalView(db, {
    proposalId: input.proposalId,
    groupId: input.groupId,
    viewerProfileId: input.profileId,
  });
  if (!view) return { ok: false, reason: "not_found" };
  return { ok: true, proposal: view, accepted: false };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * Groups are between people.
 *
 * An agent profile owns its own three-layer stack; it does not take a seat at
 * a human's table. Enforced once, in front of every handler, because the rule
 * is about the caller rather than about any particular group — and a rule
 * re-implemented per route is a rule that will be missing from one of them.
 */
export const humanProfilesOnly: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const session = c.get("session");
  if (session.profile.type !== "human") {
    return c.json({ error: "Groups are between people, not agent profiles" }, 403);
  }
  await next();
};

export interface GroupsRouteDependencies {
  getDatabase?: typeof getDb;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
  loadMembership?: typeof loadGroupMembership;
  listGroups?: typeof listGroupsForProfile;
  createGroup?: typeof createGroupForProfile;
  joinGroup?: typeof joinGroupByCode;
  leaveGroupFn?: typeof leaveGroup;
  deleteGroupFn?: typeof deleteGroup;
  renameGroupFn?: typeof renameGroup;
  removeMemberFn?: typeof removeGroupMember;
  listMembers?: typeof listGroupMembers;
  loadWall?: typeof loadGroupWall;
  loadTopOfMind?: typeof loadGroupTopOfMind;
  enqueueRefresh?: typeof enqueueGroupTopOfMindRefresh;
  listProposals?: typeof listGroupProposals;
  createProposal?: typeof createGroupProposal;
  affirmProposal?: typeof affirmGroupProposal;
  declineProposal?: typeof declineGroupProposal;
}

export function createGroupsRoutes(deps: GroupsRouteDependencies = {}): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;
  const loadMembership = deps.loadMembership ?? loadGroupMembership;
  const listGroups = deps.listGroups ?? listGroupsForProfile;
  const createGroup = deps.createGroup ?? createGroupForProfile;
  const joinGroup = deps.joinGroup ?? joinGroupByCode;
  const leaveGroupFn = deps.leaveGroupFn ?? leaveGroup;
  const deleteGroupFn = deps.deleteGroupFn ?? deleteGroup;
  const renameGroupFn = deps.renameGroupFn ?? renameGroup;
  const removeMemberFn = deps.removeMemberFn ?? removeGroupMember;
  const listMembers = deps.listMembers ?? listGroupMembers;
  const loadWall = deps.loadWall ?? loadGroupWall;
  const loadTopOfMind = deps.loadTopOfMind ?? loadGroupTopOfMind;
  const enqueueRefresh = deps.enqueueRefresh ?? enqueueGroupTopOfMindRefresh;
  const listProposals = deps.listProposals ?? listGroupProposals;
  const createProposal = deps.createProposal ?? createGroupProposal;
  const affirmProposal = deps.affirmProposal ?? affirmGroupProposal;
  const declineProposal = deps.declineProposal ?? declineGroupProposal;

  routes.use("*", deps.authMiddleware ?? requireAuth);
  routes.use("*", humanProfilesOnly);

  /** A membership change is new material for the group's next synthesis. */
  const requestRefresh = async (
    groupId: string,
    profileId: string,
    reason: RefreshGroupTopOfMindPayload["reason"],
  ): Promise<void> => {
    try {
      await enqueueRefresh(getDatabase(), {
        groupId,
        requestedByProfileId: profileId,
        reason,
      });
    } catch (err) {
      // A refresh that could not be queued must not fail the action that
      // caused it: the membership change already happened.
      console.warn("[groups] group top of mind refresh could not be queued", {
        groupId,
        reason,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const readJsonBody = async (c: {
    req: { json: () => Promise<unknown> };
  }): Promise<{ ok: true; value: unknown } | { ok: false }> => {
    try {
      return { ok: true, value: await c.req.json() };
    } catch {
      return { ok: false };
    }
  };

  // GET /api/groups — the groups the caller belongs to.
  routes.get("/", async (c) => {
    const session = c.get("session");
    const groupList = await listGroups(getDatabase(), session.profile.id);
    return c.json({ groups: groupList });
  });

  // POST /api/groups — create a group; the caller takes the owner seat.
  routes.post("/", async (c) => {
    const body = await readJsonBody(c);
    if (!body.ok) return c.json({ error: "Request body must be valid JSON" }, 400);
    const parsed = createGroupSchema.safeParse(body.value);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid group payload", details: parsed.error.flatten().fieldErrors },
        400,
      );
    }
    const session = c.get("session");
    const group = await createGroup(getDatabase(), {
      profileId: session.profile.id,
      name: parsed.data.name,
    });
    return c.json({ group }, 201);
  });

  // POST /api/groups/join — join by shareable code.
  routes.post("/join", async (c) => {
    const body = await readJsonBody(c);
    if (!body.ok) return c.json({ error: "Request body must be valid JSON" }, 400);
    const parsed = joinGroupSchema.safeParse(body.value);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid join payload", details: parsed.error.flatten().fieldErrors },
        400,
      );
    }
    const session = c.get("session");
    const result = await joinGroup(getDatabase(), {
      profileId: session.profile.id,
      joinCode: parsed.data.joinCode,
    });
    if (!result.ok) {
      return c.json({ error: "No group matches that join code" }, 404);
    }
    if (!result.alreadyMember) {
      await requestRefresh(result.group.id, session.profile.id, "membership_changed");
    }
    return c.json({ group: result.group, alreadyMember: result.alreadyMember });
  });

  // POST /api/groups/:groupId/leave
  routes.post("/:groupId/leave", async (c) => {
    const parsedParams = groupParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) return c.json({ error: "Invalid group id" }, 400);
    const session = c.get("session");
    const { groupId } = parsedParams.data;

    const result = await leaveGroupFn(getDatabase(), {
      profileId: session.profile.id,
      groupId,
    });
    if (!result.ok) return c.json({ error: "Group not found" }, 404);
    await requestRefresh(groupId, session.profile.id, "membership_changed");
    return c.json({ ok: true });
  });

  // DELETE /api/groups/:groupId — owner closes the group.
  routes.delete("/:groupId", async (c) => {
    const parsedParams = groupParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) return c.json({ error: "Invalid group id" }, 400);
    const session = c.get("session");
    const { groupId } = parsedParams.data;

    const membership = await loadMembership(getDatabase(), {
      groupId,
      profileId: session.profile.id,
    });
    if (!membership) return c.json({ error: "Group not found" }, 404);
    if (membership.role !== "owner") {
      return c.json({ error: "Only the group's owner can delete it" }, 403);
    }

    await deleteGroupFn(getDatabase(), groupId);
    return c.json({ ok: true });
  });

  // PATCH /api/groups/:groupId — rename. Owner only.
  routes.patch("/:groupId", async (c) => {
    const parsedParams = groupParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) return c.json({ error: "Invalid group id" }, 400);
    const body = await readJsonBody(c);
    if (!body.ok) return c.json({ error: "Request body must be valid JSON" }, 400);
    const parsed = renameGroupSchema.safeParse(body.value);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid group name", details: parsed.error.flatten().fieldErrors },
        400,
      );
    }
    const session = c.get("session");
    const { groupId } = parsedParams.data;

    const membership = await loadMembership(getDatabase(), {
      groupId,
      profileId: session.profile.id,
    });
    if (!membership) return c.json({ error: "Group not found" }, 404);
    if (membership.role !== "owner") {
      return c.json({ error: "Only the group's owner can rename it" }, 403);
    }

    const group = await renameGroupFn(getDatabase(), {
      groupId,
      name: parsed.data.name,
    });
    if (!group) return c.json({ error: "Group not found" }, 404);
    return c.json({ group });
  });

  // DELETE /api/groups/:groupId/members/:memberProfileId — owner removes someone.
  routes.delete("/:groupId/members/:memberProfileId", async (c) => {
    const parsedParams = memberParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) return c.json({ error: "Invalid group or member id" }, 400);
    const session = c.get("session");
    const { groupId, memberProfileId } = parsedParams.data;

    const membership = await loadMembership(getDatabase(), {
      groupId,
      profileId: session.profile.id,
    });
    if (!membership) return c.json({ error: "Group not found" }, 404);
    if (membership.role !== "owner") {
      return c.json({ error: "Only the group's owner can remove someone" }, 403);
    }
    // Removing yourself is either leaving or deleting, and both already exist.
    if (memberProfileId === session.profile.id) {
      return c.json({ error: "Leave the group instead of removing yourself" }, 400);
    }

    const removed = await removeMemberFn(getDatabase(), { groupId, memberProfileId });
    if (!removed) return c.json({ error: "That person is not in this group" }, 404);
    await requestRefresh(groupId, session.profile.id, "membership_changed");
    return c.json({ ok: true });
  });

  // GET /api/groups/:groupId/members
  routes.get("/:groupId/members", async (c) => {
    const parsedParams = groupParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) return c.json({ error: "Invalid group id" }, 400);
    const session = c.get("session");
    const { groupId } = parsedParams.data;

    const membership = await loadMembership(getDatabase(), {
      groupId,
      profileId: session.profile.id,
    });
    if (!membership) return c.json({ error: "Group not found" }, 404);

    const members = await listMembers(getDatabase(), groupId);
    return c.json({ members });
  });

  // GET /api/groups/:groupId/wall — members' shared signals.
  routes.get("/:groupId/wall", async (c) => {
    const parsedParams = groupParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) return c.json({ error: "Invalid group id" }, 400);
    const session = c.get("session");
    const { groupId } = parsedParams.data;

    const membership = await loadMembership(getDatabase(), {
      groupId,
      profileId: session.profile.id,
    });
    if (!membership) return c.json({ error: "Group not found" }, 404);

    const wall = await loadWall(getDatabase(), groupId);
    // Serialized field by field rather than spread: the wall is the boundary
    // between two people's memory, and a loader that one day selects a column
    // more must not be able to publish it by accident.
    return c.json({
      wall: wall.map((shared) => ({
        signalId: shared.signalId,
        statement: shared.statement,
        confidence: shared.confidence,
        ownerProfileId: shared.ownerProfileId,
        ownerName: shared.ownerName,
        sharedAt: shared.sharedAt,
      })),
    });
  });

  // GET /api/groups/:groupId/top-of-mind
  routes.get("/:groupId/top-of-mind", async (c) => {
    const parsedParams = groupParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) return c.json({ error: "Invalid group id" }, 400);
    const session = c.get("session");
    const { groupId } = parsedParams.data;

    const membership = await loadMembership(getDatabase(), {
      groupId,
      profileId: session.profile.id,
    });
    if (!membership) return c.json({ error: "Group not found" }, 404);

    const view = await loadTopOfMind(getDatabase(), groupId);
    // Serialized field by field for the same reason as the wall: this is a
    // read across an account boundary, and it must publish exactly the fields
    // it means to, not whatever a loader's select list grows into.
    return c.json({
      topOfMind: view.topOfMind
        ? {
            id: view.topOfMind.id,
            version: view.topOfMind.version,
            status: view.topOfMind.status,
            reason: view.topOfMind.reason,
            createdAt: view.topOfMind.createdAt,
          }
        : null,
      entries: view.entries.map((entry) => ({
        id: entry.id,
        type: entry.type,
        body: entry.body,
        belief: entry.belief,
        prompt: entry.prompt,
        lockedAt: entry.lockedAt,
        pinnedAt: entry.pinnedAt,
        sortOrder: entry.sortOrder,
        createdAt: entry.createdAt,
        contributors: entry.contributors.map((contributor) => ({
          profileId: contributor.profileId,
          name: contributor.name,
        })),
      })),
    });
  });

  // POST /api/groups/:groupId/top-of-mind/refresh — ask for the next version.
  routes.post("/:groupId/top-of-mind/refresh", async (c) => {
    const parsedParams = groupParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) return c.json({ error: "Invalid group id" }, 400);
    const session = c.get("session");
    const { groupId } = parsedParams.data;

    const membership = await loadMembership(getDatabase(), {
      groupId,
      profileId: session.profile.id,
    });
    if (!membership) return c.json({ error: "Group not found" }, 404);

    const queued = await enqueueRefresh(getDatabase(), {
      groupId,
      requestedByProfileId: session.profile.id,
      reason: "manual",
    });
    // 202 either way: synthesis is a model pass that finishes after this
    // response, and the caller's next read is what shows the result.
    return c.json(
      {
        queued: Boolean(queued),
        jobId: queued?.jobId ?? null,
        alreadyQueued: queued?.alreadyQueued ?? false,
      },
      202,
    );
  });

  // GET /api/groups/:groupId/proposals
  routes.get("/:groupId/proposals", async (c) => {
    const parsedParams = groupParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) return c.json({ error: "Invalid group id" }, 400);
    const parsedQuery = listProposalsQuerySchema.safeParse(c.req.query());
    if (!parsedQuery.success) {
      return c.json(
        { error: "Invalid query", details: parsedQuery.error.flatten().fieldErrors },
        400,
      );
    }
    const session = c.get("session");
    const { groupId } = parsedParams.data;

    const membership = await loadMembership(getDatabase(), {
      groupId,
      profileId: session.profile.id,
    });
    if (!membership) return c.json({ error: "Group not found" }, 404);

    const proposals = await listProposals(getDatabase(), {
      groupId,
      viewerProfileId: session.profile.id,
      ...(parsedQuery.data.status ? { status: parsedQuery.data.status } : {}),
      limit: parsedQuery.data.limit ?? DEFAULT_PROPOSAL_LIMIT,
    });
    return c.json({ proposals });
  });

  // POST /api/groups/:groupId/proposals
  routes.post("/:groupId/proposals", async (c) => {
    const parsedParams = groupParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) return c.json({ error: "Invalid group id" }, 400);
    const body = await readJsonBody(c);
    if (!body.ok) return c.json({ error: "Request body must be valid JSON" }, 400);
    const parsed = createProposalSchema.safeParse(body.value);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid proposal payload", details: parsed.error.flatten().fieldErrors },
        400,
      );
    }
    const session = c.get("session");
    const { groupId } = parsedParams.data;

    const membership = await loadMembership(getDatabase(), {
      groupId,
      profileId: session.profile.id,
    });
    if (!membership) return c.json({ error: "Group not found" }, 404);

    const result = await createProposal(getDatabase(), {
      groupId,
      profileId: session.profile.id,
      kind: parsed.data.kind,
      ...(parsed.data.entryId ? { entryId: parsed.data.entryId } : {}),
      ...(parsed.data.body ? { body: parsed.data.body } : {}),
      ...(parsed.data.rationale ? { rationale: parsed.data.rationale } : {}),
    });
    if (!result.ok) {
      return result.reason === "entry_not_found"
        ? c.json({ error: "That entry is not part of this group's top of mind" }, 404)
        : c.json({ error: "A proposal must match the shape of its kind" }, 400);
    }
    return c.json({ proposal: result.proposal }, 201);
  });

  // POST /api/groups/:groupId/proposals/:proposalId/affirm
  routes.post("/:groupId/proposals/:proposalId/affirm", async (c) => {
    const parsedParams = proposalParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) return c.json({ error: "Invalid group or proposal id" }, 400);
    const session = c.get("session");
    const { groupId, proposalId } = parsedParams.data;

    const membership = await loadMembership(getDatabase(), {
      groupId,
      profileId: session.profile.id,
    });
    if (!membership) return c.json({ error: "Group not found" }, 404);

    const result = await affirmProposal(getDatabase(), {
      groupId,
      proposalId,
      profileId: session.profile.id,
    });
    if (!result.ok) {
      return result.reason === "already_resolved"
        ? c.json({ error: "That proposal has already been settled" }, 409)
        : c.json({ error: "Proposal not found" }, 404);
    }
    if (result.accepted) {
      await requestRefresh(groupId, session.profile.id, "proposal_accepted");
    }
    return c.json({ proposal: result.proposal, accepted: result.accepted });
  });

  // POST /api/groups/:groupId/proposals/:proposalId/decline
  routes.post("/:groupId/proposals/:proposalId/decline", async (c) => {
    const parsedParams = proposalParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) return c.json({ error: "Invalid group or proposal id" }, 400);
    const session = c.get("session");
    const { groupId, proposalId } = parsedParams.data;

    const membership = await loadMembership(getDatabase(), {
      groupId,
      profileId: session.profile.id,
    });
    if (!membership) return c.json({ error: "Group not found" }, 404);

    const result = await declineProposal(getDatabase(), {
      groupId,
      proposalId,
      profileId: session.profile.id,
    });
    if (!result.ok) {
      return result.reason === "already_resolved"
        ? c.json({ error: "That proposal has already been settled" }, 409)
        : c.json({ error: "Proposal not found" }, 404);
    }
    return c.json({ proposal: result.proposal });
  });

  return routes;
}

export const groupsRoutes = createGroupsRoutes();
