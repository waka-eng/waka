import { sql } from 'drizzle-orm';
import { bigint, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Operational byte inventory; deliberately survives profile/account cascades. */
export const attachmentObjects = pgTable('attachment_objects', {
  keyHash: text('key_hash').primaryKey(),
  key: text('key'),
  storageScope: text('storage_scope'),
  issuedProfileId: uuid('issued_profile_id'),
  uploadExpiresAt: timestamp('upload_expires_at', { withTimezone: true }),
  dueAt: timestamp('due_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  attempts: integer('attempts').notNull().default(0),
  generation: bigint('generation', {mode:'bigint'}).notNull().default(sql`0`),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => ({ dueIdx: index('attachment_objects_due_idx').on(table.dueAt) }));
