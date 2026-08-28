/**
 * Permanent account erasure.
 *
 * Two kinds of work, in a deliberate order:
 *
 *   1. **Bytes we own outside Postgres** — the S3 objects behind image and
 *      file attachments. They go first, while the database still lists them:
 *      the rows are the only inventory of what to delete, so dropping them
 *      before the objects would strand private bytes with nothing left
 *      pointing at them. Every external delete is idempotent, so a failure
 *      leaves the inventory intact and a retry finishes the same work.
 *
 *   2. **The account row.** Everything a person owns hangs off their
 *      profiles, and every memory table cascades from `profiles`, which
 *      cascades from `accounts` — so one delete takes the whole stack:
 *      inspirations, attachments, reflections, embeddings, signals and their
 *      evidence and shares, personal top-of-mind artifacts, group
 *      memberships, background jobs, feedback, sessions, CLI login codes.
 *
 * What cascades cannot reach is anything owned by a *group* — and the
 * erasure doctrine (founder ruling, 2026-08-23) is that it MUST NOT reach
 * it: a sentence the room approved belongs to the room. This function used
 * to delete every group artifact the person was ever cited in, "to
 * regenerate clean" — one member erasing themselves destroyed the room's
 * settled record, the exact class of destruction Phase 0a closed at every
 * other door. Now:
 *
 *   - **The room's record stays whole.** Versions, entries, settled
 *     proposals, settled stances, and door marks all survive; the FKs to
 *     `profiles` are `set null`, so each becomes a departed mark — the
 *     surface reads "someone" where a name used to be. The name is what
 *     erasure removes; the fact that someone was here is the room's.
 *   - **Live hands are withdrawn.** The erased person's OPEN proposals and
 *     their stances on anyone's OPEN proposals are deleted in the same
 *     transaction — an unanswered ask leaves with the asker, the same way
 *     removal from a room withdraws a live vote (the 0a rule).
 *   - **The door is marked.** Erasing is leaving every room at once, so a
 *     `left` event is written per membership before the cascade takes the
 *     seat.
 */

import { DeleteObjectsCommand, type ObjectIdentifier } from "@aws-sdk/client-s3";

import { makeAttachmentsS3Client } from "./s3-client.js";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";

import {
  accounts,
  attachments,
  groupMembers,
  groupMembershipEvents,
  groupTopOfMindAffirmations,
  groupTopOfMindProposals,
  profiles,
} from "../db/index.js";
import { getDb } from "./db.js";

type WakaDb = ReturnType<typeof getDb>;

export interface EraseAccountDependencies {
  db?: WakaDb;
  deleteAttachmentObjects?: (keys: string[]) => Promise<void>;
}

function attachmentBucketName(): string {
  const direct = process.env.ATTACHMENTS_BUCKET;
  if (direct?.trim()) return direct.trim();
  const linked = process.env.SST_RESOURCE_Attachments;
  if (linked) {
    try {
      const parsed = JSON.parse(linked) as { name?: unknown };
      if (typeof parsed.name === "string" && parsed.name.trim()) return parsed.name.trim();
    } catch {
      // The explicit error below is safer than silently skipping private bytes.
    }
  }
  throw new Error("Attachments bucket is not configured for account erasure");
}

async function deleteAttachmentObjectsFromS3(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const client = makeAttachmentsS3Client();
  const bucket = attachmentBucketName();

  for (let offset = 0; offset < keys.length; offset += 1_000) {
    const objects: ObjectIdentifier[] = keys
      .slice(offset, offset + 1_000)
      .map((Key) => ({ Key }));
    const result = await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: objects, Quiet: true },
      }),
    );
    if (result.Errors?.length) {
      throw new Error(`Failed to erase ${result.Errors.length} attachment object(s)`);
    }
  }
}

/**
 * Erase an account and every profile it owns. Safe to retry: the external
 * deletes are idempotent and the database work happens in one transaction.
 */
export async function eraseAccount(
  accountId: string,
  deps: EraseAccountDependencies = {},
): Promise<void> {
  const db = deps.db ?? getDb();

  const profileRows = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.accountId, accountId));
  const profileIds = profileRows.map((row) => row.id);

  let attachmentKeys: string[] = [];

  if (profileIds.length > 0) {
    const attachmentRows = await db
      .select({ s3Key: attachments.s3Key })
      .from(attachments)
      .where(
        and(inArray(attachments.profileId, profileIds), isNotNull(attachments.s3Key)),
      );

    attachmentKeys = [
      ...new Set(
        attachmentRows
          .map((row) => row.s3Key)
          .filter((key): key is string => typeof key === "string" && key.length > 0),
      ),
    ];
  }

  await (deps.deleteAttachmentObjects ?? deleteAttachmentObjectsFromS3)(attachmentKeys);

  await db.transaction(async (tx) => {
    if (profileIds.length > 0) {
      /* THE DOOR IS MARKED BEFORE THE SEAT GOES. Erasing is leaving every
         room at once; the ledger records it the way `leaveGroup` would, and
         the profile delete below then sets the mark's name null — the room
         keeps "someone left", which is exactly what erasure leaves behind. */
      const seats = await tx
        .select({ groupId: groupMembers.groupId, profileId: groupMembers.profileId })
        .from(groupMembers)
        .where(inArray(groupMembers.profileId, profileIds));
      if (seats.length > 0) {
        await tx.insert(groupMembershipEvents).values(
          seats.map((seat) => ({
            groupId: seat.groupId,
            profileId: seat.profileId,
            kind: "left" as const,
          })),
        );
      }

      /* LIVE HANDS ARE WITHDRAWN; SETTLED ONES ARE HISTORY. An open
         proposal is an unanswered ask — it leaves with the asker. A stance
         on someone else's open proposal is a live vote — it goes the way a
         removed member's does (the 0a rule). Everything already settled
         stays, and the profile cascade turns its names into departed marks. */
      const openProposalIds = tx
        .select({ id: groupTopOfMindProposals.id })
        .from(groupTopOfMindProposals)
        .where(eq(groupTopOfMindProposals.status, "open"));
      await tx
        .delete(groupTopOfMindAffirmations)
        .where(
          and(
            inArray(groupTopOfMindAffirmations.profileId, profileIds),
            inArray(groupTopOfMindAffirmations.proposalId, openProposalIds),
          ),
        );
      await tx
        .delete(groupTopOfMindProposals)
        .where(
          and(
            inArray(groupTopOfMindProposals.proposedByProfileId, profileIds),
            eq(groupTopOfMindProposals.status, "open"),
          ),
        );
    }

    /**
     * NO ROOM IS LEFT WITHOUT AN OWNER.
     *
     * Erasing an account deletes its profiles, which cascades away their
     * `group_members` rows — and if one of those carried `role: 'owner'`, the
     * room is left with members and nobody able to rename it, remove anyone,
     * or close it. Leaving a room has always handed the seat on
     * (`promoteSuccessorOwner` in routes/groups.ts); deleting an account is
     * leaving every room at once and owes the same courtesy.
     *
     * This is the second half of the fix for the cascade that used to take the
     * whole room: `groups.created_by_profile_id` is now `ON DELETE SET NULL`
     * (migration 0004), so the room survives its creator — and this makes sure
     * it survives as something its remaining members can still administer,
     * rather than a room frozen at whatever it was.
     *
     * Longest-standing member first, the same rule `promoteSuccessorOwner`
     * uses, so the outcome does not depend on which way you left.
     */
    if (profileIds.length > 0) {
      const owned = await tx
        .select({ groupId: groupMembers.groupId })
        .from(groupMembers)
        .where(
          and(inArray(groupMembers.profileId, profileIds), eq(groupMembers.role, "owner")),
        );

      const leaving = new Set(profileIds);
      for (const groupId of new Set(owned.map((row) => row.groupId))) {
        const roll = await tx
          .select({ id: groupMembers.id, profileId: groupMembers.profileId })
          .from(groupMembers)
          .where(eq(groupMembers.groupId, groupId))
          .orderBy(asc(groupMembers.createdAt), asc(groupMembers.id));
        /* everyone except the profiles about to disappear with this account */
        const heir = roll.find((row) => !leaving.has(row.profileId));
        if (heir) {
          await tx
            .update(groupMembers)
            .set({ role: "owner" })
            .where(eq(groupMembers.id, heir.id));
        }
      }
    }

    await tx.delete(accounts).where(eq(accounts.id, accountId));
  });
}
