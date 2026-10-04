/** WHAT THIS MOCKS, AND WHY (gate G6): `authMiddleware` supplies owned
 * sessions and `ModelProvider` returns controlled replies. Real routes,
 * queue claims, dispatch accounting, memory fences and SQL transactions run.
 * No remote database or paid provider is used. */
import {randomUUID} from 'node:crypto';
import {Hono} from 'hono';
import {afterAll,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {createConversationRoutes} from './conversations.js';
import type {AuthEnv} from '../lib/middleware.js';
import {getDb} from '../lib/db.js';
import {setDefaultModelProviderForTests,type ConversationReplyInput,type ConversationReplyResult,type ModelProvider} from '../lib/model-provider.js';
import {postgresBackgroundJobStore,processBackgroundJob} from '../lib/queue.js';
import {assembleProfileExport} from '../lib/profile-export.js';
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
it('commits Send and the reply outbox atomically, including an exact lost-response replay',async()=>{
  const f=await fixture(),messageId=randomUUID();const input={id:messageId,content:'What is a useful next step?',revision:1,requestReply:true};
  expect((await f.post(`/${f.id}/messages`,input)).status).toBe(200);expect((await f.post(`/${f.id}/messages`,input)).status).toBe(200);
  expect(await t.sql`SELECT id FROM conversation_reply_requests WHERE user_message_id=${messageId}`).toHaveLength(1);
  expect(await t.sql`SELECT id FROM conversation_messages WHERE id=${messageId}`).toHaveLength(1);
  expect(await f.state()).toMatchObject({phase:'pending',messageId});await processBackgroundJob(await claim());expect(answer).toHaveBeenCalledTimes(1);
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
it('deletion during a call erases content but retains its dispatch budget and refuses resurrection',async()=>{
  const f=await fixture();await f.request();during=async()=>{expect((await f.app.request(`/conversations/${f.id}`,{method:'DELETE'})).status).toBe(200);};
  await processBackgroundJob(await claim());expect(await t.sql`SELECT id FROM conversation_messages`).toHaveLength(0);
  const [row]=await t.sql`SELECT dispatched_at,"references",follow_up_question,context_hash FROM conversation_reply_requests`;expect(row.dispatched_at).not.toBeNull();expect(row.references).toEqual([]);expect(row.follow_up_question).toBeNull();expect(row.context_hash).toBe('');
  expect((await f.request()).status).toBe(410);expect(await postgresBackgroundJobStore.usageForAccount(f.accountId,new Date(Date.now()-3600000))).toMatchObject({startedInWindow:1});
});
it('excludes historical replies after their memory changes and refuses stale reference access',async()=>{
  const f=await fixture();await f.request();await processBackgroundJob(await claim());const state=await f.state();
  await t.sql`DELETE FROM inspirations WHERE id=${f.sourceId}`;
  const body=await(await f.app.request(`/conversations/${f.id}`)).json() as any;expect(body.conversation.messages[1].memoryChanged).toBe(true);
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
