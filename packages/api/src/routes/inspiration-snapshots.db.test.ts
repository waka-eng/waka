/** Real SQL, hash, routing and ownership on disposable Postgres.
 * authMiddleware supplies a synthetic principal, not a bypassed query. */
import {Hono} from 'hono';
import {createHash,randomUUID} from 'node:crypto';
import {afterAll,beforeEach,expect,it} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {createInspirationsRoutes} from './inspirations.js';
import {readInspirationSnapshot} from '../lib/inspiration-snapshots.js';
import {listProfileSignals} from './signals.js';
import type {AuthEnv} from '../lib/middleware.js';
let t:TestDatabase,sequence=0;
beforeEach(async()=>{t??=await createTestDatabase();await t.truncateAll();});afterAll(async()=>{await t?.cleanup();});
async function fixture(){
  const [account]=await t.sql`INSERT INTO accounts(email) VALUES (${`snapshot-${++sequence}@example.test`}) RETURNING id`;
  const [profile]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${account.id},'human','Snapshot fixture') RETURNING id`;
  const [source]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES (${profile.id},'PRIVATE_SYNTHETIC_SOURCE') RETURNING id`;
  const app=new Hono<AuthEnv>();app.route('/api/inspirations',createInspirationsRoutes({getDatabase:()=>t.db as never,authMiddleware:async(c,next)=>{
    c.set('session',{sessionId:randomUUID(),account:{id:account.id,email:'snapshot@example.test'},profile:{id:profile.id,accountId:account.id,type:'human',name:'Snapshot fixture',preferredLocale:'en-US'}});await next();
  }}));return {app,id:profile.id as string,source:source.id as string};
}
it('returns only an owned fingerprint and matches the summary wire digest without model work',async()=>{
  const f=await fixture();const response=await f.app.request(`/api/inspirations/snapshot?profile=${f.id}`);expect(response.status).toBe(200);
  const snapshot=await response.json() as Awaited<ReturnType<typeof readInspirationSnapshot>>;expect(snapshot).toMatchObject({profileId:f.id,total:1,fingerprint:expect.stringMatching(/^[a-f0-9]{64}$/)});expect(Object.keys(snapshot).sort()).toEqual(['fingerprint','profileId','total']);expect(JSON.stringify(snapshot)).not.toContain('PRIVATE_SYNTHETIC_SOURCE');
  const body=await (await f.app.request('/api/inspirations?limit=200')).json() as {inspirations:Array<{materialRevision:string}>};
  expect(body.inspirations[0].materialRevision).toBe('1');
  expect(snapshot.fingerprint).toBe(createHash('sha256').update(JSON.stringify({policy:'inspiration-snapshot-v1',profileId:f.id,total:1,items:[[f.source,'1']]})).digest('hex'));
  expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);
});
it('detects uncited edits and reflections even when the generation fence does not change',async()=>{
  const f=await fixture(),before=await readInspirationSnapshot(t.db as never,f.id);
  const generation=await t.sql`SELECT revision::text FROM generation_revisions WHERE profile_id=${f.id}`;
  await t.sql`UPDATE inspirations SET text='Changed uncited source' WHERE id=${f.source}`;
  const edited=await readInspirationSnapshot(t.db as never,f.id);expect(edited.fingerprint).not.toBe(before.fingerprint);
  await t.sql`INSERT INTO reflections(profile_id,inspiration_id,question,answer) VALUES (${f.id},${f.source},'Why?','A new thought')`;
  expect((await readInspirationSnapshot(t.db as never,f.id)).fingerprint).not.toBe(edited.fingerprint);
  expect(await t.sql`SELECT revision::text FROM generation_revisions WHERE profile_id=${f.id}`).toEqual(generation);
});
it('detects effective media changes, visibility, captures and deletion without exposing other profiles',async()=>{
  const f=await fixture(),other=await fixture();let before=await readInspirationSnapshot(t.db as never,f.id);
  const [attachment]=await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,enrichment_status,enrichment_kind,enrichment_text) VALUES (${f.id},${f.source},'audio','https://example.test/clip','ready','audio_transcription','Original transcript') RETURNING id`;
  let after=await readInspirationSnapshot(t.db as never,f.id);expect(after.fingerprint).not.toBe(before.fingerprint);before=after;
  await t.sql`UPDATE attachments SET transcript_correction='Corrected transcript' WHERE id=${attachment.id}`;
  after=await readInspirationSnapshot(t.db as never,f.id);expect(after.fingerprint).not.toBe(before.fingerprint);before=after;
  await t.sql`UPDATE inspirations SET visibility='public' WHERE id=${f.source}`;
  after=await readInspirationSnapshot(t.db as never,f.id);expect(after.fingerprint).not.toBe(before.fingerprint);before=after;
  await t.sql`UPDATE inspirations SET text='Foreign edit' WHERE id=${other.source}`;
  expect(await readInspirationSnapshot(t.db as never,f.id)).toEqual(before);
  expect((await f.app.request(`/api/inspirations/snapshot?profile=${other.id}`)).status).toBe(404);
  await t.sql`DELETE FROM inspirations WHERE id=${f.source}`;
  expect(await readInspirationSnapshot(t.db as never,f.id)).toMatchObject({total:0,fingerprint:expect.any(String)});
});
it('bounds the newest identities but includes the exact total so an older removal invalidates reuse',async()=>{
  const f=await fixture();await t.sql`INSERT INTO inspirations(profile_id,text,created_at) SELECT ${f.id},'Synthetic bounded source',now()-i*interval '1 hour' FROM generate_series(1,2001) i`;
  const before=await readInspirationSnapshot(t.db as never,f.id);expect(before.total).toBe(2002);
  await t.sql`DELETE FROM inspirations WHERE id IN (SELECT id FROM inspirations WHERE profile_id=${f.id} ORDER BY created_at ASC LIMIT 1)`;
  const after=await readInspirationSnapshot(t.db as never,f.id);expect(after.total).toBe(2001);expect(after.fingerprint).not.toBe(before.fingerprint);
});
it('refuses reuse for missing material lineage without hiding the original from the archive',async()=>{
  const f=await fixture();await t.sql`DELETE FROM inspiration_revisions WHERE profile_id=${f.id} AND inspiration_id=${f.source}`;
  expect(await readInspirationSnapshot(t.db as never,f.id)).toMatchObject({total:1,fingerprint:null});
  const body=await (await f.app.request('/api/inspirations')).json() as {inspirations:Array<{id:string;materialRevision?:string}>};
  expect(body.inspirations[0].id).toBe(f.source);expect(body.inspirations[0]).not.toHaveProperty('materialRevision');
});
it('returns private origin identities only on opt-in and keeps them out of group summaries',async()=>{
  const f=await fixture();await t.sql`INSERT INTO signals(profile_id,statement) VALUES (${f.id},'Synthetic source relationship')`;
  const [signal]=await t.sql`SELECT id FROM signals WHERE profile_id=${f.id}`;
  await t.sql`INSERT INTO signal_evidence(profile_id,owner_profile_id,signal_id,inspiration_id,statement_revision,material_revision) VALUES (${f.id},${f.id},${signal.id},${f.source},1,1)`;
  expect((await listProfileSignals(t.db as never,{profileId:f.id,limit:10}))[0]).not.toHaveProperty('inspirationIds');
  expect((await listProfileSignals(t.db as never,{profileId:f.id,limit:10,includeInspirationIds:true}))[0].inspirationIds).toEqual([f.source]);
  const [group]=await t.sql`INSERT INTO groups(name,join_code,created_by_profile_id) VALUES ('Synthetic group','SNAPSHOTGROUP',${f.id}) RETURNING id`;
  const [mind]=await t.sql`INSERT INTO profiles(type,name,group_id) VALUES ('group','Synthetic room',${group.id}) RETURNING id`;
  await t.sql`INSERT INTO signals(profile_id,statement) VALUES (${mind.id},'A room statement')`;
  expect((await listProfileSignals(t.db as never,{profileId:mind.id,limit:10,includeInspirationIds:true}))[0]).not.toHaveProperty('inspirationIds');
});
