/** Real router, tenant checks, revision fence and cascades on isolated SQL.
 * Only the shared DB accessor is redirected to this disposable test schema.
 * No object-store bytes or model requests are involved. */
import {Hono} from 'hono';
import {afterAll,beforeEach,expect,it,vi} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {createInspirationsRoutes} from './inspirations.js';
import {createReviewSession} from '../lib/review-sessions.js';
import type {AuthEnv} from '../lib/middleware.js';
import {randomUUID} from 'node:crypto';
const state=vi.hoisted(()=>({db:null as unknown}));
vi.mock('../lib/db.js',()=>({getDb:()=>state.db}));
let t:TestDatabase,sequence=0;
beforeEach(async()=>{t??=await createTestDatabase();await t.truncateAll();state.db=t.db;});
afterAll(async()=>{await t?.cleanup();});
async function fixture(){
  const [account]=await t.sql`INSERT INTO accounts(email) VALUES (${`remove-${++sequence}@example.test`}) RETURNING id`;
  const [profile]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${account.id},'human','Reviewer') RETURNING id`;
  const [source]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES (${profile.id},'An inspiration to review') RETURNING id`;
  const app=new Hono<AuthEnv>();app.route('/api/inspirations',createInspirationsRoutes({getDatabase:()=>t.db as never,authMiddleware:async(c,next)=>{
    c.set('session',{sessionId:randomUUID(),account:{id:account.id,email:'reviewer@example.test'},profile:{id:profile.id,accountId:account.id,type:'human',name:'Reviewer',preferredLocale:'en-US'}});await next();
  }}));return {app,profileId:profile.id as string,id:source.id as string};
}
const remove=(f:Awaited<ReturnType<typeof fixture>>,body?:unknown,id=f.id,profile=f.profileId)=>f.app.request(`/api/inspirations/${id}?profile=${profile}`,{method:'DELETE',...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})});
it('refuses deletion after a text edit, keeps all data, and accepts the freshly observed revision',async()=>{
  const f=await fixture();await t.sql`UPDATE inspirations SET text='Changed after opening' WHERE id=${f.id}`;
  const response=await remove(f,{sourceRevision:'1'});expect(response.status).toBe(409);expect(await response.json()).toMatchObject({code:'inspiration_changed'});
  expect(await t.sql`SELECT id FROM inspirations WHERE id=${f.id}`).toHaveLength(1);expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);
  const [revision]=await t.sql`SELECT personal_revision::text AS value FROM inspiration_revisions WHERE inspiration_id=${f.id}`;
  expect((await remove(f,{sourceRevision:revision.value})).status).toBe(200);expect(await t.sql`SELECT id FROM inspirations WHERE id=${f.id}`).toHaveLength(0);
});
it('cascades only the confirmed inspiration, its media/reflections and review item',async()=>{
  const f=await fixture(),other=await fixture();
  await t.sql`INSERT INTO reflections(profile_id,inspiration_id,question,answer) VALUES (${f.profileId},${f.id},'Why?','My answer')`;
  await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url) VALUES (${f.profileId},${f.id},'link','https://example.test/inspiration')`;
  const session=await createReviewSession(t.db as never,f.profileId,{id:randomUUID()});
  expect(session!.items).toHaveLength(1);
  const response=await remove(f,{sourceRevision:session!.items[0]!.currentRevision});expect(response.status).toBe(200);
  expect(await t.sql`SELECT id FROM reflections WHERE inspiration_id=${f.id}`).toHaveLength(0);
  expect(await t.sql`SELECT id FROM attachments WHERE inspiration_id=${f.id}`).toHaveLength(0);
  expect(await t.sql`SELECT inspiration_id FROM review_items WHERE session_id=${session!.id}`).toHaveLength(0);
  expect(await t.sql`SELECT id FROM inspirations WHERE id=${other.id}`).toHaveLength(1);
});
it('rejects a foreign profile/source and malformed deletion fences without deleting',async()=>{
  const f=await fixture(),other=await fixture();
  expect((await remove(f,{sourceRevision:'1'},other.id,other.profileId)).status).toBe(404);
  expect((await remove(f,{sourceRevision:'1'},other.id)).status).toBe(404);
  for(const body of [{sourceRevision:'0'},{sourceRevision:'wrong'},{sourceRevision:'1',force:true},null])expect((await remove(f,body)).status).toBe(400);
  const malformed=await f.app.request(`/api/inspirations/${f.id}`,{method:'DELETE',headers:{'content-type':'application/json'},body:'{'});expect(malformed.status).toBe(400);
  expect(await t.sql`SELECT id FROM inspirations`).toHaveLength(2);
});
it('keeps the existing unversioned delete contract compatible',async()=>{
  const f=await fixture();expect((await remove(f)).status).toBe(200);expect((await remove(f)).status).toBe(404);
});
