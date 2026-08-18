/**
 * Who is in a room, and how they got there.
 *
 * Every group-scoped handler in `groups.ts` starts by calling
 * {@link loadGroupMembership}, so this file holds the answer to "may I?" for
 * the whole module. The rest of it is the small number of ways that answer
 * changes: creating a room, joining one by code, leaving, being removed, and
 * the join code itself.
 *
 * The join code is the part worth reading twice. It is a bearer credential —
 * anyone holding it can walk in — which is why removal rotates it and leaving
 * does not, and why the rotation lives next to the removal rather than in a
 * handler that could forget to call it.
 *
 * These loaders take an already-authorized group id. They are exported so
 * tests can reach them, but they are not a second authorization layer: the
 * gate in the handler is the one that decides.
 */

import { randomBytes } from "node:crypto";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import {
  groupMembers,
  groups,
  groupTopOfMindAffirmations,
  groupTopOfMindProposals,
  profiles,
  type GroupMemberRole,
} from "../db/index.js";
import { getDb } from "../lib/db.js";
import { labelMembersByProfileId } from "../lib/member-labels.js";

type WakaDb = ReturnType<typeof getDb>;

/** No ambiguous 0/O/1/I — the code is read aloud and typed by hand. */
const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const JOIN_CODE_LENGTH = 8;
const MAX_JOIN_CODE_ATTEMPTS = 6;

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
  /** Human or agent. A room reads completely differently depending on the
      company it keeps, and the client cannot tell without this. */
  type: "human" | "agent";
  role: GroupMemberRole;
  joinedAt: string;
}

export interface GroupMembership {
  groupId: string;
  profileId: string;
  role: GroupMemberRole;
}

export type JoinGroupResult =
  | { ok: true; group: GroupSummary; alreadyMember: boolean }
  | { ok: false; reason: "not_found" };

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
  /**
   * AND THE DOOR IS RE-KEYED.
   *
   * Deleting the membership row ended the person's access to exactly nothing:
   * the invite link carries a join code, the code does not expire, and
   * `joinGroupByCode` asks only whether the code matches. Anyone removed who
   * had ever seen the link — or a screenshot of it, or the message it arrived
   * in — could walk back in immediately, and the group would have no way to
   * tell that from a normal join.
   *
   * Removal is the one exit that means "not you, not again", so it is the one
   * that rotates. Leaving does not: that is voluntary, the person may be asked
   * back, and re-keying on every departure would invalidate the link in
   * everyone else's hands for no security gain.
   *
   * A rotation failure must not resurrect the membership, so it is deliberately
   * not fatal — the row is already gone, which is the part that matters, and
   * the owner can rotate again from the panel. Failing the whole request here
   * would leave a caller believing the removal did not happen.
   */
  await rotateJoinCode(db, input.groupId);
  /**
   * AND THEIR VOTES GO WITH THEM — OUT OF THIS ROOM, AND NO FURTHER.
   *
   * The tally already ignores a non-member, so this delete is not what makes
   * the count right; it is what stops re-joining from silently restoring a
   * vote nobody cast again.
   *
   * The predicate is the whole story. `group_top_of_mind_affirmations` has no
   * `group_id` column — its only scoping is `proposal_id` — so a delete keyed
   * on the profile alone does not mean "their votes here", it means "their
   * votes anywhere". Removing someone from a room you own reached into every
   * other room they are in: rooms you are not a member of, cannot read, and
   * that were never named in the request. The agreements there simply stopped
   * existing, which stalls whatever was resting on them and leaves nothing to
   * tell it apart from "they never voted". So the scope has to come from the
   * proposals, which are the only rows in this graph that know which room they
   * belong to.
   *
   * A subquery rather than "read the proposal ids, then delete where in
   * them": two statements would let a proposal opened between them keep an
   * affirmation the removal was supposed to take, and would rebuild an empty
   * list into a delete with no proposal predicate at all if the read came back
   * empty. One statement cannot drift from itself.
   */
  await db
    .delete(groupTopOfMindAffirmations)
    .where(
      and(
        eq(groupTopOfMindAffirmations.profileId, input.memberProfileId),
        inArray(
          groupTopOfMindAffirmations.proposalId,
          db
            .select({ id: groupTopOfMindProposals.id })
            .from(groupTopOfMindProposals)
            .where(eq(groupTopOfMindProposals.groupId, input.groupId)),
        ),
      ),
    );
  return true;
}

/**
 * Give a group a fresh join code, retrying on the unique collision the same
 * way `createGroup` does — the alphabet is small enough that a clash is rare
 * but not impossible, and a clash must not be mistaken for a real failure.
 */
export async function rotateJoinCode(db: WakaDb, groupId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const joinCode = generateJoinCode();
    try {
      const [updated] = await db
        .update(groups)
        .set({ joinCode })
        .where(eq(groups.id, groupId))
        .returning({ joinCode: groups.joinCode });
      return updated?.joinCode ?? null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/join_code/i.test(message) && !/unique/i.test(message)) throw err;
    }
  }
  return null;
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
      type: profiles.type,
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
      type: row.type,
      initials: label?.initials ?? "?",
      role: row.role,
      joinedAt: row.joinedAt.toISOString(),
    };
  });
}
