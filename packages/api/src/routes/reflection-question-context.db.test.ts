/** WHAT THIS MOCKS, AND WHY (gate G6): `authMiddleware` sets a fixture owner,
 * and `enqueueQuestion` records explicit model-work requests. Context hashing,
 * route authorization, cached results and redaction use real disposable SQL. */
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import { registerReflectionRoutes } from './inspirations-reflections.js';
import { loadReflectionQuestionContext } from '../lib/reflection-question-context.js';
import { reflectionQuestionJobKey } from '../lib/queue.js';
import type { AuthEnv } from '../lib/middleware.js';

let t: TestDatabase, sequence = 0;
const enqueueQuestion = vi.fn(async () => ({jobId:randomUUID(),created:true,requestVersion:'1'}));
beforeEach(async () => {t ??= await createTestDatabase(); await t.truncateAll(); enqueueQuestion.mockClear();});
afterAll(async () => {await t?.cleanup();});
async function fixture() {
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES (${`reflection-cache-${++sequence}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${account.id},'human','Reader') RETURNING id`;
  const [source] = await t.sql`INSERT INTO inspirations(profile_id,text) VALUES (${profile.id},'A raw note') RETURNING id`;
  const [answer] = await t.sql`INSERT INTO reflections(profile_id,inspiration_id,question,answer)
    VALUES (${profile.id},${source.id},'Why keep this?','I want more room to explore') RETURNING id`;
  const context = await loadReflectionQuestionContext(t.db as never,profile.id,source.id);
  const [job] = await t.sql`INSERT INTO background_jobs(profile_id,type,status,idempotency_key,payload)
    VALUES (${profile.id},'generate_reflection_question','succeeded',${reflectionQuestionJobKey(profile.id,source.id,answer.id)},
    ${JSON.stringify({inspirationId:source.id,afterReflectionId:answer.id,question:'Which possibility would you explore first?',contextHash:context!.hash})}::jsonb) RETURNING id`;
  const routes = new Hono<AuthEnv>();
  routes.use('*',async(c,next)=>{c.set('session',{sessionId:randomUUID(),account:{id:account.id,email:'fixture@example.test'},
    profile:{id:profile.id,accountId:account.id,type:'human',name:'Reader',preferredLocale:'en-US'}});await next();});
  registerReflectionRoutes(routes,()=>t.db as never,enqueueQuestion);
  const base=`/${source.id}/reflection-question`;
  return {routes,profileId:profile.id as string,sourceId:source.id as string,answerId:answer.id as string,jobId:job.id as string,
    get:()=>routes.request(`${base}/status?afterReflectionId=${answer.id}`),
    post:()=>routes.request(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({afterReflectionId:answer.id})})};
}
it('reuses only a question tied to current context and never generates on a read',async()=>{
  const f=await fixture(); const response=await f.get();
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(await response.json()).toMatchObject({phase:'ready',question:'Which possibility would you explore first?'});
  expect(await (await f.post()).json()).toMatchObject({phase:'ready'}); expect(enqueueQuestion).not.toHaveBeenCalled();
});
it('treats an unverified legacy question as idle and regenerates only on explicit request',async()=>{
  const f=await fixture(); await t.sql`UPDATE background_jobs SET payload=payload-'contextHash' WHERE id=${f.jobId}`;
  expect(await (await f.get()).json()).toEqual({phase:'idle'}); expect(enqueueQuestion).not.toHaveBeenCalled();
  expect(await (await f.post()).json()).toEqual({phase:'processing'}); expect(enqueueQuestion).toHaveBeenCalledWith(f.profileId,f.sourceId,f.answerId);
});
it('adding a photo withdraws the cached question instead of silently serving the old read',async()=>{
  const f=await fixture(); await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,enrichment_status)
    VALUES (${f.profileId},${f.sourceId},'image','https://example.test/photo','pending')`;
  expect(await (await f.get()).json()).toEqual({phase:'idle'});
  expect(await t.sql`SELECT id FROM background_jobs WHERE id=${f.jobId}`).toHaveLength(0);
});
it('refuses another account and a deleted source without exposing the question',async()=>{
  const f=await fixture(),other=await fixture();
  expect((await other.routes.request(`/${f.sourceId}/reflection-question/status?afterReflectionId=${f.answerId}`)).status).toBe(404);
  await t.sql`DELETE FROM inspirations WHERE id=${f.sourceId}`;
  expect((await f.get()).status).toBe(404); expect(enqueueQuestion).not.toHaveBeenCalled();
});
