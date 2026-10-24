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
it('keeps recoverable copies for owned agents and captures with no words', async () => {
  const f = await fixture();
  const [agent] = await t.sql`INSERT INTO profiles(account_id,type,name) SELECT account_id,'agent','Agent' FROM profiles WHERE id=${f.profileId} RETURNING id`;
  const [theirs] = await t.sql`INSERT INTO inspirations(profile_id,text) VALUES (${agent.id},'The agent kept this') RETURNING id`;
  expect((await f.app.request(`/api/inspirations/${theirs.id}?profile=${agent.id}`, { method: 'DELETE' })).status).toBe(200);
  const [blank] = await t.sql`INSERT INTO inspirations(profile_id,text) VALUES (${f.profileId},'') RETURNING id`;
  expect((await f.app.request(`/api/inspirations/${blank.id}`, { method: 'DELETE' })).status).toBe(200);
  expect(await t.sql`SELECT id FROM deleted_inspirations`).toHaveLength(2);
  expect((await f.app.request(`/api/inspirations/deleted/${theirs.id}/restore`, { method: 'POST' })).status).toBe(404);
  expect((await f.app.request(`/api/inspirations/deleted/${theirs.id}/restore?profile=${agent.id}`, { method: 'POST' })).status).toBe(200);
  expect((await t.sql`SELECT profile_id FROM inspirations WHERE id=${theirs.id}`)[0].profile_id).toBe(agent.id);
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

/* Found in review (2026-10-15), second pass: what a restore loses, said;
   the revision fence; and a month that passes for people who never return. */
it('restores a link with its original kind', async () => {
  const f = await fixture();
  await t.sql`UPDATE inspirations SET kind='link' WHERE id=${f.id}`;
  await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url) VALUES (${f.profileId},${f.id},'link','https://example.test/a')`;
  await f.app.request(`/api/inspirations/${f.id}`, { method: 'DELETE' });
  const restored = await f.app.request(`/api/inspirations/deleted/${f.id}/restore`, { method: 'POST' });
  expect(await restored.json()).toEqual({ id: f.id, notRestored: [] });
  const [back] = await t.sql`SELECT kind FROM inspirations WHERE id=${f.id}`;
  expect(back!.kind).toBe('link');
  expect(await t.sql`SELECT url FROM attachments WHERE inspiration_id=${f.id}`).toEqual([{ url: 'https://example.test/a' }]);
});
it('restores past every revision the deleted row ever had', async () => {
  const f = await fixture();
  await t.sql`UPDATE inspirations SET text='Small first moves, edited' WHERE id=${f.id}`;
  const [before] = await t.sql`SELECT personal_revision::text AS r FROM inspiration_revisions WHERE inspiration_id=${f.id}`;
  expect(BigInt(before!.r)).toBeGreaterThan(1n);
  await f.app.request(`/api/inspirations/${f.id}`, { method: 'DELETE' });
  await f.app.request(`/api/inspirations/deleted/${f.id}/restore`, { method: 'POST' });
  const [after] = await t.sql`SELECT personal_revision::text AS p, public_revision::text AS q FROM inspiration_revisions WHERE inspiration_id=${f.id}`;
  expect(BigInt(after!.p)).toBeGreaterThan(BigInt(before!.r));
  expect(BigInt(after!.q)).toBeGreaterThan(BigInt(before!.r));
});
it('sweeps everyone\'s expired copies in the daily run, and leaves them out of the export before that', async () => {
  const { sweepDeletedShelf } = await import('../lib/deleted-shelf.js');
  const f = await fixture(), other = await fixture();
  await f.app.request(`/api/inspirations/${f.id}`, { method: 'DELETE' });
  await other.app.request(`/api/inspirations/${other.id}`, { method: 'DELETE' });
  await t.sql`UPDATE deleted_inspirations SET deleted_at=now()-interval '31 days' WHERE profile_id=${f.profileId}`;
  expect((await assembleProfileExport(t.db as never, f.profileId)).deletedInspirations).toEqual([]);
  expect(await sweepDeletedShelf(t.db as never, new Date())).toBe(1);
  expect((await t.sql`SELECT profile_id FROM deleted_inspirations`).map((row) => row.profile_id)).toEqual([other.profileId]);
});
it('gives a restored save back to the harvest candidate it was kept from', async () => {
  const f = await fixture();
  const [candidate] = await t.sql`INSERT INTO harvest_candidates(profile_id,status,source_hash,inspiration_id,context)
    VALUES (${f.profileId},'kept','h',${f.id},${JSON.stringify({ keptAs: f.id })}::jsonb) RETURNING id`;
  await f.app.request(`/api/inspirations/${f.id}`, { method: 'DELETE' });
  expect((await t.sql`SELECT inspiration_id FROM harvest_candidates WHERE id=${candidate!.id}`)[0]!.inspiration_id).toBeNull();
  await f.app.request(`/api/inspirations/deleted/${f.id}/restore`, { method: 'POST' });
  expect((await t.sql`SELECT inspiration_id, source_hash FROM harvest_candidates WHERE id=${candidate!.id}`)[0]).toEqual({ inspiration_id: f.id, source_hash: 'h' });
});

it('restores media-only captures with stable attachment ids and corrected transcripts, without exposing them to another profile',async()=>{
  const f=await fixture(),other=await fixture();
  await t.sql`UPDATE inspirations SET text='',kind='mixed' WHERE id=${f.id}`;
  const [audio]=await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,s3_key,content_type,size,enrichment_status,enrichment_text,transcript_correction,transcript_revision,transcript_corrected_at)
    VALUES (${f.profileId},${f.id},'audio','https://example.test/audio','recovery/audio','audio/mp4',10,'ready','Machine words','My corrected words',2,'2026-10-01T00:00:00Z') RETURNING id`;
  await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,s3_key,content_type,size,name)
    VALUES (${f.profileId},${f.id},'image','https://example.test/photo','recovery/photo','image/jpeg',20,'Photo.jpg'),
    (${f.profileId},${f.id},'file','https://example.test/file','recovery/file','application/pdf',30,'Notes.pdf')`;
  await f.app.request(`/api/inspirations/${f.id}`,{method:'DELETE'});
  expect(await t.sql`SELECT id FROM attachments WHERE inspiration_id=${f.id}`).toHaveLength(0);
  const {unreferencedAttachmentKeys}=await import('../lib/conversation-attachments.js');
  expect(await unreferencedAttachmentKeys(t.db as never,['recovery/audio','recovery/photo','recovery/file'])).toEqual([]);
  const {assertAttachmentKeysUnused}=await import('../lib/inspiration-attachments.js');
  await expect(t.db.transaction(tx=>assertAttachmentKeysUnused(tx as never,['recovery/audio']))).rejects.toThrow('already attached');
  expect((await other.app.request(`/api/inspirations/deleted?profile=${f.profileId}`)).status).toBe(404);
  expect((await other.app.request(`/api/inspirations/deleted/${f.id}/restore?profile=${f.profileId}`,{method:'POST'})).status).toBe(404);
  const list=await (await f.app.request('/api/inspirations/deleted')).json() as {deleted:Array<{attachmentCount:number}>};
  expect(list.deleted[0]?.attachmentCount).toBe(3);
  expect((await f.app.request(`/api/inspirations/deleted/${f.id}/restore`,{method:'POST'})).status).toBe(200);
  const [restored]=await t.sql`SELECT profile_id,inspiration_id,transcript_correction,transcript_revision,transcript_corrected_at,s3_key FROM attachments WHERE id=${audio.id}`;
  expect(restored).toMatchObject({profile_id:f.profileId,inspiration_id:f.id,transcript_correction:'My corrected words',transcript_revision:2,s3_key:'recovery/audio'});
  expect(new Date(restored.transcript_corrected_at).toISOString()).toBe('2026-10-01T00:00:00.000Z');
  expect(await t.sql`SELECT id FROM attachments WHERE inspiration_id=${f.id}`).toHaveLength(3);
});
it('reports attachment loss honestly for old copies made before media retention',async()=>{
  const f=await fixture(); await f.app.request(`/api/inspirations/${f.id}`,{method:'DELETE'});
  await t.sql`UPDATE deleted_inspirations SET had_photo=true,kind='image' WHERE id=${f.id}`;
  const response=await f.app.request(`/api/inspirations/deleted/${f.id}/restore`,{method:'POST'});
  expect(await response.json()).toEqual({id:f.id,notRestored:['attachments']});
  expect((await t.sql`SELECT kind FROM inspirations WHERE id=${f.id}`)[0].kind).toBe('note');
});
it('expiry sweeps retained media only when no other live attachment still uses it',async()=>{
  const f=await fixture();
  await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,s3_key) VALUES (${f.profileId},${f.id},'image','https://example.test/a','recovery/expired'),(${f.profileId},${f.id},'image','https://example.test/b','recovery/shared')`;
  await f.app.request(`/api/inspirations/${f.id}`,{method:'DELETE'});
  const [live]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES (${f.profileId},'Legacy shared media') RETURNING id`;
  await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,s3_key) VALUES (${f.profileId},${live.id},'image','https://example.test/b','recovery/shared')`;
  await t.sql`UPDATE deleted_inspirations SET deleted_at=now()-interval '31 days' WHERE id=${f.id}`;
  const {sweepDeletedShelf}=await import('../lib/deleted-shelf.js');
  const sweep=vi.fn().mockResolvedValue(undefined);
  expect(await sweepDeletedShelf(t.db as never,new Date(),f.profileId,sweep)).toBe(1);
  expect(sweep).toHaveBeenCalledExactlyOnceWith(['recovery/expired']);
});


it('resumes enrichment that was pending when an inspiration was deleted',async()=>{
  const f=await fixture();
  const [attachment]=await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,enrichment_status) VALUES (${f.profileId},${f.id},'link','https://example.test/pending','pending') RETURNING id`;
  await f.app.request(`/api/inspirations/${f.id}`,{method:'DELETE'});
  await f.app.request(`/api/inspirations/deleted/${f.id}/restore`,{method:'POST'});
  const jobs=await t.sql`SELECT payload FROM background_jobs WHERE type='enrich_attachment' AND profile_id=${f.profileId}`;
  expect(jobs).toHaveLength(1);
  expect(jobs[0].payload).toMatchObject({attachmentId:attachment.id,inspirationId:f.id});
});
