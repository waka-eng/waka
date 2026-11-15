/** Operational index coordination, not another memory layer. No words/vectors. */
import {sql} from 'drizzle-orm';
import {bigint,check,index,integer,numeric,pgSequence,pgTable,text,timestamp,uniqueIndex,uuid} from 'drizzle-orm/pg-core';
import {accounts} from './schema-accounts.js';
import {profiles} from './schema-profiles.js';

export const embeddingIndexWorkVersion=pgSequence('embedding_index_work_version_seq');
export const profileEmbeddingIndexes=pgTable('profile_embedding_indexes',{
 profileId:uuid('profile_id').primaryKey().references(()=>profiles.id,{onDelete:'cascade'}),
 activeSpace:text('active_space').notNull().default('gemini-embedding-001'),
 activeEpoch:bigint('active_epoch',{mode:'bigint'}).notNull().default(sql`0`),
 activeThresholdPolicy:text('active_threshold_policy').notNull().default('gemini-embedding-001.thresholds.v1'),
 buildingSpace:text('building_space'),
 buildingThresholdPolicy:text('building_threshold_policy'),
 /** Historical full-inventory proof, not a sticky whole-profile read gate. */
 cutoverCoveredVersion:bigint('cutover_covered_version',{mode:'bigint'}),
 updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
},t=>({
 spaces:check('profile_embedding_indexes_spaces',sql`${t.activeSpace} IN ('gemini-embedding-001','waka.embedding.gemini-2.text-retrieval.v1.768.raw') AND (${t.buildingSpace} IS NULL OR ${t.buildingSpace} IN ('gemini-embedding-001','waka.embedding.gemini-2.text-retrieval.v1.768.raw'))`),
 epochs:check('profile_embedding_indexes_epochs',sql`${t.activeEpoch}>=0 AND (${t.cutoverCoveredVersion} IS NULL OR ${t.cutoverCoveredVersion}>=0)`),
 build:check('profile_embedding_indexes_build',sql`(${t.buildingSpace} IS NULL)=(${t.buildingThresholdPolicy} IS NULL)`),
 threshold:check('profile_embedding_indexes_threshold',sql`(${t.activeSpace}='gemini-embedding-001' AND ${t.activeThresholdPolicy}='gemini-embedding-001.thresholds.v1') OR (${t.activeSpace}<>'gemini-embedding-001' AND ${t.activeThresholdPolicy}<>'embedding2.unvalidated')`),
}));

export const embeddingIndexWork=pgTable('embedding_index_work',{
 id:uuid('id').primaryKey().defaultRandom(),
 profileId:uuid('profile_id').notNull().references(()=>profiles.id,{onDelete:'cascade'}),
 space:text('space').notNull(),
 sourceKind:text('source_kind').$type<'inspiration'|'signal'>().notNull(),
 sourceId:uuid('source_id').notNull(),
 inputScope:text('input_scope').$type<'personal'|'public'|'statement'>().notNull(),
 requestedVersion:bigint('requested_version',{mode:'bigint'}).notNull().default(sql`nextval('embedding_index_work_version_seq')`),
 completedVersion:bigint('completed_version',{mode:'bigint'}).notNull().default(sql`0`),
 completedInputHash:text('completed_input_hash'),
 outcome:text('outcome').$type<'current'|'ineligible'|'failed'>(),
 failureCode:text('failure_code'),
 /** Queue cleanup cannot remove a source's durable progress. */
 jobId:uuid('job_id'),
 updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
},t=>({
 identity:uniqueIndex('embedding_index_work_identity').on(t.profileId,t.space,t.sourceKind,t.sourceId,t.inputScope),
 pending:index('embedding_index_work_pending').on(t.profileId,t.space,t.sourceKind,t.inputScope).where(sql`${t.requestedVersion}>${t.completedVersion}`),
 latest:index('embedding_index_work_latest').on(t.profileId,t.space,t.requestedVersion.desc()),
 versions:check('embedding_index_work_versions',sql`${t.requestedVersion}>0 AND ${t.completedVersion}>=0 AND ${t.completedVersion}<=${t.requestedVersion}`),
 source:check('embedding_index_work_source',sql`(${t.sourceKind}='inspiration' AND ${t.inputScope} IN ('personal','public')) OR (${t.sourceKind}='signal' AND ${t.inputScope}='statement')`),
 space:check('embedding_index_work_space',sql`${t.space} IN ('gemini-embedding-001','waka.embedding.gemini-2.text-retrieval.v1.768.raw')`),
 hash:check('embedding_index_work_hash',sql`${t.completedInputHash} IS NULL OR ${t.completedInputHash} ~ '^[a-f0-9]{64}$'`),
 outcome:check('embedding_index_work_outcome',sql`${t.outcome} IS NULL OR ${t.outcome} IN ('current','ineligible','failed')`),
 complete:check('embedding_index_work_complete',sql`(${t.completedVersion}=0 OR ${t.outcome} IS NOT NULL) AND (${t.outcome}<>'current' OR ${t.completedInputHash} IS NOT NULL) AND (${t.outcome}<>'ineligible' OR ${t.completedInputHash} IS NULL)`),
}));

export const embeddingIndexAttempts=pgTable('embedding_index_attempts',{
 id:uuid('id').primaryKey().defaultRandom(),
 accountId:uuid('account_id').notNull().references(()=>accounts.id,{onDelete:'cascade'}),
 /** Like background_job_runs, paid reservations survive source/profile deletion. */
 profileId:uuid('profile_id').notNull(),
 requestKey:text('request_key').notNull(),
 dispatchFamily:text('dispatch_family').$type<'index'|'discovery'>().notNull().default('index'),
 purpose:text('purpose').$type<'live'|'migration'>().notNull(),
 manifestHash:text('manifest_hash'),
 space:text('space').notNull(),
 sourceKind:text('source_kind').$type<'inspiration'|'signal'|'review_answer'>().notNull(),
 sourceId:uuid('source_id').notNull(),
 inputScope:text('input_scope').$type<'personal'|'public'|'statement'>().notNull(),
 inputHash:text('input_hash').notNull(),
 inputBytes:integer('input_bytes').notNull(),
 status:text('status').$type<'reserved'|'received'|'committed'|'http_failed'|'unknown'|'stale'>().notNull().default('reserved'),
 httpStatus:integer('http_status'),
 inputTokens:integer('input_tokens'),
 reportedCostUsd:numeric('reported_cost_usd'),
 startedAt:timestamp('started_at',{withTimezone:true}).notNull().defaultNow(),
 finishedAt:timestamp('finished_at',{withTimezone:true}),
},t=>({
 identity:uniqueIndex('embedding_index_attempts_request').on(t.accountId,t.requestKey),
 manifest:index('embedding_index_attempts_manifest').on(t.manifestHash),
 account:index('embedding_index_attempts_account').on(t.accountId,t.startedAt),
  unresolvedSource:index('embedding_index_attempts_unresolved_source').on(t.accountId,t.profileId,t.space,t.sourceKind,t.sourceId,t.inputScope,t.dispatchFamily).where(sql`${t.status} IN ('reserved','received','unknown')`),
 hash:check('embedding_index_attempts_hash',sql`${t.inputHash} ~ '^[a-f0-9]{64}$' AND (${t.manifestHash} IS NULL OR ${t.manifestHash} ~ '^[a-f0-9]{64}$')`),
 family:check('embedding_index_attempts_family',sql`${t.dispatchFamily} IN ('index','discovery') AND (${t.sourceKind}<>'review_answer' OR ${t.dispatchFamily}='discovery')`),
 purpose:check('embedding_index_attempts_purpose',sql`(${t.purpose}='live' AND ${t.manifestHash} IS NULL) OR (${t.purpose}='migration' AND ${t.manifestHash} IS NOT NULL)`),
 source:check('embedding_index_attempts_source',sql`(${t.sourceKind}='inspiration' AND ${t.inputScope} IN ('personal','public')) OR (${t.sourceKind} IN ('signal','review_answer') AND ${t.inputScope}='statement')`),
 status:check('embedding_index_attempts_status',sql`${t.status} IN ('reserved','received','committed','http_failed','unknown','stale')`),
 numeric:check('embedding_index_attempts_numeric',sql`${t.inputBytes}>=0 AND (${t.httpStatus} IS NULL OR ${t.httpStatus} BETWEEN 100 AND 599) AND (${t.inputTokens} IS NULL OR ${t.inputTokens}>=0) AND (${t.reportedCostUsd} IS NULL OR ${t.reportedCostUsd}>=0)`),
}));
