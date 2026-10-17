/** P0, 2026-10-17 — an edited long save keeps all of its words.
 *
 * The archive list sends `textPreview` (220 characters, "…") and attachment
 * labels; the web editor once PATCHed that preview back as the whole text and
 * truncated the save. The web fix seeds the editor from GET /:id. This pins the
 * wire contract that fix depends on, on real Postgres: the list read is a cut
 * and says so, the detail read is the whole text with no attachment label in
 * it, and open (detail) → edit → PATCH → read keeps all 1,000 characters.
 * Only the auth principal is a fixture. */
import {Hono} from 'hono';
import {randomUUID} from 'node:crypto';
import {afterAll,beforeEach,expect,it} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {createInspirationsRoutes} from './inspirations.js';
import type {AuthEnv} from '../lib/middleware.js';
let t:TestDatabase,sequence=0;
beforeEach(async()=>{t??=await createTestDatabase();await t.truncateAll();});
afterAll(async()=>{await t?.cleanup();});
async function fixture(){
  const [account]=await t.sql`INSERT INTO accounts(email) VALUES (${`full-text-${++sequence}@example.test`}) RETURNING id`;
  const [profile]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${account.id},'human','Writer') RETURNING id`;
  const app=new Hono<AuthEnv>();app.route('/api/inspirations',createInspirationsRoutes({getDatabase:()=>t.db as never,
    authMiddleware:async(c,next)=>{c.set('session',{sessionId:randomUUID(),account:{id:account.id,email:'writer@example.test'},
      profile:{id:profile.id,accountId:account.id,type:'human',name:'Writer',preferredLocale:'en-US'}});await next();}}));
  return {profileId:profile.id as string,app};
}
const LONG=Array.from({length:60},(_,i)=>`sentence ${i} keeps going.`).join(' ').slice(0,1000);
type Detail={inspiration:{text:string}};
type List={inspirations:Array<{id:string;textPreview:string;attachmentSummary:Array<{label:string}>}>};

it('keeps the full 1,000 characters through open → edit → save, and the list stays a labelled cut',async()=>{
  expect(LONG).toHaveLength(1000);
  const f=await fixture();
  const [row]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES (${f.profileId},${LONG}) RETURNING id`;
  const id=row.id as string;
  await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,name) VALUES (${f.profileId},${id},'link','https://example.test/essay','An essay about light')`;

  const list=await (await f.app.request('/api/inspirations')).json() as List;
  const summary=list.inspirations.find(item=>item.id===id)!;
  expect(summary.textPreview.length).toBeLessThanOrEqual(220);
  expect(summary.textPreview.endsWith('…')).toBe(true);
  expect(summary.attachmentSummary.map(item=>item.label)).toEqual(['An essay about light']);

  /* The open: what the editor is seeded from. */
  const opened=await (await f.app.request(`/api/inspirations/${id}`)).json() as Detail;
  expect(opened.inspiration.text).toBe(LONG);
  expect(opened.inspiration.text).not.toContain('An essay about light');

  const edited=`${opened.inspiration.text} One more line.`;
  const patched=await f.app.request(`/api/inspirations/${id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({text:edited})});
  expect(patched.status).toBe(200);
  const after=await (await f.app.request(`/api/inspirations/${id}`)).json() as Detail;
  expect(after.inspiration.text).toBe(edited);
  expect(after.inspiration.text).toHaveLength(1015);
  const [stored]=await t.sql`SELECT text FROM inspirations WHERE id=${id}`;
  expect(stored.text).toBe(edited);
});

it('opens a photo-only save with empty words, never its attachment label',async()=>{
  const f=await fixture();
  const [row]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES (${f.profileId},'') RETURNING id`;
  await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,name) VALUES (${f.profileId},${row.id},'image','https://example.test/p.jpg','IMG_0001.jpg')`;
  const opened=await (await f.app.request(`/api/inspirations/${row.id}`)).json() as Detail;
  expect(opened.inspiration.text).toBe('');
});
