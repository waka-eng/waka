import {sql} from 'drizzle-orm';
import {check,foreignKey,index,integer,jsonb,pgTable,text,timestamp,unique,uniqueIndex,uuid} from 'drizzle-orm/pg-core';
import {profiles} from './schema-profiles.js';
import {backgroundJobs} from './schema-background-jobs.js';
import {principles} from './schema-principles.js';
import {inspirations} from './schema-inspirations.js';

/** Whose memory a chat's replies stand on — see `conversations.perspective`.
    The one list: the column's type, its check, the route's validation and
    the prompt's input all read it. */
export const conversationPerspectiveValues=['mine','agent','both'] as const;
export type ConversationPerspective=(typeof conversationPerspectiveValues)[number];

export const conversations=pgTable('conversations',{
  id:uuid('id').primaryKey(),
  profileId:uuid('profile_id').notNull().references(()=>profiles.id,{onDelete:'cascade'}),
  initialPrincipleId:uuid('initial_principle_id'),
  /**
   * WHICH SAVED THING THIS CONVERSATION IS ABOUT RIGHT NOW.
   *
   * Founder: "I basically want to have a good experience where user can pick
   * an inspiration on the right and then like chat about it and then when the
   * user specifically brings that up then the agent can read it."
   *
   * The last clause is the whole reason this column exists rather than being
   * left to retrieval. Semantic and lexical retrieval answer "what in the
   * archive resembles this question"; they do not answer "the person is
   * pointing at THIS one". A picked keep whose words share nothing with the
   * sentence typed about it — a photo caption, a link, a line in Korean asked
   * about in English — is exactly the case retrieval misses, and it is the
   * case the founder described. So the choice is stored and the reading is
   * pinned from it (`readConversationContext`), never hoped for.
   *
   * MUTABLE, UNLIKE `initial_principle_id` BESIDE IT. A principle start is
   * where a conversation came from and can never have been anywhere else; the
   * picked keep is where the conversation is pointed, and "pick an inspiration
   * on the right ... while chatting" means the person changes it mid-thread.
   * `PATCH /conversations/:id` is the only writer after create. The `initial_`
   * prefix is kept anyway so the pair reads as one family on the row and in
   * the wire shape (`initialPrinciple` / `initialInspiration`) — renaming the
   * concept to `focusInspirationId` was considered and rejected: it would have
   * made two columns doing the same job look unrelated.
   *
   * NULLABLE AND NULL BY DEFAULT, with no backfill. Most conversations are
   * about nothing in the archive, every row that exists today is one of those,
   * and clearing the pick is a thing the person can do (`inspirationId: null`)
   * — so null has to be a real, reachable answer rather than an absence.
   *
   * The composite FK below — `(profile_id, initial_inspiration_id)` against
   * `inspirations (profile_id, id)` — is what makes cross-profile pinning
   * STRUCTURAL rather than checked. A conversation cannot name another
   * profile's keep even if every handler forgot to scope its query, because
   * the row Postgres would have to find does not exist. A plain
   * `references(inspirations.id)` was rejected for precisely that reason: it
   * would have made tenant isolation a rule to remember.
   */
  initialInspirationId:uuid('initial_inspiration_id'),
  revision:integer('revision').notNull().default(0),
  /**
   * WHOSE MEMORY THE REPLY READS. Founder, 2026-10-15: "new chat should also
   * let you select if you want to chat with me vs my agent or both
   * perspectives."
   *
   * The conversation is still the person's — one list, one owner, per the
   * earlier ruling that "there should be no difference between me and my
   * agent's chat". What changes is the material the reply stands on: the
   * person's own saves ('mine', and every chat before this column), the
   * agent's ('agent'), or both, each source labelled with whose it is
   * ('both'). `agentProfileId` names which agent; if it is gone, the chat
   * quietly reads the person's own memory again.
   */
  perspective:text('perspective').$type<ConversationPerspective>().notNull().default('mine'),
  agentProfileId:uuid('agent_profile_id').references(()=>profiles.id,{onDelete:'set null'}),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
  updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
  deletedAt:timestamp('deleted_at',{withTimezone:true}),
},table=>({
  ownerIdentity:unique('conversations_owner_identity').on(table.profileId,table.id),
  initialPrincipleFk:foreignKey({columns:[table.profileId,table.initialPrincipleId],foreignColumns:[principles.profileId,principles.id],name:'conversations_initial_principle_fk'}),
  /**
   * Declared without `.onDelete(...)` for the same reason the principle FK
   * above is: deleting the keep must null `initial_inspiration_id` ALONE, and
   * a bare composite `ON DELETE SET NULL` would null `profile_id` too —
   * detaching the conversation from its owner, which is unthinkable. The
   * column-list form `ON DELETE SET NULL (initial_inspiration_id)` that says
   * so is not expressible in the builder, so it lives in migration 0070, the
   * same split `inspirations.experience_id` and `profiles.group_id` use.
   */
  initialInspirationFk:foreignKey({columns:[table.profileId,table.initialInspirationId],foreignColumns:[inspirations.profileId,inspirations.id],name:'conversations_initial_inspiration_fk'}),
  ownerUpdated:index('conversations_owner_updated_idx').on(table.profileId,table.updatedAt),
  revisionBounds:check('conversations_revision_bounds',sql`${table.revision} BETWEEN 0 AND 200`),
  /* Spelled out because the migration that created it is: keep it equal to
     `conversationPerspectiveValues`. */
  perspectiveCheck:check('conversations_perspective_check',sql`${table.perspective} IN ('mine','agent','both')`),
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

export type ConversationReference={kind:'principle'|'top_of_mind_entry'|'inspiration';id:string;hash:string;quoteStart?:number;quoteLength?:number;historical?:boolean};
export const conversationReplyRequests=pgTable('conversation_reply_requests',{
  id:uuid('id').primaryKey(),profileId:uuid('profile_id').notNull().references(()=>profiles.id,{onDelete:'cascade'}),conversationId:uuid('conversation_id').notNull(),
  userMessageId:uuid('user_message_id'),assistantMessageId:uuid('assistant_message_id'),jobId:uuid('job_id'),
  conversationRevision:integer('conversation_revision').notNull(),contextHash:text('context_hash').notNull(),
  status:text('status').$type<'pending'|'running'|'ready'|'failed'|'stopped'|'stale'>().notNull().default('pending'),
  references:jsonb('references').$type<ConversationReference[]>().notNull().default(sql`'[]'::jsonb`),
  contextSources:jsonb('context_sources').$type<ConversationReference[]>(),
  followUpQuestion:text('follow_up_question'),failureCode:text('failure_code'),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
  dispatchedAt:timestamp('dispatched_at',{withTimezone:true}),finishedAt:timestamp('finished_at',{withTimezone:true}),
  retrievalDispatchedAt:timestamp('retrieval_dispatched_at',{withTimezone:true}),
},table=>({
  conversationFk:foreignKey({columns:[table.profileId,table.conversationId],foreignColumns:[conversations.profileId,conversations.id],name:'conversation_replies_conversation_fk'}).onDelete('cascade'),
  userMessageFk:foreignKey({columns:[table.profileId,table.conversationId,table.userMessageId],foreignColumns:[conversationMessages.profileId,conversationMessages.conversationId,conversationMessages.id],name:'conversation_replies_user_message_fk'}),
  assistantMessageFk:foreignKey({columns:[table.profileId,table.conversationId,table.assistantMessageId],foreignColumns:[conversationMessages.profileId,conversationMessages.conversationId,conversationMessages.id],name:'conversation_replies_assistant_message_fk'}),
  jobFk:foreignKey({columns:[table.profileId,table.jobId],foreignColumns:[backgroundJobs.profileId,backgroundJobs.id],name:'conversation_replies_job_fk'}),
  active:uniqueIndex('conversation_replies_one_active').on(table.profileId,table.conversationId).where(sql`${table.status} IN ('pending','running')`),
  messageIdx:index('conversation_replies_message_idx').on(table.profileId,table.userMessageId,table.createdAt),
  budgetIdx:index('conversation_replies_budget_idx').on(table.profileId,table.dispatchedAt),
  stateCheck:check('conversation_replies_status_check',sql`${table.status} IN ('pending','running','ready','failed','stopped','stale')`),
  contextSourcesCheck:check('conversation_context_sources_bounds',sql`${table.contextSources} IS NULL OR (jsonb_typeof(${table.contextSources})='array' AND jsonb_array_length(${table.contextSources})<=21)`),
}));
