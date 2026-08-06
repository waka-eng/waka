import {
  DeleteObjectsCommand,
  S3Client,
  type ObjectIdentifier,
} from "@aws-sdk/client-s3";
import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";

import {
  attachments,
  combinationReadings,
  combinations,
  documents,
  groupConversationRooms,
  groupMembers,
  groupRoomParticipants,
  groupRoomPrompts,
  groupRoomSignals,
  groups,
  groupTopOfMindNoteSignals,
  groupTopOfMindNotes,
  inspirations,
  users,
} from "../db/index.js";
import { getDb } from "./db.js";
import { getRuntimeVault } from "../vault/runtime.js";
import type { VaultStore } from "../vault/vault.js";

type WakaDb = ReturnType<typeof getDb>;

export interface EraseUserAccountDependencies {
  db?: WakaDb;
  vault?: VaultStore;
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
 * Permanently erase every storage representation before dropping the account.
 * External deletes are idempotent, so a failed attempt leaves the DB inventory
 * intact and a retry can safely finish the same work.
 */
export async function eraseUserAccount(
  userId: string,
  deps: EraseUserAccountDependencies = {},
): Promise<void> {
  const db = deps.db ?? getDb();
  const vault = deps.vault ?? getRuntimeVault();

  const [
    indexedDocuments,
    attachmentRows,
    groupRows,
    evidenceGroupRows,
    combinationRows,
    participantRoomRows,
    signalRoomRows,
  ] = await Promise.all([
    db
      .select({ path: documents.path })
      .from(documents)
      .where(eq(documents.userId, userId)),
    db
      .select({ s3Key: attachments.s3Key })
      .from(attachments)
      .innerJoin(inspirations, eq(attachments.inspirationId, inspirations.id))
      .where(and(eq(inspirations.userId, userId), isNotNull(attachments.s3Key))),
    db
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(eq(groupMembers.userId, userId)),
    db
      .select({ groupId: groupTopOfMindNotes.groupId })
      .from(groupTopOfMindNoteSignals)
      .innerJoin(
        groupTopOfMindNotes,
        eq(groupTopOfMindNoteSignals.groupTopOfMindNoteId, groupTopOfMindNotes.id),
      )
      .where(eq(groupTopOfMindNoteSignals.ownerUserId, userId)),
    db
      .select({ id: combinations.id })
      .from(combinations)
      .leftJoin(
        combinationReadings,
        eq(combinationReadings.combinationId, combinations.id),
      )
      .where(
        or(
          eq(combinations.createdByUserId, userId),
          sql<boolean>`exists (
            select 1
            from jsonb_array_elements(${combinationReadings.memberGrades}) as member_grade
            where member_grade->>'userId' = ${userId}
          )`,
          sql<boolean>`exists (
            select 1
            from jsonb_array_elements(${combinationReadings.memberQuotes}) as member_quote
            where member_quote->>'userId' = ${userId}
          )`,
        ),
      ),
    db
      .select({ roomId: groupRoomParticipants.roomId })
      .from(groupRoomParticipants)
      .where(eq(groupRoomParticipants.userId, userId)),
    db
      .select({ roomId: groupRoomSignals.roomId })
      .from(groupRoomSignals)
      .where(eq(groupRoomSignals.userId, userId)),
  ]);

  const vaultPaths = new Set(indexedDocuments.map((row) => row.path));
  for await (const path of vault.list(`${userId}/`)) vaultPaths.add(path);
  for (const path of vaultPaths) await vault.delete(path);

  const keys = Array.from(
    new Set(
      attachmentRows
        .map((row) => row.s3Key)
        .filter((key): key is string => typeof key === "string" && key.length > 0),
    ),
  );
  await (deps.deleteAttachmentObjects ?? deleteAttachmentObjectsFromS3)(keys);

  // Membership alone is insufficient: leaving a room deliberately keeps its
  // historical board intact. If the person later erases their account, find
  // those former rooms through the evidence rows that still cite their work.
  const groupIds = [
    ...new Set([
      ...groupRows.map((row) => row.groupId),
      ...evidenceGroupRows.map((row) => row.groupId),
    ]),
  ];
  const combinationIds = [...new Set(combinationRows.map((row) => row.id))];
  const roomIds = [
    ...new Set([
      ...participantRoomRows.map((row) => row.roomId),
      ...signalRoomRows.map((row) => row.roomId),
    ]),
  ];

  await db.transaction(async (tx) => {
    if (groupIds.length > 0) {
      // These records belong to a room rather than a user, so FK cascades
      // cannot know that their prose and embedded quotes were derived from the
      // departing member. Remove the affected generations and let remaining
      // members produce a clean reading on their next visit.
      await tx
        .delete(groupTopOfMindNotes)
        .where(inArray(groupTopOfMindNotes.groupId, groupIds));
      await tx.delete(combinations).where(inArray(combinations.groupId, groupIds));
      await tx
        .update(groups)
        .set({ lastSynthesisAt: null, updatedAt: new Date() })
        .where(inArray(groups.id, groupIds));
    }

    if (combinationIds.length > 0) {
      // Future subset/handshake combinations need not belong to a room. Their
      // structured grades and quotes still identify the person, so erase them
      // through their own inventory as well as through affected room ids.
      await tx.delete(combinations).where(inArray(combinations.id, combinationIds));
    }

    if (roomIds.length > 0) {
      // Legacy conversation-room prompts can also carry excerpts or a
      // synthesis of the member's signals without retaining a direct user FK.
      await tx
        .delete(groupRoomPrompts)
        .where(inArray(groupRoomPrompts.roomId, roomIds));
      await tx
        .update(groupConversationRooms)
        .set({ feedbackSummary: {}, updatedAt: new Date() })
        .where(inArray(groupConversationRooms.id, roomIds));
    }

    await tx.delete(users).where(eq(users.id, userId));
  });
}
