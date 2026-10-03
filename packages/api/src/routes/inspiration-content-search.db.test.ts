/** WHAT THIS MOCKS, AND WHY (gate G6): `authMiddleware` supplies a fixture
 * principal. The archive query, effective transcript and ownership run on
 * disposable Postgres; no model or search service is substituted. */
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { afterAll,beforeEach,expect,it } from 'vitest';
import { createTestDatabase,type TestDatabase } from '../../test/helpers/index.js';
import { createInspirationsRoutes } from './inspirations.js';
import type { AuthEnv } from '../lib/middleware.js';
let t:TestDatabase,sequence=0;
beforeEach(async()=>{t??=await createTestDatabase();await t.truncateAll();});
afterAll(async()=>{await t?.cleanup();});
async function fixture(){
  const [account]=await t.sql`INSERT INTO accounts(email) VALUES (${`content-search-${++sequence}@example.test`}) RETURNING id`;
  const [profile]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${account.id},'human','Reader') RETURNING id`;
  const [source]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES (${profile.id},'') RETURNING id`;
  const app=new Hono<AuthEnv>();app.route('/api/inspirations',createInspirationsRoutes({getDatabase:()=>t.db as never,
    authMiddleware:async(c,next)=>{c.set('session',{sessionId:randomUUID(),account:{id:account.id,email:'reader@example.test'},
      profile:{id:profile.id,accountId:account.id,type:'human',name:'Reader',preferredLocale:'en-US'}});await next();}}));
  return {profileId:profile.id as string,sourceId:source.id as string,
    search:async(q:string)=>{const response=await app.request(`/api/inspirations?q=${encodeURIComponent(q)}`);expect(response.status).toBe(200);return response.json() as Promise<{inspirations:Array<{id:string}>,total:number}>;}};
}
it('finds effective corrected speech and answers without duplicating the source or revealing another owner',async()=>{
  const own=await fixture(),other=await fixture();
  for(const f of [own,other]){
    await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,enrichment_status,enrichment_kind,enrichment_text,transcript_correction)
      VALUES (${f.profileId},${f.sourceId},'audio','https://storage.test/private-key','failed','audio_transcription','Superseded machine text','조용한 주말 garden')`;
    await t.sql`INSERT INTO reflections(profile_id,inspiration_id,question,answer) VALUES (${f.profileId},${f.sourceId},'Why?','garden reflection')`;
  }
  const found=await own.search('garden');expect(found.inspirations.map(row=>row.id)).toEqual([own.sourceId]);expect(found.total).toBe(1);
  expect((await own.search('조용한')).inspirations).toHaveLength(1);
  expect((await own.search('Superseded')).inspirations).toHaveLength(0);
  expect((await own.search('private-key')).inspirations).toHaveLength(0);
});
it('searches ready source passages and original link URLs but excludes pending text and skipped answers',async()=>{
  const f=await fixture();
  await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,enrichment_status,enrichment_kind,enrichment_text)
    VALUES (${f.profileId},${f.sourceId},'link','https://example.test/garden-page','ready','page_body','A readable garden passage'),
      (${f.profileId},${f.sourceId},'image','https://storage.test/private','pending','image_description','UNREADY_SENTINEL')`;
  await t.sql`INSERT INTO reflections(profile_id,inspiration_id,question,answer,skipped) VALUES (${f.profileId},${f.sourceId},'Why?','SKIPPED_SENTINEL',true)`;
  expect((await f.search('readable garden')).inspirations).toHaveLength(1);
  expect((await f.search('garden-page')).inspirations).toHaveLength(1);
  expect((await f.search('UNREADY_SENTINEL')).inspirations).toHaveLength(0);
  expect((await f.search('SKIPPED_SENTINEL')).inspirations).toHaveLength(0);
});
it('treats wildcard characters literally and withdraws matches after correction/removal',async()=>{
  const f=await fixture();
  const [row]=await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,enrichment_status,enrichment_kind,enrichment_text)
    VALUES (${f.profileId},${f.sourceId},'audio','https://storage.test/audio','ready','audio_transcription','literal%_! phrase') RETURNING id`;
  expect((await f.search('literal%_!')).inspirations).toHaveLength(1);
  await t.sql`UPDATE attachments SET transcript_correction='' WHERE id=${row.id}`;
  expect((await f.search('literal%_!')).inspirations).toHaveLength(0);
  await t.sql`INSERT INTO reflections(profile_id,inspiration_id,question,answer) VALUES (${f.profileId},${f.sourceId},'Why?','only in reflection')`;
  expect((await f.search('only in reflection')).inspirations).toHaveLength(1);
  await t.sql`DELETE FROM reflections WHERE inspiration_id=${f.sourceId}`;
  expect((await f.search('only in reflection')).inspirations).toHaveLength(0);
});
