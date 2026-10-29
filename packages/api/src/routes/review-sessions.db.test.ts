/** WHAT THIS MOCKS, AND WHY (gate G6): `authMiddleware` supplies fixture
 * principals. The real router, selection queries, transactions, constraints,
 * export and cascades run against disposable Postgres. `console.error` is
 * observed in the error-redaction test. No model calls. */
import {randomUUID} from 'node:crypto';
import {Hono} from 'hono';
import {afterAll,beforeEach,expect,it,vi} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {createReviewSessionRoutes} from './review-sessions.js';
import type {AuthEnv} from '../lib/middleware.js';
import {assembleProfileExport} from '../lib/profile-export.js';
import type {readReviewSession} from '../lib/review-sessions.js';
import postgres from 'postgres';
import {drizzle} from 'drizzle-orm/postgres-js';
import * as schema from '../db/index.js';

let t:TestDatabase,sequence=0;
beforeEach(async()=>{t??=await createTestDatabase();await t.truncateAll();});
afterAll(async()=>{await t?.cleanup();});
async function person(type:'human'|'agent'='human',keyScoped=false){
  const [account]=await t.sql`INSERT INTO accounts(email) VALUES (${`review-${++sequence}@example.test`}) RETURNING id`;
  const [profile]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${account.id},${type},'Reviewer') RETURNING id`;
  const app=new Hono<AuthEnv>();app.route('/reviews',createReviewSessionRoutes({getDatabase:()=>t.db as never,
    authMiddleware:async(c,next)=>{c.set('session',{sessionId:randomUUID(),...(keyScoped?{keyScoped:true as const}:{}),
      account:{id:account.id,email:'reviewer@example.test'},profile:{id:profile.id,accountId:account.id,type,name:'Reviewer',preferredLocale:'en-US'}});await next();}}));
  return {id:profile.id as string,accountId:account.id as string,app};
}
async function source(profileId:string,daysAgo=0){
  const [row]=await t.sql`INSERT INTO inspirations(profile_id,text,created_at) VALUES (${profileId},'Original inspiration',now()-${daysAgo}::int*interval '1 day') RETURNING id`;
  return row.id as string;
}
type Person=Awaited<ReturnType<typeof person>>;
const post=(p:Person,path:string,body:unknown)=>p.app.request(`/reviews${path==='/'?'':path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
async function start(p:Person,inspirationIds?:string[],id=randomUUID()){
  return sessionBody(await post(p,'/',{id,...(inspirationIds?{inspirationIds}:{})}));
}
async function sessionBody(response:Response){
  expect(response.status).toBe(200);
  const body=await response.json() as {session:Awaited<ReturnType<typeof readReviewSession>>};
  expect(body.session).not.toBeNull();return body.session!;
}
const choose=(p:Person,session: {id:string;revision:number},inspirationId:string,choice:'keep'|'skip'|null,sourceRevision='1')=>post(p,`/${session.id}/choices`,{revision:session.revision,inspirationId,choice,sourceRevision});

it('advances atomically to one new owned inspiration with its full material and replay proof',async()=>{
  const p=await person(),a=await source(p.id),b=await source(p.id,1),session=await start(p,[a]);
  const input={revision:session.revision,inspirationId:a,sourceRevision:'1',choice:'skip',nextId:randomUUID()};
  const next=await sessionBody(await post(p,`/${session.id}/advance`,input));
  expect(next.id).toBe(input.nextId);expect(next.currentInspiration).toMatchObject({id:b,profileId:p.id,materialRevision:'1'});
  expect(next.supportsAdvance).toBe(true);expect(next.items).toHaveLength(1);
  const [finished]=await t.sql`SELECT completed_at,revision FROM review_sessions WHERE id=${session.id}`;
  expect(finished.revision).toBe(2);expect(Number.isFinite(Date.parse(finished.completed_at))).toBe(true);
  expect((await sessionBody(await post(p,`/${session.id}/advance`,input))).id).toBe(next.id);
  expect(await t.sql`SELECT id FROM review_sessions`).toHaveLength(2);expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);
  expect((await post(p,`/${session.id}/advance`,{...input,choice:'keep'})).status).toBe(409);
});
it('rolls back the entire next transition on stale source or foreign access',async()=>{
  const p=await person(),other=await person(),a=await source(p.id);await source(p.id,1);const session=await start(p,[a]);
  const input={revision:session.revision,inspirationId:a,sourceRevision:'2',choice:'skip',nextId:randomUUID()};
  expect((await post(p,`/${session.id}/advance`,input)).status).toBe(409);
  expect((await post(other,`/${session.id}/advance`,{...input,sourceRevision:'1'})).status).toBe(404);
  expect((await t.sql`SELECT revision,completed_at FROM review_sessions WHERE id=${session.id}`)[0]).toEqual({revision:0,completed_at:null});
  expect((await t.sql`SELECT choice FROM review_items WHERE session_id=${session.id}`)[0].choice).toBeNull();
  expect(await t.sql`SELECT id FROM review_sessions`).toHaveLength(1);
});
it('never creates another review on replay after a no-candidate next result',async()=>{
  const p=await person(),a=await source(p.id),session=await start(p,[a]);
  const input={revision:session.revision,inspirationId:a,sourceRevision:'1',choice:'skip',nextId:randomUUID()};
  expect(await (await post(p,`/${session.id}/advance`,input)).json()).toEqual({session:null});
  await source(p.id);
  expect(await (await post(p,`/${session.id}/advance`,input)).json()).toEqual({session:null});
  expect(await t.sql`SELECT id FROM review_sessions`).toHaveLength(1);
});
it('keeps legacy multi-item manifests and bundles their next original without opening another session',async()=>{
  const p=await person(),a=await source(p.id),b=await source(p.id,1),session=await start(p,[a,b]);
  const input={revision:session.revision,inspirationId:a,sourceRevision:'1',choice:'skip',nextId:randomUUID()};
  const next=await sessionBody(await post(p,`/${session.id}/advance`,input));
  expect(next.id).toBe(session.id);expect(next.currentInspiration).toMatchObject({id:b});expect(next.completedAt).toBeNull();
  expect((await sessionBody(await post(p,`/${session.id}/advance`,input))).revision).toBe(1);
  expect(await t.sql`SELECT id FROM review_sessions`).toHaveLength(1);
});
it('rolls back choice and completion when the next review cannot be created',async()=>{
  const p=await person(),a=await source(p.id);await source(p.id,1);const session=await start(p,[a]);
  await t.sql`CREATE FUNCTION reject_next_review() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'PRIVATE_NEXT_TEST'; END; $$ LANGUAGE plpgsql`;
  await t.sql`CREATE TRIGGER reject_next_review BEFORE INSERT ON review_sessions FOR EACH ROW EXECUTE FUNCTION reject_next_review()`;
  const logged=vi.spyOn(console,'error').mockImplementation(()=>{});
  try{
    const response=await post(p,`/${session.id}/advance`,{revision:0,inspirationId:a,sourceRevision:'1',choice:'skip',nextId:randomUUID()});
    expect(response.status).toBe(500);expect(await response.text()).not.toContain('PRIVATE_NEXT_TEST');
    expect((await t.sql`SELECT revision,completed_at FROM review_sessions WHERE id=${session.id}`)[0]).toEqual({revision:0,completed_at:null});
    expect((await t.sql`SELECT choice FROM review_items WHERE session_id=${session.id}`)[0].choice).toBeNull();
  }finally{logged.mockRestore();await t.sql`DROP TRIGGER reject_next_review ON review_sessions`;await t.sql`DROP FUNCTION reject_next_review()`;}
});

it('bundles only the current owned original and its matching revision when explicitly requested',async()=>{
  const p=await person(),other=await person(),id=await source(p.id);await source(other.id);
  await t.sql`INSERT INTO reflections(profile_id,inspiration_id,question,answer) VALUES (${p.id},${id},'Why?','A synthetic saved thought')`;
  const response=await p.app.request('/reviews?include=current',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:randomUUID(),inspirationIds:[id]})});
  const session=await sessionBody(response);expect(session.currentInspiration).toMatchObject({id,profileId:p.id,materialRevision:session.items[0].currentRevision,reflections:[{answer:'A synthetic saved thought'}]});
  expect((await sessionBody(await p.app.request(`/reviews/${session.id}`)))).not.toHaveProperty('currentInspiration');
  await t.sql`UPDATE inspirations SET text='Current updated original' WHERE id=${id}`;
  const refreshed=await sessionBody(await p.app.request(`/reviews/${session.id}?include=current`));
  expect(refreshed.currentInspiration).toMatchObject({text:'Current updated original',materialRevision:refreshed.items[0].currentRevision});
  expect((await other.app.request(`/reviews/${session.id}?include=current`)).status).toBe(404);
  expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);
});
it('distinguishes an empty archive from caught-up originals in the opt-in empty response',async()=>{
  const p=await person();const request=()=>p.app.request('/reviews?include=current',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:randomUUID()})});
  expect(await (await request()).json()).toEqual({session:null,hasInspirations:false});
  const id=await source(p.id),session=await start(p),next=await sessionBody(await choose(p,session,id,'skip'));
  await post(p,`/${session.id}/complete`,{revision:next.revision});
  expect(await (await request()).json()).toEqual({session:null,hasInspirations:true});
});

it('reads an owned review result without creating work and refuses foreign result access',async()=>{
  const p=await person(),other=await person();await source(p.id);const session=await start(p);
  const response=await p.app.request(`/reviews/${session.id}/processing`);expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');
  expect(await response.json()).toMatchObject({profileId:p.id,sessionId:session.id,phase:'empty',answerCount:0,result:null,relatedPrinciples:[]});
  expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);
  expect((await other.app.request(`/reviews/${session.id}/processing`)).status).toBe(404);
  expect((await post(other,`/${session.id}/processing/retry`,{})).status).toBe(404);
  expect((await post(p,`/${session.id}/processing/retry`,{answer:'Do not accept arbitrary new words'})).status).toBe(400);
});

it('does not log private database parameters or return them on a failed review write',async()=>{
  const p=await person();await source(p.id);
  await t.sql`CREATE FUNCTION reject_review_write() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'PRIVATE_REVIEW_SENTINEL'; END; $$ LANGUAGE plpgsql`;
  await t.sql`CREATE TRIGGER reject_review_write BEFORE INSERT ON review_sessions FOR EACH ROW EXECUTE FUNCTION reject_review_write()`;
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  try{
    const response=await post(p,'/',{id:randomUUID()});expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('PRIVATE_REVIEW_SENTINEL');
    expect(log).toHaveBeenCalledWith('[review-sessions]',{code:'P0001'});expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_REVIEW_SENTINEL');
    expect(await t.sql`SELECT id FROM review_sessions`).toHaveLength(0);
  }finally{log.mockRestore();await t.sql`DROP TRIGGER reject_review_write ON review_sessions`;await t.sql`DROP FUNCTION reject_review_write()`;}
});

it('has an honest empty state and no orphan session, then admits a single source',async()=>{
  const p=await person();expect(await (await post(p,'/',{id:randomUUID()})).json()).toEqual({session:null});expect(await t.sql`SELECT id FROM review_sessions`).toHaveLength(0);
  const id=await source(p.id);const session=await start(p);expect(session.items.map((row:{inspirationId:string})=>row.inspirationId)).toEqual([id]);
  const active=await p.app.request('/reviews/active');expect(active.headers.get('cache-control')).toContain('no-store');expect((await sessionBody(active)).id).toBe(session.id);
});
it('suggests one unreviewed source and does not replace it when new material arrives',async()=>{
  const p=await person(),newest=await source(p.id);
  await t.sql`INSERT INTO reflections(profile_id,inspiration_id,question,answer) VALUES (${p.id},${newest},'Why?','Already reflected')`;
  const ids=[];for(let days=1;days<=6;days++) ids.push(await source(p.id,days));
  const session=await start(p);expect(session.items.map((row:{inspirationId:string})=>row.inspirationId)).toEqual(ids.slice(0,1));
  expect(session.items.every((row:{reason:string})=>row.reason==='unreviewed')).toBe(true);
  await source(p.id);const read=await sessionBody(await p.app.request(`/reviews/${session.id}`));
  expect(read.items).toEqual(session.items);expect((await start(p)).id).toBe(session.id);
});
it('preserves explicit order, replays the same start and rejects a changed manifest',async()=>{
  const p=await person(),a=await source(p.id),b=await source(p.id,1),id=randomUUID();
  const first=await start(p,[b,a],id);expect(first.items.map((row:{inspirationId:string})=>row.inspirationId)).toEqual([b,a]);
  expect((await start(p,[b,a],id)).id).toBe(id);
  expect((await post(p,'/',{id,inspirationIds:[a,b]})).status).toBe(409);
  expect((await post(p,'/',{id:randomUUID(),inspirationIds:[a]})).status).toBe(409);
  expect(await t.sql`SELECT id FROM review_sessions`).toHaveLength(1);
});
it('choices and undo are revision checked, replay-safe and do not create beliefs or jobs',async()=>{
  const p=await person(),a=await source(p.id),session=await start(p,[a]);
  const before=await t.sql`SELECT personal_revision::text FROM inspiration_revisions WHERE inspiration_id=${a}`;
  const first=await choose(p,session,a,'skip');expect(first.status).toBe(200);
  const next=await sessionBody(first);expect(next).toMatchObject({revision:1,cursor:1});
  expect((await sessionBody(await choose(p,session,a,'skip'))).revision).toBe(1);
  expect((await choose(p,session,a,'keep')).status).toBe(409);
  const undone=await sessionBody(await choose(p,next,a,null));expect(undone).toMatchObject({revision:2,cursor:0});expect(undone.items[0].choice).toBeNull();
  expect(await t.sql`SELECT personal_revision::text FROM inspiration_revisions WHERE inspiration_id=${a}`).toEqual(before);
  expect(await t.sql`SELECT id FROM feedback UNION ALL SELECT id FROM signals UNION ALL SELECT id FROM principles UNION ALL SELECT id FROM background_jobs`).toHaveLength(0);
});
it('refuses stale source choices and reports the current revision without overwriting source text',async()=>{
  const p=await person(),a=await source(p.id),session=await start(p,[a]);
  await t.sql`UPDATE inspirations SET text='Changed by the person' WHERE id=${a}`;
  expect((await choose(p,session,a,'keep')).status).toBe(409);
  const read=await sessionBody(await p.app.request(`/reviews/${session.id}`));
  expect(read.items[0]).toMatchObject({sourceChanged:true,currentRevision:'2',sourceRevision:'1'});
  const saved=await sessionBody(await choose(p,session,a,'keep','2'));expect(saved.items[0].sourceChanged).toBe(false);
  expect((await t.sql`SELECT text FROM inspirations WHERE id=${a}`)[0].text).toBe('Changed by the person');
});
it('source deletion removes only its item and never fills the gap with a new source',async()=>{
  const p=await person(),a=await source(p.id),b=await source(p.id),session=await start(p,[a,b]);
  await t.sql`DELETE FROM inspirations WHERE id=${a}`;await source(p.id);
  const read=await sessionBody(await p.app.request(`/reviews/${session.id}`));
  expect(read.items).toHaveLength(1);expect(read.items[0]).toMatchObject({inspirationId:b,position:1});expect(read.currentInspirationId).toBe(b);
  expect((await choose(p,session,a,'keep')).status).toBe(404);
});
it('permits finishing early and holds recently reviewed sources for 24 hours',async()=>{
  const p=await person(),a=await source(p.id),session=await start(p,[a]);
  const picked=await sessionBody(await choose(p,session,a,'skip'));
  expect((await post(p,`/${session.id}/complete`,{revision:0})).status).toBe(409);
  const done=await post(p,`/${session.id}/complete`,{revision:picked.revision});expect(done.status).toBe(200);
  expect((await sessionBody(await post(p,`/${session.id}/complete`,{revision:picked.revision}))).revision).toBe(2);
  expect(await (await p.app.request('/reviews/active')).json()).toEqual({session:null});
  expect((await choose(p,picked,a,null)).status).toBe(409);
  expect(await (await post(p,'/',{id:randomUUID()})).json()).toEqual({session:null});
  await t.sql`UPDATE review_items SET decided_at=now()-interval '25 hours' WHERE session_id=${session.id}`;
  expect((await start(p)).items[0]).toMatchObject({reason:'revisit',choice:null});
});
it('rotates older reviews before recent eligible reviews and never treats Next as deletion',async()=>{
  const p=await person(),a=await source(p.id),b=await source(p.id,1);
  for(const [id,hours] of [[a,25],[b,48]] as const){
    const session=await start(p,[id]);const next=await sessionBody(await choose(p,session,id,'skip'));
    await post(p,`/${session.id}/complete`,{revision:next.revision});
    await t.sql`UPDATE review_items SET decided_at=now()-${hours}::int*interval '1 hour' WHERE session_id=${session.id}`;
  }
  expect((await start(p)).items[0]).toMatchObject({inspirationId:b,reason:'revisit'});
  expect(await t.sql`SELECT id FROM inspirations WHERE profile_id=${p.id}`).toHaveLength(2);
  expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);
});

it('holds an inspiration for 24 hours after an authored reflection, then permits a revisit',async()=>{
  const p=await person(),id=await source(p.id);
  await t.sql`INSERT INTO reflections(profile_id,inspiration_id,question,answer) VALUES(${p.id},${id},'What mattered?','My own answer.')`;
  expect(await (await post(p,'/',{id:randomUUID()})).json()).toEqual({session:null});
  await t.sql`UPDATE reflections SET created_at=now()-interval '25 hours' WHERE inspiration_id=${id}`;
  expect((await start(p)).items[0]).toMatchObject({inspirationId:id,reason:'revisit'});
});

it('does not treat a blank, unanswered or skipped reflection as a completed review',async()=>{
  for(const [answer,skipped] of [[null,false],['',false],['   ',false],['Not an answer',true]] as const){
    const p=await person(),id=await source(p.id);
    await t.sql`INSERT INTO reflections(profile_id,inspiration_id,question,answer,skipped) VALUES(${p.id},${id},'What mattered?',${answer},${skipped})`;
    expect((await start(p)).items[0]).toMatchObject({inspirationId:id,reason:'unreviewed'});
  }
});
it('rejects cross-account reads/choices/manual sources and cross-tenant SQL links',async()=>{
  const p=await person(),other=await person(),a=await source(p.id),b=await source(other.id),session=await start(p,[a]);
  expect((await other.app.request(`/reviews/${session.id}`)).status).toBe(404);
  expect((await choose(other,session,a,'skip')).status).toBe(404);
  expect((await post(other,'/',{id:randomUUID(),inspirationIds:[a]})).status).toBe(404);
  await expect(t.sql`INSERT INTO review_items(profile_id,session_id,inspiration_id,position,source_revision,reason) VALUES (${p.id},${session.id},${b},1,1,'chosen')`).rejects.toMatchObject({code:'23503'});
  await expect(t.sql`INSERT INTO review_items(profile_id,session_id,inspiration_id,position,source_revision,reason) VALUES (${other.id},${session.id},${b},1,1,'chosen')`).rejects.toMatchObject({code:'23503'});
});
it('restricts review to a human browser session and validates choices/counts',async()=>{
  for(const p of [await person('agent'),await person('human',true)]) expect((await post(p,'/',{id:randomUUID()})).status).toBe(403);
  const p=await person(),a=await source(p.id);expect((await post(p,'/',{id:randomUUID(),inspirationIds:[a,a]})).status).toBe(400);
  expect((await post(p,'/',{id:randomUUID(),inspirationIds:Array.from({length:6},()=>randomUUID())})).status).toBe(400);
  const session=await start(p,[a]);
  await expect(t.sql`UPDATE review_items SET decided_at=now() WHERE session_id=${session.id}`).rejects.toMatchObject({code:'23514'});
});
it('exports review metadata only for its owner and erases it with the account',async()=>{
  const p=await person(),other=await person(),a=await source(p.id),session=await start(p,[a]);
  const bundle=await assembleProfileExport(t.db as never,p.id);expect(bundle.reviewSessions).toHaveLength(1);expect(bundle.reviewItems[0].sourceRevision).toBe('1');expect(()=>JSON.stringify(bundle)).not.toThrow();
  expect((await assembleProfileExport(t.db as never,other.id)).reviewSessions).toHaveLength(0);
  await t.sql`DELETE FROM accounts WHERE id=${p.accountId}`;
  expect(await t.sql`SELECT id FROM review_sessions WHERE id=${session.id}`).toHaveLength(0);expect(await t.sql`SELECT session_id FROM review_items`).toHaveLength(0);
});
it('concurrent starts produce at most one open session',async()=>{
  const p=await person();await source(p.id);
  const connection=postgres(process.env.DB_CONNECTION_URL!,{max:1,prepare:false,connection:{search_path:t.schemaName}});
  const db=drizzle(connection,{schema});
  const second=new Hono<AuthEnv>();second.route('/reviews',createReviewSessionRoutes({getDatabase:()=>db as never,
    authMiddleware:async(c,next)=>{c.set('session',{sessionId:randomUUID(),account:{id:p.accountId,email:'reviewer@example.test'},profile:{id:p.id,accountId:p.accountId,type:'human',name:'Reviewer',preferredLocale:'en-US'}});await next();}}));
  try {
    const responses=await Promise.all([post(p,'/',{id:randomUUID()}),post({...p,app:second},'/',{id:randomUUID()})]);
    expect(responses.every(response=>[200,409].includes(response.status))).toBe(true);
    expect(await t.sql`SELECT id FROM review_sessions WHERE completed_at IS NULL`).toHaveLength(1);
  } finally {await connection.end();}
});
it('refuses a choice while attachment material is being committed, without a partial cursor update',async()=>{
  const p=await person(),a=await source(p.id),session=await start(p,[a]);
  const connection=postgres(process.env.DB_CONNECTION_URL!,{max:1,prepare:false,connection:{search_path:t.schemaName}});
  let unlock!:()=>void,locked!:()=>void;
  const release=new Promise<void>(done=>{unlock=done;}),ready=new Promise<void>(done=>{locked=done;});
  const held=connection.begin(async tx=>{
    await tx`SELECT inspiration_id FROM inspiration_revisions WHERE inspiration_id=${a} FOR UPDATE`;
    locked();await release;
  });
  try {await ready;const response=await choose(p,session,a,'keep');expect(response.status).toBe(409);expect(await response.json()).toMatchObject({code:'review_busy'});}
  finally {unlock();await held;await connection.end();}
  const read=await sessionBody(await p.app.request(`/reviews/${session.id}`));expect(read.revision).toBe(0);expect(read.items[0].choice).toBeNull();
});
