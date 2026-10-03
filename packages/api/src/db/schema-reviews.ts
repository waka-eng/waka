import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, integer, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { profiles } from './schema-profiles.js';
import { inspirations } from './schema-inspirations.js';

export const reviewSessions = pgTable('review_sessions', {
  id: uuid('id').primaryKey(),
  profileId: uuid('profile_id').notNull().references(()=>profiles.id,{onDelete:'cascade'}),
  inputHash: text('input_hash').notNull(),
  revision: integer('revision').notNull().default(0),
  cursor: integer('cursor').notNull().default(0),
  createdAt: timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
  updatedAt: timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
  completedAt: timestamp('completed_at',{withTimezone:true}),
}, table=>({
  ownerIdentity: unique('review_sessions_owner_identity').on(table.profileId,table.id),
  oneOpen: uniqueIndex('review_sessions_one_open').on(table.profileId).where(sql`${table.completedAt} IS NULL`),
  bounds: check('review_sessions_bounds',sql`${table.revision} >= 0 AND ${table.cursor} BETWEEN 0 AND 5`),
}));

export const reviewItems = pgTable('review_items', {
  profileId: uuid('profile_id').notNull(),
  sessionId: uuid('session_id').notNull(),
  inspirationId: uuid('inspiration_id').notNull(),
  position: integer('position').notNull(),
  sourceRevision: bigint('source_revision',{mode:'bigint'}).notNull(),
  reason: text('reason').$type<'unreviewed'|'revisit'|'chosen'>().notNull(),
  choice: text('choice').$type<'keep'|'skip'>(),
  decidedAt: timestamp('decided_at',{withTimezone:true}),
}, table=>({
  identity: primaryKey({columns:[table.profileId,table.sessionId,table.inspirationId]}),
  positionUnique: unique('review_items_position_unique').on(table.profileId,table.sessionId,table.position),
  sourceIdx: index('review_items_source_idx').on(table.profileId,table.inspirationId),
  sessionFk: foreignKey({columns:[table.profileId,table.sessionId],foreignColumns:[reviewSessions.profileId,reviewSessions.id],name:'review_items_session_fk'}).onDelete('cascade'),
  sourceFk: foreignKey({columns:[table.profileId,table.inspirationId],foreignColumns:[inspirations.profileId,inspirations.id],name:'review_items_source_fk'}).onDelete('cascade'),
  bounds: check('review_items_bounds',sql`${table.position} BETWEEN 0 AND 4 AND ${table.sourceRevision} > 0`),
  reasonCheck: check('review_items_reason_check',sql`${table.reason} IN ('unreviewed','revisit','chosen')`),
  choiceCheck: check('review_items_choice_check',sql`(${table.choice} IS NULL AND ${table.decidedAt} IS NULL) OR (${table.choice} IS NOT NULL AND ${table.choice} IN ('keep','skip') AND ${table.decidedAt} IS NOT NULL)`),
}));
