/** WHAT THIS MOCKS, AND WHY (gate G6): fixture auth and getDb select a
 * disposable local tenant. Real capture, queue outbox, replay and SQL FKs run. */
import {randomUUID} from 'node:crypto';
import {Hono} from 'hono';
import {afterAll,beforeEach,expect,it,vi} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {createInspirationsRoutes} from './inspirations.js';
import {createConversationRoutes} from './conversations.js';
import {assembleProfileExport} from '../lib/profile-export.js';
import type {AuthEnv} from '../lib/middleware.js';
const state=vi.hoisted(()=>({db:null as unknown}));vi.mock('../lib/db.js',()=>({getDb:()=>state.db}));
let t:TestDatabase;
beforeEach(async()=>{t??=await createTestDatabase();await t.truncateAll();state.db=t.db;});afterAll(async()=>{await t?.cleanup();});
async function fixture(role='user',keyScoped=false){
  const [account]=await t.sql`INSERT INTO accounts(email) VALUES(${randomUUID()+'@example.test'}) RETURNING id`;
  const [profile]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${account.id},'human','Chat save fixture') RETURNING id`;
  const conversationId=randomUUID(),messageId=randomUUID();
  await t.sql`INSERT INTO conversations(id,profile_id,revision) VALUES(${conversationId},${profile.id},1)`;
  await t.sql`INSERT INTO conversation_messages(id,profile_id,conversation_id,position,role,content) VALUES(${messageId},${profile.id},${conversationId},1,${role},'Leave one morning free to think.')`;
  const auth:typeof import('../lib/middleware.js').requireAuth=async(c,next)=>{c.set('session',{sessionId:randomUUID(),...(keyScoped?{keyScoped:true as const}:{}),account:{id:account.id,email:'fixture@example.test'},profile:{id:profile.id,accountId:account.id,type:'human',name:'Fixture',preferredLocale:'en-US'}});await next();};
  const app=new Hono<AuthEnv>();app.route('/api/inspirations',createInspirationsRoutes({getDatabase:()=>t.db as never,authMiddleware:auth}));app.route('/api/conversations',createConversationRoutes({getDatabase:()=>t.db as never,authMiddleware:auth}));
  const input={text:'I want one free morning this week.',kind:'note',visibility:'private',fromConversation:{conversationId,messageId,selectedText:'one morning free',adopted:role==='assistant'}};
  const post=(body:unknown=input,key=randomUUID())=>app.request('/api/inspirations',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)});
  return {app,input,post,profileId:profile.id,accountId:account.id,conversationId,messageId};
}
it('saves one edited thought with provenance and processing intent; replay is exact and conversation stays unchanged',async()=>{
  const f=await fixture(),key=randomUUID();const first=await f.post(f.input,key);expect(first.status).toBe(201);const made=await first.json() as any;
  const replay=await f.post(f.input,key);expect(replay.status).toBe(200);expect((await replay.json() as any).inspiration.id).toBe(made.inspiration.id);
  expect((await f.post({...f.input,text:'different'},key)).status).toBe(409);
  const read=await (await f.app.request('/api/inspirations/'+made.inspiration.id)).json() as any;expect(read.inspiration.conversationOrigin).toEqual({conversationId:f.conversationId,messageId:f.messageId,authorship:'user'});
  expect(await t.sql`SELECT id FROM inspirations`).toHaveLength(1);expect(await t.sql`SELECT id FROM conversation_messages`).toHaveLength(1);
  expect(await t.sql`SELECT id FROM principles`).toHaveLength(0);expect(await t.sql`SELECT request_id FROM inspiration_save_requests`).toHaveLength(1);
  expect((await t.sql`SELECT visibility FROM inspirations`)[0].visibility).toBe('private');
  expect((await (await f.app.request('/api/conversations/'+f.conversationId)).json() as any).conversation.messages[0].savedInspirationIds).toEqual([made.inspiration.id]);
  const edited=await f.app.request('/api/inspirations/'+made.inspiration.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'Revised after saving.'})});
  expect(edited.status).toBe(200);expect((await edited.json() as any).inspiration.conversationOrigin.authorship).toBe('user');
});
it('requires explicit rewritten adoption of an assistant suggestion and never stores rejected AI text as a source',async()=>{
  const f=await fixture('assistant');
  expect((await f.post({...f.input,fromConversation:{...f.input.fromConversation,adopted:false}})).status).toBe(400);
  expect((await f.post({...f.input,text:f.input.fromConversation.selectedText})).status).toBe(400);
  expect(await t.sql`SELECT id FROM inspirations`).toHaveLength(0);expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);
  const result=await f.post();expect(result.status).toBe(201);expect((await result.json() as any).inspiration.conversationOrigin.authorship).toBe('adopted');
  expect((await t.sql`SELECT text FROM inspirations`)[0].text).toBe(f.input.text);
});
it('refuses foreign messages, forged spans, standing keys and public capture without partial writes',async()=>{
  const a=await fixture(),b=await fixture(),key=await fixture('user',true);
  expect((await b.post(a.input)).status).toBe(404);
  expect((await a.post({...a.input,fromConversation:{...a.input.fromConversation,selectedText:'Invented quote'}})).status).toBe(409);
  expect((await key.post()).status).toBe(403);expect((await a.post({...a.input,visibility:'public'})).status).toBe(400);
  expect(await t.sql`SELECT id FROM inspirations`).toHaveLength(0);
});
it('preserves saved thought and authorship after chat deletion; late save replay never resurrects either',async()=>{
  const f=await fixture('assistant'),key=randomUUID(),made=await (await f.post(f.input,key)).json() as any;
  expect((await f.app.request('/api/conversations/'+f.conversationId,{method:'DELETE'})).status).toBe(200);
  const origin=(await t.sql`SELECT * FROM inspiration_conversation_origins`)[0];expect(origin.authorship).toBe('adopted');expect(origin.conversation_id).toBeNull();expect(origin.message_id).toBeNull();
  expect((await f.post(f.input,key)).status).toBe(200);expect((await f.post(f.input)).status).toBe(404);
  await t.sql`DELETE FROM inspirations WHERE id=${made.inspiration.id}`;
  expect((await f.post(f.input,key)).status).toBe(410);expect(await t.sql`SELECT * FROM inspiration_conversation_origins`).toHaveLength(0);
});
it('exports owned provenance, rejects cross-profile FKs and erases it with the account',async()=>{
  const a=await fixture(),b=await fixture(),made=await (await a.post()).json() as any;
  expect((await assembleProfileExport(t.db as never,a.profileId)).inspirationConversationOrigins).toHaveLength(1);
  expect((await assembleProfileExport(t.db as never,b.profileId)).inspirationConversationOrigins).toHaveLength(0);
  await expect(t.sql`UPDATE inspiration_conversation_origins SET conversation_id=${b.conversationId},message_id=${b.messageId} WHERE inspiration_id=${made.inspiration.id}`).rejects.toMatchObject({code:'23503'});
  await t.sql`DELETE FROM accounts WHERE id=${a.accountId}`;expect(await t.sql`SELECT * FROM inspiration_conversation_origins`).toHaveLength(0);
});
