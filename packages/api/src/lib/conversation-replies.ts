import {randomUUID} from 'node:crypto';
import {and,asc,desc,eq,gte,inArray,sql} from 'drizzle-orm';
import {backgroundJobs,conversationMessages,conversationReplyRequests,conversations,generationRevisions,inspirationEmbeddings,profiles,type BackgroundJob,type ConversationReference} from '../db/index.js';
import type {getDb} from './db.js';
import {CONVERSATION_LIMITS,conversationHash,conversationRepliesEnabled,currentConversationReferences,readConversationContext,conversationPromptSources} from './conversation-context.js';
import {getDefaultModelProvider,type ConversationReplyInput} from './model-provider.js';
import {parseConversationReply} from '../queue/gemini.js';
import {conversationSearchQuery} from './conversation-material.js';
import {conversationUsesSavedSources} from './conversation-corrections.js';
import {GEMINI_EMBEDDING_DIMENSIONS,GEMINI_EMBEDDING_MODEL,GeminiEmbeddingHttpClient,validateEmbeddingVector,type GeminiEmbeddingClient} from './inspiration-embeddings.js';
import type {ConversationRetrievalTrace} from './conversation-retrieval.js';
import {enqueueConversationReply,STALE_LOCK_SECONDS,wakeCommittedBackgroundJobs} from './queue.js';
type Db=ReturnType<typeof getDb>;
type Tx=Parameters<Parameters<Db['transaction']>[0]>[0];
type Reader=Pick<Db,'select'>;
type Request=typeof conversationReplyRequests.$inferSelect;
const HOUR=3600000;
export class ConversationReplyError extends Error{constructor(readonly status:404|409|410|429|503,message:string){super(message);}}
async function owned(db:Reader,profileId:string,id:string){
  const [row]=await db.select().from(conversations).where(and(eq(conversations.profileId,profileId),eq(conversations.id,id)));
  if(!row)throw new ConversationReplyError(404,'Conversation not found.');if(row.deletedAt)throw new ConversationReplyError(410,'This conversation was deleted.');return row;
}
async function lockConversation(tx:Tx,profileId:string,id:string){
  await tx.select({id:conversations.id}).from(conversations).where(and(eq(conversations.profileId,profileId),eq(conversations.id,id))).for('update');
  return owned(tx,profileId,id);
}
async function lockMemory(tx:Tx,profileId:string){
  await tx.insert(generationRevisions).values({profileId}).onConflictDoNothing();
  await tx.select().from(generationRevisions).where(eq(generationRevisions.profileId,profileId)).for('update');
}
async function requestsFor(db:Reader,profileId:string,id:string){return db.select().from(conversationReplyRequests).where(and(eq(conversationReplyRequests.profileId,profileId),eq(conversationReplyRequests.conversationId,id))).orderBy(desc(conversationReplyRequests.createdAt),desc(conversationReplyRequests.id));}
async function effectiveStatus(db:Reader,row:Request){
  if(!['pending','running'].includes(row.status))return row.status;
  const [job]=row.jobId?await db.select().from(backgroundJobs).where(and(eq(backgroundJobs.profileId,row.profileId),eq(backgroundJobs.id,row.jobId))):[];
  if(!job||job.status==='failed'||job.status==='succeeded'||job.status==='running'&&job.attempts>=job.maxAttempts&&(!job.lockedAt||job.lockedAt.getTime()<Date.now()-STALE_LOCK_SECONDS*1000))return 'failed' as const;
  return row.status;
}
export async function projectConversationMessages(db:Reader,profileId:string,id:string,messages:Array<typeof conversationMessages.$inferSelect>){
  const requests=await requestsFor(db,profileId,id);
  return Promise.all(messages.map(async message=>{
    if(message.role==='user')return {...message,followUpQuestion:null,memoryChanged:false,replyRequestId:null,citations:[]};
    const request=requests.find(row=>row.assistantMessageId===message.id&&row.status==='ready');
    const current=request?await currentConversationReferences(db,profileId,request.references):[];
    const memoryChanged=!request||current.some((row,index)=>row===null||row.historical===true&&request.references[index]?.historical!==true);
    return {...message,followUpQuestion:request?.followUpQuestion??null,memoryChanged,replyRequestId:request?.id??null,
      citations:request?.references.map((reference,index)=>({index,kind:reference.kind,id:reference.id,available:current[index]!==null,
        ...(current[index]?{preview:current[index]!.text.replace(/\s+/g,' ').slice(0,96),...(current[index]!.historical?{historical:true,recordedAt:current[index]!.recordedAt}:{} )}:{})}))??[]};
  }));
}
async function inputFor(db:Reader,profileId:string,id:string,userMessageId:string,queryVector?:number[]){
  const conversation=await owned(db,profileId,id),messages=await db.select().from(conversationMessages)
    .where(and(eq(conversationMessages.profileId,profileId),eq(conversationMessages.conversationId,id))).orderBy(asc(conversationMessages.position));
  const anchor=messages.find(row=>row.id===userMessageId&&row.role==='user');
  if(!anchor||anchor.position!==conversation.revision)return null;
  const projected=await projectConversationMessages(db,profileId,id,messages.slice(-8));
  const history:ConversationReplyInput['history']=[];let characters=0,contextChanged=messages.length>8||projected.some(row=>row.memoryChanged);
  // Keep complete messages: truncating a human sentence can drop its negation
  // or correction. Missing earlier context is disclosed to the provider.
  for(const row of [...projected].reverse()){
    if(row.role==='assistant'&&row.memoryChanged)continue;
    const content=row.content+(row.followUpQuestion?'\n'+row.followUpQuestion:'');
    if(characters+content.length>8000){contextChanged=true;break;}
    history.unshift({role:row.role,content,...(row.correctsMessageId?{correction:true}:{})});characters+=content.length;
  }
  let retrievalTrace:ConversationRetrievalTrace|undefined;
  const context=conversationUsesSavedSources(history)?await readConversationContext(db,profileId,conversationSearchQuery(history),undefined,conversation.initialPrincipleId,queryVector,trace=>{retrievalTrace=trace;}):{principles:[],reading:[],inspirations:[]},sources=[...context.principles,...context.reading,...context.inspirations];
  const [profile]=await db.select({locale:profiles.preferredLocale}).from(profiles).where(eq(profiles.id,profileId));
  const focusIndex=sources.findIndex(source=>source.kind==='principle'&&source.id===conversation.initialPrincipleId);
  const input:ConversationReplyInput={preferredLocale:profile?.locale==='ko-KR'?'ko-KR':'en-US',messageDate:anchor.createdAt.toISOString().slice(0,10),contextChanged,...(focusIndex>=0?{focusSourceNumber:focusIndex+1}:{}),history,sources:conversationPromptSources(sources)};
  return {input,sources,retrievalTrace,revision:conversation.revision,hash:conversationHash({input,identities:sources.map(({kind,id,hash})=>({kind,id,hash})),revision:conversation.revision})};
}
async function replyState(db:Reader,profileId:string,id:string){
  const conversation=await owned(db,profileId,id),messages=await db.select().from(conversationMessages).where(and(eq(conversationMessages.profileId,profileId),eq(conversationMessages.conversationId,id))).orderBy(desc(conversationMessages.position)).limit(2);
  const message=messages.find(row=>row.role==='user'),rows=await requestsFor(db,profileId,id),row=rows.find(item=>item.userMessageId===message?.id);
  const recent=rows.filter(item=>item.userMessageId===message?.id&&item.createdAt.getTime()>Date.now()-HOUR);
  const messageRetryAfter=recent.length>=CONVERSATION_LIMITS.attemptsPerMessage?new Date(Math.min(...recent.map(item=>item.createdAt.getTime()))+HOUR).toISOString():null;
  const [owner]=await db.select({accountId:profiles.accountId}).from(profiles).where(eq(profiles.id,profileId));
  const [budget]=await db.select({count:sql<number>`coalesce(sum(1 + CASE WHEN ${conversationReplyRequests.retrievalDispatchedAt} IS NOT NULL THEN 1 ELSE 0 END),0)::int`,oldest:sql<string|null>`min(${conversationReplyRequests.dispatchedAt})::text`}).from(conversationReplyRequests)
    .innerJoin(profiles,eq(profiles.id,conversationReplyRequests.profileId)).where(and(eq(profiles.accountId,owner.accountId!),gte(conversationReplyRequests.dispatchedAt,new Date(Date.now()-HOUR))));
  const accountRetryAfter=budget.count>=CONVERSATION_LIMITS.modelCalls&&budget.oldest?new Date(Date.parse(budget.oldest)+HOUR).toISOString():null;
  const retryAfter=[messageRetryAfter,accountRetryAfter].filter((value):value is string=>value!==null).sort().at(-1)??null;
  const phase=row?await effectiveStatus(db,row):'idle';
  const [job]=row?.jobId?await db.select({status:backgroundJobs.status,runAfter:backgroundJobs.runAfter}).from(backgroundJobs).where(and(eq(backgroundJobs.profileId,profileId),eq(backgroundJobs.id,row.jobId))):[];
  return {profileId,conversationId:id,messageId:message?.id??null,requestId:row?.id??null,phase,revision:conversation.revision,
    runAfter:phase==='pending'&&job?.status==='pending'&&job.runAfter.getTime()>Date.now()?job.runAfter.toISOString():null,
    failureCode:row?.failureCode??null,retryAfter,canRetry:conversationRepliesEnabled()&&Boolean(message)&&conversation.revision<200&&!retryAfter&&['idle','failed','stopped','stale'].includes(phase),generationEnabled:conversationRepliesEnabled()};
}
export async function readConversationReplyState(db:Db,profileId:string,id:string){return db.transaction(tx=>replyState(tx,profileId,id),{isolationLevel:'repeatable read',accessMode:'read only'});}
export async function requestConversationReply(db:Db,profileId:string,id:string,input:{messageId:string;afterRequestId:string|null}){
  const result=await db.transaction(tx=>requestConversationReplyInTransaction(tx,profileId,id,input));await wakeCommittedBackgroundJobs();return result;
}
/** Also used by Send's transaction: the message and its reply intent commit together. */
export async function requestConversationReplyInTransaction(tx:Tx,profileId:string,id:string,input:{messageId:string;afterRequestId:string|null}){
  if(!conversationRepliesEnabled())throw new ConversationReplyError(503,'Replies are not enabled here yet. Your messages are saved.');
    const conversation=await lockConversation(tx,profileId,id),rows=await requestsFor(tx,profileId,id),latest=rows.find(row=>row.userMessageId===input.messageId);
    // The predecessor is a compare-and-swap token. Replaying a lost retry
    // joins its successor even if it has already failed or finished.
    if((latest?.id??null)!==input.afterRequestId)return replyState(tx,profileId,id);
    if(latest&&!['failed','stopped','stale'].includes(await effectiveStatus(tx,latest)))return replyState(tx,profileId,id);
    if(conversation.revision>=200)throw new ConversationReplyError(429,'This conversation is full. Start another one.');
    const work=await inputFor(tx,profileId,id,input.messageId);if(!work)throw new ConversationReplyError(409,'The conversation changed. Check saved messages.');
    const recent=rows.filter(row=>row.userMessageId===input.messageId&&row.createdAt.getTime()>Date.now()-HOUR);
    if(recent.length>=CONVERSATION_LIMITS.attemptsPerMessage)throw new ConversationReplyError(429,'Please wait before retrying this reply. Your message is saved.');
    await tx.update(conversationReplyRequests).set({status:'stale',finishedAt:new Date(),failureCode:'superseded'})
      .where(and(eq(conversationReplyRequests.profileId,profileId),eq(conversationReplyRequests.conversationId,id),inArray(conversationReplyRequests.status,['pending','running'])));
    const requestId=randomUUID();await tx.insert(conversationReplyRequests).values({id:requestId,profileId,conversationId:id,userMessageId:input.messageId,conversationRevision:work.revision,contextHash:work.hash,contextSources:work.sources.map(({kind,id,hash})=>({kind,id,hash}))});
    const job=await enqueueConversationReply(profileId,id,requestId,tx);
    await tx.update(conversationReplyRequests).set({jobId:job.jobId}).where(eq(conversationReplyRequests.id,requestId));
    return replyState(tx,profileId,id);
}
export async function stopConversationReply(db:Db,profileId:string,id:string,requestId:string){
  return db.transaction(async tx=>{
    await lockConversation(tx,profileId,id);
    await tx.update(conversationReplyRequests).set({status:'stopped',failureCode:null,finishedAt:new Date()}).where(and(eq(conversationReplyRequests.profileId,profileId),eq(conversationReplyRequests.conversationId,id),eq(conversationReplyRequests.id,requestId),inArray(conversationReplyRequests.status,['pending','running'])));
    return replyState(tx,profileId,id);
  });
}
export async function readConversationReference(db:Db,profileId:string,id:string,requestId:string,index:number){
  return db.transaction(async tx=>{
    await owned(tx,profileId,id);const [request]=await tx.select().from(conversationReplyRequests).where(and(eq(conversationReplyRequests.profileId,profileId),eq(conversationReplyRequests.conversationId,id),eq(conversationReplyRequests.id,requestId),eq(conversationReplyRequests.status,'ready')));
    const reference=request?.references[index];if(!reference)throw new ConversationReplyError(404,'Reference not found.');
    const [source]=await currentConversationReferences(tx,profileId,[reference]);if(!source)throw new ConversationReplyError(409,'This memory changed since the reply.');
    if(!Number.isInteger(reference.quoteStart)||!Number.isInteger(reference.quoteLength)||reference.quoteStart!<0||reference.quoteLength!<4||reference.quoteLength!>300||reference.quoteStart!+reference.quoteLength!>source.text.length)throw new ConversationReplyError(409,'This reference cannot be verified.');
    return {profileId,conversationId:id,requestId,index,source:{kind:source.kind,id:source.id,text:source.text,state:source.state,supportCurrent:source.supportCurrent,recordedAt:source.recordedAt,historical:source.historical,artifactVersion:source.artifactVersion,
      quote:source.text.slice(reference.quoteStart??0,(reference.quoteStart??0)+(reference.quoteLength??0))}};
  },{isolationLevel:'repeatable read',accessMode:'read only'});
}

/** At most one query embedding and one answer per attempt, with both slots
 * accounted before transport. Uncertain attempts are not automatically replayed. */
export async function processConversationReply(db:Db,job:BackgroundJob,id:string,requestId:string,beforeCommit:(tx:Tx)=>Promise<void>,deps:{embeddingClient?:GeminiEmbeddingClient|null}={}){
  const retrievalStarted=performance.now();
  const embeddingClient=deps.embeddingClient===undefined
    ?process.env.GEMINI_API_KEY||process.env.SST_RESOURCE_GeminiApiKey?new GeminiEmbeddingHttpClient(GEMINI_EMBEDDING_MODEL,{timeoutMs:5000,exchangeTimeoutMs:10000}):null
    :deps.embeddingClient;
  const finish=async(status:'failed'|'stale',failureCode:string)=>db.update(conversationReplyRequests).set({status,failureCode,finishedAt:new Date()})
    .where(and(eq(conversationReplyRequests.profileId,job.profileId),eq(conversationReplyRequests.id,requestId),inArray(conversationReplyRequests.status,['pending','running'])));
  const initial=await db.transaction(async tx=>{
    const [conversation]=await tx.select().from(conversations).where(and(eq(conversations.profileId,job.profileId),eq(conversations.id,id))).for('update');
    if(!conversation||conversation.deletedAt)return null;
    await lockMemory(tx,job.profileId);await beforeCommit(tx);
    const [request]=await tx.select().from(conversationReplyRequests).where(and(eq(conversationReplyRequests.profileId,job.profileId),eq(conversationReplyRequests.id,requestId),eq(conversationReplyRequests.conversationId,id))).for('update');
    if(!request||!['pending','running'].includes(request.status))return null;
    const refuse=async(status:'failed'|'stale',failureCode:string)=>{await tx.update(conversationReplyRequests).set({status,failureCode,finishedAt:new Date()}).where(eq(conversationReplyRequests.id,requestId));return null;};
    if(request.dispatchedAt)return refuse('failed','outcome_unknown');
    if(!conversationRepliesEnabled())return refuse('failed','disabled');
    const next=request.userMessageId?await inputFor(tx,job.profileId,id,request.userMessageId):null;
    if(!next||next.hash!==request.contextHash||next.revision!==request.conversationRevision)return refuse('stale','memory_changed');
    const [owner]=await tx.select({accountId:profiles.accountId}).from(profiles).where(eq(profiles.id,job.profileId));
    if(!owner)return null;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'waka.conversation-budget:'+owner.accountId},0))`);
    const [usage]=await tx.execute<{count:number}>(sql`SELECT coalesce(sum(1 + CASE WHEN r.retrieval_dispatched_at IS NOT NULL THEN 1 ELSE 0 END),0)::int AS count FROM conversation_reply_requests r JOIN profiles p ON p.id=r.profile_id
      WHERE p.account_id=${owner.accountId}::uuid AND r.dispatched_at>=now()-interval '1 hour'`);
    if(usage.count>=CONVERSATION_LIMITS.modelCalls)return refuse('failed','budget');
    const [indexed]=conversationUsesSavedSources(next.input.history)&&embeddingClient?.model===GEMINI_EMBEDDING_MODEL&&usage.count+2<=CONVERSATION_LIMITS.modelCalls
      ?await tx.select({id:inspirationEmbeddings.id}).from(inspirationEmbeddings).where(and(eq(inspirationEmbeddings.profileId,job.profileId),eq(inspirationEmbeddings.inputScope,'personal'),eq(inspirationEmbeddings.model,GEMINI_EMBEDDING_MODEL),eq(inspirationEmbeddings.dimensions,GEMINI_EMBEDDING_DIMENSIONS))).limit(1):[];
    const semantic=Boolean(indexed);
    await tx.update(conversationReplyRequests).set({status:'running',dispatchedAt:sql`clock_timestamp()`,retrievalDispatchedAt:semantic?sql`clock_timestamp()`:null,failureCode:null}).where(eq(conversationReplyRequests.id,requestId));
    return {...next,userMessageId:request.userMessageId!,semantic};
  });
  if(!initial)return;
  let queryVector:number[]|undefined;
  if(initial.semantic){
    try{queryVector=validateEmbeddingVector(await embeddingClient!.embed(conversationSearchQuery(initial.input.history),'RETRIEVAL_QUERY'));}
    catch{ /* Bounded lexical context remains usable when semantic lookup fails. */ }
  }
  // The network call above owns no DB locks. Stop, deletion and edits during
  // lookup must be checked before spending the answer slot, not only afterward.
  const work=initial.semantic?await db.transaction(async tx=>{
    const [conversation]=await tx.select().from(conversations).where(and(eq(conversations.profileId,job.profileId),eq(conversations.id,id))).for('update');
    if(!conversation||conversation.deletedAt)return null;
    await lockMemory(tx,job.profileId);await beforeCommit(tx);
    const [request]=await tx.select().from(conversationReplyRequests).where(and(eq(conversationReplyRequests.profileId,job.profileId),eq(conversationReplyRequests.id,requestId))).for('update');
    if(!request||request.status!=='running')return null;
    const unchanged=await inputFor(tx,job.profileId,id,initial.userMessageId);
    if(!unchanged||unchanged.hash!==initial.hash){await tx.update(conversationReplyRequests).set({status:'stale',failureCode:'memory_changed',finishedAt:new Date()}).where(eq(conversationReplyRequests.id,requestId));return null;}
    const selected=queryVector?await inputFor(tx,job.profileId,id,initial.userMessageId,queryVector):unchanged;
    if(!selected)return null;
    await tx.update(conversationReplyRequests).set({contextHash:selected.hash,contextSources:selected.sources.map(({kind,id,hash})=>({kind,id,hash}))}).where(eq(conversationReplyRequests.id,requestId));
    return selected;
  }):initial;
  if(!work)return;
  console.info('[conversation-retrieval]',JSON.stringify({requestId,profileId:job.profileId,
    mode:queryVector?'hybrid':initial.semantic?'lexical_fallback':'lexical',preparationMs:Math.round(performance.now()-retrievalStarted),
    ...work.retrievalTrace,sources:work.sources.map(({kind,id,revision})=>({kind,id,revision}))}));
  let result;
  try{result=parseConversationReply(await (await getDefaultModelProvider()).answerConversation(work.input),work.input);}
  catch{await finish('failed','provider_failed');return;}
  try{await db.transaction(async tx=>{
    const [conversation]=await tx.select().from(conversations).where(and(eq(conversations.profileId,job.profileId),eq(conversations.id,id))).for('update');
    if(!conversation||conversation.deletedAt)return;await lockMemory(tx,job.profileId);await beforeCommit(tx);
    const [request]=await tx.select().from(conversationReplyRequests).where(and(eq(conversationReplyRequests.profileId,job.profileId),eq(conversationReplyRequests.id,requestId))).for('update');
    if(!request||request.status!=='running')return;
    const current=request.userMessageId?await inputFor(tx,job.profileId,id,request.userMessageId,queryVector):null;
    if(!current||current.hash!==work.hash){await tx.update(conversationReplyRequests).set({status:'stale',failureCode:'memory_changed',finishedAt:new Date()}).where(eq(conversationReplyRequests.id,requestId));return;}
    const assistantId=randomUUID(),references:ConversationReference[]=result.citations.map(citation=>{const source=work.sources[citation.sourceNumber-1]!;return {kind:source.kind,id:source.id,hash:source.hash,quoteStart:source.text.indexOf(citation.quote),quoteLength:citation.quote.length,...(source.kind==='top_of_mind_entry'?{historical:source.historical===true}:{})};});
    await tx.insert(conversationMessages).values({id:assistantId,profileId:job.profileId,conversationId:id,position:conversation.revision+1,role:'assistant',content:result.answer});
    await tx.update(conversations).set({revision:conversation.revision+1,updatedAt:new Date()}).where(eq(conversations.id,id));
    await tx.update(conversationReplyRequests).set({status:'ready',assistantMessageId:assistantId,references,followUpQuestion:result.followUpQuestion,finishedAt:new Date()}).where(eq(conversationReplyRequests.id,requestId));
  });}catch{await finish('failed','publication_unconfirmed');}
}
