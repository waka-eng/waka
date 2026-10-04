/** WHAT THIS MOCKS, AND WHY (gate G6): `authMiddleware` supplies fixture
 * identities. Real routes, transactions, memory predicates, exports and
 * cascades run on disposable Postgres. No model or network is invoked. */
import {randomUUID} from 'node:crypto';
import {Hono} from 'hono';
import {afterAll,beforeAll,beforeEach,expect,it} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {createConversationRoutes} from './conversations.js';
import type {AuthEnv} from '../lib/middleware.js';
import {assembleProfileExport} from '../lib/profile-export.js';
let t:TestDatabase;
beforeAll(async()=>{t=await createTestDatabase();});beforeEach(async()=>{await t.truncateAll();});afterAll(async()=>{await t?.cleanup();});
async function fixture(keyScoped=false){
  const [account]=await t.sql`INSERT INTO accounts(email) VALUES(${randomUUID()+'@example.test'}) RETURNING id`;
  const [profile]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${account.id},'human','Conversation fixture') RETURNING id`;
  const app=new Hono<AuthEnv>();app.route('/conversations',createConversationRoutes({getDatabase:()=>t.db as never,authMiddleware:async(c,next)=>{
    c.set('session',{sessionId:randomUUID(),...(keyScoped?{keyScoped:true as const}:{}),account:{id:account.id,email:'fixture@example.test'},profile:{id:profile.id,accountId:account.id,type:'human',name:'Fixture',preferredLocale:'en-US'}});await next();
  }}));
  const send=(path:string,body:unknown)=>app.request('/conversations'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const id=randomUUID();return {app,send,id,accountId:account.id as string,profileId:profile.id as string};
}
it('stores ordered words once, rejects changed replay and never requests an assistant response',async()=>{
  const f=await fixture();expect((await f.send('',{id:f.id})).status).toBe(200);expect((await f.send('',{id:f.id})).status).toBe(200);
  const message={id:randomUUID(),content:'I need room to think.',revision:0};
  for(let i=0;i<2;i++)expect((await f.send(`/${f.id}/messages`,message)).status).toBe(200);
  expect((await f.send(`/${f.id}/messages`,{...message,content:'Different words'})).status).toBe(409);
  expect((await f.send(`/${f.id}/messages`,{...message,id:randomUUID(),role:'assistant'})).status).toBe(400);
  const response=await f.app.request(`/conversations/${f.id}`);expect(response.headers.get('cache-control')).toContain('no-store');
  const body=await response.json() as any;expect(body.conversation.messages).toHaveLength(1);expect(body.conversation.messages[0].content).toBe(message.content);expect(body.generationEnabled).toBe(false);expect(body.limits.modelCalls).toBe(0);
  const history=await (await f.app.request('/conversations')).json() as any;expect(history.conversations).toHaveLength(1);expect(history.conversations[0].preview).toBe(message.content);
  expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);
});
it('includes the original capture date so old interests cannot silently look recent',async()=>{
  const f=await fixture();await f.send('',{id:f.id});await f.send(`/${f.id}/messages`,{id:randomUUID(),content:'marathon training',revision:0});
  await t.sql`INSERT INTO inspirations(profile_id,text,created_at) VALUES(${f.profileId},'I want to try marathon training.','2021-06-01T00:00:00Z')`;
  const result=await (await f.app.request(`/conversations/${f.id}/context`)).json() as any;expect(result.inspirations).toHaveLength(1);expect(new Date(result.inspirations[0].recordedAt).getUTCFullYear()).toBe(2021);
});
it('serializes competing writers and permits an exact retry after its revision becomes stale',async()=>{
  const f=await fixture();await f.send('',{id:f.id});const first={id:randomUUID(),content:'First',revision:0},second={id:randomUUID(),content:'Second',revision:0};
  const results=await Promise.all([f.send(`/${f.id}/messages`,first),f.send(`/${f.id}/messages`,second)]);
  expect(results.map(row=>row.status).sort()).toEqual([200,409]);
  const winner=results[0].status===200?first:second;expect((await f.send(`/${f.id}/messages`,winner)).status).toBe(200);
  expect(await t.sql`SELECT id FROM conversation_messages`).toHaveLength(1);
});
it('refuses other accounts and standing keys, including database-level cross-profile links',async()=>{
  const a=await fixture(),b=await fixture(),key=await fixture(true);await a.send('',{id:a.id});
  expect((await b.app.request(`/conversations/${a.id}`)).status).toBe(404);
  expect((await b.app.request(`/conversations/${a.id}/context?profile=${a.profileId}`)).status).toBe(404);
  expect((await key.send('',{id:key.id})).status).toBe(403);
  await expect(t.sql`INSERT INTO conversation_messages(id,profile_id,conversation_id,position,role,content) VALUES(${randomUUID()},${b.profileId},${a.id},1,'user','Foreign')`).rejects.toMatchObject({code:'23503'});
});
it('deletion erases text, excludes it from export and prevents delayed create/send resurrection',async()=>{
  const f=await fixture();await f.send('',{id:f.id});const message={id:randomUUID(),content:'Erase these words',revision:0};await f.send(`/${f.id}/messages`,message);
  expect((await assembleProfileExport(t.db as never,f.profileId)).conversationMessages).toHaveLength(1);
  for(let i=0;i<2;i++)expect((await f.app.request(`/conversations/${f.id}`,{method:'DELETE'})).status).toBe(200);
  expect((await f.app.request(`/conversations/${f.id}`)).status).toBe(410);expect((await f.send('',{id:f.id})).status).toBe(410);expect((await f.send(`/${f.id}/messages`,message)).status).toBe(410);
  const exported=await assembleProfileExport(t.db as never,f.profileId);expect(exported.conversations).toEqual([]);expect(exported.conversationMessages).toEqual([]);
  await t.sql`DELETE FROM accounts WHERE id=${f.accountId}`;expect(await t.sql`SELECT id FROM conversations`).toHaveLength(0);
});
it('retrieves only current owned memories and preserves disputed/unconfirmed standing',async()=>{
  const f=await fixture(),other=await fixture();await f.send('',{id:f.id});await f.send(`/${f.id}/messages`,{id:randomUUID(),content:'quiet mornings',revision:0});
  const [source]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${f.profileId},'quiet mornings leave room for thought') RETURNING id`;
  await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${other.profileId},'quiet mornings PRIVATE_SENTINEL')`;
  await t.sql`INSERT INTO principles(profile_id,statement,type,origin,rank,state,locked_at) VALUES(${f.profileId},'My disputed words','maxim','declared',0,'contested',now()),(${f.profileId},'Stale machine claim','maxim','minted',1,'held',null)`;
  const read=async()=>await (await f.app.request(`/conversations/${f.id}/context`)).json() as any;
  const context=await read();expect(context.inspirations).toHaveLength(1);expect(context.principles).toHaveLength(1);expect(context.principles[0]).toMatchObject({text:'My disputed words',state:'contested',supportCurrent:false});expect(JSON.stringify(context)).not.toContain('PRIVATE_SENTINEL');
  await t.sql`DELETE FROM inspirations WHERE id=${source.id}`;expect((await read()).inspirations).toEqual([]);
  await t.sql`UPDATE principles SET statement='My revised words' WHERE profile_id=${f.profileId} AND rank=0`;expect((await read()).principles[0].text).toBe('My revised words');
});
it('enforces input, active-conversation and per-conversation bounds',async()=>{
  const f=await fixture();await f.send('',{id:f.id});
  for(const content of [' ', 'a'.repeat(4001)])expect((await f.send(`/${f.id}/messages`,{id:randomUUID(),content,revision:0})).status).toBe(400);
  await t.sql`UPDATE conversations SET revision=200 WHERE id=${f.id}`;
  expect((await f.send(`/${f.id}/messages`,{id:randomUUID(),content:'More',revision:200})).status).toBe(429);
  await t.sql`INSERT INTO conversations(id,profile_id) SELECT gen_random_uuid(),${f.profileId}::uuid FROM generate_series(1,99)`;
  expect((await f.send('',{id:randomUUID()})).status).toBe(429);
});
it('bounds memory text without starving the reading and excludes dismissed entries',async()=>{
  const f=await fixture();await f.send('',{id:f.id});await f.send(`/${f.id}/messages`,{id:randomUUID(),content:'quiet',revision:0});
  await t.sql`INSERT INTO principles(profile_id,statement,rank,origin,locked_at) SELECT ${f.profileId}::uuid,repeat('Principle words ',150),n,'declared',now() FROM generate_series(1,10) n`;
  const [reading]=await t.sql`INSERT INTO top_of_minds(profile_id) VALUES(${f.profileId}) RETURNING id`;
  const [entry]=await t.sql`INSERT INTO top_of_mind_entries(top_of_mind_id,type,body,sort_order,locked_at) VALUES(${reading.id},'pattern','A current user-kept reading',0,now()) RETURNING id`;
  await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${f.profileId},'quiet time')`;
  const read=async()=>await (await f.app.request(`/conversations/${f.id}/context`)).json() as any;
  const body=await read();expect(body.reading[0].text).toBe('A current user-kept reading');expect(body.inspirations).toHaveLength(1);expect([...body.principles,...body.reading,...body.inspirations].reduce((sum:number,row:{text:string})=>sum+row.text.length,0)).toBeLessThanOrEqual(16000);
  await t.sql`UPDATE top_of_mind_entries SET dismissed_at=now() WHERE id=${entry.id}`;expect((await read()).reading).toEqual([]);
});
it('exports only the owner and cascades active messages on account erasure',async()=>{
  const a=await fixture(),b=await fixture();for(const f of [a,b]){await f.send('',{id:f.id});await f.send(`/${f.id}/messages`,{id:randomUUID(),content:f===a?'Owned':'Foreign',revision:0});}
  const exported=await assembleProfileExport(t.db as never,a.profileId);expect(exported.conversations.map(row=>row.id)).toEqual([a.id]);expect(exported.conversationMessages.map(row=>row.content)).toEqual(['Owned']);
  await t.sql`DELETE FROM accounts WHERE id=${a.accountId}`;expect(await t.sql`SELECT id FROM conversation_messages WHERE profile_id=${a.profileId}`).toHaveLength(0);expect(await t.sql`SELECT id FROM conversation_messages WHERE profile_id=${b.profileId}`).toHaveLength(1);
});
