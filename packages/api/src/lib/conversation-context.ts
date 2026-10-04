import {createHash} from 'node:crypto';
import {and,asc,desc,eq,ilike,inArray,isNull,or,sql} from 'drizzle-orm';
import {inspirations,principles,topOfMindEntries,topOfMinds,type ConversationReference} from '../db/index.js';
import type {getDb} from './db.js';
import {personalEntryReadable,personalEntrySupportCurrent,personalPrincipleReadable,personalPrincipleSupportCurrent} from './personal-output.js';
import {PRINCIPLE_MIN_SIGNALS} from './principle-generation.js';
import {CONVERSATION_REPLY_OUTPUT_TOKENS} from './model-provider.js';
export const CONVERSATION_LIMITS={conversations:100,messages:200,inputCharacters:4000,contextCharacters:16000,modelCalls:20,attemptsPerMessage:3,outputTokens:CONVERSATION_REPLY_OUTPUT_TOKENS} as const;
export const conversationRepliesEnabled=()=>process.env.WAKA_CONVERSATION_REPLIES==='1';
export const conversationCapabilities=()=>({generationEnabled:conversationRepliesEnabled(),limits:{...CONVERSATION_LIMITS,modelCalls:conversationRepliesEnabled()?CONVERSATION_LIMITS.modelCalls:0}});
type Reader=Pick<ReturnType<typeof getDb>,'select'>;
export const conversationHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface ConversationSource {kind:'principle'|'top_of_mind_entry'|'inspiration';id:string;text:string;hash:string;state?:string;rank?:number;locked?:boolean;supportCurrent?:boolean;truncated:boolean}
/** Reuse exactly the serving predicates; no cached excerpts or model calls. */
export async function readConversationContext(db:Reader,profileId:string,question:string,referenceIds?:ConversationReference[],initialPrincipleId?:string|null){
  const byKind=(kind:ConversationReference['kind'])=>referenceIds?.filter(row=>row.kind===kind).map(row=>row.id);
  const pIds=byKind('principle'),rIds=byKind('top_of_mind_entry'),iIds=byKind('inspiration');
  const p=await db.select({id:principles.id,text:principles.statement,revision:sql<string>`${principles.statementRevision}::text`,rank:principles.rank,state:principles.state,locked:sql<boolean>`${principles.lockedAt} IS NOT NULL`,supportCurrent:sql<boolean>`${principles.unsupportedAt} IS NULL AND ${personalPrincipleSupportCurrent(profileId,PRINCIPLE_MIN_SIGNALS)}`})
    .from(principles).where(and(eq(principles.profileId,profileId),personalPrincipleReadable(profileId,PRINCIPLE_MIN_SIGNALS),pIds?inArray(principles.id,pIds):undefined)).orderBy(...(initialPrincipleId?[desc(sql`${principles.id}=${initialPrincipleId}::uuid`)]:[]),asc(principles.rank),asc(principles.id)).limit(10);
  const r=await db.select({id:topOfMindEntries.id,text:topOfMindEntries.body,revision:sql<string>`${topOfMindEntries.bodyRevision}::text`,locked:sql<boolean>`${topOfMindEntries.lockedAt} IS NOT NULL`,supportCurrent:sql<boolean>`${personalEntrySupportCurrent(profileId)}`})
    .from(topOfMindEntries).innerJoin(topOfMinds,eq(topOfMinds.id,topOfMindEntries.topOfMindId))
    .where(and(eq(topOfMinds.profileId,profileId),eq(topOfMinds.status,'live'),isNull(topOfMindEntries.dismissedAt),personalEntryReadable(profileId),rIds?inArray(topOfMindEntries.id,rIds):undefined)).orderBy(asc(topOfMindEntries.sortOrder),asc(topOfMindEntries.id)).limit(5);
  const terms=[...new Set(question.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)??[])].slice(0,8);
  const i=terms.length||iIds?.length?await db.select({id:inspirations.id,text:inspirations.text,revision:sql<string>`${inspirations.updatedAt}::text`}).from(inspirations)
    .where(and(eq(inspirations.profileId,profileId),iIds?inArray(inspirations.id,iIds):or(...terms.map(term=>ilike(inspirations.text,`%${term}%`)))))
    .orderBy(desc(inspirations.createdAt),asc(inspirations.id)).limit(6):[];
  const bound=<T extends {id:string;text:string}>(kind:ConversationSource['kind'],rows:T[],allowance:number):ConversationSource[]=>rows.flatMap(row=>{
    if(allowance<=0)return [];const text=row.text.slice(0,Math.min(1600,allowance));allowance-=text.length;
    return [{...row,kind,text,hash:conversationHash(row),truncated:text.length<row.text.length}];
  });
  return {profileId,principles:bound('principle',p,referenceIds?16000:8000),reading:bound('top_of_mind_entry',r,referenceIds?8000:4000),inspirations:bound('inspiration',i,referenceIds?9600:4000),...conversationCapabilities()};
}
export async function currentConversationReferences(db:Reader,profileId:string,references:ConversationReference[]){
  if(!references.length)return [];
  const context=await readConversationContext(db,profileId,'',references),sources=[...context.principles,...context.reading,...context.inspirations];
  return references.map(reference=>sources.find(source=>source.kind===reference.kind&&source.id===reference.id&&source.hash===reference.hash)??null);
}
