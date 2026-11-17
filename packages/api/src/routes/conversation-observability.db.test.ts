/** Real owned SQL/route/worker boundaries with synthetic sessions/provider only.
 * The paired stage runs compare exact query ordering, provider input and public
 * answer/citation bytes. No cloud wake, real model credential or owner DB. */
import {realpathSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import postgres from 'postgres';
import {drizzle} from 'drizzle-orm/postgres-js';
import {eq} from 'drizzle-orm';
import {Hono} from 'hono';
import {afterAll,afterEach,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import * as schema from '../db/index.js';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {createConversationRoutes} from './conversations.js';
import {processConversationReply,requestConversationReplyInTransaction} from '../lib/conversation-replies.js';
import {getDb} from '../lib/db.js';
import {setDefaultModelProviderForTests,type ConversationReplyInput,type ModelProvider} from '../lib/model-provider.js';
import type {AuthEnv} from '../lib/middleware.js';
const originalConnection=process.env.DB_CONNECTION_URL!;
const url=new URL(originalConnection);
const strictLocal=Object.prototype.hasOwnProperty.call(process.env,'WAKA_CHAT_TIMING_DISPOSABLE_DIR');
if(strictLocal&&(!process.env.WAKA_CHAT_TIMING_DISPOSABLE_DIR||url.hostname!=='127.0.0.1'||url.port!=='55439'||url.pathname!=='/waka_test_chat_timing'))throw Error('Owned observability fixture required');
let t:TestDatabase,client:ReturnType<typeof postgres>,db:ReturnType<typeof getDb>,queries:string[]=[];
const answer=vi.fn(async(input:ConversationReplyInput)=>({answer:'A small synthetic experiment can clarify this choice.',followUpQuestion:'What would you test first?',citations:input.sources.length?[{sourceNumber:1,quote:input.sources[0].text.slice(0,80)}]:[]}));
beforeAll(async()=>{
 t=await createTestDatabase();
 if(strictLocal){
  const [identity]=await t.sql`SELECT current_setting('server_version_num')::int AS version,current_setting('data_directory') AS directory,current_setting('port') AS port,host(inet_server_addr()) AS host`;
  expect(identity.version).toBeGreaterThanOrEqual(170000);expect(identity.version).toBeLessThan(180000);expect(identity.port).toBe('55439');expect(identity.host).toBe('127.0.0.1');
  expect(realpathSync(identity.directory)).toBe(realpathSync(process.env.WAKA_CHAT_TIMING_DISPOSABLE_DIR!));
 }
 const scoped=new URL(originalConnection);scoped.searchParams.set('options',`-c search_path=${t.schemaName}`);process.env.DB_CONNECTION_URL=scoped.toString();
 client=postgres(scoped.toString(),{max:1,prepare:false,onnotice:()=>{},debug:(_connection,query)=>{queries.push(query);}});db=drizzle(client,{schema}) as typeof db;
 // Establish postgres-js catalog/type initialization before either paired stage.
 // Startup is not an application-statement delta or a latency measurement.
 await client`SELECT 1`;
});
beforeEach(async()=>{await t.truncateAll();answer.mockClear();queries=[];vi.stubEnv('WAKA_STAGE','development');vi.stubEnv('WAKA_CONVERSATION_REPLIES','1');vi.stubEnv('WAKA_BACKGROUND_JOB_AUTODRAIN','0');setDefaultModelProviderForTests({name:'observability-fixture',answerConversation:answer} as unknown as ModelProvider);});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
afterAll(async()=>{setDefaultModelProviderForTests(null);await client?.end();await getDb().$client.end();await t?.cleanup();process.env.DB_CONNECTION_URL=originalConnection;});
const ids={account:'11111111-1111-4111-8111-111111111111',profile:'22222222-2222-4222-8222-222222222222',source:'33333333-3333-4333-8333-333333333333',conversation:'44444444-4444-4444-8444-444444444444',message:'55555555-5555-4555-8555-555555555555'};
async function fixture(database:typeof db=db){
 await t.sql`INSERT INTO accounts(id,email) VALUES(${ids.account},'synthetic-observability@example.test')`;
 await t.sql`INSERT INTO profiles(id,account_id,type,name) VALUES(${ids.profile},${ids.account},'human','Synthetic')`;
 await t.sql`INSERT INTO inspirations(id,profile_id,text,created_at) VALUES(${ids.source},${ids.profile},'A quiet morning gives me room for an experiment.','2026-01-01T00:00:00Z')`;
 const app=new Hono<AuthEnv>();app.route('/conversations',createConversationRoutes({getDatabase:()=>database,authMiddleware:async(c,next)=>{c.set('session',{sessionId:randomUUID(),account:{id:ids.account,email:'synthetic@example.test'},profile:{id:ids.profile,accountId:ids.account,type:'human',name:'Synthetic',preferredLocale:'en-US'}});await next();}}));
 const post=(path:string,body:unknown)=>app.request('/conversations'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 return {app,post,body:{id:ids.conversation,firstMessage:{id:ids.message,content:'How could a quiet morning help me decide?',requestReply:true}}};
}
function logs(throwMarker?:string){
 const rows:Array<{marker:string;body:any}>=[];vi.spyOn(console,'info').mockImplementation((marker,...rest)=>{if(marker===throwMarker)throw Error('SYNTHETIC_SINK');if(marker==='[conversation-api-timing]'||marker==='[conversation-timing]')rows.push({marker,body:JSON.parse(rest[0])});});return rows;
}
async function publish(){
 const [request]=await db.select().from(schema.conversationReplyRequests);const [job]=await db.select().from(schema.backgroundJobs).where(eq(schema.backgroundJobs.id,request.jobId!));
 await processConversationReply(db,job,ids.conversation,request.id,async()=>{},{embeddingClient:null});
 const messages=await db.select().from(schema.conversationMessages);return {request,messages};
}
it('links new owned admission and worker once, excludes create replay and marks explicit retry replay',async()=>{
 const rows=logs(),f=await fixture();const first=await f.post('',f.body);expect(first.status).toBe(200);expect((await first.json() as any).conversation.messages).toHaveLength(1);
 const replay=await f.post('',f.body);expect(replay.status).toBe(200);
 const {request,messages}=await publish();expect(messages).toHaveLength(2);expect(answer).toHaveBeenCalledOnce();
 const retry=await f.post(`/${ids.conversation}/replies`,{messageId:ids.message,afterRequestId:null});expect(retry.status).toBe(200);
 expect(await t.sql`SELECT id FROM conversation_reply_requests`).toHaveLength(1);
 const api=rows.filter(r=>r.marker==='[conversation-api-timing]').map(r=>r.body),worker=rows.find(r=>r.marker==='[conversation-timing]')!.body;
 expect(api).toHaveLength(3);expect(api[0]).toMatchObject({operation:'create',admission:'new',requestId:request.id,transactionOutcome:'resolved',responseReady:true,revisionBucket:'first'});
 expect(api[1]).toMatchObject({admission:'replay',transactionOutcome:'resolved'});expect(api[1]).not.toHaveProperty('requestId');
 expect(api[2]).toMatchObject({operation:'retry',admission:'replay',requestId:request.id,sweepMs:null});expect(worker).toMatchObject({requestId:request.id,revisionBucket:'first',published:true});
 for(const r of rows){expect(Buffer.byteLength(JSON.stringify(r.body))).toBeLessThanOrEqual(1024);expect(JSON.stringify(r.body)).not.toMatch(/quiet morning|synthetic@example|profileId|accountId|conversationId|contextHash|sources/);}
});
it.each(['create','message','retry'] as const)('preserves exact statement ordering, provider input and publication for %s with diagnostics enabled',async operation=>{
 const runs:any[]=[];logs();
 for(const stage of ['test','development']){
  await t.truncateAll();answer.mockClear();vi.stubEnv('WAKA_STAGE',stage);const f=await fixture();
  if(operation!=='create')expect((await f.post('',{...f.body,firstMessage:{...f.body.firstMessage,requestReply:false}})).status).toBe(200);
  queries=[];
  const response=operation==='create'?await f.post('',f.body):operation==='message'
   ?await f.post(`/${ids.conversation}/messages`,{id:'66666666-6666-4666-8666-666666666666',content:'How should I compare this quiet morning experiment?',revision:1,requestReply:true})
   :await f.post(`/${ids.conversation}/replies`,{messageId:ids.message,afterRequestId:null});
  expect(response.status).toBe(200);const {messages}=await publish();
  const [publication]=await t.sql`SELECT "references",follow_up_question FROM conversation_reply_requests WHERE conversation_id=${ids.conversation}`;
  runs.push({queries:[...queries],input:structuredClone(answer.mock.calls[0][0]),words:messages.map(m=>({role:m.role,content:m.content,position:m.position})),publication});
 }
 expect(runs[1].queries).toEqual(runs[0].queries);expect(runs[1].input).toEqual(runs[0].input);expect(runs[1].words).toEqual(runs[0].words);expect(runs[1].publication).toEqual(runs[0].publication);
 console.log('[synthetic-observability-proof]',JSON.stringify({operation,matchedStatements:runs[0].queries.length,statementOrderEqual:true,providerInputEqual:true,publicationEqual:true}));
});
it('contains throwing sinks and sync/async admission callbacks without changing durable results',async()=>{
 logs('[conversation-api-timing]');const f=await fixture();expect((await f.post('',{...f.body,firstMessage:{...f.body.firstMessage,requestReply:false}})).status).toBe(200);
 const failure=Error('SYNTHETIC_CALLBACK');const accepted=await db.transaction(tx=>requestConversationReplyInTransaction(tx as never,ids.profile,ids.conversation,{messageId:ids.message,afterRequestId:null},undefined,()=>{throw failure;}));
 const replay=await db.transaction(tx=>requestConversationReplyInTransaction(tx as never,ids.profile,ids.conversation,{messageId:ids.message,afterRequestId:null},undefined,()=>Promise.reject(failure)));
 expect(replay.requestId).toBe(accepted.requestId);await publish();expect(answer).toHaveBeenCalledOnce();expect(await t.sql`SELECT id FROM conversation_reply_requests`).toHaveLength(1);
 expect((await f.post(`/${ids.conversation}/replies`,{messageId:ids.message,afterRequestId:null})).status).toBe(200);
});
it('keeps a committed lost ACK unconfirmed and reconciles the exact request without another admission',async()=>{
 const rows=logs();let lose=true;const wrapped=new Proxy(db,{get(target,key){if(key==='transaction')return async(...args:any[])=>{const result=await (target.transaction as any)(...args);if(lose){lose=false;throw Error('SYNTHETIC_COMMIT_ACK_LOST');}return result;};return Reflect.get(target,key);}});
 const f=await fixture(wrapped);expect((await f.post('',f.body)).status).toBe(500);
 expect(await t.sql`SELECT id FROM conversation_messages`).toHaveLength(1);expect(await t.sql`SELECT id FROM conversation_reply_requests`).toHaveLength(1);
 const uncertain=rows.find(r=>r.marker==='[conversation-api-timing]')!.body;expect(uncertain).toMatchObject({transactionOutcome:'unconfirmed',responseReady:false,bodyExitToResolutionMs:null});expect(JSON.stringify(uncertain)).not.toMatch(/rollback|SYNTHETIC_COMMIT/);
 expect((await f.post('',f.body)).status).toBe(200);expect(await t.sql`SELECT id FROM conversation_reply_requests`).toHaveLength(1);
});

it('classifies a stale worker by its admitted revision rather than a later message',async()=>{
 const rows=logs(),f=await fixture();expect((await f.post('',f.body)).status).toBe(200);
 expect((await f.post(`/${ids.conversation}/messages`,{id:randomUUID(),content:'A later synthetic clarification.',revision:1,requestReply:false})).status).toBe(200);
 const [request]=await db.select().from(schema.conversationReplyRequests);expect(request.conversationRevision).toBe(1);
 const [job]=await db.select().from(schema.backgroundJobs).where(eq(schema.backgroundJobs.id,request.jobId!));
 await processConversationReply(db,job,ids.conversation,request.id,async()=>{},{embeddingClient:null});
 const worker=rows.find(r=>r.marker==='[conversation-timing]')!.body;
 expect(worker).toMatchObject({requestId:request.id,revisionBucket:'first',answerAttempted:false,published:false});
 expect((await t.sql`SELECT status FROM conversation_reply_requests WHERE id=${request.id}`)[0].status).toBe('stale');expect(answer).not.toHaveBeenCalled();
 expect((await t.sql`SELECT revision FROM conversations WHERE id=${ids.conversation}`)[0].revision).toBe(2);
});
