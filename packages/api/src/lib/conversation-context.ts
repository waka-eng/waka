import {createHash} from 'node:crypto';
import {and,asc,desc,eq,inArray,sql} from 'drizzle-orm';
import {inspirations,principles,type ConversationReference} from '../db/index.js';
import type {getDb} from './db.js';
import {personalPrincipleReadable,personalPrincipleSupportCurrent} from './personal-output.js';
import {PRINCIPLE_MIN_SIGNALS} from './principle-generation.js';
import {CONVERSATION_REPLY_OUTPUT_TOKENS,type ConversationReplyInput} from './model-provider.js';
import {conversationSearchTerms,readConversationMaterial} from './conversation-material.js';
import {rankConversationCandidates,readSemanticConversationCandidates,type ConversationRetrievalTrace} from './conversation-retrieval.js';
import {measurePerformanceStage} from './performance-stages.js';
import {readConversationReadings} from './conversation-readings.js';
export const CONVERSATION_LIMITS={conversations:100,messages:200,inputCharacters:4000,contextCharacters:16000,modelCalls:20,attemptsPerMessage:3,outputTokens:CONVERSATION_REPLY_OUTPUT_TOKENS} as const;
export const conversationRepliesEnabled=()=>process.env.WAKA_CONVERSATION_REPLIES==='1';
export const conversationCapabilities=()=>({generationEnabled:conversationRepliesEnabled(),limits:{...CONVERSATION_LIMITS,modelCalls:conversationRepliesEnabled()?CONVERSATION_LIMITS.modelCalls:0}});
type Reader=Pick<ReturnType<typeof getDb>,'select'>;
export const conversationHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface ConversationSource {kind:'principle'|'top_of_mind_entry'|'inspiration';id:string;text:string;hash:string;legacyHash?:string;revision?:string;recordedAt?:string;artifactVersion?:number;historical?:boolean;state?:string;rank?:number;locked?:boolean;supportCurrent?:boolean;truncated:boolean}
/** The provider receives dated prose, not private record IDs or proof hashes. */
export function conversationPromptSources(sources:ConversationSource[]):ConversationReplyInput['sources']{
  return sources.map(({kind,text,recordedAt,artifactVersion,historical,state,rank,locked,supportCurrent,truncated})=>({kind,text,...(recordedAt?{recordedAt}:{}),...(artifactVersion?{artifactVersion,historical}:{}),state,rank,locked,supportCurrent,truncated}));
}
/** Reuse exactly the serving predicates; no cached excerpts or model calls. */
export async function readConversationContext(db:Reader,profileId:string,question:string,referenceIds?:ConversationReference[],initialPrincipleId?:string|null,queryVector?:number[],onRetrievalTrace?:(trace:ConversationRetrievalTrace)=>void){
  return measurePerformanceStage('context_read','conversation',async()=>{
  const byKind=(kind:ConversationReference['kind'])=>referenceIds?.filter(row=>row.kind===kind).map(row=>row.id);
  const pIds=byKind('principle'),rIds=byKind('top_of_mind_entry'),iIds=byKind('inspiration');
  const p=await db.select({id:principles.id,text:principles.statement,revision:sql<string>`${principles.statementRevision}::text`,rank:principles.rank,state:principles.state,locked:sql<boolean>`${principles.lockedAt} IS NOT NULL`,supportCurrent:sql<boolean>`${principles.unsupportedAt} IS NULL AND ${personalPrincipleSupportCurrent(profileId,PRINCIPLE_MIN_SIGNALS)}`})
    .from(principles).where(and(eq(principles.profileId,profileId),personalPrincipleReadable(profileId,PRINCIPLE_MIN_SIGNALS),pIds?inArray(principles.id,pIds):undefined)).orderBy(...(initialPrincipleId?[desc(sql`${principles.id}=${initialPrincipleId}::uuid`)]:[]),asc(principles.rank),asc(principles.id)).limit(10);
  const r=(await readConversationReadings(db,profileId,question,rIds)).map(row=>{
    const {historical,...proof}=row;
    return {...row,hash:'reading-v2:'+conversationHash(proof),legacyHash:conversationHash({id:row.id,text:row.text,revision:row.revision,locked:row.locked,supportCurrent:row.supportCurrent})};
  });
  let i=await readConversationMaterial(db,profileId,conversationSearchTerms(question),iIds);
  if(queryVector&&!referenceIds){
    const semantic=await readSemanticConversationCandidates(db,profileId,queryVector,undefined,i.map(row=>row.id));
    onRetrievalTrace?.(semantic.trace);
    const ids=rankConversationCandidates(i.map(row=>row.id),semantic.candidates,semantic.similarities);
    i=await readConversationMaterial(db,profileId,[],ids);
  }
  const bound=<T extends {id:string;text:string}>(kind:ConversationSource['kind'],rows:T[],allowance:number):ConversationSource[]=>rows.flatMap(row=>{
    if(allowance<=0)return [];const text=row.text.slice(0,Math.min(1600,allowance));allowance-=text.length;
    return [{...row,kind,text,hash:'hash' in row&&typeof row.hash==='string'?row.hash:conversationHash(row),truncated:text.length<row.text.length||('truncated' in row&&row.truncated===true)}];
  });
  return {profileId,principles:bound('principle',p,referenceIds?16000:8000),reading:bound('top_of_mind_entry',r,referenceIds?8000:4000),inspirations:bound('inspiration',i,referenceIds?9600:4000),...conversationCapabilities()};
  });
}
async function readConversationReferenceSources(db:Reader,profileId:string,references:ConversationReference[]):Promise<ConversationSource[]>{
  if(!references.length)return [];
  const context=await readConversationContext(db,profileId,'',references),sources=[...context.principles,...context.reading,...context.inspirations];
  // Old citations refer only to the original text. Preserve their exact hash
  // and offsets; do not relabel a plain-text quote as enriched material.
  const legacyIds=references.filter(row=>row.kind==='inspiration'&&/^[a-f0-9]{64}$/.test(row.hash)).map(row=>row.id);
  const legacy=legacyIds.length?await db.select({id:inspirations.id,text:inspirations.text,recordedAt:sql<string>`${inspirations.createdAt}::text`,revision:sql<string>`${inspirations.updatedAt}::text`})
    .from(inspirations).where(and(eq(inspirations.profileId,profileId),inArray(inspirations.id,legacyIds))).limit(6):[];
  return [...sources,...legacy.map(row=>({...row,kind:'inspiration' as const,hash:conversationHash(row),truncated:row.text.length>1600,text:row.text.slice(0,1600)}))];
}
const matchesReference=(source:ConversationSource,reference:ConversationReference)=>source.kind===reference.kind&&source.id===reference.id&&
  (source.hash===reference.hash||source.kind==='top_of_mind_entry'&&source.legacyHash===reference.hash);
export async function currentConversationReferences(db:Reader,profileId:string,references:ConversationReference[]):Promise<Array<ConversationSource|null>>{
  const available=await readConversationReferenceSources(db,profileId,references);
  return references.map(reference=>available.find(source=>matchesReference(source,reference))??null);
}
/** Per-read batching, never a cross-request source cache. Three identities per
 * chunk fit every existing excerpt allowance, even with full-length sources. */
export async function currentConversationReferenceGroups(db:Reader,profileId:string,groups:ConversationReference[][]):Promise<Array<Array<ConversationSource|null>>>{
  if(groups.length>CONVERSATION_LIMITS.messages||groups.some(group=>group.length>3))throw new Error('Conversation reference bounds');
  const key=(source:{kind:string;id:string})=>`${source.kind}:${source.id}`;
  const identities=new Map<string,ConversationReference>();
  for(const reference of groups.flat()){
    // A legacy inspiration needs its original-text projection as well as the
    // enriched one. Prefer that representative if either proof is requested.
    if(!identities.has(key(reference))||reference.kind==='inspiration'&&/^[a-f0-9]{64}$/.test(reference.hash))identities.set(key(reference),reference);
  }
  const selected=[...identities.values()],available=new Map<string,ConversationSource[]>();
  for(let offset=0;offset<selected.length;offset+=3){
    for(const source of await readConversationReferenceSources(db,profileId,selected.slice(offset,offset+3))){
      const rows=available.get(key(source))??[];rows.push(source);available.set(key(source),rows);
    }
  }
  return groups.map(group=>group.map(reference=>available.get(key(reference))?.find(source=>matchesReference(source,reference))??null));
}
