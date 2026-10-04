import {and,eq} from 'drizzle-orm';
import {conversationMessages,conversations,inspirationConversationOrigins} from '../db/index.js';
import {InspirationSaveError,type InspirationSaveTransaction} from './inspiration-save-requests.js';
import type {CreateInspirationInput} from '../routes/inspirations-validation.js';

/** The role comes from the owned immutable message, never from the browser. */
export async function prepareConversationOrigin(tx:InspirationSaveTransaction,profileId:string,input:NonNullable<CreateInspirationInput['fromConversation']>,text:string){
  const [conversation]=await tx.select().from(conversations).where(and(eq(conversations.profileId,profileId),eq(conversations.id,input.conversationId))).for('update');
  if(!conversation||conversation.deletedAt)throw new InspirationSaveError(404,'conversation_not_found','This conversation is no longer available.');
  const [message]=await tx.select().from(conversationMessages).where(and(eq(conversationMessages.profileId,profileId),eq(conversationMessages.conversationId,input.conversationId),eq(conversationMessages.id,input.messageId)));
  if(!message||!message.content.includes(input.selectedText))throw new InspirationSaveError(409,'conversation_selection_changed','Choose words from this message.');
  if(message.role==='assistant'&&(!input.adopted||text.trim()===input.selectedText.trim()||text.trim()===message.content.trim()))
    throw new InspirationSaveError(400,'adoption_required','Write your own takeaway and confirm it before saving.');
  if(message.role==='user'&&input.adopted)throw new InspirationSaveError(400,'invalid_authorship','These are already your words.');
  return {profileId,conversationId:conversation.id,messageId:message.id,authorship:message.role==='user'?'user' as const:'adopted' as const};
}

export async function readConversationOrigin(tx:Pick<InspirationSaveTransaction,'select'>,profileId:string,inspirationId:string):Promise<{conversationId:string|null;messageId:string|null;authorship:'user'|'adopted'}|null>{
  const [row]=await tx.select({conversationId:inspirationConversationOrigins.conversationId,messageId:inspirationConversationOrigins.messageId,authorship:inspirationConversationOrigins.authorship})
    .from(inspirationConversationOrigins).where(and(eq(inspirationConversationOrigins.profileId,profileId),eq(inspirationConversationOrigins.inspirationId,inspirationId)));
  return row??null;
}
