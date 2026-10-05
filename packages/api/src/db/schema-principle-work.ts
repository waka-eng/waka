import {check,foreignKey,index,jsonb,pgTable,text,timestamp,uuid} from 'drizzle-orm/pg-core';
import {sql} from 'drizzle-orm';
import {profiles} from './schema-profiles.js';
import {backgroundJobs} from './schema-background-jobs.js';

/** Private generation receipts, not Principles or additional human evidence. */
export const principleGenerationSteps=pgTable('principle_generation_steps',{
  id:uuid('id').primaryKey().defaultRandom(),
  profileId:uuid('profile_id').notNull().references(()=>profiles.id,{onDelete:'cascade'}),
  billingProfileId:uuid('billing_profile_id').notNull().references(()=>profiles.id,{onDelete:'cascade'}),
  jobId:uuid('job_id'),
  inputHash:text('input_hash').notNull(),stepKey:text('step_key').notNull(),
  kind:text('kind').$type<'model'|'publication'>().notNull(),
  status:text('status').$type<'running'|'ready'|'failed'>().notNull(),
  response:jsonb('response').$type<unknown>(),
  startedAt:timestamp('started_at',{withTimezone:true}).notNull().defaultNow(),
  finishedAt:timestamp('finished_at',{withTimezone:true}),
},table=>({
  lookup:index('principle_generation_steps_lookup').on(table.profileId,table.inputHash,table.stepKey,table.status),
  budget:index('principle_generation_steps_budget').on(table.billingProfileId,table.startedAt),
  job:index('principle_generation_steps_job').on(table.jobId,table.kind),
  jobFk:foreignKey({columns:[table.billingProfileId,table.jobId],foreignColumns:[backgroundJobs.profileId,backgroundJobs.id],name:'principle_generation_steps_job_fk'}).onDelete('cascade'),
  kindCheck:check('principle_generation_steps_kind_check',sql`${table.kind} IN ('model','publication')`),
  statusCheck:check('principle_generation_steps_status_check',sql`${table.status} IN ('running','ready','failed')`),
}));
