import { sql } from 'drizzle-orm';
import { bigint, boolean, check, foreignKey, index, integer, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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

export const reviewAnswers = pgTable('review_answers', {
  id:uuid('id').primaryKey(),
  profileId:uuid('profile_id').notNull(),
  sessionId:uuid('session_id').notNull(),
  questionJobId:uuid('question_job_id').notNull(),
  inputHash:text('input_hash').notNull(),
  contextHash:text('context_hash').notNull(),
  question:text('question'),
  connection:text('connection'),
  answer:text('answer'),
  revision:integer('revision').notNull().default(1),
  sourceCount:integer('source_count').notNull(),
  contextInvalidatedAt:timestamp('context_invalidated_at',{withTimezone:true}),
  deletedAt:timestamp('deleted_at',{withTimezone:true}),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().default(sql`clock_timestamp()`),
  updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
},table=>({
  identity:unique('review_answers_owner_identity').on(table.profileId,table.sessionId,table.id),
  profileIdentity:unique('review_answers_profile_identity').on(table.profileId,table.id),
  questionUnique:unique('review_answers_question_unique').on(table.profileId,table.sessionId,table.questionJobId),
  sessionFk:foreignKey({columns:[table.profileId,table.sessionId],foreignColumns:[reviewSessions.profileId,reviewSessions.id],name:'review_answers_session_fk'}).onDelete('cascade'),
  bounds:check('review_answers_bounds',sql`${table.revision} > 0 AND ${table.sourceCount} BETWEEN 1 AND 5 AND ((${table.deletedAt} IS NULL AND ${table.answer} IS NOT NULL AND length(trim(${table.answer})) > 0 AND length(${table.answer}) <= 16000) OR (${table.deletedAt} IS NOT NULL AND ${table.answer} IS NULL AND ${table.question} IS NULL AND ${table.connection} IS NULL))`),
  sessionIdx:index('review_answers_session_idx').on(table.profileId,table.sessionId,table.createdAt),
}));

export const reviewAnswerSources=pgTable('review_answer_sources',{
  profileId:uuid('profile_id').notNull(),sessionId:uuid('session_id').notNull(),answerId:uuid('answer_id').notNull(),
  inspirationId:uuid('inspiration_id').notNull(),sourceRevision:bigint('source_revision',{mode:'bigint'}).notNull(),
  referenced:boolean('referenced').notNull(),
},table=>({
  identity:primaryKey({columns:[table.profileId,table.answerId,table.inspirationId]}),
  answerFk:foreignKey({columns:[table.profileId,table.sessionId,table.answerId],foreignColumns:[reviewAnswers.profileId,reviewAnswers.sessionId,reviewAnswers.id],name:'review_answer_sources_answer_fk'}).onDelete('cascade'),
  itemFk:foreignKey({columns:[table.profileId,table.sessionId,table.inspirationId],foreignColumns:[reviewItems.profileId,reviewItems.sessionId,reviewItems.inspirationId],name:'review_answer_sources_item_fk'}).onDelete('cascade'),
  sourceIdx:index('review_answer_sources_source_idx').on(table.profileId,table.inspirationId),
  revisionCheck:check('review_answer_sources_revision_check',sql`${table.sourceRevision} > 0`),
}));
