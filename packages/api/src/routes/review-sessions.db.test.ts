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
it('prioritizes unreviewed sources, bounds five, and does not change order when new material arrives',async()=>{
  const p=await person(),newest=await source(p.id);
  await t.sql`INSERT INTO reflections(profile_id,inspiration_id,question,answer) VALUES (${p.id},${newest},'Why?','Already reflected')`;
  const ids=[];for(let days=1;days<=6;days++) ids.push(await source(p.id,days));
  const session=await start(p);expect(session.items.map((row:{inspirationId:string})=>row.inspirationId)).toEqual(ids.slice(0,5));
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
it('permits finishing early, resumes no completed session and reuses reviewed sources only as revisits',async()=>{
  const p=await person(),a=await source(p.id),session=await start(p,[a]);
  const picked=await sessionBody(await choose(p,session,a,'skip'));
  expect((await post(p,`/${session.id}/complete`,{revision:0})).status).toBe(409);
  const done=await post(p,`/${session.id}/complete`,{revision:picked.revision});expect(done.status).toBe(200);
  expect((await sessionBody(await post(p,`/${session.id}/complete`,{revision:picked.revision}))).revision).toBe(2);
  expect(await (await p.app.request('/reviews/active')).json()).toEqual({session:null});
  expect((await choose(p,picked,a,null)).status).toBe(409);
  expect((await start(p)).items[0]).toMatchObject({reason:'revisit',choice:null});
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
