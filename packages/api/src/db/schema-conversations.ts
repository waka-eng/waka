import {sql} from 'drizzle-orm';
import {check,foreignKey,index,integer,pgTable,text,timestamp,unique,uuid} from 'drizzle-orm/pg-core';
import {profiles} from './schema-profiles.js';

export const conversations=pgTable('conversations',{
  id:uuid('id').primaryKey(),
  profileId:uuid('profile_id').notNull().references(()=>profiles.id,{onDelete:'cascade'}),
  revision:integer('revision').notNull().default(0),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
  updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
  deletedAt:timestamp('deleted_at',{withTimezone:true}),
},table=>({
  ownerIdentity:unique('conversations_owner_identity').on(table.profileId,table.id),
  ownerUpdated:index('conversations_owner_updated_idx').on(table.profileId,table.updatedAt),
  revisionBounds:check('conversations_revision_bounds',sql`${table.revision} BETWEEN 0 AND 200`),
}));
export const conversationMessages=pgTable('conversation_messages',{
  id:uuid('id').primaryKey(),profileId:uuid('profile_id').notNull(),conversationId:uuid('conversation_id').notNull(),
  position:integer('position').notNull(),role:text('role').$type<'user'|'assistant'>().notNull(),content:text('content').notNull(),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},table=>({
  conversationFk:foreignKey({columns:[table.profileId,table.conversationId],foreignColumns:[conversations.profileId,conversations.id],name:'conversation_messages_conversation_fk'}).onDelete('cascade'),
  positionUnique:unique('conversation_messages_position_unique').on(table.profileId,table.conversationId,table.position),
  bounds:check('conversation_messages_bounds',sql`${table.position} BETWEEN 1 AND 200 AND ${table.role} IN ('user','assistant') AND length(trim(${table.content})) > 0 AND length(${table.content}) <= 4000`),
}));
