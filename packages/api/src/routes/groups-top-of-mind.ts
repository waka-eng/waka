/**
 * The single artifact a room co-owns, and the request to regenerate it.
 *
 * Reading it is the easy half. The half worth reading is who ends up owning
 * the regeneration job: a membership change is usually requested by the person
 * on their way out, and a job owned by a former member would be invisible to
 * everyone left behind — so the owner is resolved against current membership
 * here rather than taken from the caller.
 */

import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import {
  groupMembers,
  profiles,
  topOfMindEntries,
  topOfMindEntrySignals,
  topOfMinds,
  type RefreshGroupTopOfMindPayload,
  type TopOfMindEntryType,
  type TopOfMindRevisionReason,
  type TopOfMindStatus,
} from "../db/index.js";
import { getDb } from "../lib/db.js";
import { labelMembersByProfileId } from "../lib/member-labels.js";
import { enqueueGroupTopOfMindRefresh as enqueueGroupRefreshJob } from "../lib/queue.js";
import { loadGroupMembership } from "./groups-membership.js";

type WakaDb = ReturnType<typeof getDb>;

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
