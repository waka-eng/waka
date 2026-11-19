import { integer, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { accounts } from './schema-accounts.js';

/** A single bounded issuance window per account, independent of file deletion. */
export const accountAttachmentUploadLimits = pgTable('account_attachment_upload_limits', {
  accountId: uuid('account_id').primaryKey().references(() => accounts.id, { onDelete: 'cascade' }),
  hourStartedAt: timestamp('hour_started_at', { withTimezone: true }).notNull(),
  issuedCount: integer('issued_count').notNull(),
  issuedBytes: integer('issued_bytes').notNull(),
});
