import { DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { getAttachmentsBucket } from './attachment-storage.js';
import { makeAttachmentsS3Client } from './s3-client.js';
import { attachmentsEndpoint, attachmentsRegion } from './s3-client.js';
import { and, asc, eq, inArray, isNotNull, lte, or, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { attachmentObjects } from '../db/index.js';
import { getDb } from './db.js';
import { recordOperationalFault } from './operational-fault.js';
import { unreferencedAttachmentKeys } from './conversation-attachments.js';

export type DeleteAttachmentObjects = (keys: string[]) => Promise<void>;

export function attachmentKeyHash(key: string): string { return createHash('sha256').update(key).digest('hex'); }

/** An endpoint change must never redirect old deletion work into another store. */
export function attachmentStorageScope(): string {
  const endpoint = attachmentsEndpoint();
  if (endpoint) {
    const url = new URL(endpoint);
    if (url.username || url.password || url.search || url.hash) throw new Error('Invalid attachment endpoint');
  }
  return JSON.stringify({ bucket: getAttachmentsBucket().trim(), region: attachmentsRegion(), endpoint });
}

/** Returns individual failures even when S3's HTTP response was successful. */
export async function deleteAttachmentObjectBatch(keys: string[]): Promise<string[]> {
  const unique = [...new Set(keys.filter((key) => key.length > 0))];
  if (unique.length === 0) return [];
  const bucket = getAttachmentsBucket();
  const client = makeAttachmentsS3Client();
  const failed = new Set<string>();
  try {
    for (let start = 0; start < unique.length; start += 1000) {
      const result = await client.send(new DeleteObjectsCommand({ Bucket: bucket,
        Delete: { Objects: unique.slice(start, start + 1000).map((Key) => ({ Key })), Quiet: true } }),
      { abortSignal: AbortSignal.timeout(8000) });
      for (const error of result.Errors ?? []) {
        // A malformed error without a key must not be mistaken for success.
        if (!error.Key || !unique.includes(error.Key)) for (const key of unique.slice(start, start + 1000)) failed.add(key);
        else failed.add(error.Key);
      }
    }
  } finally { client.destroy(); }
  return [...failed];
}

type Db = ReturnType<typeof getDb>;
export interface AttachmentCleanupOptions {
  keys?: string[];
  now?: Date;
  limit?: number;
  storageScope?: string;
  deleteObjects?: typeof deleteAttachmentObjectBatch;
}

export const ATTACHMENT_CLEANUP_CLAIM_MS = 5 * 60 * 1000;

/** Commit closure before I/O. The common lock fences every reference writer;
 * a lost COMMIT acknowledgment cannot cause a DELETE without a durable fence. */
export async function prepareAttachmentObjectCleanup(db: Db, options: AttachmentCleanupOptions = {}) {
  const now = options.now ?? new Date(), scope = options.storageScope ?? attachmentStorageScope();
  const limit = Math.max(1, Math.min(100, options.limit ?? 100));
  return db.transaction(async tx => {
    const due = await tx.select().from(attachmentObjects).where(and(isNotNull(attachmentObjects.key), lte(attachmentObjects.dueAt, now),
      options.keys ? inArray(attachmentObjects.keyHash, options.keys.map(attachmentKeyHash)) : undefined))
      .orderBy(asc(attachmentObjects.dueAt), asc(attachmentObjects.keyHash)).limit(limit);
    const held: typeof due = [];
    for (const row of due) {
      const lock = await tx.execute<{ held: boolean }>(sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${'waka.attachment-key:' + row.key},0)) AS held`);
      if (!lock[0]?.held) continue;
      const [current] = await tx.select().from(attachmentObjects).where(and(eq(attachmentObjects.keyHash, row.keyHash), lte(attachmentObjects.dueAt, now))).for('update');
      if (current?.key) held.push(current);
    }
    const compatible = held.filter(row => row.storageScope === scope);
    const scopeMismatch = held.filter(row => row.storageScope !== scope);
    const free = new Set(await unreferencedAttachmentKeys(tx, compatible.map(row => row.key!)));
    const deleting = compatible.filter(row => free.has(row.key!)), live = compatible.filter(row => !free.has(row.key!));
    if (live.length) await tx.update(attachmentObjects).set({ dueAt: null, key: null, issuedProfileId: null, uploadExpiresAt: null })
      .where(inArray(attachmentObjects.keyHash, live.map(row => row.keyHash)));
    if (deleting.length) await tx.update(attachmentObjects).set({ closedAt: sql`coalesce(${attachmentObjects.closedAt},${now.toISOString()}::timestamptz)`, dueAt:new Date(now.getTime()+ATTACHMENT_CLEANUP_CLAIM_MS) })
      .where(inArray(attachmentObjects.keyHash, deleting.map(row => row.keyHash)));
    for (const row of scopeMismatch) {
      await tx.update(attachmentObjects).set({ attempts: row.attempts + 1,
        dueAt: new Date(now.getTime() + Math.min(86_400_000, 60_000 * 2 ** Math.min(row.attempts, 10))),
        lastError: 'storage_scope_unverified' })
        .where(eq(attachmentObjects.keyHash, row.keyHash));
    }
    return { selected: held.length, deleting, retained: live.length, scopeFailures: scopeMismatch.length };
  });
}

type CleanupClaim = typeof attachmentObjects.$inferSelect;
/** CAS on a genuine generation, not a timestamp. A newer completion/request
 * owns its pending key even if its timestamp equals this attempt's timestamp. */
export async function settleAttachmentObjectCleanup(db: Pick<Db,'update'>, claims: CleanupClaim[], failed: string[], now: Date) {
  const done=claims.filter(row=>!failed.includes(row.key!));
  let deleted=0;
  if(done.length) deleted=(await db.update(attachmentObjects).set({completedAt:now,dueAt:null,key:null,issuedProfileId:null,uploadExpiresAt:null,lastError:null})
    .where(or(...done.map(row=>and(eq(attachmentObjects.keyHash,row.keyHash),eq(attachmentObjects.generation,row.generation)))))
    .returning({hash:attachmentObjects.keyHash})).length;
  for(const row of claims.filter(row=>failed.includes(row.key!))) await db.update(attachmentObjects).set({attempts:row.attempts+1,
    dueAt:new Date(now.getTime()+Math.min(86_400_000,60_000*2**Math.min(row.attempts,10))),lastError:'storage_delete_failed'})
    .where(and(eq(attachmentObjects.keyHash,row.keyHash),eq(attachmentObjects.generation,row.generation)));
  return deleted;
}

/** Three crash-safe phases on pool one: commit close; external DELETE;
 * generation-checked settlement. A crash leaves bounded retry eligibility. */
export async function drainAttachmentObjects(db: Db, options: AttachmentCleanupOptions = {}) {
  const now=options.now??new Date(),scope=options.storageScope??attachmentStorageScope();
  const claim=await prepareAttachmentObjectCleanup(db,{...options,now,storageScope:scope});
  let failed:string[]=[];
  if(claim.deleting.length) {
    try {
      if(!options.deleteObjects&&attachmentStorageScope()!==scope) throw Error('Storage changed during cleanup');
      failed=await(options.deleteObjects??deleteAttachmentObjectBatch)(claim.deleting.map(row=>row.key!));
    } catch { failed=claim.deleting.map(row=>row.key!); }
  }
  const deleted=await settleAttachmentObjectCleanup(db,claim.deleting,failed,now);
  if (failed.length + claim.scopeFailures > 0) recordOperationalFault('attachment_cleanup');
  return {selected:claim.selected,deleted,retained:claim.retained,failed:failed.length+claim.scopeFailures};
}

/** Immediate best effort, with durable intent/retry supplied by the database. */
export const sweepAttachmentObjects: DeleteAttachmentObjects = async keys => {
  if (!keys.length) return;
  try { await drainAttachmentObjects(getDb(), { keys }); }
  catch { console.warn('[attachments] cleanup deferred', { keyCount: keys.length }); }
};
