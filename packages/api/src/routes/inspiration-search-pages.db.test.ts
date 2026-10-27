/** WHAT THIS MOCKS, AND WHY: only the auth principal is a fixture. Actual
 * Postgres matching, totals, keyset cursors, revisions and tenancy run. */
import {Hono} from 'hono';
import {randomUUID} from 'node:crypto';
import {afterAll,beforeEach,expect,it} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {createInspirationsRoutes} from './inspirations.js';
import type {AuthEnv} from '../lib/middleware.js';
let t:TestDatabase,sequence=0;
beforeEach(async()=>{t??=await createTestDatabase();await t.truncateAll();});
afterAll(async()=>{await t?.cleanup();});
type Page={categories?:string[];inspirations:Array<{id:string;materialRevision?:string|null}>,total?:number;nextCursor?:string};
async function fixture(){
  const [account]=await t.sql`INSERT INTO accounts(email) VALUES (${`search-pages-${++sequence}@example.test`}) RETURNING id`;
  const [profile]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${account.id},'human','Reader') RETURNING id`;
  const app=new Hono<AuthEnv>();app.route('/api/inspirations',createInspirationsRoutes({getDatabase:()=>t.db as never,
    authMiddleware:async(c,next)=>{c.set('session',{sessionId:randomUUID(),account:{id:account.id,email:'reader@example.test'},
      profile:{id:profile.id,accountId:account.id,type:'human',name:'Reader',preferredLocale:'en-US'}});await next();}}));
  return {profileId:profile.id as string,app,search:async(q:string,extra='')=>{
    const response=await app.request(`/api/inspirations?q=${encodeURIComponent(q)}${extra}`);expect(response.status).toBe(200);return response.json() as Promise<Page>;
  }};
}
async function source(profileId:string,text:string,time='2026-10-01T12:00:00.000Z'){
  const [row]=await t.sql`INSERT INTO inspirations(profile_id,text,created_at) VALUES (${profileId},${text},${time}) RETURNING id`;
  return row.id as string;
}
const descending=(ids:string[])=>[...ids].sort((a,b)=>b.localeCompare(a));
it('finds full text beyond both the preview and the newest 2,000 captures, scoped by profile and category',async()=>{
  const own=await fixture(),foreign=await fixture();
  const text='An ordinary opening. '.repeat(30)+'hiddenneedle';
  const older=await source(own.profileId,text,'2020-01-01T00:00:00.000Z');
  const sameCategory=await source(own.profileId,'hiddenneedle');
  const otherCategory=await source(own.profileId,'hiddenneedle');
  await source(foreign.profileId,text);
  await t.sql`UPDATE inspirations SET category='Work' WHERE profile_id=${own.profileId} AND id IN (${older},${sameCategory})`;
  await t.sql`UPDATE inspirations SET category='Life' WHERE id=${otherCategory}`;
  await t.sql`INSERT INTO inspirations(profile_id,text,created_at) SELECT ${own.profileId},'A newer capture',now() FROM generate_series(1,2001)`;
  const first=await own.search('hiddenneedle','&category=Work&limit=1');
  expect(first.total).toBe(2); expect(first.inspirations.map(row=>row.id)).toEqual([sameCategory]);
  const next=await own.search('hiddenneedle','&category=Work&limit=1&cursor='+encodeURIComponent(first.nextCursor!));
  expect(next.inspirations.map(row=>row.id)).toEqual([older]);
  expect((await own.search('hiddenneedle','&category=Life')).inspirations.map(row=>row.id)).toEqual([otherCategory]);
  expect(await own.search('hiddenneedle','&category=Missing')).toMatchObject({total:0,inspirations:[]});
});
it('preserves full-text token order, Korean fragments and literal wildcards with exact totals',async()=>{
  const own=await fixture(),foreign=await fixture();
  const a=await source(own.profileId,'garden then walking'),b=await source(own.profileId,'walking garden');
  const korean=await source(own.profileId,'여백 생각 느긋한 하루'),literal=await source(own.profileId,'literal%_! anchor');
  await source(foreign.profileId,'garden walking 여백 생각 literal%_!');
  const words=await own.search('garden walking');expect(words.inspirations.map(row=>row.id)).toEqual(descending([a,b]));expect(words.total).toBe(2);
  for(const row of words.inspirations){expect(row).not.toHaveProperty('textSearchVector');expect(row).not.toHaveProperty('textSearchVectorPolicy');expect(row).not.toHaveProperty('cursorCreatedAt');expect(row).not.toHaveProperty('total');}
  const detail=await(await own.app.request(`/api/inspirations/${a}`)).json() as {inspiration:Record<string,unknown>};
  expect(detail.inspiration).not.toHaveProperty('textSearchVector');expect(detail.inspiration).not.toHaveProperty('textSearchVectorPolicy');
  for(const q of ['여백','백','생각 여백'])expect((await own.search(q)).inspirations.map(row=>row.id)).toEqual([korean]);
  for(const q of ['%','_','!'])expect((await own.search(q)).inspirations.map(row=>row.id)).toEqual([literal]);
  expect(await own.search('neverfoundzx')).toMatchObject({inspirations:[],total:0});
});
it('returns one original when several owned child passages match and follows edits/removal immediately',async()=>{
  const own=await fixture(),foreign=await fixture();
  const id=await source(own.profileId,''),other=await source(foreign.profileId,'');
  for(const [profileId,inspirationId] of [[own.profileId,id],[foreign.profileId,other]]){
    await t.sql`INSERT INTO reflections(profile_id,inspiration_id,question,answer) VALUES (${profileId},${inspirationId},'Why?','garden'),(${profileId},${inspirationId},'Again?','garden')`;
    await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,enrichment_status,enrichment_kind,enrichment_text)
      VALUES (${profileId},${inspirationId},'image','https://storage.test/private-object','ready','image_description','garden')`;
  }
  expect(await own.search('garden')).toMatchObject({inspirations:[{id}],total:1});
  await t.sql`UPDATE reflections SET answer='changed' WHERE profile_id=${own.profileId}`;
  await t.sql`UPDATE attachments SET enrichment_status='pending' WHERE profile_id=${own.profileId}`;
  expect(await own.search('garden')).toMatchObject({inspirations:[],total:0});
  await t.sql`UPDATE inspirations SET text='garden' WHERE id=${id}`;
  expect((await own.search('garden')).total).toBe(1);
  await t.sql`DELETE FROM inspirations WHERE profile_id=${own.profileId} AND id=${id}`;
  expect(await own.search('garden')).toMatchObject({inspirations:[],total:0});
  expect((await own.app.request(`/api/inspirations?q=garden&profile=${foreign.profileId}`)).status).toBe(404);
});
it('counts before the cursor, omits later totals and handles the empty final page',async()=>{
  const own=await fixture(),ids:string[]=[];
  for(let n=0;n<4;n++)ids.push(await source(own.profileId,'garden','2026-10-01T12:00:00.000Z'));
  const first=await own.search('garden','&limit=2');expect(first.total).toBe(4);expect(first.inspirations.map(row=>row.id)).toEqual(descending(ids).slice(0,2));
  const second=await own.search('garden','&limit=2&cursor='+encodeURIComponent(first.nextCursor!));expect(second.total).toBeUndefined();expect(second.inspirations.map(row=>row.id)).toEqual(descending(ids).slice(2));
  const tail=await own.search('garden','&limit=2&cursor='+encodeURIComponent(second.nextCursor!));expect(tail).toEqual({inspirations:[]});
});
it('keeps microsecond timestamp ties across both searched and unsearched cursors',async()=>{
  const own=await fixture(),ids:string[]=[];
  for(let n=0;n<3;n++)ids.push(await source(own.profileId,'garden','2026-10-01T12:00:00.123456Z'));
  for(const q of ['garden','']){
    const found:string[]=[];let cursor:string|undefined;
    do{const page=await own.search(q,'&limit=1'+(cursor?'&cursor='+encodeURIComponent(cursor):''));found.push(...page.inspirations.map(row=>row.id));cursor=page.nextCursor;}while(cursor);
    expect(found).toEqual(descending(ids));
  }
});
it('applies an owned named experience to matching and counting without requiring material lineage',async()=>{
  const own=await fixture(),foreign=await fixture();
  const [experience]=await t.sql`INSERT INTO experiences(profile_id,name) VALUES (${own.profileId},'A quiet day') RETURNING id`;
  await t.sql`INSERT INTO experiences(profile_id,name) VALUES (${foreign.profileId},'A quiet day')`;
  const id=await source(own.profileId,'garden'),outside=await source(own.profileId,'garden');
  await source(foreign.profileId,'garden');await t.sql`UPDATE inspirations SET experience_id=${experience.id} WHERE id=${id}`;
  await t.sql`DELETE FROM inspiration_revisions WHERE profile_id=${own.profileId} AND inspiration_id=${id}`;
  const page=await own.search('garden','&experience='+encodeURIComponent('A quiet day'));
  expect(page.total).toBe(1);expect(page.inspirations.map(row=>row.id)).toEqual([id]);expect(page.inspirations.map(row=>row.id)).not.toContain(outside);
  expect(await own.search('garden','&experience=missing')).toMatchObject({inspirations:[],total:0});
});

it('returns owned category choices beyond the first page only when requested',async()=>{
  const own=await fixture(),foreign=await fixture();
  const older=await source(own.profileId,'Old note','2020-01-01T00:00:00Z');
  const recent=await source(own.profileId,'Recent note');
  const other=await source(foreign.profileId,'Other profile');
  await t.sql`UPDATE inspirations SET category='Older category' WHERE id=${older}`;
  await t.sql`UPDATE inspirations SET category='Recent' WHERE id=${recent}`;
  await t.sql`UPDATE inspirations SET category='Private category' WHERE id=${other}`;
  const first=await own.search('','&limit=1&includeCategories=true');
  expect(first.inspirations.map(row=>row.id)).toEqual([recent]);
  expect(first.categories).toEqual(['Older category','Recent']);
  expect((await own.search('','&limit=1')).categories).toBeUndefined();
  expect((await own.app.request('/api/inspirations?includeCategories=false')).status).toBe(400);
});
