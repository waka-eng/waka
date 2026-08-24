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
  groupMembershipEvents,
  groups,
  groupTopOfMindAffirmations,
  groupTopOfMindProposals,
  inspirations,
  profiles,
  type GroupMemberRole,
  type GroupMembershipEventKind,
} from "../db/index.js";
import { getDb } from "../lib/db.js";
import { labelMembersByProfileId } from "../lib/member-labels.js";
import { enqueueDeriveSignals } from "../lib/queue.js";
import { GROUP_JOIN_BACKFILL_LIMIT } from "../lib/signal-derivation-thresholds.js";

type WakaDb = ReturnType<typeof getDb>;
type WakaTx = Parameters<Parameters<WakaDb["transaction"]>[0]>[0];

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
 * THE DOOR KEEPS A LEDGER.
 *
 * The membership row is the current seat and nothing else — it is deleted on
 * leave and removal, and a re-join writes a fresh row with a fresh
 * `createdAt`. So every function below that changes who is in the room also
 * appends a membership event in the same transaction: the seat says who is
 * here, the events say how the room came to hold these people. Nothing in
 * application code ever updates or deletes an event row.
 */
async function recordMembershipEvent(
  db: WakaDb | WakaTx,
  input: { groupId: string; profileId: string; kind: GroupMembershipEventKind },
): Promise<void> {
  await db.insert(groupMembershipEvents).values({
    groupId: input.groupId,
    profileId: input.profileId,
    kind: input.kind,
  });
}

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
/**
 * THE GROUND A PERSON ARRIVES CARRYING.
 *
 * A room distils from its members' pooled public memories, and the fan-out
 * that feeds it fires when a memory is KEPT. On its own that means a room
 * only ever sees what its members keep after they join — so somebody who
 * joins with a full archive contributes nothing, possibly forever, and a room
 * of such people stays empty while every memory that would have converged
 * sits one table away. Joining has to reach back.
 *
 * One derivation pass per existing public memory, aimed at the room's mind,
 * newest first and capped by `GROUP_JOIN_BACKFILL_LIMIT`. Three properties
 * make this safe to fire and forget:
 *
 *   - IT IS THE JOINER'S SPEND. The jobs are owned by the joining profile, so
 *     the per-account model budget and the queue's fairness bill the person
 *     whose arrival asked for the work.
 *   - IT IS IDEMPOTENT. The idempotency key already carries the target mind,
 *     so re-joining a room, or a retry, collapses onto the jobs that exist
 *     rather than deriving the same memory twice.
 *   - IT NEVER FAILS THE JOIN. Being seated is the thing the person asked
 *     for; a queue insert that fails is a room that fills late, which is
 *     recoverable, while a 5xx on the join is a door that did not open.
 *
 * Visibility is read here and re-read by the worker: a memory turned private
 * between the two is refused there, which is what makes this bound to the
 * switch rather than to the moment somebody happened to arrive.
 */
export interface GroundBackfillDependencies {
  /**
   * How a memory is asked for. Seams here because `enqueueDeriveSignals`
   * writes through the process-wide database handle rather than the one this
   * function was handed, so a schema-isolated test cannot see what it wrote.
   * What is worth holding is WHICH memories a room is asked to read — whose,
   * how many, in what order — and that is this function's own work.
   */
  enqueueDerive?: typeof enqueueDeriveSignals;
}

async function backfillGroundIntoMind(
  db: WakaDb,
  input: { profileId: string; groupId: string },
  deps: GroundBackfillDependencies = {},
): Promise<void> {
  const enqueue = deps.enqueueDerive ?? enqueueDeriveSignals;
  const [mind] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.groupId, input.groupId), eq(profiles.type, "group")))
    .limit(1);
  if (!mind) return;

  /* HUMAN ONLY, joined rather than assumed. `docs/data-model.md` rule 5:
     membership is between people, and an agent's memory is its own stack, not
     ground a room may stand on. The join routes already refuse an agent a
     seat — but this is the second path by which a profile's memories reach a
     room, and a rule enforced only where somebody remembered to enforce it is
     the rule that put six agent-seated rows in the dev database. So the read
     carries the gate itself. */
  const ground = await db
    .select({ id: inspirations.id })
    .from(inspirations)
    .innerJoin(
      profiles,
      and(eq(profiles.id, inspirations.profileId), eq(profiles.type, "human")),
    )
    .where(
      and(
        eq(inspirations.profileId, input.profileId),
        eq(inspirations.visibility, "public"),
      ),
    )
    .orderBy(desc(inspirations.createdAt), desc(inspirations.id))
    .limit(GROUP_JOIN_BACKFILL_LIMIT);

  for (const memory of ground) {
    await enqueue(input.profileId, memory.id, "created", mind.id);
  }
}

/**
 * Ask for the backfill without ever letting it fail the seating.
 *
 * Awaited rather than fired and forgotten. The work is a bounded run of queue
 * inserts — no model call happens here, the drain does that later — so the
 * cost to the join is milliseconds, and in exchange the room's state after a
 * join is a fact rather than a race. An unawaited promise would also outlive
 * the request into whatever ran next, which in a test suite is the next
 * test's truncation.
 */
async function requestGroundBackfill(
  db: WakaDb,
  input: { profileId: string; groupId: string },
  deps: GroundBackfillDependencies = {},
): Promise<void> {
  try {
    await backfillGroundIntoMind(db, input, deps);
  } catch (err: unknown) {
    console.error("[groups] failed to backfill a member's ground into the room:", {
      groupId: input.groupId,
      profileId: input.profileId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function createGroupForProfile(
  db: WakaDb,
  input: { profileId: string; name: string },
  deps: GroundBackfillDependencies = {},
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
        await recordMembershipEvent(tx, {
          groupId: group.id,
          profileId: input.profileId,
          kind: "joined",
        });
        /* THE ROOM'S MIND, born with the room (2026-08-24). The profile that
           owns what this room distils from its pooled ground: no account --
           it is the room's, not anyone's -- and deleted by the room's own
           cascade. Same transaction as the group row, so no code path ever
           meets a room without one; migration 0025 settled the rooms that
           predate this line. */
        await tx.insert(profiles).values({
          accountId: null,
          type: "group",
          name: input.name,
          groupId: group.id,
        });
        return group;
      });

      /* The maker is the room's first member, and they arrive carrying the
         same ground anyone else would. */
      await requestGroundBackfill(db, { profileId: input.profileId, groupId: created.id }, deps);

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
  deps: GroundBackfillDependencies = {},
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
    await db.transaction(async (tx) => {
      // The conflict target tells a lost race from a real join: only the
      // insert that actually seated someone writes the arrival event, so a
      // double-submitted join is one arrival, not two.
      const seated = await tx
        .insert(groupMembers)
        .values({ groupId: group.id, profileId: input.profileId, role: "member" })
        .onConflictDoNothing()
        .returning({ id: groupMembers.id });
      if (seated.length > 0) {
        await recordMembershipEvent(tx, {
          groupId: group.id,
          profileId: input.profileId,
          kind: "joined",
        });
      }
    });
  }

  const summaries = await listGroupsForProfile(db, input.profileId);
  const summary = summaries.find((candidate) => candidate.id === group.id);
  // The membership can vanish between the insert and this read — a concurrent
  // removal, a deleted group. Say not-found rather than answering 200 with an
  // undefined group attached.
  if (!summary) return { ok: false, reason: "not_found" };
  /* Only for a genuine arrival: re-submitting a join is not a second arrival,
     and the enqueue is idempotent anyway, but asking for nothing is cheaper
     than asking for a hundred jobs the queue will collapse. */
  if (!existing) {
    await requestGroundBackfill(db, { profileId: input.profileId, groupId: group.id }, deps);
  }
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
  return db.transaction(async (tx) => {
    const deleted = await tx
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
    await recordMembershipEvent(tx, {
      groupId: input.groupId,
      profileId: input.profileId,
      kind: "left",
    });
    if (removed.role === "owner") await promoteSuccessorOwner(tx, input.groupId);
    return { ok: true };
  });
}

async function promoteSuccessorOwner(db: WakaDb | WakaTx, groupId: string): Promise<void> {
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
  const didRemove = await db.transaction(async (tx) => {
    const removed = await tx
      .delete(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, input.groupId),
          eq(groupMembers.profileId, input.memberProfileId),
        ),
      )
      .returning({ id: groupMembers.id, role: groupMembers.role });
    if (removed.length === 0) return false;
    await recordMembershipEvent(tx, {
      groupId: input.groupId,
      profileId: input.memberProfileId,
      kind: "removed",
    });
    if (removed[0]!.role === "owner") await promoteSuccessorOwner(tx, input.groupId);
    /**
     * AND THEIR VOTES GO WITH THEM — FROM THE PROPOSALS STILL BEING DECIDED,
     * AND NO OTHERS.
     *
     * The tally already ignores a non-member, so this delete is not what makes
     * the count right; it is what stops re-joining from silently restoring a
     * vote nobody cast again. Only an OPEN proposal can still be carried, so
     * only open proposals need that protection — which is why the subquery
     * carries `status = 'open'`.
     *
     * It did not always. This delete used to take every affirmation the
     * member had ever made in the room, settled proposals included — which
     * destroyed the record of WHO carried each accepted version. That record
     * is the room's approval history: the surface that shows who stood behind
     * a version reads from these rows, and an accepted proposal's affirmations
     * are facts about a decision already made, which a later removal has no
     * business unmaking. A removed member's vote on a settled proposal is
     * history; their vote on an open one is a live hand in a decision they no
     * longer belong to.
     *
     * The scoping lesson stands from the previous wording: the affirmations
     * table has no `group_id` column, so the room scope must come through the
     * proposals — a delete keyed on the profile alone would reach into every
     * other room they are in. And it stays one statement with a subquery
     * rather than read-then-delete: two statements would let a proposal opened
     * between them keep an affirmation this removal was supposed to take.
     */
    await tx
      .delete(groupTopOfMindAffirmations)
      .where(
        and(
          eq(groupTopOfMindAffirmations.profileId, input.memberProfileId),
          inArray(
            groupTopOfMindAffirmations.proposalId,
            tx
              .select({ id: groupTopOfMindProposals.id })
              .from(groupTopOfMindProposals)
              .where(
                and(
                  eq(groupTopOfMindProposals.groupId, input.groupId),
                  eq(groupTopOfMindProposals.status, "open"),
                ),
              ),
          ),
        ),
      );
    return true;
  });
  if (!didRemove) return false;
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

  /* A room's mind is not a member of the room — it IS the room's layer 2.
     `group_members` never holds one, so this filter is a type-level
     restatement of that fact rather than a behavior change. */
  const seated = rows.flatMap((row) =>
    row.type === "group" ? [] : [{ ...row, type: row.type }],
  );
  const labels = labelMembersByProfileId(seated);
  return seated.map((row) => {
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
