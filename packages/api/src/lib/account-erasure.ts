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
 * What cascades cannot reach is anything owned by a *group*: a group's top of
 * mind is generated from its members' shared signals, so its prose can carry
 * a departing member's thinking while belonging to a row the member does not
 * own. Those artifacts are removed explicitly below and regenerate clean from
 * the remaining members' signals.
 */

import {
  DeleteObjectsCommand,
  S3Client,
  type ObjectIdentifier,
} from "@aws-sdk/client-s3";
import { and, eq, inArray, isNotNull } from "drizzle-orm";

import {
  accounts,
  attachments,
  groupMembers,
  profiles,
  topOfMindEntries,
  topOfMindEntrySignals,
  topOfMinds,
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
  const client = new S3Client({
    region:
      process.env.ATTACHMENTS_REGION ||
      process.env.AWS_REGION ||
      process.env.AWS_DEFAULT_REGION ||
      "us-west-2",
  });
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
  let groupIds: string[] = [];

  if (profileIds.length > 0) {
    const [attachmentRows, membershipRows, citedGroupRows] = await Promise.all([
      db
        .select({ s3Key: attachments.s3Key })
        .from(attachments)
        .where(
          and(
            inArray(attachments.profileId, profileIds),
            isNotNull(attachments.s3Key),
          ),
        ),
      db
        .select({ groupId: groupMembers.groupId })
        .from(groupMembers)
        .where(inArray(groupMembers.profileId, profileIds)),
      // Membership alone is insufficient: leaving a group deliberately keeps
      // its board intact, so a former group is only reachable through the
      // citations that still credit this account's signals.
      db
        .select({ groupId: topOfMinds.groupId })
        .from(topOfMindEntrySignals)
        .innerJoin(
          topOfMindEntries,
          eq(topOfMindEntrySignals.entryId, topOfMindEntries.id),
        )
        .innerJoin(topOfMinds, eq(topOfMindEntries.topOfMindId, topOfMinds.id))
        .where(inArray(topOfMindEntrySignals.ownerProfileId, profileIds)),
    ]);

    attachmentKeys = [
      ...new Set(
        attachmentRows
          .map((row) => row.s3Key)
          .filter((key): key is string => typeof key === "string" && key.length > 0),
      ),
    ];

    groupIds = [
      ...new Set(
        [...membershipRows, ...citedGroupRows]
          .map((row) => row.groupId)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    ];
  }

  await (deps.deleteAttachmentObjects ?? deleteAttachmentObjectsFromS3)(attachmentKeys);

  await db.transaction(async (tx) => {
    if (groupIds.length > 0) {
      await tx.delete(topOfMinds).where(inArray(topOfMinds.groupId, groupIds));
    }

    await tx.delete(accounts).where(eq(accounts.id, accountId));
  });
}
