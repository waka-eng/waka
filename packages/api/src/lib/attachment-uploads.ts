import { and, eq, sql } from 'drizzle-orm';
import { attachmentObjects, profiles } from '../db/index.js';
import type { getDb } from './db.js';
import { attachmentKeyHash, attachmentStorageScope } from './attachment-sweep.js';

type Db = ReturnType<typeof getDb>;
export const UPLOAD_FINALIZATION_GRACE_MS = 24 * 60 * 60 * 1000;

/** A URL never leaves the API before this independent inventory commits. */
export async function recordAttachmentUpload(db: Db, input: { key: string; profileId: string; expiresAt: Date; now?: Date; storageScope?: string }) {
  return db.transaction(async tx => {
    const [owner] = await tx.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, input.profileId)).for('key share');
    if (!owner) return false;
    await tx.insert(attachmentObjects).values({ keyHash: attachmentKeyHash(input.key), key: input.key,
      storageScope: input.storageScope ?? attachmentStorageScope(), issuedProfileId: input.profileId,
      uploadExpiresAt: input.expiresAt, dueAt: new Date((input.now ?? new Date()).getTime() + UPLOAD_FINALIZATION_GRACE_MS) });
    return true;
  });
}

/** Event authority comes from the configured bucket/queue, then the exact
 * issuance hash+store. Unknown keys are not an excuse for an orphan sweep. */
export async function recordAttachmentObjectCreated(db: Db, key: string, scope: string, now = new Date()) {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'waka.attachment-key:' + key},0))`);
    const [row] = await tx.select().from(attachmentObjects).where(and(eq(attachmentObjects.keyHash, attachmentKeyHash(key)),eq(attachmentObjects.storageScope,scope))).for('update');
    if (!row) return false;
    // A completion after the first DELETE re-arms cleanup, never reopens the
    // closed fence. Early events retain the finalization allowance.
    await tx.update(attachmentObjects).set({ key, completedAt: null, generation:sql`${attachmentObjects.generation}+1`,
      dueAt: row.closedAt || !row.dueAt ? now : row.dueAt })
      .where(eq(attachmentObjects.keyHash,row.keyHash));
    return true;
  });
}
