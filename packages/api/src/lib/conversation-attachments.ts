/**
 * PHOTOS AND FILES SENT WITH A CHAT MESSAGE (2026-10-15, migration 0076).
 *
 * The flow the composer needs: presign → PUT → finalize onto
 * `{conversationId, messageId}` with the id the client WILL send the message
 * under (the row is "staged"), then send the message with `attachmentIds`.
 * The send links the staged rows in the message's own transaction. Nothing
 * here trusts the browser about ownership: every query is scoped by
 * `profile_id`, the link matches (profile, conversation, staged message, id),
 * and once linked the composite FK holds the row to its message.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { attachments } from '../db/index.js';
import type { getDb } from './db.js';

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Reader = Pick<Db, 'select'>;

/** Per message. The note composer allows five; a chat turn a few more photos. */
export const MAX_MESSAGE_ATTACHMENTS = 6;
/** Uploaded-but-unsent rows one profile may hold at once, across all drafts. */
export const MAX_STAGED_MESSAGE_ATTACHMENTS = 30;

export class ConversationAttachmentError extends Error {
  constructor(readonly status: 400 | 404 | 409 | 429, message: string) { super(message); }
}

export const messageAttachmentSelection = {
  id: attachments.id, conversationId: attachments.conversationId, messageId: attachments.messageId,
  stagedMessageId: attachments.stagedMessageId, type: attachments.type, name: attachments.name,
  contentType: attachments.contentType, size: attachments.size, createdAt: attachments.createdAt,
} as const;
type MessageAttachmentRow = { id: string; conversationId: string | null; messageId: string | null; stagedMessageId: string | null;
  type: 'link' | 'image' | 'file' | 'audio'; name: string | null; contentType: string | null; size: number | null; createdAt: Date };

/**
 * The wire shape. No URL: the bucket is private, and a reader opens the bytes
 * through `GET /api/attachments/:id/url` — the same short presigned read every
 * inspiration photo uses, with the same owner check.
 */
export function serializeMessageAttachment(row: MessageAttachmentRow) {
  return { id: row.id, conversationId: row.conversationId!, messageId: (row.messageId ?? row.stagedMessageId)!,
    staged: row.messageId === null, type: row.type as 'image' | 'file', name: row.name,
    contentType: row.contentType, size: row.size, createdAt: row.createdAt.toISOString() };
}
export type MessageAttachment = ReturnType<typeof serializeMessageAttachment>;

/** Linked attachments of these messages, in the order they were added. */
export async function readMessageAttachments(db: Reader, profileId: string, conversationId: string, messageIds: string[]) {
  const byMessage = new Map<string, MessageAttachment[]>();
  if (messageIds.length === 0) return byMessage;
  const rows = await db.select(messageAttachmentSelection).from(attachments)
    .where(and(eq(attachments.profileId, profileId), eq(attachments.conversationId, conversationId), inArray(attachments.messageId, messageIds)))
    .orderBy(asc(attachments.createdAt), asc(attachments.id));
  for (const row of rows) {
    const list = byMessage.get(row.messageId!) ?? [];
    list.push(serializeMessageAttachment(row));
    byMessage.set(row.messageId!, list);
  }
  return byMessage;
}

/**
 * Move this message's staged uploads onto it. Call AFTER the message row is
 * inserted, in the same transaction — the FK needs the message to exist.
 *
 * Every id asked for must be a row this profile staged for exactly this
 * conversation and message id, or the whole send rolls back (409). Staged
 * rows for this message id that were NOT asked for (a chip removed after its
 * upload) can never be linked once the message exists, so they are deleted
 * here; their S3 keys are returned for the caller to sweep after commit.
 */
export async function linkMessageAttachments(tx: Tx, input: { profileId: string; conversationId: string; messageId: string; attachmentIds: string[] }) {
  const staged = await tx.select({ id: attachments.id, conversationId: attachments.conversationId, s3Key: attachments.s3Key }).from(attachments)
    .where(and(eq(attachments.profileId, input.profileId), eq(attachments.stagedMessageId, input.messageId))).for('update');
  const wanted = new Set(input.attachmentIds);
  const usable = staged.filter((row) => row.conversationId === input.conversationId && wanted.has(row.id));
  if (usable.length !== wanted.size) throw new ConversationAttachmentError(409, 'Some attachments are not ready for this message. Add them again.');
  if (usable.length) {
    await tx.update(attachments).set({ messageId: input.messageId, stagedMessageId: null, updatedAt: new Date() })
      .where(and(eq(attachments.profileId, input.profileId), inArray(attachments.id, usable.map((row) => row.id))));
  }
  const dropped = staged.filter((row) => !wanted.has(row.id));
  if (dropped.length) {
    await tx.delete(attachments).where(and(eq(attachments.profileId, input.profileId), inArray(attachments.id, dropped.map((row) => row.id))));
  }
  return dropped.map((row) => row.s3Key).filter((key): key is string => typeof key === 'string' && key.length > 0);
}

/** Every S3 key of a conversation's chat attachments, linked and staged. */
export async function conversationAttachmentKeys(db: Reader, profileId: string, conversationId: string) {
  const rows = await db.select({ s3Key: attachments.s3Key }).from(attachments)
    .where(and(eq(attachments.profileId, profileId), eq(attachments.conversationId, conversationId)));
  return rows.map((row) => row.s3Key).filter((key): key is string => typeof key === 'string' && key.length > 0);
}

/**
 * What the reply model is told about a message's attachments: their kind and
 * name, nothing else. The bytes are not read — a chat photo is not described
 * by a machine the way a saved one is — so the model can acknowledge what was
 * sent without pretending to have seen it.
 */
export function attachmentNote(list: ReadonlyArray<Pick<MessageAttachment, 'type' | 'name'>>): string {
  if (!list.length) return '';
  const items = list.map((item) => `${item.type === 'image' ? 'photo' : 'file'} "${(item.name ?? 'untitled').replace(/\s+/g, ' ').replace(/"/g, "'").trim().slice(0, 120)}"`);
  return `[Attached, not read: ${items.join(', ')}]`;
}
