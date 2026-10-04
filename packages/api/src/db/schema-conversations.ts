import {sql} from 'drizzle-orm';
import {check,foreignKey,index,integer,jsonb,pgTable,text,timestamp,unique,uniqueIndex,uuid} from 'drizzle-orm/pg-core';
import {profiles} from './schema-profiles.js';
import {backgroundJobs} from './schema-background-jobs.js';
import {principles} from './schema-principles.js';

export const conversations=pgTable('conversations',{
  id:uuid('id').primaryKey(),
  profileId:uuid('profile_id').notNull().references(()=>profiles.id,{onDelete:'cascade'}),
  initialPrincipleId:uuid('initial_principle_id'),
  revision:integer('revision').notNull().default(0),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
  updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
  deletedAt:timestamp('deleted_at',{withTimezone:true}),
},table=>({
  ownerIdentity:unique('conversations_owner_identity').on(table.profileId,table.id),
  initialPrincipleFk:foreignKey({columns:[table.profileId,table.initialPrincipleId],foreignColumns:[principles.profileId,principles.id],name:'conversations_initial_principle_fk'}),
  ownerUpdated:index('conversations_owner_updated_idx').on(table.profileId,table.updatedAt),
  revisionBounds:check('conversations_revision_bounds',sql`${table.revision} BETWEEN 0 AND 200`),
}));
export const conversationMessages=pgTable('conversation_messages',{
  id:uuid('id').primaryKey(),profileId:uuid('profile_id').notNull(),conversationId:uuid('conversation_id').notNull(),
  position:integer('position').notNull(),role:text('role').$type<'user'|'assistant'>().notNull(),content:text('content').notNull(),
  correctsMessageId:uuid('corrects_message_id'),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},table=>({
  ownerIdentity:unique('conversation_messages_owner_identity').on(table.profileId,table.conversationId,table.id),
  correctionFk:foreignKey({columns:[table.profileId,table.conversationId,table.correctsMessageId],foreignColumns:[table.profileId,table.conversationId,table.id],name:'conversation_messages_correction_fk'}),
  correctionRole:check('conversation_messages_correction_role',sql`${table.correctsMessageId} IS NULL OR (${table.role}='user' AND ${table.correctsMessageId}<>${table.id})`),
  conversationFk:foreignKey({columns:[table.profileId,table.conversationId],foreignColumns:[conversations.profileId,conversations.id],name:'conversation_messages_conversation_fk'}).onDelete('cascade'),
  positionUnique:unique('conversation_messages_position_unique').on(table.profileId,table.conversationId,table.position),
  bounds:check('conversation_messages_bounds',sql`${table.position} BETWEEN 1 AND 200 AND ${table.role} IN ('user','assistant') AND length(trim(${table.content})) > 0 AND length(${table.content}) <= 4000`),
}));

export type ConversationReference={kind:'principle'|'top_of_mind_entry'|'inspiration';id:string;hash:string;quoteStart?:number;quoteLength?:number};
export const conversationReplyRequests=pgTable('conversation_reply_requests',{
  id:uuid('id').primaryKey(),profileId:uuid('profile_id').notNull().references(()=>profiles.id,{onDelete:'cascade'}),conversationId:uuid('conversation_id').notNull(),
  userMessageId:uuid('user_message_id'),assistantMessageId:uuid('assistant_message_id'),jobId:uuid('job_id'),
  conversationRevision:integer('conversation_revision').notNull(),contextHash:text('context_hash').notNull(),
  status:text('status').$type<'pending'|'running'|'ready'|'failed'|'stopped'|'stale'>().notNull().default('pending'),
  references:jsonb('references').$type<ConversationReference[]>().notNull().default(sql`'[]'::jsonb`),
  followUpQuestion:text('follow_up_question'),failureCode:text('failure_code'),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
  dispatchedAt:timestamp('dispatched_at',{withTimezone:true}),finishedAt:timestamp('finished_at',{withTimezone:true}),
},table=>({
  conversationFk:foreignKey({columns:[table.profileId,table.conversationId],foreignColumns:[conversations.profileId,conversations.id],name:'conversation_replies_conversation_fk'}).onDelete('cascade'),
  userMessageFk:foreignKey({columns:[table.profileId,table.conversationId,table.userMessageId],foreignColumns:[conversationMessages.profileId,conversationMessages.conversationId,conversationMessages.id],name:'conversation_replies_user_message_fk'}),
  assistantMessageFk:foreignKey({columns:[table.profileId,table.conversationId,table.assistantMessageId],foreignColumns:[conversationMessages.profileId,conversationMessages.conversationId,conversationMessages.id],name:'conversation_replies_assistant_message_fk'}),
  jobFk:foreignKey({columns:[table.profileId,table.jobId],foreignColumns:[backgroundJobs.profileId,backgroundJobs.id],name:'conversation_replies_job_fk'}),
  active:uniqueIndex('conversation_replies_one_active').on(table.profileId,table.conversationId).where(sql`${table.status} IN ('pending','running')`),
  messageIdx:index('conversation_replies_message_idx').on(table.profileId,table.userMessageId,table.createdAt),
  budgetIdx:index('conversation_replies_budget_idx').on(table.profileId,table.dispatchedAt),
  stateCheck:check('conversation_replies_status_check',sql`${table.status} IN ('pending','running','ready','failed','stopped','stale')`),
}));
