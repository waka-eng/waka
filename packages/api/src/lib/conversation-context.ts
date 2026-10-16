import {createHash} from 'node:crypto';
import {and,asc,desc,eq,inArray,sql} from 'drizzle-orm';
import {inspirations,principles,profiles,type ConversationPerspective,type ConversationReference} from '../db/index.js';
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
export interface ConversationSource {kind:'principle'|'top_of_mind_entry'|'inspiration';id:string;text:string;hash:string;owner?:'person'|'agent';legacyHash?:string;revision?:string;recordedAt?:string;artifactVersion?:number;historical?:boolean;state?:string;rank?:number;locked?:boolean;supportCurrent?:boolean;truncated:boolean}
/** The provider receives dated prose, not private record IDs or proof hashes. */
export function conversationPromptSources(sources:ConversationSource[]):ConversationReplyInput['sources']{
  return sources.map(({kind,text,owner,recordedAt,artifactVersion,historical,state,rank,locked,supportCurrent,truncated})=>({kind,text,...(owner?{owner}:{}),...(recordedAt?{recordedAt}:{}),...(artifactVersion?{artifactVersion,historical}:{}),state,rank,locked,supportCurrent,truncated}));
}
/**
 * Reuse exactly the serving predicates; no cached excerpts or model calls.
 *
 * `initialInspirationId` is the keep the person has pointed this conversation
 * at, and it is PINNED rather than ranked: present in `inspirations` whether
 * or not either retrieval path would have found it, and first in the list.
 *
 * Why pinning and not a ranking boost: the founder's case is "pick an
 * inspiration on the right and then like chat about it", and the sentence
 * typed about a keep routinely shares no words and no embedding neighbourhood
 * with it. A boost moves a candidate that was already a candidate; a keep that
 * scored nothing has nothing to boost. Nothing short of pinning makes "the
 * agent can read it" true.
 */
export async function readConversationContext(db:Reader,profileId:string,question:string,referenceIds?:ConversationReference[],initialPrincipleId?:string|null,initialInspirationId?:string|null,queryVector?:number[],onRetrievalTrace?:(trace:ConversationRetrievalTrace)=>void){
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
  /* THE PIN, APPLIED LAST so it survives both retrieval paths above — lexical
   * on its own (`GET /:id/context`, and a reply with no embedding yet) and the
   * hybrid re-read that replaces `i` wholesale when `queryVector` is supplied,
   * which is the live path `conversation-replies.ts` takes. Pinning before
   * either would have been silently discarded by the second one; this is the
   * only position where one piece of code covers both.
   *
   * NOT WHEN `referenceIds` IS GIVEN. That is the historical-citation read
   * (`readConversationReferenceSources`), which asks for an exact, closed set
   * of sources so an old citation can be re-opened and its hash re-proved.
   * An unrequested extra source there is not merely noise: `bound` below
   * spends one shared character allowance in list order, so a pinned keep
   * placed first would eat the allowance of the very source being re-opened
   * and could truncate or drop it — turning "your citation changed" on for a
   * record that never changed.
   *
   * Re-read rather than re-sorted in memory: `readConversationMaterial` is
   * the only thing that knows how to assemble a keep's reflections and media
   * into its excerpt, and a pinned keep that retrieval never saw has no row
   * here to sort. Handing it the ids re-reads with `array_position` ordering,
   * so the pin lands first and the retrieved order behind it is preserved.
   *
   * OWNER SCOPING COSTS NOTHING HERE: `readConversationMaterial` filters on
   * `profileId`, so a foreign or deleted id yields no row and the pin simply
   * does not appear — the same answer the composite FK already guarantees
   * cannot be stored. Skipped entirely when the pin is already in front,
   * which is the steady state once a conversation has one. */
  if(initialInspirationId&&!referenceIds&&i[0]?.id!==initialInspirationId)
    i=await readConversationMaterial(db,profileId,[],[initialInspirationId,...i.map(row=>row.id).filter(id=>id!==initialInspirationId)].slice(0,6));
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
/** A chat that reads two memories re-proves its citations against both: ids
 * are unique across profiles, so a source is found in whichever one holds it. */
async function referenceSourcesIn(db:Reader,profileIds:string|string[],references:ConversationReference[]):Promise<ConversationSource[]>{
  const out:ConversationSource[]=[];
  for(const profileId of Array.isArray(profileIds)?profileIds:[profileIds])out.push(...await readConversationReferenceSources(db,profileId,references));
  return out;
}
export async function currentConversationReferences(db:Reader,profileId:string|string[],references:ConversationReference[]):Promise<Array<ConversationSource|null>>{
  const available=await referenceSourcesIn(db,profileId,references);
  return references.map(reference=>available.find(source=>matchesReference(source,reference))??null);
}
/** Per-read batching, never a cross-request source cache. Three identities per
 * chunk fit every existing excerpt allowance, even with full-length sources. */
export async function currentConversationReferenceGroups(db:Reader,profileId:string|string[],groups:ConversationReference[][]):Promise<Array<Array<ConversationSource|null>>>{
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
    for(const source of await referenceSourcesIn(db,profileId,selected.slice(offset,offset+3))){
      const rows=available.get(key(source))??[];rows.push(source);available.set(key(source),rows);
    }
  }
  return groups.map(group=>group.map(reference=>available.get(key(reference))?.find(source=>matchesReference(source,reference))??null));
}

/* ═══ WHOSE MEMORY A CHAT READS ═══════════════════════════════════════════
   Founder, 2026-10-15: "new chat should also let you select if you want to
   chat with me vs my agent or both perspectives." See `conversations.
   perspective`. The chat stays the person's; this decides which memory the
   reply stands on. */
export interface ConversationMemory{perspective:ConversationPerspective;personId:string;agentId:string|null}
/** The memory a chat reads, re-checked every time: an agent that has since
 * been removed, or that is not this person's, falls back to their own. */
export async function conversationMemory(db:Reader,profileId:string,conversation:{perspective?:string|null;agentProfileId?:string|null}):Promise<ConversationMemory>{
  const wanted=conversation.perspective==='agent'||conversation.perspective==='both'?conversation.perspective:'mine';
  if(wanted==='mine'||!conversation.agentProfileId)return {perspective:'mine',personId:profileId,agentId:null};
  const agentId=await accountAgent(db,profileId,conversation.agentProfileId);
  return agentId?{perspective:wanted,personId:profileId,agentId}:{perspective:'mine',personId:profileId,agentId:null};
}
/** `agentId`, when it is an agent of the same account as `profileId` and
 * `profileId` is that account's person; otherwise null. The one ownership
 * rule for a chat's agent: checked when the chat is started, and again every
 * time it is read. */
export async function accountAgent(db:Reader,profileId:string,agentId:string):Promise<string|null>{
  const [owner]=await db.select({accountId:profiles.accountId,type:profiles.type}).from(profiles).where(eq(profiles.id,profileId));
  if(!owner?.accountId||owner.type!=='human')return null;
  const [agent]=await db.select({id:profiles.id}).from(profiles)
    .where(and(eq(profiles.id,agentId),eq(profiles.accountId,owner.accountId),eq(profiles.type,'agent')));
  return agent?.id??null;
}
/** Every profile whose sources this chat may cite. */
export function memoryProfiles(memory:ConversationMemory):string[]{
  return memory.perspective==='mine'||!memory.agentId?[memory.personId]:memory.perspective==='agent'?[memory.agentId]:[memory.personId,memory.agentId];
}
/* Two memories in one reply, without growing the reply: each kind is
   interleaved — yours, then the agent's, then yours — and held to the same
   character allowance and a source count under the prompt's ceiling, so a
   'both' chat costs what a 'mine' chat costs. */
const PERSPECTIVE_CAPS={principle:{chars:8000,count:8},top_of_mind_entry:{chars:4000,count:4},inspiration:{chars:4000,count:6}} as const;
function interleave(kind:ConversationSource['kind'],a:ConversationSource[],b:ConversationSource[]):ConversationSource[]{
  const out:ConversationSource[]=[];let chars=0;
  for(let i=0;i<Math.max(a.length,b.length);i++)for(const row of [a[i],b[i]]){
    if(!row||out.length>=PERSPECTIVE_CAPS[kind].count)continue;
    if(chars+row.text.length>PERSPECTIVE_CAPS[kind].chars)continue;
    chars+=row.text.length;out.push(row);
  }
  return out;
}
export async function readPerspectiveContext(db:Reader,memory:ConversationMemory,question:string,initialPrincipleId?:string|null,initialInspirationId?:string|null,queryVector?:number[],onRetrievalTrace?:(trace:ConversationRetrievalTrace)=>void){
  if(memory.perspective==='mine'||!memory.agentId)
    return readConversationContext(db,memory.personId,question,undefined,initialPrincipleId,initialInspirationId,queryVector,onRetrievalTrace);
  const tag=(owner:'person'|'agent',rows:ConversationSource[])=>rows.map(row=>({...row,owner}));
  /* The pins belong to the person's own memory; the agent's is read plain. */
  const agent=await readConversationContext(db,memory.agentId,question,undefined,null,null,queryVector,memory.perspective==='agent'?onRetrievalTrace:undefined);
  if(memory.perspective==='agent')
    return {...agent,principles:tag('agent',agent.principles),reading:tag('agent',agent.reading),inspirations:tag('agent',agent.inspirations)};
  const mine=await readConversationContext(db,memory.personId,question,undefined,initialPrincipleId,initialInspirationId,queryVector,onRetrievalTrace);
  return {...mine,
    principles:interleave('principle',tag('person',mine.principles),tag('agent',agent.principles)),
    reading:interleave('top_of_mind_entry',tag('person',mine.reading),tag('agent',agent.reading)),
    inspirations:interleave('inspiration',tag('person',mine.inspirations),tag('agent',agent.inspirations))};
}
