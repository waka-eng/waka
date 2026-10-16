/** The deleted shelf on real SQL: delete writes the copy, restore brings the
 * same id back with its original date and answers, the shelf is the person's
 * own, and it lapses after thirty days. */
import {Hono} from 'hono';
import {afterAll,beforeEach,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {createInspirationsRoutes} from './inspirations.js';
import {assembleProfileExport} from '../lib/profile-export.js';
import type {AuthEnv} from '../lib/middleware.js';
const state=vi.hoisted(()=>({db:null as unknown}));
vi.mock('../lib/db.js',()=>({getDb:()=>state.db}));
let t:TestDatabase,sequence=0;
beforeEach(async()=>{t??=await createTestDatabase();await t.truncateAll();state.db=t.db;});
afterAll(async()=>{await t?.cleanup();});
async function fixture(options:{keyScoped?:boolean}={}){
  const [account]=await t.sql`INSERT INTO accounts(email) VALUES (${`shelf-${++sequence}@example.test`}) RETURNING id`;
  const [profile]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${account.id},'human','Keeper') RETURNING id`;
  const [source]=await t.sql`INSERT INTO inspirations(profile_id,text,kind,created_at) VALUES (${profile.id},'Small first moves','note','2026-03-01T10:00:00Z') RETURNING id`;
  await t.sql`INSERT INTO reflections(profile_id,inspiration_id,question,answer) VALUES (${profile.id},${source.id},'Why?','Because starting is the hard part')`;
  const app=new Hono<AuthEnv>();app.route('/api/inspirations',createInspirationsRoutes({getDatabase:()=>t.db as never,authMiddleware:async(c,next)=>{
    c.set('session',{sessionId:randomUUID(),...(options.keyScoped?{keyScoped:true}:{}),account:{id:account.id,email:'k@example.test'},profile:{id:profile.id,accountId:account.id,type:'human',name:'Keeper',preferredLocale:'en-US'}} as never);await next();
  }}));return {app,profileId:profile.id as string,id:source.id as string};
}
it('puts a deleted inspiration on the shelf and brings it back whole, under the same id and date',async()=>{
  const f=await fixture();
  expect((await f.app.request(`/api/inspirations/${f.id}`,{method:'DELETE'})).status).toBe(200);
  expect(await t.sql`SELECT id FROM inspirations WHERE id=${f.id}`).toHaveLength(0);
  const shelf=await (await f.app.request('/api/inspirations/deleted')).json() as {deleted:Array<{id:string;text:string;keptAt:string;hadPhoto:boolean}>};
  expect(shelf.deleted).toHaveLength(1);
  expect(shelf.deleted[0]).toMatchObject({id:f.id,text:'Small first moves',hadPhoto:false,keptAt:'2026-03-01T10:00:00.000Z'});
  expect((await f.app.request(`/api/inspirations/deleted/${f.id}/restore`,{method:'POST'})).status).toBe(200);
  const [back]=await t.sql`SELECT text,kind,created_at FROM inspirations WHERE id=${f.id}`;
  expect(back).toMatchObject({text:'Small first moves',kind:'note'});
  expect(new Date(back.created_at).toISOString()).toBe('2026-03-01T10:00:00.000Z');
  expect(await t.sql`SELECT answer FROM reflections WHERE inspiration_id=${f.id}`).toEqual([{answer:'Because starting is the hard part'}]);
  expect(await t.sql`SELECT id FROM deleted_inspirations`).toHaveLength(0);
  expect(await t.sql`SELECT id FROM background_jobs WHERE type='derive_signals'`).toHaveLength(1);
  /* a second press finds it already back */
  expect((await f.app.request(`/api/inspirations/deleted/${f.id}/restore`,{method:'POST'})).status).toBe(200);
});
it('keeps each shelf to its own person and lets a copy go for good',async()=>{
  const f=await fixture(),other=await fixture();
  await f.app.request(`/api/inspirations/${f.id}`,{method:'DELETE'});
  expect(((await (await other.app.request('/api/inspirations/deleted')).json()) as {deleted:unknown[]}).deleted).toHaveLength(0);
  expect((await other.app.request(`/api/inspirations/deleted/${f.id}/restore`,{method:'POST'})).status).toBe(404);
  expect((await other.app.request(`/api/inspirations/deleted/${f.id}`,{method:'DELETE'})).status).toBe(404);
  expect((await f.app.request(`/api/inspirations/deleted/${f.id}`,{method:'DELETE'})).status).toBe(200);
  expect(await t.sql`SELECT id FROM deleted_inspirations`).toHaveLength(0);
});
it('lapses copies older than thirty days when the shelf is read',async()=>{
  const f=await fixture();
  await f.app.request(`/api/inspirations/${f.id}`,{method:'DELETE'});
  await t.sql`UPDATE deleted_inspirations SET deleted_at=now()-interval '31 days'`;
  expect(((await (await f.app.request('/api/inspirations/deleted')).json()) as {deleted:unknown[]}).deleted).toHaveLength(0);
  expect(await t.sql`SELECT id FROM deleted_inspirations`).toHaveLength(0);
});
it('refuses the keeper key: the shelf is a browser act',async()=>{
  const f=await fixture({keyScoped:true});
  expect((await f.app.request('/api/inspirations/deleted')).status).toBe(403);
  expect((await f.app.request(`/api/inspirations/deleted/${f.id}/restore`,{method:'POST'})).status).toBe(403);
});

/* Found in review (2026-10-15): a copy filed where nobody can reach it, and a
   month that only passed when somebody looked. */
it('files no copy for a delete that is not the person\'s own, nor for a save with no words', async () => {
  const f = await fixture();
  const [agent] = await t.sql`INSERT INTO profiles(account_id,type,name) SELECT account_id,'agent','Agent' FROM profiles WHERE id=${f.profileId} RETURNING id`;
  const [theirs] = await t.sql`INSERT INTO inspirations(profile_id,text) VALUES (${agent.id},'The agent kept this') RETURNING id`;
  expect((await f.app.request(`/api/inspirations/${theirs.id}?profile=${agent.id}`, { method: 'DELETE' })).status).toBe(200);
  const [blank] = await t.sql`INSERT INTO inspirations(profile_id,text) VALUES (${f.profileId},'') RETURNING id`;
  expect((await f.app.request(`/api/inspirations/${blank.id}`, { method: 'DELETE' })).status).toBe(200);
  expect(await t.sql`SELECT id FROM deleted_inspirations`).toHaveLength(0);
});
it('cannot bring back a copy past its month even if the shelf was never opened, and sweeps it on the next delete', async () => {
  const f = await fixture();
  await f.app.request(`/api/inspirations/${f.id}`, { method: 'DELETE' });
  await t.sql`UPDATE deleted_inspirations SET deleted_at=now()-interval '31 days'`;
  expect((await f.app.request(`/api/inspirations/deleted/${f.id}/restore`, { method: 'POST' })).status).toBe(404);
  const [another] = await t.sql`INSERT INTO inspirations(profile_id,text) VALUES (${f.profileId},'Another') RETURNING id`;
  await f.app.request(`/api/inspirations/${another.id}`, { method: 'DELETE' });
  expect((await t.sql`SELECT id FROM deleted_inspirations`).map((row) => row.id)).toEqual([another.id]);
});

it('puts what is on the shelf in the person\'s export', async () => {
  const f = await fixture();
  await f.app.request(`/api/inspirations/${f.id}`, { method: 'DELETE' });
  const exported = await assembleProfileExport(t.db as never, f.profileId);
  expect(exported.deletedInspirations.map((row) => row.text)).toEqual(['Small first moves']);
});
