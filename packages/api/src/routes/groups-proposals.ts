/**
 * How a room changes what it says about itself.
 *
 * A member opens a proposal, members affirm it, and a proposal that carries
 * asks for the next version of the artifact — it never edits the artifact
 * directly. Two rules in here have each been wrong in production and are
 * written out at the point they are enforced: {@link carriesMajority}, which
 * decides what "most of us" means, and the join onto current membership in
 * {@link affirmGroupProposal}, which decides who is still allowed to be
 * counted.
 */

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import {
  groupMembers,
  groupTopOfMindAffirmations,
  groupTopOfMindProposals,
  profiles,
  topOfMindEntries,
  topOfMinds,
  type GroupProposalKind,
  type GroupProposalStatus,
} from "../db/index.js";
import { getDb } from "../lib/db.js";
import { labelMembersByProfileId } from "../lib/member-labels.js";

type WakaDb = ReturnType<typeof getDb>;

export const DEFAULT_PROPOSAL_LIMIT = 50;

export const MAX_PROPOSAL_LIMIT = 100;

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

export type CreateProposalResult =
  | { ok: true; proposal: GroupProposalView }
  | { ok: false; reason: "entry_not_found" | "invalid" };

export type ResolveProposalResult =
  | { ok: true; proposal: GroupProposalView; accepted: boolean }
  | { ok: false; reason: "not_found" | "already_resolved" };

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
/**
 * DOES THE ROOM CARRY IT? Strictly more than half, so a tie does not pass, and
 * a room of one is carried by its only member — the honest reading of "most of
 * us" when us is one.
 *
 * Exported because it is the entire rule, and until it was, nothing could
 * execute it: every route test injects a mock affirmProposal, so "364 passed"
 * proved the route calls a function and said nothing about whether the
 * function was right.
 */
export function carriesMajority(affirmations: number, members: number): boolean {
  return members > 0 && affirmations * 2 > members;
}

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

  /* the rule itself lives beside its tests — see carriesMajority below */
  /**
   * A MAJORITY OF THE ROOM, NOT A SECOND.
   *
   * This used to accept on the existence of one affirmation that was not the
   * proposer's — enough for two people to decide for five. A room's top of
   * mind is a claim about everyone in it, so everyone in it decides: the
   * proposal carries when more than half the members have affirmed.
   *
   * EVERY MEMBER COUNTS, whichever kind of mind they are. A room of agents is
   * decided by its agents, because they are the only ones in it; a mixed room
   * votes together, unweighted. A member is a member.
   *
   * The proposer's own affirmation counts. Proposing IS agreeing — writing
   * the sentence is the strongest statement of support available, and asking
   * someone to then affirm their own words is ceremony.
   *
   * Both counts are read here rather than cached: membership changes between
   * proposal and resolution, and the threshold has to follow the room as it
   * is now, not as it was when somebody wrote a sentence.
   */
  /**
   * ONLY THE PEOPLE STILL HERE GET A VOTE.
   *
   * The comment above is right that the threshold follows the room as it is
   * now — but only the DENOMINATOR did. An affirmation's foreign key is to
   * `profiles`, not to membership, so removing someone left their vote
   * standing while the room it was cast in got smaller:
   *
   *   four members, owner opens a proposal (auto-affirmed, 1/4), B affirms
   *   (2/4, not carried), owner removes B, owner affirms again — the
   *   duplicate no-ops but the tally reruns, and 2 against 3 now carries.
   *
   * Two votes, one of them an ejected person's, overruling the two members
   * who never agreed. So the count joins current membership: a vote is a
   * statement by someone in the room, and leaving the room withdraws it.
   */
  const [{ affirmations }] = await db
    .select({ affirmations: sql<number>`count(*)::int` })
    .from(groupTopOfMindAffirmations)
    .innerJoin(
      groupMembers,
      and(
        eq(groupMembers.profileId, groupTopOfMindAffirmations.profileId),
        eq(groupMembers.groupId, input.groupId),
      ),
    )
    .where(eq(groupTopOfMindAffirmations.proposalId, proposal.id));
  const [{ members }] = await db
    .select({ members: sql<number>`count(*)::int` })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, input.groupId));
  /* strictly more than half: 5 members needs 3, 4 needs 3, 1 needs 1 — a room
     of one is carried by its only member, which is the honest reading of
     "most of us" when us is one. */
  const carried = carriesMajority(affirmations, members);

  let accepted = false;
  if (carried) {
    const now = new Date();
    // Guard on `status = 'open'`: the open check above was a separate read,
    // and a decline that commits between it and here would otherwise be flipped
    // back to accepted. The guard makes the transition atomic — whichever of
    // accept and decline commits second finds the row no longer open and does
    // nothing. `accepted` follows the row actually changing, so the caller does
    // not refresh a board for a change the group turned down.
    const flipped = await db
      .update(groupTopOfMindProposals)
      .set({ status: "accepted", resolvedAt: now, updatedAt: now })
      .where(
        and(
          eq(groupTopOfMindProposals.id, proposal.id),
          eq(groupTopOfMindProposals.status, "open"),
        ),
      )
      .returning({ id: groupTopOfMindProposals.id });
    accepted = flipped.length > 0;
  }

  const view = await loadProposalView(db, {
    proposalId: proposal.id,
    groupId: input.groupId,
    viewerProfileId: input.profileId,
  });
  if (!view) return { ok: false, reason: "not_found" };
  return { ok: true, proposal: view, accepted };
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
