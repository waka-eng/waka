import { sql } from 'drizzle-orm';
import { check, foreignKey, index, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { profiles } from './schema-profiles.js';
import { inspirations } from './schema-inspirations.js';
import { reflections } from './schema-reflections.js';
import type { InspirationProcessingReceipt } from '../lib/inspiration-processing.js';

/** One accepted authored-save intent. Deletion clears output links, not the
 * request identity: retry must never resurrect removed words. No text snapshots. */
export const inspirationSaveRequests = pgTable('inspiration_save_requests', {
  profileId: uuid('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  requestId: uuid('request_id').notNull(),
  operation: text('operation').$type<'inspiration' | 'reflection'>().notNull(),
  requestHash: text('request_hash').notNull(),
  inspirationId: uuid('inspiration_id'),
  reflectionId: uuid('reflection_id'),
  processing: jsonb('processing').$type<InspirationProcessingReceipt>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ name: 'inspiration_save_requests_pk', columns: [table.profileId, table.requestId] }),
  sourceFk: foreignKey({ name: 'inspiration_save_requests_source_fk', columns: [table.profileId, table.inspirationId],
    foreignColumns: [inspirations.profileId, inspirations.id] }),
  answerFk: foreignKey({ name: 'inspiration_save_requests_answer_fk', columns: [table.profileId, table.inspirationId, table.reflectionId],
    foreignColumns: [reflections.profileId, reflections.inspirationId, reflections.id] }),
  sourceIdx: index('inspiration_save_requests_source_idx').on(table.profileId, table.inspirationId),
  answerIdx: index('inspiration_save_requests_answer_idx').on(table.profileId, table.reflectionId),
  hash: check('inspiration_save_requests_hash', sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`),
  operation: check('inspiration_save_requests_operation', sql`${table.operation} IN ('inspiration', 'reflection')`),
  result: check('inspiration_save_requests_result', sql`(
    ${table.inspirationId} IS NULL AND ${table.reflectionId} IS NULL AND ${table.processing} IS NULL
  ) OR (
    ${table.inspirationId} IS NOT NULL AND ${table.processing} IS NOT NULL AND
    ((${table.operation} = 'inspiration' AND ${table.reflectionId} IS NULL) OR (${table.operation} = 'reflection' AND ${table.reflectionId} IS NOT NULL))
  )`),
}));
