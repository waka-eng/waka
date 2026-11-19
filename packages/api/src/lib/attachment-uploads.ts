import { and, eq, sql } from 'drizzle-orm';
import { accountAttachmentUploadLimits, accounts, attachmentObjects, profiles } from '../db/index.js';
import type { getDb } from './db.js';
import { attachmentKeyHash, attachmentStorageScope } from './attachment-sweep.js';
import { MAX_ATTACHMENT_UPLOAD_BYTES, MAX_INSPIRATION_ATTACHMENTS } from './inspiration-attachment-input.js';

type Db = ReturnType<typeof getDb>;
export const UPLOAD_FINALIZATION_GRACE_MS = 24 * 60 * 60 * 1000;

export const ATTACHMENT_UPLOAD_HOUR_LIMITS = {
  count: 20,
  // Preserve a single batch at the existing six-attachment envelope.
  bytes: MAX_ATTACHMENT_UPLOAD_BYTES * MAX_INSPIRATION_ATTACHMENTS,
} as const;

export class AttachmentUploadCapacityError extends Error {
  constructor(readonly retryAfter: number) {
    super('attachment_upload_capacity');
  }
}

/** Charge issuance and record the key in one transaction before signing.
 * An uncertain response or later deletion cannot refund the hourly budget. */
export async function recordAttachmentUpload(db: Db, input: {
  key: string; accountId: string; profileId: string; size: number;
  expiresAt: Date; now?: Date; storageScope?: string;
}) {
  if (!Number.isSafeInteger(input.size) || input.size < 1 || input.size > MAX_ATTACHMENT_UPLOAD_BYTES) {
    throw new Error('Invalid attachment issuance size');
  }

  return db.transaction(async tx => {
    const [account] = await tx.select({ id: accounts.id }).from(accounts)
      .where(eq(accounts.id, input.accountId)).for('key share');
    if (!account) return false;
    const [owner] = await tx.select({ id: profiles.id }).from(profiles)
      .where(and(eq(profiles.id, input.profileId), eq(profiles.accountId, account.id))).for('key share');
    if (!owner) return false;

    const clock = input.now ? sql`${input.now.toISOString()}::timestamptz` : sql`transaction_timestamp()`;
    const scope = accountAttachmentUploadLimits;
    const issued = await tx.execute(sql`
      INSERT INTO ${scope} (account_id,hour_started_at,issued_count,issued_bytes)
      VALUES (${account.id}::uuid,date_trunc('hour',${clock},'UTC'),1,${input.size})
      ON CONFLICT (account_id) DO UPDATE
      SET hour_started_at=excluded.hour_started_at,
          issued_count=CASE WHEN ${scope.hourStartedAt}<excluded.hour_started_at THEN 1 ELSE ${scope.issuedCount}+1 END,
          issued_bytes=CASE WHEN ${scope.hourStartedAt}<excluded.hour_started_at THEN excluded.issued_bytes ELSE ${scope.issuedBytes}+excluded.issued_bytes END
      WHERE ${scope.hourStartedAt}<excluded.hour_started_at
        OR (${scope.hourStartedAt}=excluded.hour_started_at AND ${scope.issuedCount}<${ATTACHMENT_UPLOAD_HOUR_LIMITS.count}
            AND ${scope.issuedBytes}+excluded.issued_bytes<=${ATTACHMENT_UPLOAD_HOUR_LIMITS.bytes})
      RETURNING account_id
    `);
    if (!issued.length) {
      const [window] = await tx.execute<{ seconds: number }>(sql`
        SELECT greatest(1,ceil(extract(epoch FROM date_trunc('hour',${clock},'UTC')+interval '1 hour'-${clock})))::int AS seconds
      `);
      throw new AttachmentUploadCapacityError(window?.seconds ?? 3600);
    }
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
