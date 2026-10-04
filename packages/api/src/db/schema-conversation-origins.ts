import {sql} from 'drizzle-orm';
import {check,foreignKey,pgTable,text,timestamp,uuid} from 'drizzle-orm/pg-core';
import {inspirations} from './schema-inspirations.js';
import {conversationMessages} from './schema-conversations.js';

/** An inspiration survives deleting the chat; the nullable source link does
 * not. Migration uses column-specific SET NULL to retain profile ownership. */
export const inspirationConversationOrigins=pgTable('inspiration_conversation_origins',{
  inspirationId:uuid('inspiration_id').primaryKey(),profileId:uuid('profile_id').notNull(),
  conversationId:uuid('conversation_id'),messageId:uuid('message_id'),
  authorship:text('authorship').$type<'user'|'adopted'>().notNull(),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},table=>({
  inspirationFk:foreignKey({columns:[table.profileId,table.inspirationId],foreignColumns:[inspirations.profileId,inspirations.id],name:'conversation_origins_inspiration_fk'}).onDelete('cascade'),
  messageFk:foreignKey({columns:[table.profileId,table.conversationId,table.messageId],foreignColumns:[conversationMessages.profileId,conversationMessages.conversationId,conversationMessages.id],name:'conversation_origins_message_fk'}),
  authorshipCheck:check('conversation_origins_authorship_check',sql`${table.authorship} IN ('user','adopted')`),
  sourceCheck:check('conversation_origins_source_check',sql`(${table.conversationId} IS NULL) = (${table.messageId} IS NULL)`),
}));
