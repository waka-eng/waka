/** Real shared Postgres counters + routes. Auth identities are injected;
 * network/provider wake is stubbed. Each independent client has max:1. */
import {randomUUID} from 'node:crypto';
import {Hono} from 'hono';
import postgres from 'postgres';
import {drizzle} from 'drizzle-orm/postgres-js';
import {afterAll,afterEach,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import * as schema from '../db/index.js';
import {createConversationRoutes} from '../routes/conversations.js';
import {chargeChatRequest,ChatRateLimitError} from './chat-rate-limit.js';
import type {AuthEnv} from './middleware.js';
vi.mock('./queue.js',async original=>({...await original<typeof import('./queue.js')>(),wakeCommittedBackgroundJobs:vi.fn()}));
let t:TestDatabase,second:ReturnType<typeof postgres>,db2:ReturnType<typeof drizzle<typeof schema>>;
beforeAll(async()=>{
 t=await createTestDatabase();const u=new URL(process.env.DB_CONNECTION_URL!);
 if(!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||!u.pathname.endsWith('_test'))throw Error('Explicit disposable loopback database required');
 u.searchParams.set('options',`-c search_path=${t.schemaName}`);
 second=postgres(u.toString(),{max:1,prepare:false,onnotice:()=>{}});db2=drizzle(second,{schema});
});
beforeEach(async()=>{vi.stubEnv('WAKA_CONVERSATION_REPLIES','0');vi.clearAllMocks();await t.truncateAll();});
afterEach(()=>vi.unstubAllEnvs());
afterAll(async()=>{await second?.end();await t?.cleanup();});
async function owner(){
 const [a]=await t.sql`INSERT INTO accounts(email) VALUES(${randomUUID()+'@example.test'}) RETURNING id`;
 const [p]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${a.id},'human','Fixture') RETURNING id`;
 return {accountId:a.id as string,profileId:p.id as string};
}
function client(who:Awaited<ReturnType<typeof owner>>,db=t.db){
 const app=new Hono<AuthEnv>();app.route('/chat',createConversationRoutes({getDatabase:()=>db as never,authMiddleware:async(c,next)=>{
  c.set('session',{sessionId:randomUUID(),account:{id:who.accountId,email:'fixture@example.test'},profile:{id:who.profileId,accountId:who.accountId,type:'human',name:'Fixture',preferredLocale:'en-US'}});await next();
 }}));
 return {app,post:(path:string,body:unknown)=>app.request('/chat'+path,{method:'POST',headers:{'content-type':'application/json','x-forwarded-for':randomUUID()},body:JSON.stringify(body)})};
}
async function seed(who:Awaited<ReturnType<typeof owner>>,minute=0,hour=0){
 await t.sql`INSERT INTO account_chat_limits(account_id,minute_count,hour_count) VALUES(${who.accountId},${minute},${hour})`;
}
it('admits exactly20 simultaneous distinct messages across two pool-one clients/conversations, isolates another account',async()=>{
 const a=await owner(),other=await owner(),clients=[client(a),client(a,db2 as never)];
 const drafts=Array.from({length:28},()=>({chat:randomUUID(),message:randomUUID()}));
 for(const d of drafts)await t.sql`INSERT INTO conversations(id,profile_id) VALUES(${d.chat},${a.profileId})`;
 const replies=await Promise.all(drafts.map((d,i)=>clients[i%2]!.post(`/${d.chat}/messages`,{id:d.message,revision:0,content:'Distinct words '+i})));
 expect(replies.filter(r=>r.status===200)).toHaveLength(20);expect(replies.filter(r=>r.status===429)).toHaveLength(8);
 expect(await t.sql`SELECT id FROM conversation_messages`).toHaveLength(20);
 expect(await t.sql`SELECT minute_count,hour_count FROM account_chat_limits WHERE account_id=${a.accountId}`).toMatchObject([{minute_count:20,hour_count:20}]);
 const denied=replies.find(r=>r.status===429)!;expect(Number(denied.headers.get('retry-after'))).toBeGreaterThan(0);expect(Number(denied.headers.get('retry-after'))).toBeLessThanOrEqual(60);
 expect(await denied.json()).toMatchObject({code:'chat_rate_limited',retryAfterSeconds:Number(denied.headers.get('retry-after'))});
 expect((await client(other).post('',{id:randomUUID()})).status).toBe(200);
 // A new process/client instance has no local quota cache to reset.
 expect((await client(a,db2 as never).post('',{id:randomUUID()})).status).toBe(429);
});
it('shares quota with retained profiles and does not charge validation, unauthorized/stale changes or committed replays',async()=>{
 const a=await owner(),f=client(a),chat=randomUUID(),message=randomUUID(),body={id:chat,firstMessage:{id:message,content:'Keep exact words'}};
 expect((await f.post('',body)).status).toBe(200);
 await t.sql`UPDATE account_chat_limits SET minute_count=20,hour_count=120 WHERE account_id=${a.accountId}`;
 expect((await f.post('',body)).status).toBe(200);
 expect((await f.post(`/${chat}/messages`,{id:message,content:'Keep exact words',revision:0})).status).toBe(200);
 expect((await f.post('',{id:'bad'})).status).toBe(400);
 expect((await f.post(`/${chat}/messages`,{id:randomUUID(),revision:99,content:'stale'})).status).toBe(409);
 expect((await client(await owner()).post(`/${chat}/messages`,{id:randomUUID(),revision:1,content:'foreign'})).status).toBe(404);
 const [legacy]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${a.accountId},'agent','Retained') RETURNING id`;
 expect((await f.post(`?profile=${legacy.id}`,{id:randomUUID()})).status).toBe(429);
 expect(await t.sql`SELECT minute_count,hour_count FROM account_chat_limits WHERE account_id=${a.accountId}`).toMatchObject([{minute_count:20,hour_count:120}]);
 expect(await t.sql`SELECT id FROM conversation_messages`).toHaveLength(1);
});
it('rolls back both counters and all draft IDs at quota; the same pending draft succeeds after expiry',async()=>{
 const a=await owner(),f=client(a);await seed(a,20,119);
 const body={id:randomUUID(),firstMessage:{id:randomUUID(),content:'Retain this draft unchanged'}};
 expect((await f.post('',body)).status).toBe(429);
 expect(await t.sql`SELECT id FROM conversations`).toHaveLength(0);expect(await t.sql`SELECT id FROM conversation_messages`).toHaveLength(0);
 expect(await t.sql`SELECT minute_count,hour_count FROM account_chat_limits`).toMatchObject([{minute_count:20,hour_count:119}]);
 await t.sql`UPDATE account_chat_limits SET minute_started_at=now()-interval '61 seconds'`;
 expect((await f.post('',body)).status).toBe(200);
 expect(await t.sql`SELECT minute_count,hour_count FROM account_chat_limits`).toMatchObject([{minute_count:1,hour_count:120}]);
 expect((await f.post('',{id:randomUUID()})).status).toBe(429);
 await t.sql`UPDATE account_chat_limits SET hour_started_at=now()-interval '3601 seconds'`;
 expect((await f.post('',{id:randomUUID()})).status).toBe(200);
 expect(await t.sql`SELECT minute_count,hour_count FROM account_chat_limits`).toMatchObject([{minute_count:2,hour_count:1}]);
});
it('charges a Send with inline reply once; explicit retry successor once and replay zero times',async()=>{
 vi.stubEnv('WAKA_CONVERSATION_REPLIES','1');const a=await owner(),f=client(a),chat=randomUUID(),message=randomUUID();
 expect((await f.post('',{id:chat,firstMessage:{id:message,content:'A bounded question',requestReply:true}})).status).toBe(200);
 const [first]=await t.sql`SELECT id FROM conversation_reply_requests`;
 expect((await f.post(`/${chat}/replies`,{messageId:message,afterRequestId:null})).status).toBe(200);
 await t.sql`UPDATE conversation_reply_requests SET status='failed',finished_at=now() WHERE id=${first.id}`;
 await t.sql`UPDATE background_jobs SET status='failed'`;
 const retry={messageId:message,afterRequestId:first.id};
 expect((await f.post(`/${chat}/replies`,retry)).status).toBe(200);
 expect((await f.post(`/${chat}/replies`,retry)).status).toBe(200);
 expect(await t.sql`SELECT minute_count,hour_count FROM account_chat_limits`).toMatchObject([{minute_count:2,hour_count:2}]);
 expect(await t.sql`SELECT id FROM conversation_reply_requests`).toHaveLength(2);
});
it('rejects new explicit reply atomically at quota but preserves Stop and read paths',async()=>{
 const a=await owner(),f=client(a),chat=randomUUID(),message=randomUUID();
 expect((await f.post('',{id:chat,firstMessage:{id:message,content:'Saved question'}})).status).toBe(200);
 vi.stubEnv('WAKA_CONVERSATION_REPLIES','1');await t.sql`UPDATE account_chat_limits SET minute_count=20`;
 expect((await f.post(`/${chat}/replies`,{messageId:message,afterRequestId:null})).status).toBe(429);
 expect(await t.sql`SELECT id FROM conversation_reply_requests`).toHaveLength(0);expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);
 expect((await f.app.request(`/chat/${chat}`)).status).toBe(200);
 expect((await f.post(`/${chat}/replies/${randomUUID()}/stop`,{})).status).toBe(200);
});
it('rolls back on storage failure before dispatch and recovers after storage returns, with no partial charge',async()=>{
 vi.stubEnv('WAKA_CONVERSATION_REPLIES','1');
 const a=await owner(),f=client(a),body={id:randomUUID(),firstMessage:{id:randomUUID(),content:'Keep words on storage failure',requestReply:true}};
 await t.sql`ALTER TABLE account_chat_limits RENAME TO account_chat_limits_unavailable`;
 try {expect((await f.post('',body)).status).toBe(500);expect(await t.sql`SELECT id FROM conversations`).toHaveLength(0);expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);}
 finally {await t.sql`ALTER TABLE account_chat_limits_unavailable RENAME TO account_chat_limits`;}
 expect((await f.post('',body)).status).toBe(200);
 await expect(t.db.transaction(async tx=>{await chargeChatRequest(tx,a.accountId);throw Error('later mutation failure');})).rejects.toThrow('later mutation failure');
 expect(await t.sql`SELECT minute_count,hour_count FROM account_chat_limits`).toMatchObject([{minute_count:1,hour_count:1}]);
});
it('permits fixed-window boundary bursts, bounds Retry-After and cascades operational counters at account erasure',async()=>{
 const a=await owner();await seed(a,20,20);
 await expect(t.db.transaction(tx=>chargeChatRequest(tx,a.accountId))).rejects.toBeInstanceOf(ChatRateLimitError);
 await t.sql`UPDATE account_chat_limits SET minute_started_at=now()-interval '60 seconds'`;
 await t.db.transaction(tx=>chargeChatRequest(tx,a.accountId));
 expect(await t.sql`SELECT minute_count,hour_count FROM account_chat_limits`).toMatchObject([{minute_count:1,hour_count:21}]);
 await t.sql`DELETE FROM accounts WHERE id=${a.accountId}`;expect(await t.sql`SELECT * FROM account_chat_limits`).toHaveLength(0);
});
