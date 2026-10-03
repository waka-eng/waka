import {sql} from 'drizzle-orm';
import {bigint,boolean,check,foreignKey,index,integer,pgTable,primaryKey,timestamp,uuid} from 'drizzle-orm/pg-core';
import {signals} from './schema-signals.js';
import {reviewAnswers,reviewAnswerSources} from './schema-reviews.js';

/** References only: the human answer stays in its original owned row. */
export const signalReviewEvidence=pgTable('signal_review_evidence',{
  profileId:uuid('profile_id').notNull(),signalId:uuid('signal_id').notNull(),
  sessionId:uuid('session_id').notNull(),answerId:uuid('answer_id').notNull(),
  statementRevision:bigint('statement_revision',{mode:'bigint'}).notNull(),
  answerRevision:integer('answer_revision').notNull(),sourceCount:integer('source_count').notNull(),
  questionContextIncluded:boolean('question_context_included').notNull(),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},table=>({
  identity:primaryKey({name:'signal_review_evidence_pk',columns:[table.profileId,table.signalId,table.answerId]}),
  signalFk:foreignKey({name:'signal_review_evidence_signal_fk',columns:[table.profileId,table.signalId],foreignColumns:[signals.profileId,signals.id]}).onDelete('cascade'),
  answerFk:foreignKey({name:'signal_review_evidence_answer_fk',columns:[table.profileId,table.sessionId,table.answerId],foreignColumns:[reviewAnswers.profileId,reviewAnswers.sessionId,reviewAnswers.id]}).onDelete('cascade'),
  answerIdx:index('signal_review_evidence_answer_idx').on(table.profileId,table.answerId),
  bounds:check('signal_review_evidence_bounds',sql`${table.statementRevision}>0 AND ${table.answerRevision}>0 AND ${table.sourceCount} BETWEEN 1 AND 5`),
}));

export const signalReviewEvidenceSources=pgTable('signal_review_evidence_sources',{
  profileId:uuid('profile_id').notNull(),signalId:uuid('signal_id').notNull(),answerId:uuid('answer_id').notNull(),
  inspirationId:uuid('inspiration_id').notNull(),materialRevision:bigint('material_revision',{mode:'bigint'}).notNull(),
  referenced:boolean('referenced').notNull(),
},table=>({
  identity:primaryKey({name:'signal_review_evidence_sources_pk',columns:[table.profileId,table.signalId,table.answerId,table.inspirationId]}),
  evidenceFk:foreignKey({name:'review_evidence_source_parent_fk',columns:[table.profileId,table.signalId,table.answerId],foreignColumns:[signalReviewEvidence.profileId,signalReviewEvidence.signalId,signalReviewEvidence.answerId]}).onDelete('cascade'),
  sourceFk:foreignKey({name:'review_evidence_source_answer_fk',columns:[table.profileId,table.answerId,table.inspirationId],foreignColumns:[reviewAnswerSources.profileId,reviewAnswerSources.answerId,reviewAnswerSources.inspirationId]}).onDelete('cascade'),
  sourceIdx:index('review_evidence_source_origin_idx').on(table.profileId,table.inspirationId),
  positiveRevision:check('review_evidence_source_revision',sql`${table.materialRevision}>0`),
}));
