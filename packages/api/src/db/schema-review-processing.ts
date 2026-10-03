import {sql} from 'drizzle-orm';
import {bigint,check,foreignKey,index,integer,jsonb,pgTable,primaryKey,text,timestamp,uuid} from 'drizzle-orm/pg-core';
import {reviewAnswers} from './schema-reviews.js';
import {signals} from './schema-signals.js';
import type {BackgroundJobResult} from './schema-background-jobs.js';

export const reviewSignalSupport=pgTable('review_signal_support',{
  profileId:uuid('profile_id').notNull(),sessionId:uuid('session_id').notNull(),answerId:uuid('answer_id').notNull(),signalId:uuid('signal_id').notNull(),
  answerRevision:integer('answer_revision').notNull(),statementRevision:bigint('statement_revision',{mode:'bigint'}).notNull(),
  materialHash:text('material_hash').notNull(),policy:text('policy').notNull(),
  verdict:text('verdict').$type<'supported'|'unsupported'|'unresolved'>().notNull(),
  lastExplicit:text('last_explicit').$type<'supported'|'unsupported'>(),
  checkedAt:timestamp('checked_at',{withTimezone:true}).notNull().default(sql`clock_timestamp()`),
},table=>({
  identity:primaryKey({name:'review_signal_support_pk',columns:[table.profileId,table.answerId,table.signalId]}),
  answerFk:foreignKey({name:'review_signal_support_answer_fk',columns:[table.profileId,table.sessionId,table.answerId],foreignColumns:[reviewAnswers.profileId,reviewAnswers.sessionId,reviewAnswers.id]}).onDelete('cascade'),
  signalFk:foreignKey({name:'review_signal_support_signal_fk',columns:[table.profileId,table.signalId],foreignColumns:[signals.profileId,signals.id]}).onDelete('cascade'),
  signalIdx:index('review_signal_support_signal_idx').on(table.profileId,table.signalId),
  bounds:check('review_signal_support_bounds',sql`${table.answerRevision}>0 AND ${table.statementRevision}>0 AND ${table.verdict} IN ('supported','unsupported','unresolved') AND (${table.lastExplicit} IS NULL OR ${table.lastExplicit} IN ('supported','unsupported')) AND (${table.verdict}='unresolved' OR (${table.lastExplicit}=${table.verdict}) IS TRUE)`),
}));

export const reviewAnswerProcessing=pgTable('review_answer_processing',{
  profileId:uuid('profile_id').notNull(),sessionId:uuid('session_id').notNull(),answerId:uuid('answer_id').notNull(),
  materialHash:text('material_hash').notNull(),discoveryHash:text('discovery_hash'),
  // Tenant-bearing partial SET NULL foreign keys are installed in migration 0059.
  derivationJobId:uuid('derivation_job_id'),
  derivationRequestVersion:bigint('derivation_request_version',{mode:'bigint'}),
  readingJobId:uuid('reading_job_id'),
  readingRequestVersion:bigint('reading_request_version',{mode:'bigint'}),
  signalIds:uuid('signal_ids').array().notNull().default(sql`ARRAY[]::uuid[]`),
  result:jsonb('result').$type<BackgroundJobResult>(),
  derivedAt:timestamp('derived_at',{withTimezone:true}),completedAt:timestamp('completed_at',{withTimezone:true}),
  updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().default(sql`clock_timestamp()`),
},table=>({
  identity:primaryKey({name:'review_answer_processing_pk',columns:[table.profileId,table.answerId]}),
  answerFk:foreignKey({name:'review_processing_answer_fk',columns:[table.profileId,table.sessionId,table.answerId],foreignColumns:[reviewAnswers.profileId,reviewAnswers.sessionId,reviewAnswers.id]}).onDelete('cascade'),
  readingIdx:index('review_processing_reading_idx').on(table.readingJobId,table.readingRequestVersion),
  bounds:check('review_processing_bounds',sql`(${table.derivationJobId} IS NULL OR (${table.derivationRequestVersion} IS NOT NULL AND ${table.derivationRequestVersion}>0)) AND (${table.readingJobId} IS NULL OR (${table.readingRequestVersion} IS NOT NULL AND ${table.readingRequestVersion}>0)) AND (${table.completedAt} IS NULL OR (${table.derivedAt} IS NOT NULL AND ${table.result} IS NOT NULL))`),
}));
