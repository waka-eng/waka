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
import { and, asc, eq, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
import { attachments } from '../db/index.js';
import type { getDb } from './db.js';
import type { DeleteAttachmentObjects } from './attachment-sweep.js';

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Reader = Pick<Db, 'select'>;

/** Per message. The note composer allows five; a chat turn a few more photos. */
export const MAX_MESSAGE_ATTACHMENTS = 6;
/**
 * Uploaded-but-unsent rows one profile may stage within
 * `STAGED_CAP_WINDOW_MS`, across all drafts. Only recent rows count: a draft
 * abandoned yesterday must not hold the composer shut today, and the daily
 * sweep removes the rest once they pass `STAGED_KEEP_DAYS`.
 */
export const MAX_STAGED_MESSAGE_ATTACHMENTS = 30;
export const STAGED_CAP_WINDOW_MS = 24 * 60 * 60 * 1000;
/** A staged upload whose message was never sent is kept this long, then swept. */
export const STAGED_KEEP_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export class ConversationAttachmentError extends Error {
  constructor(readonly status: 400 | 404 | 409 | 429, message: string,
    readonly code?: 'attachment_not_ready', readonly missingAttachmentIds?: string[]) { super(message); }
  /** The JSON a route answers with: the sentence, and when there is one, the
      code and which ids it was about, so a composer can drop exactly those. */
  body() {
    return { error: this.message, ...(this.code ? { code: this.code } : {}), ...(this.missingAttachmentIds ? { missingAttachmentIds: this.missingAttachmentIds } : {}) };
  }
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
  /* NAMED, NOT ONLY REFUSED. A draft can outlive its uploads — the daily
     sweep takes week-old staged rows, and another tab may have removed one —
     and a composer told only "409" would resend the same ids forever. It is
     told which ids this profile no longer has staged for this message, and
     drops those. */
  if (usable.length !== wanted.size) {
    const found = new Set(usable.map((row) => row.id));
    throw new ConversationAttachmentError(409, 'Some attachments are not ready for this message. Add them again.', 'attachment_not_ready',
      input.attachmentIds.filter((id) => !found.has(id)));
  }
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

/**
 * The search words a photo/file-only message offers when no message in the
 * window has any: its attachments' names, extension dropped
 * ("kyoto-garden.png" → "kyoto-garden"). Only for retrieval; the model is
 * told what was attached by `attachmentNote`.
 */
export function attachmentSearchText(list: ReadonlyArray<Pick<MessageAttachment, 'name'>>): string {
  return list.map((item) => (item.name ?? '').replace(/\.[a-z0-9]{1,16}$/i, '').replace(/[\s_]+/g, ' ').trim()).filter(Boolean).join(' ').slice(0, 1000);
}

/**
 * Of these keys, the ones no remaining row names. Every door refuses a key
 * already attached (`assertAttachmentKeysUnused`), but rows written before
 * those checks may share one; a sweep must never take bytes a row still
 * shows.
 */
export async function unreferencedAttachmentKeys(db: Reader, keys: string[]) {
  const unique = [...new Set(keys.filter((key) => key.length > 0))];
  if (!unique.length) return [];
  const held = new Set((await db.select({ s3Key: attachments.s3Key }).from(attachments).where(inArray(attachments.s3Key, unique)))
    .map((row) => row.s3Key));
  return unique.filter((key) => !held.has(key));
}

/**
 * DISCARD ONE STAGED UPLOAD — a chip removed from the composer. Only a row
 * this profile staged (never an inspiration's, never a sent message's) is
 * removed; the row is locked first, so a send linking it at the same moment
 * either wins (409 here) or finds it gone (409 there). Returns the S3 key for
 * the caller to sweep after commit.
 */
export async function discardStagedAttachment(tx: Tx, profileId: string, attachmentId: string) {
  const [row] = await tx.select({ id: attachments.id, messageId: attachments.messageId, stagedMessageId: attachments.stagedMessageId, s3Key: attachments.s3Key })
    .from(attachments)
    .where(and(eq(attachments.profileId, profileId), eq(attachments.id, attachmentId), isNotNull(attachments.conversationId), isNull(attachments.inspirationId)))
    .for('update');
  if (!row) throw new ConversationAttachmentError(404, 'Attachment not found');
  if (row.messageId !== null || row.stagedMessageId === null) throw new ConversationAttachmentError(409, 'This attachment was already sent. Delete the conversation to remove it.');
  await tx.delete(attachments).where(and(eq(attachments.profileId, profileId), eq(attachments.id, row.id), isNotNull(attachments.stagedMessageId)));
  return row.s3Key;
}

/** Staged rows created before this moment have outlived their draft. */
export function stagedAttachmentCutoff(now: Date): Date {
  return new Date(now.getTime() - STAGED_KEEP_DAYS * DAY_MS);
}

const STAGED_SWEEP_BATCH = 500;
const STAGED_SWEEP_MAX_BATCHES = 20;

/**
 * EVERYONE'S ABANDONED DRAFT UPLOADS, GONE: staged rows older than
 * `STAGED_KEEP_DAYS` (a message never sent; for a first message, often a
 * chat that was never created, which no conversation DELETE can reach), and
 * the bytes behind them. Run by the worker's daily scheduled invocation.
 *
 * Bounded batches; `SKIP LOCKED` steps over a row a send is linking right
 * now (that send moves it out of `staged`). Rows go first, in their own
 * statement; the objects are swept after, best-effort, and only those no
 * remaining row names. Bytes left behind by a failed sweep are the
 * recoverable half, the same policy as every other attachment delete.
 */
export async function sweepStaleStagedAttachments(db: Pick<Db, 'select' | 'delete'>, now: Date, deleteObjects: DeleteAttachmentObjects): Promise<number> {
  const cutoff = stagedAttachmentCutoff(now);
  const stale = and(isNotNull(attachments.stagedMessageId), isNull(attachments.messageId), isNull(attachments.inspirationId), lt(attachments.createdAt, cutoff));
  let removed = 0;
  for (let batch = 0; batch < STAGED_SWEEP_MAX_BATCHES; batch += 1) {
    const due = db.select({ id: attachments.id }).from(attachments).where(stale)
      .orderBy(asc(attachments.createdAt)).limit(STAGED_SWEEP_BATCH).for('update', { skipLocked: true });
    const rows = await db.delete(attachments).where(and(inArray(attachments.id, due), stale)).returning({ s3Key: attachments.s3Key });
    removed += rows.length;
    const keys = await unreferencedAttachmentKeys(db, rows.map((row) => row.s3Key).filter((key): key is string => typeof key === 'string'));
    if (keys.length) await deleteObjects(keys);
    if (rows.length < STAGED_SWEEP_BATCH) break;
  }
  return removed;
}

/** Recent staged rows count toward the per-profile cap; older ones do not. */
export function stagedCapCutoff(now: Date): Date {
  return new Date(now.getTime() - STAGED_CAP_WINDOW_MS);
}
