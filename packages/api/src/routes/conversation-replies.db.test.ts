/** WHAT THIS MOCKS, AND WHY (gate G6): `authMiddleware` supplies owned
 * sessions and `ModelProvider` returns controlled replies. Real routes,
 * queue claims, dispatch accounting, memory fences and SQL transactions run.
 * Semantic lookup cases also inject query vectors and a no-op lease callback;
 * the existing processBackgroundJob cases retain real lease-fence coverage.
 * No remote database or paid provider is used. */
import {randomUUID} from 'node:crypto';
import postgres from 'postgres';
import {Hono} from 'hono';
import {afterAll,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {createConversationRoutes} from './conversations.js';
import type {AuthEnv} from '../lib/middleware.js';
import {getDb} from '../lib/db.js';
import {setDefaultModelProviderForTests,type ConversationReplyInput,type ConversationReplyResult,type ModelProvider} from '../lib/model-provider.js';
import {postgresBackgroundJobStore,processBackgroundJob} from '../lib/queue.js';
import {assembleProfileExport} from '../lib/profile-export.js';
import {processConversationReply} from '../lib/conversation-replies.js';
import {ensureInspirationEmbedding,GEMINI_EMBEDDING_MODEL} from '../lib/inspiration-embeddings.js';
let t:TestDatabase,during:(()=>Promise<void>)|null=null;
const connection=process.env.DB_CONNECTION_URL!;
const answer=vi.fn<(input:ConversationReplyInput)=>Promise<ConversationReplyResult>>(async(input)=>{await during?.();return {answer:'A small experiment may help you compare these priorities.',followUpQuestion:'What would you most like that experiment to clarify?',citations:input.sources.length?[{sourceNumber:1,quote:input.sources[0].text.slice(0,80)}]:[]};});
beforeAll(async()=>{t=await createTestDatabase();const url=new URL(connection);url.searchParams.set('options',`-c search_path=${t.schemaName}`);process.env.DB_CONNECTION_URL=url.toString();});
beforeEach(async()=>{await t.truncateAll();during=null;answer.mockClear();vi.stubEnv('WAKA_CONVERSATION_REPLIES','1');setDefaultModelProviderForTests({name:'conversation-fixture',answerConversation:answer} as unknown as ModelProvider);});
afterAll(async()=>{setDefaultModelProviderForTests(null);await getDb().$client.end();vi.unstubAllEnvs();await t?.cleanup();process.env.DB_CONNECTION_URL=connection;});
async function fixture(){
  const [account]=await t.sql`INSERT INTO accounts(email) VALUES(${randomUUID()+'@example.test'}) RETURNING id`;
  const [profile]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${account.id},'human','Fixture') RETURNING id`;
  const [source]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${profile.id},'A quiet morning gives me room for an experiment.') RETURNING id`;
  const app=new Hono<AuthEnv>();app.route('/conversations',createConversationRoutes({getDatabase:()=>t.db as never,authMiddleware:async(c,next)=>{c.set('session',{sessionId:randomUUID(),account:{id:account.id,email:'fixture@example.test'},profile:{id:profile.id,accountId:account.id,type:'human',name:'Fixture',preferredLocale:'en-US'}});await next();}}));
  const id=randomUUID(),messageId=randomUUID();
  const post=(suffix:string,body:unknown)=>app.request(`/conversations${suffix}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  await post('',{id});await post(`/${id}/messages`,{id:messageId,content:'How could a quiet morning help me decide?',revision:0});
  const request=(afterRequestId:string|null=null)=>post(`/${id}/replies`,{messageId,afterRequestId});
  const state=async()=>await(await app.request(`/conversations/${id}/reply`)).json() as any;
  return {app,id,messageId,post,request,state,sourceId:source.id as string,profileId:profile.id as string,accountId:account.id as string};
}
async function claim(){
  await t.sql`UPDATE background_jobs SET run_after=now()+interval '1 day' WHERE type::text<>'generate_conversation_reply'`;
  const job=await postgresBackgroundJobStore.claimNext(new Date());expect(job?.type).toBe('generate_conversation_reply');return job!;
}
it('polls an active reply with at most four application statements',async()=>{
  const f=await fixture();expect((await f.request()).status).toBe(200);
  const options=t.sql.options as {debug?:boolean|((...args:any[])=>void)};
  const previous=options.debug;let statements=0;
  options.debug=(_connection:unknown,query:string)=>{if(!/^(begin|commit|rollback|set transaction)\b/i.test(query.trim()))statements++;};
  try{
    expect(await f.state()).toMatchObject({phase:'pending',messageId:f.messageId,canRetry:false});
    expect(statements).toBe(4);
  }finally{options.debug=previous;}
});
it('delivers actual dated earlier/current records without IDs and keeps history citations reopenable',async()=>{
  const f=await fixture();
  await t.sql`UPDATE conversation_messages SET content='What has changed in how I think?' WHERE id=${f.messageId}`;
  const [past]=await t.sql`INSERT INTO top_of_minds(profile_id,version,status,created_at) VALUES(${f.profileId},1,'superseded','2026-09-01T12:00:00Z') RETURNING id`;
  const [live]=await t.sql`INSERT INTO top_of_minds(profile_id,version,status,created_at) VALUES(${f.profileId},2,'live','2026-10-01T12:00:00Z') RETURNING id`;
  await t.sql`INSERT INTO top_of_mind_entries(top_of_mind_id,type,body,locked_at) VALUES(${past.id},'pattern','I prefer a detailed plan before starting.',now()),(${live.id},'pattern','I try a small experiment before a detailed plan.',now())`;
  answer.mockImplementationOnce(async input=>({answer:'The earlier reading favored planning first; the current reading describes trying a small experiment.',followUpQuestion:null,citations:input.sources.flatMap((source,index)=>source.historical?[{sourceNumber:index+1,quote:source.text}]:[])}));
  await f.request();await processBackgroundJob(await claim());
  const input=answer.mock.calls[0][0];expect(input.sources.filter(source=>source.kind==='top_of_mind_entry')).toHaveLength(2);
  expect(input.sources.find(source=>source.historical)).toMatchObject({recordedAt:'2026-09-01T12:00:00.000Z',artifactVersion:1});
  expect(JSON.stringify(input.sources)).not.toContain(past.id);
  const [request]=await t.sql`SELECT id FROM conversation_reply_requests WHERE conversation_id=${f.id}`;
  const reopened=await f.app.request(`/conversations/${f.id}/replies/${request.id}/references/0`);expect(reopened.status).toBe(200);
  expect((await reopened.json() as {source:{historical:boolean}}).source.historical).toBe(true);
  const conversation=await(await f.app.request(`/conversations/${f.id}`)).json() as {conversation:{messages:Array<{role:string;memoryChanged:boolean}>}};
  expect(conversation.conversation.messages.find(message=>message.role==='assistant')?.memoryChanged).toBe(false);
});
it('delivers the explicit correction to the next reply without changing memory or duplicating the user message',async()=>{
  const f=await fixture();await f.request();const firstJob=await claim();await processBackgroundJob(firstJob);await postgresBackgroundJobStore.markSucceeded(firstJob,null);
  const [reply]=await t.sql`SELECT id FROM conversation_messages WHERE conversation_id=${f.id} AND role='assistant'`;
  const correction={id:randomUUID(),content:'No, I enjoyed it. For this month only, I want a slower pace.',revision:2,correctsMessageId:reply.id,requestReply:true};
  for(let n=0;n<2;n++)expect((await f.post(`/${f.id}/messages`,correction)).status).toBe(200);
  expect((await f.post(`/${f.id}/messages`,{...correction,correctsMessageId:randomUUID()})).status).toBe(409);
  answer.mockImplementationOnce(async()=>({answer:'You enjoyed it and want a slower pace this month only.',followUpQuestion:null,citations:[]}));
  await processBackgroundJob(await claim());const input=answer.mock.calls.at(-1)![0];expect(input.history.at(-1)).toEqual({role:'user',content:correction.content,correction:true});
  expect((await f.state()).phase).toBe('ready');
  expect(await t.sql`SELECT id FROM inspirations`).toHaveLength(1);expect(await t.sql`SELECT id FROM principles`).toHaveLength(0);
  expect(await t.sql`SELECT id FROM conversation_messages WHERE id=${correction.id}`).toHaveLength(1);
  expect((await assembleProfileExport(t.db as never,f.profileId)).conversationMessages.find(row=>row.id===correction.id)?.correctsMessageId).toBe(reply.id);
  expect((await f.app.request(`/conversations/${f.id}`,{method:'DELETE'})).status).toBe(200);expect(await t.sql`SELECT id FROM conversation_messages`).toHaveLength(0);
});
it('rejects correction targets outside this conversation and user-authored targets',async()=>{
  const f=await fixture(),other=await fixture();await other.request();await processBackgroundJob(await claim());
  const [reply]=await t.sql`SELECT id FROM conversation_messages WHERE conversation_id=${other.id} AND role='assistant'`;
  for(const correctsMessageId of [reply.id,f.messageId])expect((await f.post(`/${f.id}/messages`,{id:randomUUID(),content:'A correction',revision:1,correctsMessageId})).status).toBe(409);
  expect(await t.sql`SELECT id FROM conversation_messages WHERE conversation_id=${f.id}`).toHaveLength(1);
});
it('records only actually used correction sources and skips unused query embedding',async()=>{
  const f=await fixture(),words='Seek intensive experiences whenever possible.';
  const [principle]=await t.sql`INSERT INTO principles(profile_id,statement,type,origin,rank,locked_at) VALUES(${f.profileId},${words},'maxim','declared',0,now()) RETURNING id`;
  const vector=[1,...Array<number>(767).fill(0)];
  await ensureInspirationEmbedding({db:t.db as never,profileId:f.profileId,inspirationId:f.sourceId,client:{model:GEMINI_EMBEDDING_MODEL,embed:async()=>vector}});
  await f.request();const firstState=await f.state(),firstJob=await claim();
  await processConversationReply(t.db as never,firstJob,f.id,firstState.requestId,async()=>{}, {embeddingClient:{model:GEMINI_EMBEDDING_MODEL,embed:async()=>vector}});
  await postgresBackgroundJobStore.markSucceeded(firstJob,null);
  const [first]=await t.sql`SELECT id FROM conversation_messages WHERE conversation_id=${f.id} AND role='assistant'`;
  const embed=vi.fn(async()=>vector),embeddingClient={model:GEMINI_EMBEDDING_MODEL,embed};
  answer.mockImplementationOnce(async()=>({answer:'The slower pace is for this month only.',followUpQuestion:null,citations:[]}));
  expect((await f.post(`/${f.id}/messages`,{id:randomUUID(),content:'No, I enjoyed it. For this month only I want a slower pace.',revision:2,correctsMessageId:first.id,requestReply:true})).status).toBe(200);
  const state=await f.state(),job=await claim();
  await processConversationReply(t.db as never,job,f.id,state.requestId,async()=>{}, {embeddingClient});
  await postgresBackgroundJobStore.markSucceeded(job,null);
  expect(answer.mock.calls.at(-1)![0].sources).toEqual([]);expect(embed).not.toHaveBeenCalled();
  const [receipt]=await t.sql`SELECT context_sources,retrieval_dispatched_at FROM conversation_reply_requests WHERE id=${state.requestId}`;
  expect(receipt.context_sources).toEqual([]);expect(receipt.retrieval_dispatched_at).toBeNull();
  const context=await(await f.app.request(`/conversations/${f.id}/context`)).json() as {principles:unknown[];reading:unknown[];inspirations:unknown[]};
  expect([...context.principles,...context.reading,...context.inspirations]).toEqual([]);
  expect((await f.state()).phase).toBe('ready');
  answer.mockImplementationOnce(async input=>({answer:'The recorded guide favors intensive experiences; your current choice is slower for this month.',followUpQuestion:null,citations:[{sourceNumber:input.sources.findIndex(source=>source.text===words)+1,quote:words}]}));
  expect((await f.post(`/${f.id}/messages`,{id:randomUUID(),content:'No, keep the slower pace this month. Compare it with my saved principle.',revision:4,correctsMessageId:first.id,requestReply:true})).status).toBe(200);
  const comparison=await f.state();await processConversationReply(t.db as never,await claim(),f.id,comparison.requestId,async()=>{}, {embeddingClient});
  expect(embed).toHaveBeenCalledOnce();expect(answer.mock.calls.at(-1)![0].sources.some(source=>source.text===words)).toBe(true);
  expect((await f.state()).phase).toBe('ready');
  const [kept]=await t.sql`SELECT statement,locked_at FROM principles WHERE id=${principle.id}`;
  expect(kept.statement).toBe(words);expect(kept.locked_at).not.toBeNull();
});
it('coalesces initial requests, stores one grounded reply, and replays without another dispatch',async()=>{
  const f=await fixture();const [a,b]=await Promise.all([f.request(),f.request()]);expect(a.status).toBe(200);expect(b.status).toBe(200);
  const first=await f.state();expect(first.phase).toBe('pending');expect(await t.sql`SELECT id FROM conversation_reply_requests`).toHaveLength(1);
  const job=await claim();await processBackgroundJob(job);await processBackgroundJob(job);await postgresBackgroundJobStore.markSucceeded(job,null);
  expect(answer).toHaveBeenCalledTimes(1);expect(await f.state()).toMatchObject({phase:'ready',requestId:first.requestId});
  await f.request();expect(await t.sql`SELECT id FROM conversation_messages WHERE role='assistant'`).toHaveLength(1);
  const reference=await f.app.request(`/conversations/${f.id}/replies/${first.requestId}/references/0`);expect(reference.status).toBe(200);expect(await reference.json()).toMatchObject({source:{id:f.sourceId,quote:'A quiet morning gives me room for an experiment.'}});
  await t.sql`DELETE FROM background_jobs WHERE id=${job.id}`;
  expect(await postgresBackgroundJobStore.usageForAccount(f.accountId,new Date(Date.now()-3600000))).toMatchObject({startedInWindow:1});
});
it('looks up semantic context outside locks, records the selected sources and does not replay its embedding',async()=>{
  const f=await fixture(),vector=[1,...Array<number>(767).fill(0)];
  const [extra]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${f.profileId},'Unstructured time invites creative noticing.') RETURNING id`;
  await ensureInspirationEmbedding({db:t.db as never,profileId:f.profileId,inspirationId:extra.id,client:{model:GEMINI_EMBEDDING_MODEL,embed:async()=>vector}});
  await f.request();const state=await f.state(),job=await claim();
  const peer=postgres(process.env.DB_CONNECTION_URL!,{max:1,prepare:false,onnotice:()=>{}});
  const embed=vi.fn(async()=>{
    await peer`SELECT id FROM conversations WHERE id=${f.id} FOR UPDATE NOWAIT`;
    await peer`SELECT profile_id FROM generation_revisions WHERE profile_id=${f.profileId} FOR UPDATE NOWAIT`;
    return vector;
  });
  try{
    await processConversationReply(t.db as never,job,f.id,state.requestId,async()=>{}, {embeddingClient:{model:GEMINI_EMBEDDING_MODEL,embed}});
    expect((await f.state()).phase).toBe('ready');expect(embed).toHaveBeenCalledOnce();
    expect(answer.mock.calls[0]![0].sources.some(source=>source.text.includes('Unstructured time'))).toBe(true);
    const context=await(await f.app.request(`/conversations/${f.id}/context`)).json() as any;
    expect(context.inspirations[0].id).toBe(extra.id);
    const [request]=await t.sql`SELECT context_sources,retrieval_dispatched_at FROM conversation_reply_requests WHERE id=${state.requestId}`;
    expect(request.retrieval_dispatched_at).not.toBeNull();expect(request.context_sources.some((source:{id:string})=>source.id===extra.id)).toBe(true);
    await processConversationReply(t.db as never,job,f.id,state.requestId,async()=>{}, {embeddingClient:{model:GEMINI_EMBEDDING_MODEL,embed}});
    expect(embed).toHaveBeenCalledOnce();expect(answer).toHaveBeenCalledOnce();
  }finally{await peer.end();}
});
it('honors Stop during semantic lookup before calling the reply model',async()=>{
  const f=await fixture(),vector=[1,...Array<number>(767).fill(0)];
  await ensureInspirationEmbedding({db:t.db as never,profileId:f.profileId,inspirationId:f.sourceId,client:{model:GEMINI_EMBEDDING_MODEL,embed:async()=>vector}});
  await f.request();const state=await f.state(),job=await claim();
  const embed=vi.fn(async()=>{await f.post(`/${f.id}/replies/${state.requestId}/stop`,{});return vector;});
  await processConversationReply(t.db as never,job,f.id,state.requestId,async()=>{}, {embeddingClient:{model:GEMINI_EMBEDDING_MODEL,embed}});
  expect((await f.state()).phase).toBe('stopped');expect(answer).not.toHaveBeenCalled();
  expect(await t.sql`SELECT id FROM conversation_messages WHERE role='user'`).toHaveLength(1);
});
it('falls back to lexical context when the bounded embedding request fails',async()=>{
  const f=await fixture(),vector=[1,...Array<number>(767).fill(0)];
  await ensureInspirationEmbedding({db:t.db as never,profileId:f.profileId,inspirationId:f.sourceId,client:{model:GEMINI_EMBEDDING_MODEL,embed:async()=>vector}});
  await f.request();const state=await f.state(),job=await claim();
  await processConversationReply(t.db as never,job,f.id,state.requestId,async()=>{}, {embeddingClient:{model:GEMINI_EMBEDDING_MODEL,embed:async()=>{throw new Error('Synthetic outage');}}});
  expect((await f.state()).phase).toBe('ready');expect(answer).toHaveBeenCalledOnce();
});
it('does not purchase a query embedding when only incompatible dimensions are indexed',async()=>{
  const f=await fixture();
  await t.sql`INSERT INTO inspiration_embeddings(profile_id,inspiration_id,model,input_scope,dimensions,input_hash,embedding)
    VALUES(${f.profileId},${f.sourceId},${GEMINI_EMBEDDING_MODEL},'personal',1536,'fixture','[]'::jsonb)`;
  await f.request();const state=await f.state(),job=await claim(),embed=vi.fn(async()=>[1,...Array<number>(767).fill(0)]);
  await processConversationReply(t.db as never,job,f.id,state.requestId,async()=>{}, {embeddingClient:{model:GEMINI_EMBEDDING_MODEL,embed}});
  expect((await f.state()).phase).toBe('ready');expect(embed).not.toHaveBeenCalled();expect(answer).toHaveBeenCalledOnce();
});
it('fences source edits during lookup before dispatching the answer',async()=>{
  const f=await fixture(),vector=[1,...Array<number>(767).fill(0)];
  await ensureInspirationEmbedding({db:t.db as never,profileId:f.profileId,inspirationId:f.sourceId,client:{model:GEMINI_EMBEDDING_MODEL,embed:async()=>vector}});
  await f.request();const state=await f.state(),job=await claim();
  const embed=async()=>{await t.sql`UPDATE inspirations SET text='A different current view.' WHERE id=${f.sourceId}`;return vector;};
  await processConversationReply(t.db as never,job,f.id,state.requestId,async()=>{}, {embeddingClient:{model:GEMINI_EMBEDDING_MODEL,embed}});
  expect((await f.state()).phase).toBe('stale');expect(answer).not.toHaveBeenCalled();
});

it.each([
  ['mine','inspiration'],['agent','inspiration'],['both','inspiration'],
  ['agent','principle'],['both','principle'],
] as const)('serializes final publication with edits to the selected %s %s',async(perspective,kind)=>{
  const f=await fixture();
  const [agent]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${f.accountId},'agent','Selected agent') RETURNING id`;
  const [source]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${agent.id},'A quiet morning leaves room for an agent experiment.') RETURNING id`;
  let sourceId=perspective==='mine'?f.sourceId:source.id;
  if(kind==='principle'){
    const [principle]=await t.sql`INSERT INTO principles(profile_id,statement,origin,rank,locked_at)
      VALUES(${agent.id},'Prefer quiet mornings for experiments.','declared',1,now()) RETURNING id`;
    sourceId=principle.id;
  }
  const [other]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${f.accountId},'agent','Other agent') RETURNING id`;
  const [unrelated]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${other.id},'An unrelated memory.') RETURNING id`;
  await t.sql`UPDATE conversations SET perspective=${perspective},agent_profile_id=${perspective==='mine'?null:agent.id} WHERE id=${f.id}`;
  await f.request();const job=await claim();
  const url=new URL(connection);url.searchParams.set('options',`-c search_path=${t.schemaName}`);
  const peer=postgres(url.toString(),{max:1,prepare:false,onnotice:()=>{}}),key=randomUUID();
  await t.sql.unsafe(`CREATE FUNCTION hold_chat_publication() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_advisory_xact_lock(hashtextextended(TG_ARGV[0],0));RETURN NEW;END $$`);
  await t.sql.unsafe(`CREATE TRIGGER hold_chat_publication BEFORE INSERT ON conversation_messages
    FOR EACH ROW WHEN (NEW.role='assistant') EXECUTE FUNCTION hold_chat_publication('${key}')`);
  let worker:Promise<void>|undefined;
  try{
    await peer`SELECT pg_advisory_lock(hashtextextended(${key},0))`;
    worker=processConversationReply(t.db as never,job,f.id,(await f.state()).requestId!,async()=>{},{embeddingClient:null});
    await vi.waitFor(async()=>{
      const [row]=await peer`SELECT count(*)::int AS waiting FROM pg_locks WHERE locktype='advisory' AND NOT granted
        AND classid=((hashtextextended(${key},0)>>32)&4294967295)::oid
        AND objid=(hashtextextended(${key},0)&4294967295)::oid`;
      expect(row.waiting).toBe(1);
    },{timeout:3000,interval:20});
    // This pause is after the final source read. An edit must serialize with
    // publication, while a different agent's memory remains independently writable.
    await peer.begin(async tx=>{
      await tx`SET LOCAL lock_timeout='150ms'`;
      await tx`UPDATE inspirations SET text='The unrelated agent can still write.' WHERE id=${unrelated.id}`;
    });
    let blocked=false;
    try{await peer.begin(async tx=>{
      await tx`SET LOCAL lock_timeout='150ms'`;
      if(kind==='principle')await tx`UPDATE principles SET statement='Changed before the reply published.' WHERE id=${sourceId}`;
      else await tx`UPDATE inspirations SET text='Changed before the reply published.' WHERE id=${sourceId}`;
    });}catch(error){expect((error as {code?:string}).code).toBe('55P03');blocked=true;}
    expect(blocked).toBe(true);
  }finally{
    await peer`SELECT pg_advisory_unlock(hashtextextended(${key},0))`;
    await worker;await peer.end();
    await t.sql`DROP TRIGGER hold_chat_publication ON conversation_messages`;
    await t.sql`DROP FUNCTION hold_chat_publication()`;
  }
  expect((await f.state()).phase).toBe('ready');
  const [current]=kind==='principle'?await t.sql`SELECT statement AS text FROM principles WHERE id=${sourceId}`:await t.sql`SELECT text FROM inspirations WHERE id=${sourceId}`;
  expect(current.text).toContain('experiment');
});
it('uses the last available provider slot for an answer rather than exceeding the budget with lookup',async()=>{
  const f=await fixture(),vector=[1,...Array<number>(767).fill(0)];
  await ensureInspirationEmbedding({db:t.db as never,profileId:f.profileId,inspirationId:f.sourceId,client:{model:GEMINI_EMBEDDING_MODEL,embed:async()=>vector}});
  await t.sql`INSERT INTO conversation_reply_requests(id,profile_id,conversation_id,conversation_revision,context_hash,status,dispatched_at)
    SELECT gen_random_uuid(),${f.profileId}::uuid,${f.id}::uuid,1,'','failed',now() FROM generate_series(1,19)`;
  await f.request();const state=await f.state(),job=await claim(),embed=vi.fn(async()=>vector);
  await processConversationReply(t.db as never,job,f.id,state.requestId,async()=>{}, {embeddingClient:{model:GEMINI_EMBEDDING_MODEL,embed}});
  expect((await f.state()).phase).toBe('ready');expect(embed).not.toHaveBeenCalled();expect(answer).toHaveBeenCalledOnce();
  const [request]=await t.sql`SELECT retrieval_dispatched_at FROM conversation_reply_requests WHERE id=${state.requestId}`;
  expect(request.retrieval_dispatched_at).toBeNull();
});

it('labels the owning agent profile’s memory for the model without mixing in human saves',async()=>{
  const f=await fixture();
  const [agent]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${f.accountId},'agent','Noah') RETURNING id`;
  await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${agent.id},'I used quiet morning experiments while developing a tool.')`;
  const chatId=randomUUID();
  expect((await f.post(`?profile=${agent.id}`,{id:chatId,firstMessage:{id:randomUUID(),content:'What do quiet morning experiments suggest about this agent?',requestReply:true}})).status).toBe(200);
  await processBackgroundJob(await claim());
  const input=answer.mock.calls[0]![0];
  expect(input.perspective).toBe('agent');
  expect(input.sources.length).toBeGreaterThan(0);
  expect(input.sources.every(source=>source.owner==='agent')).toBe(true);
  expect(JSON.stringify(input.sources)).not.toContain('A quiet morning gives me room for an experiment.');
  expect((await t.sql`SELECT profile_id,perspective FROM conversations WHERE id=${chatId}`)[0]).toMatchObject({profile_id:agent.id,perspective:'mine'});
});

it('yields publication to an active source editor without blocking or repeating the model call',async()=>{
  const f=await fixture();await f.request();const job=await claim();
  const url=new URL(connection);url.searchParams.set('options',`-c search_path=${t.schemaName}`);
  const peer=postgres(url.toString(),{max:1,prepare:false,onnotice:()=>{}});
  try{await peer.begin(async tx=>{
    await tx`UPDATE inspirations SET text='The owner is changing this raw capture.' WHERE id=${f.sourceId}`;
    await processBackgroundJob(job);
    expect(await f.state()).toMatchObject({phase:'failed',failureCode:'publication_unconfirmed'});
    expect(answer).toHaveBeenCalledTimes(1);
  });}finally{await peer.end();}
  expect((await t.sql`SELECT text FROM inspirations WHERE id=${f.sourceId}`)[0].text).toBe('The owner is changing this raw capture.');
  expect(await t.sql`SELECT id FROM conversation_messages WHERE conversation_id=${f.id}`).toHaveLength(1);
});
it('counts both reserved provider slots of earlier hybrid attempts',async()=>{
  const f=await fixture();
  await t.sql`INSERT INTO conversation_reply_requests(id,profile_id,conversation_id,conversation_revision,context_hash,status,dispatched_at,retrieval_dispatched_at)
    SELECT gen_random_uuid(),${f.profileId}::uuid,${f.id}::uuid,1,'','failed',now(),now() FROM generate_series(1,10)`;
  await f.request();const state=await f.state(),job=await claim(),embed=vi.fn(async()=>[1,...Array<number>(767).fill(0)]);
  await processConversationReply(t.db as never,job,f.id,state.requestId,async()=>{}, {embeddingClient:{model:GEMINI_EMBEDDING_MODEL,embed}});
  expect(await f.state()).toMatchObject({phase:'failed',failureCode:'budget'});expect(embed).not.toHaveBeenCalled();expect(answer).not.toHaveBeenCalled();
});
it('commits Send and the reply outbox atomically, including an exact lost-response replay',async()=>{
  const f=await fixture(),messageId=randomUUID();const input={id:messageId,content:'What is a useful next step?',revision:1,requestReply:true};
  expect((await f.post(`/${f.id}/messages`,input)).status).toBe(200);expect((await f.post(`/${f.id}/messages`,input)).status).toBe(200);
  expect(await t.sql`SELECT id FROM conversation_reply_requests WHERE user_message_id=${messageId}`).toHaveLength(1);
  expect(await t.sql`SELECT id FROM conversation_messages WHERE id=${messageId}`).toHaveLength(1);
  expect(await f.state()).toMatchObject({phase:'pending',messageId});await processBackgroundJob(await claim());expect(answer).toHaveBeenCalledTimes(1);
});
it('first Send creates one conversation, message and reply request without an empty intermediate row',async()=>{
  const f=await fixture(),id=randomUUID(),firstMessage={id:randomUUID(),content:'How can a quiet morning leave room for ideas?',requestReply:true};
  for(let n=0;n<2;n++)expect((await f.post('',{id,firstMessage})).status).toBe(200);
  expect(await t.sql`SELECT id FROM conversations WHERE id=${id}`).toHaveLength(1);
  expect(await t.sql`SELECT id FROM conversation_messages WHERE conversation_id=${id}`).toHaveLength(1);
  expect(await t.sql`SELECT id FROM conversation_reply_requests WHERE conversation_id=${id}`).toHaveLength(1);
  expect(answer).not.toHaveBeenCalled();
  const result=await(await f.app.request(`/conversations/${id}/reply`)).json() as any;
  expect(result).toMatchObject({phase:'pending',messageId:firstMessage.id,revision:1});
  await processBackgroundJob(await claim());expect(answer).toHaveBeenCalledOnce();
  expect(await t.sql`SELECT id FROM conversation_messages WHERE conversation_id=${id}`).toHaveLength(2);
});
it('recovers the first Send after its starting principle was deleted without restoring it',async()=>{
  const f=await fixture(),id=randomUUID();
  const [principle]=await t.sql`INSERT INTO principles(profile_id,statement,origin,rank,locked_at) VALUES(${f.profileId},'Keep room for thought.','declared',0,now()) RETURNING id`;
  const input={id,principleId:principle.id,firstMessage:{id:randomUUID(),content:'How might this guide today?',requestReply:true}};
  expect((await f.post('',input)).status).toBe(200);
  await t.sql`DELETE FROM principles WHERE id=${principle.id}`;
  const retry=await f.post('',input);expect(retry.status).toBe(200);
  const body=await retry.json() as any;expect(body.conversation.initialPrinciple).toBeNull();expect(body.conversation.messages).toHaveLength(1);
  expect(await t.sql`SELECT id FROM conversation_reply_requests WHERE conversation_id=${id}`).toHaveLength(1);
});
it('starts from a current owned principle even below the default rank window, without asserting it as a user message',async()=>{
  const f=await fixture(),other=await fixture();
  const [principle]=await t.sql`INSERT INTO principles(profile_id,statement,rank,origin,locked_at) VALUES(${f.profileId},'My chosen starting point.',30,'declared',now()) RETURNING id`;
  await t.sql`INSERT INTO principles(profile_id,statement,rank,origin,locked_at) SELECT ${f.profileId}::uuid,'Another principle '||n,n,'declared',now() FROM generate_series(1,12) n`;
  const id=randomUUID();expect((await f.post('',{id,principleId:principle.id})).status).toBe(200);
  expect((await other.post('',{id:randomUUID(),principleId:principle.id})).status).toBe(404);
  const first=await(await f.app.request(`/conversations/${id}`)).json() as any;expect(first.conversation.messages).toHaveLength(0);expect(first.conversation.initialPrinciple.statement).toBe('My chosen starting point.');
  await f.post(`/${id}/messages`,{id:randomUUID(),content:'How could this apply to my choice?',revision:0,requestReply:true});await processBackgroundJob(await claim());
  expect(answer.mock.calls[0][0].focusSourceNumber).toBe(1);expect(answer.mock.calls[0][0].sources[0].text).toBe('My chosen starting point.');
  await t.sql`DELETE FROM principles WHERE id=${principle.id}`;const after=await(await f.app.request(`/conversations/${id}`)).json() as any;
  expect(after.conversation.initialPrinciple).toBeNull();expect(after.conversation.messages).toHaveLength(2);expect(after.conversation.messages[1].memoryChanged).toBe(true);
});
it('a retried request with an old predecessor joins its successor rather than creating a third attempt',async()=>{
  const f=await fixture();await f.request();const original=await f.state();answer.mockRejectedValueOnce(new Error('Network outcome unknown'));
  await processBackgroundJob(await claim());expect((await f.state()).phase).toBe('failed');
  await f.request(original.requestId);const retry=await f.state();expect(retry.requestId).not.toBe(original.requestId);
  await f.request(original.requestId);expect((await f.state()).requestId).toBe(retry.requestId);expect(await t.sql`SELECT id FROM conversation_reply_requests`).toHaveLength(2);
  await processBackgroundJob(await claim());expect(answer).toHaveBeenCalledTimes(2);expect((await f.state()).phase).toBe('ready');
});
it.each(['before','during'] as const)('stops %s dispatch without publishing a late reply',async timing=>{
  const f=await fixture();await f.request();const state=await f.state();const stop=async()=>{expect((await f.post(`/${f.id}/replies/${state.requestId}/stop`,{})).status).toBe(200);};
  if(timing==='before')await stop();else during=stop;
  await processBackgroundJob(await claim());expect((await f.state()).phase).toBe('stopped');expect(answer).toHaveBeenCalledTimes(timing==='before'?0:1);
  expect(await t.sql`SELECT id FROM conversation_messages WHERE role='user'`).toHaveLength(1);expect(await t.sql`SELECT id FROM conversation_messages WHERE role='assistant'`).toHaveLength(0);
});
it.each(['before','during'] as const)('fences memory changes %s dispatch and retains the user message',async timing=>{
  const f=await fixture();await f.request();const change=async()=>{await t.sql`UPDATE inspirations SET text='The current words reject that experiment.' WHERE id=${f.sourceId}`;};
  if(timing==='before')await change();else during=change;
  await processBackgroundJob(await claim());expect((await f.state()).phase).toBe('stale');expect(answer).toHaveBeenCalledTimes(timing==='before'?0:1);expect(await t.sql`SELECT id FROM conversation_messages`).toHaveLength(1);
});
it('refuses a late reply after an owned reflection changes during generation',async()=>{
  const f=await fixture();
  const [reflection]=await t.sql`INSERT INTO reflections(profile_id,inspiration_id,question,answer)
    VALUES(${f.profileId},${f.sourceId},'What mattered?','Quiet mornings give me room to experiment.') RETURNING id`;
  await f.request();
  during=async()=>{await t.sql`UPDATE reflections SET answer='I changed my view on this.' WHERE id=${reflection.id}`;};
  await processBackgroundJob(await claim());
  expect((await f.state()).phase).toBe('stale');expect(answer).toHaveBeenCalledTimes(1);
  expect(await t.sql`SELECT id FROM conversation_messages WHERE role='assistant'`).toHaveLength(0);
  expect(await t.sql`SELECT id FROM conversation_messages WHERE role='user'`).toHaveLength(1);
});
it('deletion during a call erases content but retains its dispatch budget and refuses resurrection',async()=>{
  const f=await fixture();await f.request();during=async()=>{expect((await f.app.request(`/conversations/${f.id}`,{method:'DELETE'})).status).toBe(200);};
  await processBackgroundJob(await claim());expect(await t.sql`SELECT id FROM conversation_messages`).toHaveLength(0);
  const [row]=await t.sql`SELECT dispatched_at,"references",context_sources,follow_up_question,context_hash FROM conversation_reply_requests`;expect(row.dispatched_at).not.toBeNull();expect(row.references).toEqual([]);expect(row.context_sources).toEqual([]);expect(row.follow_up_question).toBeNull();expect(row.context_hash).toBe('');
  expect((await f.request()).status).toBe(410);expect(await postgresBackgroundJobStore.usageForAccount(f.accountId,new Date(Date.now()-3600000))).toMatchObject({startedInWindow:1});
});
it('excludes historical replies after their memory changes and refuses stale reference access',async()=>{
  const f=await fixture();await f.request();await processBackgroundJob(await claim());const state=await f.state();
  const before=await(await f.app.request(`/conversations/${f.id}`)).json() as any;
  expect(before.conversation.messages[1].citations[0].preview).toBeTruthy();
  expect(before.conversation.messages[1].citations[0].preview.length).toBeLessThanOrEqual(96);
  await t.sql`DELETE FROM inspirations WHERE id=${f.sourceId}`;
  const body=await(await f.app.request(`/conversations/${f.id}`)).json() as any;expect(body.conversation.messages[1].memoryChanged).toBe(true);
  expect(body.conversation.messages[1].citations[0]).toMatchObject({available:false});
  expect(body.conversation.messages[1].citations[0]).not.toHaveProperty('preview');
  expect((await f.app.request(`/conversations/${f.id}/replies/${state.requestId}/references/0`)).status).toBe(409);
  const nextId=randomUUID();await f.post(`/${f.id}/messages`,{id:nextId,content:'What could I try now?',revision:2});
  await f.post(`/${f.id}/replies`,{messageId:nextId,afterRequestId:null});await processBackgroundJob(await claim());expect(answer.mock.calls.at(-1)![0].history.every(row=>row.role==='user')).toBe(true);expect(answer.mock.calls.at(-1)![0].contextChanged).toBe(true);
});
it('omits whole old messages rather than truncating away their correction',async()=>{
  const f=await fixture(),old='I used to protect quiet mornings. '+'x'.repeat(3900)+' But I reject that now.';
  await t.sql`UPDATE conversation_messages SET content=${old} WHERE id=${f.messageId}`;await f.request();await processBackgroundJob(await claim());
  const next=randomUUID(),content='Now '.repeat(1000);await f.post(`/${f.id}/messages`,{id:next,content,revision:2});await f.post(`/${f.id}/replies`,{messageId:next,afterRequestId:null});await processBackgroundJob(await claim());
  const input=answer.mock.calls.at(-1)![0];expect(input.contextChanged).toBe(true);expect(input.history.at(-1)?.content).toBe(content);expect(input.history.some(row=>row.content.startsWith('I used to protect'))).toBe(false);
});
it('does not dispatch a reclaimed request twice and rejects publication after ownership is lost',async()=>{
  const f=await fixture();await f.request();const job=await claim();during=async()=>{await t.sql`UPDATE background_jobs SET locked_at=locked_at+interval '1 second' WHERE id=${job.id}`;};
  await processBackgroundJob(job);expect((await f.state()).phase).toBe('failed');expect(await t.sql`SELECT id FROM conversation_messages WHERE role='assistant'`).toHaveLength(0);
  const updated=await getDb().query.backgroundJobs.findFirst({where:(row,{eq})=>eq(row.id,job.id)});await processBackgroundJob(updated!);expect(answer).toHaveBeenCalledTimes(1);
});
it('enforces per-message attempt and per-account dispatch limits without losing user words',async()=>{
  const f=await fixture();answer.mockRejectedValue(new Error('Provider failed'));
  let previous:string|null=null;for(let i=0;i<3;i++){await f.request(previous);previous=(await f.state()).requestId;await processBackgroundJob(await claim());}
  expect((await f.request(previous)).status).toBe(429);expect(answer).toHaveBeenCalledTimes(3);expect(await t.sql`SELECT id FROM conversation_messages`).toHaveLength(1);
  answer.mockReset().mockImplementation(async()=>({answer:'No source claim.',followUpQuestion:null,citations:[]}));
  const other=await fixture();await t.sql`INSERT INTO conversation_reply_requests(id,profile_id,conversation_id,conversation_revision,context_hash,status,dispatched_at)
    SELECT gen_random_uuid(),${other.profileId}::uuid,${other.id}::uuid,1,'','failed',now() FROM generate_series(1,20)`;
  await other.request();await processBackgroundJob(await claim());expect(answer).not.toHaveBeenCalled();expect(await other.state()).toMatchObject({phase:'failed',failureCode:'budget'});
});
it('refuses foreign reply requests, exports owned metadata, and leaves generation opt-in',async()=>{
  const a=await fixture(),b=await fixture();await a.request();expect((await b.app.request(`/conversations/${a.id}/reply`)).status).toBe(404);
  expect((await assembleProfileExport(t.db as never,a.profileId)).conversationReplyRequests).toHaveLength(1);expect((await assembleProfileExport(t.db as never,b.profileId)).conversationReplyRequests).toHaveLength(0);
  await t.sql`DELETE FROM accounts WHERE id=${a.accountId}`;expect(await t.sql`SELECT id FROM conversation_reply_requests WHERE profile_id=${a.profileId}`).toHaveLength(0);expect(await t.sql`SELECT id FROM conversation_messages WHERE profile_id=${a.profileId}`).toHaveLength(0);
  vi.stubEnv('WAKA_CONVERSATION_REPLIES','0');expect((await b.request()).status).toBe(503);expect(answer).not.toHaveBeenCalled();
});
it('hands the reply the picked inspiration and points the focus at it, and drops it once cleared',async()=>{
  const f=await fixture();
  const [picked]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${f.profileId},'Ferry timetable, Ulleungdo.') RETURNING id`;
  const id=randomUUID();
  expect((await f.post('',{id,inspirationId:picked.id})).status).toBe(200);
  await f.post(`/${id}/messages`,{id:randomUUID(),content:'What do you make of this?',revision:0,requestReply:true});
  await processBackgroundJob(await claim());
  /* THE POINT OF THE WHOLE CHANGE. The sentence typed shares nothing with a
   * ferry timetable, so neither retrieval path has any reason to return it —
   * and the fixture's own 'quiet morning' keep is exactly what they return
   * instead, which is what this would look like if the pin were a ranking
   * nudge. The pin is what puts the picked keep in front of the model, and
   * `focusSourceNumber` is what tells the model this is the one being talked
   * about rather than one of six it happened to be handed.
   *
   * Asserted on the INPUT, never on the mock's return value: a sibling test
   * can leave an unconsumed `mockImplementationOnce` queued (`mockClear` does
   * not drain those), so a case that reads the reply's text or citations
   * passes or fails on the order the file runs in. What this change produces
   * is the prompt. */
  const input=answer.mock.calls[0][0];
  const index=input.sources.findIndex(source=>source.kind==='inspiration'&&source.text.includes('Ferry timetable'));
  expect(index,JSON.stringify(input.sources)).toBe(0);
  expect(input.focusSourceNumber).toBe(1);
  // What the reply actually read is recorded on its request, and that record
  // is the proof an old citation reopens against.
  const sources=async()=>JSON.stringify(await t.sql`SELECT context_sources FROM conversation_reply_requests WHERE conversation_id=${id}`);
  const recorded=await sources();expect(recorded).toContain(picked.id);
  /* CLEARED MID-THREAD. The next reply stops reading it. The one already given
   * keeps both its assistant message and the record of what it read, because a
   * conversation whose history re-interpreted itself when the rail moved would
   * be the world moving without the person moving it. */
  await f.app.request(`/conversations/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({inspirationId:null})});
  await f.post(`/${id}/messages`,{id:randomUUID(),content:'And the quiet morning?',revision:2,requestReply:true});
  await processBackgroundJob(await claim());
  const next=answer.mock.calls[1][0];
  expect(next.sources.some(source=>source.text.includes('Ferry timetable'))).toBe(false);
  expect(next.focusSourceNumber).toBeUndefined();
  expect(next.sources.some(source=>source.text.includes('quiet morning'))).toBe(true);
  const after=await(await f.app.request(`/conversations/${id}`)).json() as any;
  expect(after.conversation.initialInspiration).toBeNull();
  expect(after.conversation.messages.map((row:any)=>row.role)).toEqual(['user','assistant','user','assistant']);
  expect(await sources()).toContain(picked.id);
});
