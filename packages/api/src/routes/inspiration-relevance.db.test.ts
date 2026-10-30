/** Real SQL selection, tenant boundaries, retries and memory exclusion on a disposable database. */
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import { createInspirationRelevanceRoutes } from './inspiration-relevance.js';
import { loadInspirationMaterial, assertMaterialCurrent } from '../lib/inspiration-material.js';
import { deriveSignalsForInspiration } from '../lib/signal-derivation.js';
import { personalSignalReadable } from '../lib/personal-output.js';
import { signals } from '../db/index.js';
import { createReviewSession } from '../lib/review-sessions.js';
import { loadReviewAnswerMaterial } from '../lib/review-answer-material.js';
import { writeReviewEvidence } from '../lib/review-evidence.js';
import type { AuthEnv } from '../lib/middleware.js';
const state=vi.hoisted(()=>({db:null as unknown}));
vi.mock('../lib/db.js',()=>({getDb:()=>state.db}));
let t:TestDatabase,sequence=0;
let at=new Date('2026-10-30T12:00:00Z');
beforeEach(async()=>{t??=await createTestDatabase();await t.truncateAll();state.db=t.db;at=new Date('2026-10-30T12:00:00Z');});
afterAll(async()=>{await t?.cleanup();});
async function fixture(keyScoped=false){
  const [account]=await t.sql`INSERT INTO accounts(email) VALUES (${`relevance-${++sequence}@example.test`}) RETURNING id`;
  const [profile]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${account.id},'human','Reviewer') RETURNING id`;
  const [source]=await t.sql`INSERT INTO inspirations(profile_id,text,created_at) VALUES (${profile.id},'The original words',${new Date(at.getTime()-31*86400000).toISOString()}) RETURNING id`;
  const app=new Hono<AuthEnv>(),wake=vi.fn(async()=>{});
  app.route('/api/inspiration-relevance',createInspirationRelevanceRoutes({getDatabase:()=>t.db as never,now:()=>at,wake,authMiddleware:async(c,next)=>{
    c.set('session',{sessionId:randomUUID(),...(keyScoped?{keyScoped:true as const}:{}),account:{id:account.id,email:'reviewer@example.test'},profile:{id:profile.id,accountId:account.id,type:'human',name:'Reviewer',preferredLocale:'en-US'}});await next();
  }}));return {app,wake,profileId:profile.id as string,id:source.id as string};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
const due=async(f:Fixture)=>((await (await f.app.request('/api/inspiration-relevance')).json()) as {items:Array<{id:string}>}).items;
const read=async(f:Fixture)=>((await(await f.app.request(`/api/inspiration-relevance/${f.id}`)).json()) as {item:{sourceRevision:string;reviewVersion:number}}).item;
const choose=(f:Fixture,input:Record<string,unknown>)=>f.app.request(`/api/inspiration-relevance/${f.id}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
const choice=async(f:Fixture,value='relevant')=>{const item=await read(f);return {requestId:randomUUID(),sourceRevision:item.sourceRevision,reviewVersion:item.reviewVersion,choice:value};};
it('offers oldest due originals, holds fresh originals for thirty days, and creates no background work on reads',async()=>{
  const f=await fixture(),other=await fixture();
  const [older]=await t.sql`INSERT INTO inspirations(profile_id,text,created_at) VALUES (${f.profileId},'Older',${new Date(at.getTime()-60*86400000).toISOString()}) RETURNING id`;
  await t.sql`INSERT INTO inspirations(profile_id,text,created_at) VALUES (${f.profileId},'New',${at.toISOString()})`;
  expect((await due(f)).map(x=>x.id)).toEqual([older.id,f.id]);expect((await due(f)).map(x=>x.id)).not.toContain(other.id);
  expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);expect(f.wake).not.toHaveBeenCalled();
});
it('persists thirty-day confirmation and seven-day later across fresh requests; replays do not move the date',async()=>{
  const f=await fixture(),input=await choice(f);
  expect((await choose(f,input)).status).toBe(200);expect(await due(f)).toHaveLength(0);
  at=new Date(at.getTime()+2*86400000);expect((await choose(f,input)).status).toBe(200);
  at=new Date(at.getTime()+28*86400000);expect(await due(f)).toHaveLength(1);
  expect((await choose(f,await choice(f,'later'))).status).toBe(200);expect(await due(f)).toHaveLength(0);
  at=new Date(at.getTime()+7*86400000);expect(await due(f)).toHaveLength(1);
  expect(f.wake).not.toHaveBeenCalled();
});
it('refuses stale source wording, stale review choices and changed replay payloads',async()=>{
  const f=await fixture(),old=await choice(f);
  await t.sql`UPDATE inspirations SET text='Changed' WHERE id=${f.id}`;
  expect((await choose(f,old)).status).toBe(409);
  const fresh=await choice(f);expect((await choose(f,fresh)).status).toBe(200);
  expect((await choose(f,{...fresh,choice:'not_relevant'})).status).toBe(409);
  expect((await choose(f,{...fresh,requestId:randomUUID()})).status).toBe(409);
});
it('rejects foreign inspirations, agent-profile queries and keeper keys',async()=>{
  const f=await fixture(),other=await fixture(),key=await fixture(true);
  expect((await f.app.request(`/api/inspiration-relevance/${other.id}`)).status).toBe(404);
  expect((await f.app.request(`/api/inspiration-relevance?profile=${other.profileId}`)).status).toBe(403);
  expect((await key.app.request('/api/inspiration-relevance')).status).toBe(403);
  const input=await choice(other);expect((await choose({...f,id:other.id},input)).status).toBe(404);
});
it('retains the original and attachments, withdraws its evidence, and stops generation after exclusion',async()=>{
  const f=await fixture();
  await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url) VALUES (${f.profileId},${f.id},'link','https://example.test/original')`;
  const [signal]=await t.sql`INSERT INTO signals(profile_id,statement,status) VALUES (${f.profileId},'A supported pattern','emerging') RETURNING id`;
  await t.sql`INSERT INTO signal_evidence(profile_id,owner_profile_id,signal_id,inspiration_id) VALUES (${f.profileId},${f.profileId},${signal.id},${f.id})`;
  const before=await loadInspirationMaterial(t.db as never,f.profileId,f.id,'personal');expect(before).not.toBeNull();
  const input=await choice(f,'not_relevant');expect((await choose(f,input)).status).toBe(200);
  expect((await t.sql`SELECT text FROM inspirations WHERE id=${f.id}`)[0].text).toBe('The original words');
  expect(await t.sql`SELECT id FROM attachments WHERE inspiration_id=${f.id}`).toHaveLength(1);
  expect(await t.sql`SELECT id FROM deleted_inspirations`).toHaveLength(0);
  expect(await t.sql`SELECT signal_id FROM signal_evidence WHERE inspiration_id=${f.id}`).toHaveLength(0);
  expect((await t.sql`SELECT status FROM signals WHERE id=${signal.id}`)[0].status).toBe('retired');
  expect(await due(f)).toHaveLength(0);expect(await loadInspirationMaterial(t.db as never,f.profileId,f.id,'personal')).toBeNull();
  await expect(t.db.transaction(tx=>assertMaterialCurrent(tx as never,before!,[]))).rejects.toThrow('changed');
  const provider={extractSignalCandidates:vi.fn()};
  expect((await deriveSignalsForInspiration({inspirationId:f.id,reason:'edited'},{db:t.db as never,modelProvider:provider as never})).candidateCount).toBe(0);
  expect(provider.extractSignalCandidates).not.toHaveBeenCalled();expect(f.wake).toHaveBeenCalledOnce();
  expect((await choose(f,input)).status).toBe(200);expect(f.wake).toHaveBeenCalledOnce();
  expect((await choose(f,await choice(f,'relevant'))).status).toBe(200);
  expect(await loadInspirationMaterial(t.db as never,f.profileId,f.id,'personal')).not.toBeNull();
  expect(await t.sql`SELECT id FROM background_jobs WHERE type='derive_signals'`).toHaveLength(1);
});
it('preserves human-locked signal wording and excludes stale support even if a late writer restores an edge',async()=>{
  const f=await fixture();
  const [signal]=await t.sql`INSERT INTO signals(profile_id,statement,status,locked_at) VALUES (${f.profileId},'My own words','emerging',now()) RETURNING id`;
  await t.sql`INSERT INTO signal_evidence(profile_id,owner_profile_id,signal_id,inspiration_id) VALUES (${f.profileId},${f.profileId},${signal.id},${f.id})`;
  expect((await choose(f,await choice(f,'not_relevant'))).status).toBe(200);
  const [row]=await t.sql`SELECT statement,locked_at,unsupported_at FROM signals WHERE id=${signal.id}`;
  expect(row.statement).toBe('My own words');expect(row.locked_at).not.toBeNull();expect(row.unsupported_at).not.toBeNull();
  await t.sql`INSERT INTO signal_evidence(profile_id,owner_profile_id,signal_id,inspiration_id) VALUES (${f.profileId},${f.profileId},${signal.id},${f.id})`;
  await t.sql`UPDATE signals SET unsupported_at=NULL WHERE id=${signal.id}`;
  expect(await t.db.select({id:signals.id}).from(signals).where(personalSignalReadable(f.profileId))).toHaveLength(0);
});
it('withdraws a cross-source review witness without deleting the authored answer or reusing excluded context',async()=>{
  const f=await fixture();
  const [second]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES (${f.profileId},'A different original') RETURNING id`;
  const session=(await createReviewSession(t.db as never,f.profileId,{id:randomUUID(),inspirationIds:[f.id,second.id]}))!;
  const answerId=randomUUID();
  await t.sql`INSERT INTO review_answers(id,profile_id,session_id,question_job_id,input_hash,context_hash,answer,source_count)
    VALUES (${answerId},${f.profileId},${session.id},${randomUUID()},'fixture','fixture','My answer about both originals',2)`;
  for(const id of [f.id,second.id])await t.sql`INSERT INTO review_answer_sources(profile_id,session_id,answer_id,inspiration_id,source_revision,referenced)
    SELECT ${f.profileId},${session.id},${answerId},${id},personal_revision,true FROM inspiration_revisions WHERE inspiration_id=${id}`;
  const [signal]=await t.sql`INSERT INTO signals(profile_id,statement) VALUES (${f.profileId},'A reading of the answer') RETURNING id`;
  const before=await loadReviewAnswerMaterial(t.db as never,f.profileId,answerId);
  await t.db.transaction(tx=>writeReviewEvidence(tx as never,before!,signal.id));
  expect((await choose(f,await choice(f,'not_relevant'))).status).toBe(200);
  expect(await t.sql`SELECT answer_id FROM signal_review_evidence`).toHaveLength(0);
  expect((await t.sql`SELECT answer FROM review_answers WHERE id=${answerId}`)[0].answer).toBe('My answer about both originals');
  const after=await loadReviewAnswerMaterial(t.db as never,f.profileId,answerId);
  expect(after?.sources).toHaveLength(0);expect(after?.questionIncluded).toBe(false);
});
