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
it('names starter-led threads after the first human topic without copying assistant text',async()=>{
  const f=await fixture(),other=await fixture();await f.send('',{id:f.id});
  await f.send(`/${f.id}/messages`,{id:randomUUID(),content:'Help me think through a choice.',revision:0});
  await f.send(`/${f.id}/messages`,{id:randomUUID(),content:'Should I take the evening course?',revision:1});
  await other.send('',{id:other.id,firstMessage:{id:randomUUID(),content:'PRIVATE_OTHER_TOPIC'}});
  const body=await (await f.app.request('/conversations')).json() as {conversations:Array<{preview:string}>};
  expect(body.conversations).toHaveLength(1);expect(body.conversations[0].preview).toBe('Should I take the evening course?');
  expect(JSON.stringify(body)).not.toContain('PRIVATE_OTHER_TOPIC');
  expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);
});
it('delivers an explicit contiguous tail and expanded history without losing legacy access or ownership',async()=>{
  const f=await fixture(),other=await fixture();await f.send('',{id:f.id});
  await t.sql`INSERT INTO conversation_messages(id,profile_id,conversation_id,position,role,content)
    SELECT gen_random_uuid(),${f.profileId},${f.id},i,'user','Owned message '||i FROM generate_series(1,80) i`;
  await t.sql`UPDATE conversations SET revision=80 WHERE id=${f.id}`;
  const tail=await(await f.app.request(`/conversations/${f.id}?limit=30`)).json() as any;
  expect(tail.conversation).toMatchObject({revision:80,messageWindowStart:51,preview:'Owned message 1'});
  expect(tail.conversation.messages.map((row:any)=>row.position)).toEqual(Array.from({length:30},(_,i)=>i+51));
  const older=await(await f.app.request(`/conversations/${f.id}?from=21`)).json() as any;
  expect(older.conversation.messages).toHaveLength(60);expect(older.conversation.messageWindowStart).toBe(21);
  const legacy=await(await f.app.request(`/conversations/${f.id}`)).json() as any;expect(legacy.conversation.messages).toHaveLength(80);expect(legacy.conversation).not.toHaveProperty('messageWindowStart');
  expect((await other.app.request(`/conversations/${f.id}?limit=30`)).status).toBe(404);
  for(const suffix of ['limit=0','from=81','from=1&limit=30','limit=1000'])expect((await f.app.request(`/conversations/${f.id}?${suffix}`)).status).toBe(400);
});
it('windowed old-message replay includes its confirmation and invalid write windows roll back',async()=>{
  const f=await fixture();await f.send('',{id:f.id});const first={id:randomUUID(),content:'Old confirmed words.',revision:0};
  await f.send(`/${f.id}/messages`,first);
  await t.sql`INSERT INTO conversation_messages(id,profile_id,conversation_id,position,role,content)
    SELECT gen_random_uuid(),${f.profileId},${f.id},i,'user','Later message '||i FROM generate_series(2,80) i`;
  await t.sql`UPDATE conversations SET revision=80 WHERE id=${f.id}`;
  const replay=await(await f.send(`/${f.id}/messages?limit=30`,first)).json() as any;
  expect(replay.conversation.messageWindowStart).toBe(1);expect(replay.conversation.messages[0].id).toBe(first.id);
  expect((await f.send(`/${f.id}/messages?from=199`,{id:randomUUID(),content:'Must roll back.',revision:80})).status).toBe(400);
  expect((await t.sql`SELECT revision FROM conversations WHERE id=${f.id}`)[0].revision).toBe(80);
  expect((await t.sql`SELECT count(*)::int AS n FROM conversation_messages WHERE conversation_id=${f.id}`)[0].n).toBe(80);
});
it('creates the first message atomically and joins concurrent exact first-send replays',async()=>{
  const f=await fixture(),firstMessage={id:randomUUID(),content:'My first question.',requestReply:false};
  const responses=await Promise.all([f.send('',{id:f.id,firstMessage}),f.send('',{id:f.id,firstMessage})]);
  expect(responses.map(row=>row.status)).toEqual([200,200]);
  expect(await t.sql`SELECT id FROM conversations`).toHaveLength(1);expect(await t.sql`SELECT id FROM conversation_messages`).toHaveLength(1);
  expect((await responses[0].json() as any).conversation).toMatchObject({revision:1,messages:[{content:firstMessage.content}]});
  expect((await f.send('',{id:f.id,firstMessage:{...firstMessage,content:'Changed'}})).status).toBe(409);
  expect((await f.send('',{id:f.id,firstMessage:{...firstMessage,id:randomUUID()}})).status).toBe(409);
  expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);
});
it('rolls back an initial conversation when its message cannot be committed',async()=>{
  const f=await fixture(),firstMessage={id:randomUUID(),content:'One question.'};
  await f.send('',{id:f.id,firstMessage});
  expect((await f.send('',{id:randomUUID(),firstMessage})).status).toBe(409);
  expect((await f.send('',{id:randomUUID(),firstMessage:{id:randomUUID(),content:' '}})).status).toBe(400);
  expect(await t.sql`SELECT id FROM conversations`).toHaveLength(1);
  expect(await t.sql`SELECT id FROM conversation_messages`).toHaveLength(1);
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
it('carries a picked inspiration from create, switches it mid-thread, clears it and refuses a foreign one',async()=>{
  const f=await fixture(),other=await fixture();
  const keep=async(profileId:string,text:string)=>(await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${profileId},${text}) RETURNING id`)[0].id as string;
  const first=await keep(f.profileId,'  A ferry timetable I keep meaning to use.  ');
  const second=await keep(f.profileId,'x'.repeat(200));
  const stranger=await keep(other.profileId,'FOREIGN_PICKED_SENTINEL');
  const patch=(id:string,body:unknown,app=f.app)=>app.request(`/conversations/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const read=async()=>(await (await f.app.request(`/conversations/${f.id}`)).json() as any).conversation;
  // A keep named at create arrives trimmed to this route's one label budget,
  // the same 120 characters `GET /` and `conversationPreview` use.
  expect((await f.send('',{id:f.id,inspirationId:first})).status).toBe(200);
  expect((await read()).initialInspiration).toEqual({id:first,text:'A ferry timetable I keep meaning to use.'});
  expect((await patch(f.id,{inspirationId:second})).status).toBe(200);
  expect((await read()).initialInspiration.text).toBe('x'.repeat(120));
  // The rail moving is not a message. Every concurrent writer compares against
  // `revision`, so a switch that bumped it would invalidate a valid in-flight
  // send; `updatedAt` does move, because the person acted on this thread.
  const switched=await read();expect(switched.revision).toBe(0);
  expect(Date.parse(switched.updatedAt)).toBeGreaterThanOrEqual(Date.parse(switched.createdAt));
  // Clearing is a real action with a real stored answer, not an omission.
  expect((await patch(f.id,{inspirationId:null})).status).toBe(200);
  expect((await read()).initialInspiration).toBeNull();
  expect((await t.sql`SELECT initial_inspiration_id FROM conversations WHERE id=${f.id}`)[0].initial_inspiration_id).toBeNull();
  // Replaying the same value is the offline retry, and must join rather than conflict.
  for(let i=0;i<2;i++)expect((await patch(f.id,{inspirationId:first})).status).toBe(200);
  // Another profile's keep is a 404 on every writer, and the stored pin is
  // left exactly as it was rather than half-applied.
  expect((await patch(f.id,{inspirationId:stranger})).status).toBe(404);
  expect((await f.send('',{id:randomUUID(),inspirationId:stranger})).status).toBe(404);
  expect((await read()).initialInspiration.id).toBe(first);
  expect(await t.sql`SELECT id FROM conversations WHERE profile_id=${f.profileId}`).toHaveLength(1);
  // Not reachable through the API, so proven at the level that actually
  // forbids it: the composite FK, which is why owner scoping here is an
  // invariant of the schema and not a rule each handler remembers.
  await expect(t.sql`UPDATE conversations SET initial_inspiration_id=${stranger} WHERE id=${f.id}`).rejects.toMatchObject({code:'23503'});
  // An empty body cannot be read as either intent, so it is a 400 rather than
  // a silent no-op; another profile cannot reach this conversation at all.
  for(const body of [{},{inspirationId:'not-a-uuid'}])expect((await patch(f.id,body)).status).toBe(400);
  expect((await patch(f.id,{inspirationId:stranger},other.app)).status).toBe(404);
  expect(JSON.stringify(await read())).not.toContain('FOREIGN_PICKED_SENTINEL');
});
it('reads the picked inspiration into context even when nothing in the conversation matches it',async()=>{
  const f=await fixture();
  const [picked]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${f.profileId},'Ferry timetable, Ulleungdo.') RETURNING id`;
  await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${f.profileId},'Quiet mornings leave room for thought.')`;
  await f.send('',{id:f.id,inspirationId:picked.id});
  await f.send(`/${f.id}/messages`,{id:randomUUID(),content:'What do you make of this?',revision:0});
  const context=async()=>await (await f.app.request(`/conversations/${f.id}/context`)).json() as any;
  // "What do you make of this?" has nothing in common with a ferry timetable,
  // which is the whole point: a person pointing at a keep does not re-describe
  // it, so retrieval alone would hand the reading six other things.
  expect((await context()).inspirations.map((row:any)=>row.id)).toEqual([picked.id]);
  await f.app.request(`/conversations/${f.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({inspirationId:null})});
  expect((await context()).inspirations).toEqual([]);
});
it('refuses a create replay whose first words match but whose picked inspiration does not',async()=>{
  const f=await fixture();
  const [one]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${f.profileId},'The first keep.') RETURNING id`;
  const [two]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${f.profileId},'The second keep.') RETURNING id`;
  const firstMessage={id:randomUUID(),content:'What do you make of this?'};
  expect((await f.send('',{id:f.id,inspirationId:one.id,firstMessage})).status).toBe(200);
  // Same id, same words, a different declared starting point: a different
  // create wearing the same id, which joining would silently discard. Compared
  // on exactly the terms `initialPrincipleId` is compared on.
  expect((await f.send('',{id:f.id,inspirationId:two.id,firstMessage})).status).toBe(409);
  expect((await f.send('',{id:f.id,firstMessage})).status).toBe(409);
  expect((await f.send('',{id:f.id,inspirationId:one.id,firstMessage})).status).toBe(200);
  expect(await t.sql`SELECT id FROM conversation_messages`).toHaveLength(1);
});
/* WHOSE MEMORY A CHAT READS (2026-10-15): only an agent of the same account
   may be chosen, and the choice is returned with the chat. */
it('starts a chat with your own agent or both, and refuses anyone else\'s agent',async()=>{
  const f=await fixture(),other=await fixture();
  const [mine]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${f.accountId},'agent','Mine') RETURNING id`;
  const [theirs]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${other.accountId},'agent','Theirs') RETURNING id`;
  expect((await f.send('',{id:randomUUID(),perspective:'both',agentId:theirs.id})).status).toBe(404);
  expect((await f.send('',{id:randomUUID(),perspective:'agent'})).status).toBe(400);
  expect((await f.send('',{id:randomUUID(),perspective:'agent',agentId:f.profileId})).status,'a person is not an agent').toBe(404);
  const response=await f.send('',{id:f.id,perspective:'both',agentId:mine.id});expect(response.status).toBe(200);
  const body=await response.json() as {conversation:{perspective:string;agentProfileId:string;profileId:string}};
  expect(body.conversation).toMatchObject({perspective:'both',agentProfileId:mine.id,profileId:f.profileId});
  const plain=await (await f.send('',{id:randomUUID()})).json() as {conversation:{perspective:string}};
  expect(plain.conversation.perspective,'every chat before this reads your own memory').toBe('mine');
});
/* Found in review (2026-10-15): a retry that asked for another memory, and a
   pin an agent-only chat would show but never read. */
it('refuses a create retry that asks for a different memory, and a pin on a chat with the agent alone',async()=>{
  const f=await fixture();
  const [agent]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${f.accountId},'agent','Mine') RETURNING id`;
  const [keep]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${f.profileId},'My own keep') RETURNING id`;
  expect((await f.send('',{id:f.id,perspective:'both',agentId:agent.id})).status).toBe(200);
  expect((await f.send('',{id:f.id})).status,'the same id asking for your own memory is a different create').toBe(409);
  expect((await f.send('',{id:f.id,perspective:'both',agentId:agent.id})).status).toBe(200);
  expect((await f.send('',{id:randomUUID(),perspective:'agent',agentId:agent.id,inspirationId:keep.id})).status).toBe(400);
  const agentChat=randomUUID();
  expect((await f.send('',{id:agentChat,perspective:'agent',agentId:agent.id})).status).toBe(200);
  const patched=await f.app.request(`/conversations/${agentChat}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({inspirationId:keep.id})});
  expect(patched.status).toBe(400);
});
it('reports an agent chat whose agent is gone as your own memory',async()=>{
  const f=await fixture();
  const [agent]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${f.accountId},'agent','Gone') RETURNING id`;
  expect((await f.send('',{id:f.id,perspective:'agent',agentId:agent.id})).status).toBe(200);
  await t.sql`DELETE FROM profiles WHERE id=${agent.id}`;
  const read=await (await f.app.request(`/conversations/${f.id}`)).json() as {conversation:{perspective:string;agentProfileId:string|null}};
  expect(read.conversation).toMatchObject({perspective:'mine',agentProfileId:null});
});
it('treats an identical retry as the same create, for your own memory and after the agent is removed',async()=>{
  const f=await fixture();
  const [agent]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${f.accountId},'agent','Soon gone') RETURNING id`;
  const mine=randomUUID();
  expect((await f.send('',{id:mine,perspective:'mine'})).status).toBe(200);
  expect((await f.send('',{id:mine,perspective:'mine',agentId:agent.id})).status,'an agent id means nothing for your own memory').toBe(200);
  expect((await f.send('',{id:f.id,perspective:'agent',agentId:agent.id})).status).toBe(200);
  await t.sql`DELETE FROM profiles WHERE id=${agent.id}`;
  expect((await f.send('',{id:f.id,perspective:'agent',agentId:agent.id})).status,'the same retry after the agent went').toBe(200);
});
