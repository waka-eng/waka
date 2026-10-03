/** The input contract for room derivation. Personal answers are never read. */
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";

import { attachments, groupMembers, inspirations, profiles, type Inspiration } from "../db/index.js";
import { getDb } from "./db.js";
import type { RelatedInspirationContext } from "./model-provider.js";
import { effectiveAttachmentKind, effectiveAttachmentStatus, effectiveAttachmentText } from './attachment-material.js';

type WakaDb = ReturnType<typeof getDb>;
type WakaTx = Parameters<Parameters<WakaDb["transaction"]>[0]>[0];

export const GROUP_INPUT_POLICY = "group-public-v1";

export async function loadGroupInputMembership(db: WakaDb, ownerProfileId: string, mindProfileId: string) {
  const [row] = await db.select({ id: groupMembers.id })
    .from(groupMembers)
    .innerJoin(profiles, and(eq(profiles.groupId, groupMembers.groupId), eq(profiles.type, "group")))
    .where(and(eq(profiles.id, mindProfileId), eq(groupMembers.profileId, ownerProfileId)))
    .limit(1);
  return row ?? null;
}

export async function loadGroupInputAttachments(db: WakaDb | WakaTx, ownerProfileId: string, inspirationId: string) {
  return db.select({
    id: attachments.id,
    kind: effectiveAttachmentKind,
    text: effectiveAttachmentText,
    hostname: attachments.hostname,
    name: attachments.name,
  }).from(attachments).where(and(
    eq(attachments.profileId, ownerProfileId),
    eq(attachments.inspirationId, inspirationId),
    eq(effectiveAttachmentStatus, "ready"),
    isNotNull(effectiveAttachmentText),
  )).orderBy(asc(attachments.id));
}

export class GroupInputUnavailableError extends Error {
  constructor(readonly status: "missing_inspiration" | "not_public" | "not_authorized") {
    super(`Room input unavailable: ${status}`);
  }
}

/**
 * Run after all model calls, inside the write transaction. Lock the source
 * rows through commit, so a late privacy switch/leave cannot race the final
 * check. Throwing rolls back match, mint, evidence and statement history.
 * A changed material snapshot is retryable, not successful empty extraction.
 */
export async function assertGroupInputCurrent(tx: WakaTx, snapshot: {
  mindProfileId: string;
  membershipId: string;
  inspiration: Inspiration;
  attachments: Awaited<ReturnType<typeof loadGroupInputAttachments>>;
  related: RelatedInspirationContext[];
}): Promise<void> {
  const { inspiration } = snapshot;
  const [membership] = await tx.select({ id: groupMembers.id })
    .from(groupMembers)
    .innerJoin(profiles, and(eq(profiles.groupId, groupMembers.groupId), eq(profiles.type, "group")))
    .where(and(
      eq(profiles.id, snapshot.mindProfileId),
      eq(groupMembers.profileId, inspiration.profileId),
      eq(groupMembers.id, snapshot.membershipId),
    )).for("share");
  if (!membership) throw new GroupInputUnavailableError("not_authorized");

  const ids = [...new Set([inspiration.id, ...snapshot.related.map((row) => row.id)])].sort();
  const current = await tx.select().from(inspirations)
    .where(and(eq(inspirations.profileId, inspiration.profileId), inArray(inspirations.id, ids)))
    .orderBy(asc(inspirations.id)).for("update");
  const primary = current.find((row) => row.id === inspiration.id);
  if (!primary) throw new GroupInputUnavailableError("missing_inspiration");
  if (current.some((row) => row.visibility !== "public")) throw new GroupInputUnavailableError("not_public");
  if (current.length !== ids.length) throw new Error("Room material changed: related capture removed");

  // Parent FOR UPDATE blocks new attachment FK links; lock existing children
  // as well so enrichment updates/removal cannot commit after this comparison.
  await tx.select({ id: attachments.id }).from(attachments)
    .where(and(eq(attachments.profileId, inspiration.profileId), eq(attachments.inspirationId, inspiration.id)))
    .orderBy(asc(attachments.id)).for("share");
  const currentAttachments = await loadGroupInputAttachments(tx, inspiration.profileId, inspiration.id);
  const unchanged = primary.text === inspiration.text && primary.kind === inspiration.kind &&
    primary.source === inspiration.source && primary.createdAt.getTime() === inspiration.createdAt.getTime() &&
    JSON.stringify(currentAttachments) === JSON.stringify(snapshot.attachments) &&
    snapshot.related.every((prior) => {
      const row = current.find((item) => item.id === prior.id);
      return row?.text === prior.text && row.createdAt.getTime() === prior.createdAt.getTime();
    });
  if (!unchanged) throw new Error("Room material changed: retry with current public inputs");
}
