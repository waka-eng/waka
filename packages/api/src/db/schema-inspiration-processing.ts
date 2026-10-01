import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, jsonb, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { inspirations } from './schema-inspirations.js';
import { profiles } from './schema-profiles.js';
import { backgroundJobs, type BackgroundJobResult } from './schema-background-jobs.js';

/** Source material counters, never raw snapshots or claims of completion. */
export const inspirationRevisions = pgTable('inspiration_revisions', {
  inspirationId: uuid('inspiration_id').primaryKey(),
  profileId: uuid('profile_id').notNull(),
  personalRevision: bigint('personal_revision', { mode: 'bigint' }).notNull().default(sql`1`),
  publicRevision: bigint('public_revision', { mode: 'bigint' }).notNull().default(sql`1`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  sourceFk: foreignKey({ columns: [table.profileId, table.inspirationId], foreignColumns: [inspirations.profileId, inspirations.id], name: 'inspiration_revisions_source_fk' }).onDelete('cascade'),
  positive: check('inspiration_revisions_positive', sql`${table.personalRevision} > 0 AND ${table.publicRevision} > 0`),
}));

/** One immutable request binding; its completion facts may arrive later.
 * A room owns progress metadata, not its member's raw material. */
export const inspirationProcessing = pgTable('inspiration_processing', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  ownerProfileId: uuid('owner_profile_id').notNull(),
  inspirationId: uuid('inspiration_id').notNull(),
  materialRevision: bigint('material_revision', { mode: 'bigint' }).notNull(),
  derivationJobId: uuid('derivation_job_id').references(() => backgroundJobs.id, { onDelete: 'set null' }),
  derivationRequestVersion: bigint('derivation_request_version', { mode: 'bigint' }),
  readingJobId: uuid('reading_job_id').references(() => backgroundJobs.id, { onDelete: 'set null' }),
  readingRequestVersion: bigint('reading_request_version', { mode: 'bigint' }),
  result: jsonb('result').$type<BackgroundJobResult>(),
  derivedAt: timestamp('derived_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
}, (table) => ({
  sourceFk: foreignKey({ columns: [table.ownerProfileId, table.inspirationId], foreignColumns: [inspirations.profileId, inspirations.id], name: 'inspiration_processing_source_fk' }).onDelete('cascade'),
  sourceIdx: index('inspiration_processing_source_idx').on(table.profileId, table.inspirationId, table.createdAt),
  derivationUnique: uniqueIndex('inspiration_processing_derivation_unique').on(table.profileId, table.inspirationId, table.derivationJobId, table.derivationRequestVersion),
  readingJobIdx: index('inspiration_processing_reading_job_idx').on(table.readingJobId, table.readingRequestVersion),
  completion: check('inspiration_processing_completion', sql`${table.materialRevision} > 0 AND (${table.completedAt} IS NULL OR (${table.derivedAt} IS NOT NULL AND ${table.result} IS NOT NULL))`),
  requestVersions: check('inspiration_processing_request_versions', sql`(${table.derivationJobId} IS NULL OR (${table.derivationRequestVersion} IS NOT NULL AND ${table.derivationRequestVersion} > 0)) AND (${table.readingJobId} IS NULL OR (${table.readingRequestVersion} IS NOT NULL AND ${table.readingRequestVersion} > 0))`),
}));
