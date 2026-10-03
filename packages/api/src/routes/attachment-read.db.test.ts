/** WHAT THIS MOCKS, AND WHY (gate G6): `authMiddleware` supplies fixture
 * principals and `getS3` uses local dummy credentials. Routes, disposable SQL
 * and presigning run unchanged, without network/object reads. */
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import { createAttachmentRoutes } from './attachments.js';
import type { AuthEnv } from '../lib/middleware.js';
let t: TestDatabase, sequence = 0;
beforeEach(async () => { t ??= await createTestDatabase(); await t.truncateAll();
  vi.stubEnv('ATTACHMENTS_BUCKET','read-fixture'); vi.stubEnv('ATTACHMENTS_ENDPOINT','http://127.0.0.1:8792'); });
afterAll(async () => { vi.unstubAllEnvs(); await t?.cleanup(); });
async function person() {
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES (${`attachment-read-${++sequence}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${account.id},'human','Reader') RETURNING id`;
  const app = new Hono<AuthEnv>(); app.route('/api/attachments',createAttachmentRoutes({getDatabase:()=>t.db as never,
    authMiddleware:async(c,next)=>{c.set('session',{sessionId:randomUUID(),account:{id:account.id,email:'reader@example.test'},
      profile:{id:profile.id,accountId:account.id,type:'human',name:'Reader',preferredLocale:'en-US'}});await next();}}));
  return {app,id:profile.id as string};
}
async function audio(profileId:string) {
  const [source]=await t.sql`INSERT INTO inspirations(profile_id,text,visibility) VALUES (${profileId},'','public') RETURNING id`;
  const key=`profiles/${profileId}/attachments/1-audio.webm`;
  const [file]=await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,s3_key,content_type,size)
    VALUES (${profileId},${source.id},'audio','https://example.invalid/private.webm',${key},'audio/webm',100) RETURNING id`;
  return {id:file.id as string,sourceId:source.id as string,key};
}
it('signs the current owner file and makes the read non-cacheable',async()=>{
  const owner=await person(),file=await audio(owner.id);
  const response=await owner.app.request(`/api/attachments/${file.id}/url`); expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  const result=await response.json() as {attachmentId:string;url:string;expiresAt:string};
  expect(result.attachmentId).toBe(file.id);
  expect(new URL(result.url).pathname).toBe(`/read-fixture/${file.key}`);
  expect(new URL(result.url).searchParams.get('X-Amz-Expires')).toBe('300');
  expect(Date.parse(result.expiresAt)).toBeGreaterThan(Date.now());
});
it('a public inspiration does not give a different account access to raw audio',async()=>{
  const owner=await person(),other=await person(),file=await audio(owner.id);
  expect((await other.app.request(`/api/attachments/${file.id}/url`)).status).toBe(404);
});
it('deletion withdraws new read URLs and malformed identifiers fail before a lookup',async()=>{
  const owner=await person(),file=await audio(owner.id);
  await t.sql`DELETE FROM inspirations WHERE id=${file.sourceId}`;
  expect((await owner.app.request(`/api/attachments/${file.id}/url`)).status).toBe(404);
  expect((await owner.app.request('/api/attachments/not-an-id/url')).status).toBe(400);
});
it('a changed browser account cannot mint an upload for the previous account draft',async()=>{
  const first=await person(), second=await person();
  const body={filename:'Photo.png',contentType:'image/png',size:50};
  const post=(app: typeof first.app,profile:string)=>app.request(`/api/attachments/presign?profile=${profile}`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  expect((await post(second.app,first.id)).status).toBe(404);
  const response=await post(first.app,first.id); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({profileId:first.id});
});
