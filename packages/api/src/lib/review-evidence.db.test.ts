/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. Explicit synthetic support
 * relationships stand in for a future model verdict, not for its semantics.
 * Real SQL constraints, revision triggers, counters, serving and export run. */
import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,beforeEach,expect,it} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {createReviewSession} from './review-sessions.js';
import {loadSignalEvidence} from './review-evidence.js';
import {selectIndependentEvidence,refreshSignalLifecycle,reconcileSignalsAfterEvidenceLoss} from './signal-lifecycle.js';
import {getProfileSignal} from '../routes/signals.js';
import {loadPrincipleMaterial} from './principle-generation.js';
import {assembleProfileExport} from './profile-export.js';
import {readGenerationRevision,assertGenerationRevision} from './generation-revision.js';
import {createGroupForProfile} from '../routes/groups-membership.js';
import {loadPrincipleViews} from '../routes/principles.js';
let t:TestDatabase,sequence=0;
beforeAll(async()=>{t=await createTestDatabase();});beforeEach(async()=>{await t.truncateAll();});afterAll(async()=>{await t?.cleanup();});
async function fixture(count=3){
  const [account]=await t.sql`INSERT INTO accounts(email) VALUES (${`review-support-${++sequence}@example.test`}) RETURNING id`;
  const [profile]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${account.id},'human','Owner') RETURNING id`;
  const ids:string[]=[];for(let i=0;i<count;i++){const [source]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES (${profile.id},${`Synthetic source ${i}`}) RETURNING id`;ids.push(source.id);}
  const session=(await createReviewSession(t.db as never,profile.id,{id:randomUUID(),inspirationIds:ids}))!;
  const [signal]=await t.sql`INSERT INTO signals(profile_id,statement) VALUES (${profile.id},'I leave room to reconsider my plans') RETURNING id`;
  return {accountId:account.id as string,profileId:profile.id as string,signalId:signal.id as string,sessionId:session.id,ids};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function answer(f:Fixture,focused=f.ids){
  const id=randomUUID();
  await t.sql`INSERT INTO review_answers(id,profile_id,session_id,question_job_id,input_hash,context_hash,question,answer,source_count)
    VALUES (${id},${f.profileId},${f.sessionId},${randomUUID()},'fixture','fixture','What stayed with you?','My own thought about making room to reconsider',${f.ids.length})`;
  for(const origin of f.ids)await t.sql`INSERT INTO review_answer_sources(profile_id,session_id,answer_id,inspiration_id,source_revision,referenced)
    SELECT ${f.profileId},${f.sessionId},${id},${origin},personal_revision,${focused.includes(origin)} FROM inspiration_revisions WHERE inspiration_id=${origin}`;
  return id;
}
async function support(f:Fixture,answerId:string){
  await t.sql.begin(async q=>{
    await q`INSERT INTO signal_review_evidence(profile_id,signal_id,session_id,answer_id,statement_revision,answer_revision,source_count,question_context_included)
      SELECT a.profile_id,${f.signalId},a.session_id,a.id,s.statement_revision,a.revision,
        (SELECT count(*) FROM review_answer_sources r WHERE r.profile_id=a.profile_id AND r.answer_id=a.id),review_question_context_current(a.profile_id,a.session_id,a.id)
      FROM review_answers a JOIN signals s ON s.profile_id=a.profile_id AND s.id=${f.signalId} WHERE a.id=${answerId}
      ON CONFLICT(profile_id,signal_id,answer_id) DO UPDATE SET statement_revision=excluded.statement_revision,answer_revision=excluded.answer_revision,
        source_count=excluded.source_count,question_context_included=excluded.question_context_included`;
    await q`DELETE FROM signal_review_evidence_sources WHERE profile_id=${f.profileId} AND signal_id=${f.signalId} AND answer_id=${answerId}`;
    await q`INSERT INTO signal_review_evidence_sources(profile_id,signal_id,answer_id,inspiration_id,material_revision,referenced)
      SELECT r.profile_id,${f.signalId},r.answer_id,r.inspiration_id,v.personal_revision,r.referenced FROM review_answer_sources r
      JOIN inspiration_revisions v ON v.profile_id=r.profile_id AND v.inspiration_id=r.inspiration_id WHERE r.profile_id=${f.profileId} AND r.answer_id=${answerId}`;
  });
}
async function raw(f:Fixture,id:string){await t.sql`INSERT INTO signal_evidence(profile_id,owner_profile_id,signal_id,inspiration_id,statement_revision,material_revision)
  SELECT ${f.profileId},${f.profileId},s.id,${id},s.statement_revision,v.personal_revision FROM signals s,inspiration_revisions v WHERE s.id=${f.signalId} AND v.inspiration_id=${id}`;}
async function count(f:Fixture){return selectIndependentEvidence((await loadSignalEvidence(t.db as never,f.profileId,[f.signalId])).witnesses.get(f.signalId)??[]).length;}
it('counts many references and replies once and exposes their current human words only to the owner',async()=>{
  const f=await fixture(),first=await answer(f),second=await answer(f);await support(f,first);await support(f,second);
  expect(await count(f)).toBe(1);await t.db.transaction(tx=>refreshSignalLifecycle(tx as never,f.signalId,new Date()));
  const detail=await getProfileSignal(t.db as never,{profileId:f.profileId,signalId:f.signalId});
  expect(detail).toMatchObject({status:'emerging',evidenceCount:1,confidence:24});expect(detail?.reviewEvidence).toHaveLength(2);
  expect(detail?.reviewEvidence?.[0]?.preview).toBe('My own thought about making room to reconsider');
  await expect(t.sql`UPDATE signals SET status='active' WHERE id=${f.signalId}`).rejects.toThrow(/with 1 evidence/);
  const other=await fixture();expect((await loadSignalEvidence(t.db as never,other.profileId,[f.signalId])).witnesses.size).toBe(0);
  expect(await getProfileSignal(t.db as never,{profileId:other.profileId,signalId:f.signalId})).toBeNull();
});
it('serves current review examples for a principle and withdraws stale or deleted answer words',async()=>{
  const f=await fixture(),a=await answer(f);await support(f,a);
  const [principle]=await t.sql`INSERT INTO principles(profile_id,statement,type,origin,rank,locked_at) VALUES(${f.profileId},'Leave room for reconsideration','maxim','declared',0,now()) RETURNING id`;
  await t.sql`INSERT INTO principle_signals(profile_id,principle_id,signal_id,statement_revision,principle_statement_revision) VALUES(${f.profileId},${principle.id},${f.signalId},1,1)`;
  const views=()=>loadPrincipleViews(t.db as never,f.profileId);
  expect((await views())[0].citedSignals[0].reviewExamples).toEqual([{answerId:a,sessionId:f.sessionId,preview:'My own thought about making room to reconsider',createdAt:expect.any(String)}]);
  const other=await fixture();expect(await loadPrincipleViews(t.db as never,other.profileId)).toEqual([]);
  await t.sql`UPDATE review_answers SET answer='A corrected private thought' WHERE id=${a}`;
  expect(JSON.stringify(await views())).not.toContain('My own thought about making room');
  await support(f,a);expect((await views())[0].citedSignals[0].reviewExamples?.[0].preview).toBe('A corrected private thought');
  await t.sql`UPDATE review_answers SET answer=NULL,question=NULL,connection=NULL,input_hash='',deleted_at=now() WHERE id=${a}`;
  expect(JSON.stringify(await views())).not.toContain('A corrected private thought');
});
it('does not spend context-only origins or the same original twice',async()=>{
  const f=await fixture(),a=await answer(f,[f.ids[0]!]);await support(f,a);await raw(f,f.ids[0]!);
  expect(await count(f)).toBe(1);
  await expect(t.sql`UPDATE signals SET status='active' WHERE id=${f.signalId}`).rejects.toThrow(/with 1 evidence/);
});
it('combines independently supported originals and review support through the same SQL promotion guard',async()=>{
  const f=await fixture(),a=await answer(f,[f.ids[2]!]);await support(f,a);await raw(f,f.ids[0]!);await raw(f,f.ids[1]!);
  expect(await count(f)).toBe(3);expect(await t.db.transaction(tx=>refreshSignalLifecycle(tx as never,f.signalId,new Date()))).toBe(true);
  expect((await loadPrincipleMaterial(t.db as never,f.profileId)).evidence.get(f.signalId)?.evidenceAt).toHaveLength(3);
  await expect(t.sql`UPDATE signals SET status='emerging',statement='An unverified new claim' WHERE id=${f.signalId}`).resolves.toBeDefined();
  await expect(t.sql`UPDATE signals SET status='active' WHERE id=${f.signalId}`).rejects.toThrow(/with 0 evidence/);
});
it('fences every source change, including after the old question was already withdrawn',async()=>{
  const f=await fixture(),a=await answer(f,[f.ids[0]!]);await support(f,a);
  const first=await readGenerationRevision(t.db as never,{profileId:f.profileId});
  await t.sql`UPDATE inspirations SET text='Changed context' WHERE id=${f.ids[2]}`;
  expect(await count(f)).toBe(0);expect((await loadSignalEvidence(t.db as never,f.profileId,[f.signalId])).pending.has(f.signalId)).toBe(true);
  await expect(t.db.transaction(tx=>assertGenerationRevision(tx as never,first!))).rejects.toThrow('Generation inputs changed');
  await support(f,a);expect(await count(f)).toBe(1);
  expect((await t.sql`SELECT question_context_included FROM signal_review_evidence WHERE answer_id=${a}`)[0].question_context_included).toBe(false);
  const next=await readGenerationRevision(t.db as never,{profileId:f.profileId});
  await t.sql`UPDATE inspirations SET text='Changed context again' WHERE id=${f.ids[2]}`;
  await expect(t.db.transaction(tx=>assertGenerationRevision(tx as never,next!))).rejects.toThrow('Generation inputs changed');expect(await count(f)).toBe(0);
});
it('withdraws changed words immediately and removes links when an answer is explicitly removed',async()=>{
  const f=await fixture(),a=await answer(f);await support(f,a);
  await t.sql`UPDATE review_answers SET answer='My corrected current words' WHERE id=${a}`;
  expect((await t.sql`SELECT revision FROM review_answers WHERE id=${a}`)[0].revision).toBe(2);expect(await count(f)).toBe(0);
  expect((await getProfileSignal(t.db as never,{profileId:f.profileId,signalId:f.signalId}))?.reviewEvidence).toEqual([]);
  await support(f,a);await t.sql`UPDATE review_answers SET answer=NULL,question=NULL,connection=NULL,input_hash='',deleted_at=now() WHERE id=${a}`;
  expect(await t.sql`SELECT answer_id FROM signal_review_evidence`).toHaveLength(0);expect(await t.sql`SELECT answer_id FROM signal_review_evidence_sources`).toHaveLength(0);
  await reconcileSignalsAfterEvidenceLoss(t.db as never,{profileId:f.profileId,signalIds:[f.signalId]});
  expect((await t.sql`SELECT status FROM signals WHERE id=${f.signalId}`)[0].status).toBe('retired');
});
it('does not turn a stale assessment into unsupported or rewrite a locked statement',async()=>{
  const f=await fixture(),a=await answer(f);await support(f,a);await t.sql`UPDATE signals SET locked_at=now() WHERE id=${f.signalId}`;
  await t.sql`UPDATE inspirations SET text='Different source' WHERE id=${f.ids[0]}`;
  await reconcileSignalsAfterEvidenceLoss(t.db as never,{profileId:f.profileId,signalIds:[f.signalId]});
  expect((await t.sql`SELECT statement,status,unsupported_at FROM signals WHERE id=${f.signalId}`)[0]).toMatchObject({statement:'I leave room to reconsider my plans',status:'emerging',unsupported_at:null});
});
it('keeps focused-source deletion distinct from another origin and cannot promote with stale raw rows',async()=>{
  const f=await fixture(),a=await answer(f,[f.ids[0]!]);await support(f,a);await raw(f,f.ids[1]!);await raw(f,f.ids[2]!);
  await t.sql`DELETE FROM inspirations WHERE id=${f.ids[0]}`;expect(await count(f)).toBe(2);
  await expect(t.sql`UPDATE signals SET status='active' WHERE id=${f.signalId}`).rejects.toThrow(/with 2 evidence/);
  await t.sql`UPDATE inspirations SET text='Edited raw witness' WHERE id=${f.ids[1]}`;expect(await count(f)).toBe(1);
});
it('enforces tenant and group boundaries, exports metadata without copied text, and cascades account erasure',async()=>{
  const f=await fixture(),a=await answer(f);await support(f,a);const other=await fixture(),b=await answer(other);
  await expect(t.sql`INSERT INTO signal_review_evidence(profile_id,signal_id,session_id,answer_id,statement_revision,answer_revision,source_count,question_context_included)
    VALUES (${f.profileId},${f.signalId},${other.sessionId},${b},1,1,3,true)`).rejects.toMatchObject({code:'23503'});
  await expect(t.sql`INSERT INTO signal_review_evidence_sources(profile_id,signal_id,answer_id,inspiration_id,material_revision,referenced)
    VALUES (${f.profileId},${f.signalId},${a},${other.ids[0]},1,true)`).rejects.toMatchObject({code:'23503'});
  const group=await createGroupForProfile(t.db as never,{profileId:f.profileId,name:'Review boundary'});const [mind]=await t.sql`SELECT id FROM profiles WHERE group_id=${group.id}`;
  await expect(t.sql`INSERT INTO signal_review_evidence(profile_id,signal_id,session_id,answer_id,statement_revision,answer_revision,source_count,question_context_included)
    VALUES (${mind.id},${f.signalId},${f.sessionId},${a},1,1,3,true)`).rejects.toMatchObject({code:'23514'});
  const exported=await assembleProfileExport(t.db as never,f.profileId);expect(exported.signalReviewEvidence).toHaveLength(1);expect(exported.signalReviewEvidenceSources).toHaveLength(3);
  expect(JSON.stringify(exported.signalReviewEvidence)).not.toContain('My own thought');expect((await assembleProfileExport(t.db as never,other.profileId)).signalReviewEvidence).toHaveLength(0);
  await t.sql`DELETE FROM accounts WHERE id=${f.accountId}`;expect(await t.sql`SELECT answer_id FROM signal_review_evidence`).toHaveLength(0);
});
it('matches the SQL count to the application selector across small overlapping graphs',async()=>{
  const origins=['a','b','c'],subsets=Array.from({length:7},(_,i)=>origins.filter((_,bit)=>((i+1)&(1<<bit))!==0));
  for(const first of subsets)for(const second of subsets)for(const third of subsets){
    const rows=[{createdAt:new Date(0),source:'app' as const,lineage:{kind:'inspiration' as const,unitId:'a',originIds:['a']}},
      {createdAt:new Date(1),source:'app' as const,lineage:{kind:'review' as const,unitId:'first',originIds:first}},
      {createdAt:new Date(2),source:'app' as const,lineage:{kind:'review' as const,unitId:'second',originIds:second}},
      {createdAt:new Date(3),source:'app' as const,lineage:{kind:'review' as const,unitId:'third',originIds:third}}];
    const edges=rows.flatMap(row=>row.lineage.originIds.map(origin=>({kind:row.lineage.kind,unit:row.lineage.unitId,origin})));
    const [result]=await t.sql`SELECT independent_evidence_count(${JSON.stringify(edges)}::jsonb) AS count,
      independent_evidence_count(${JSON.stringify(edges)}::jsonb,2) AS bounded`;
    expect(result.count).toBe(selectIndependentEvidence(rows).length);
    expect(result.bounded).toBe(Math.min(2,result.count));
  }
});
it('treats missing source-version metadata as pending rather than silently retiring the claim',async()=>{
  const f=await fixture(1);await raw(f,f.ids[0]!);
  await t.sql`DELETE FROM inspiration_revisions WHERE inspiration_id=${f.ids[0]}`;
  const snapshot=await loadSignalEvidence(t.db as never,f.profileId,[f.signalId]);expect(snapshot.pending.has(f.signalId)).toBe(true);
  await reconcileSignalsAfterEvidenceLoss(t.db as never,{profileId:f.profileId,signalIds:[f.signalId]});
  expect((await t.sql`SELECT status FROM signals WHERE id=${f.signalId}`)[0].status).toBe('emerging');
});
it('cannot change a saved question or relabel its original focused sources in place',async()=>{
  const f=await fixture(),a=await answer(f);await support(f,a);
  await expect(t.sql`UPDATE review_answers SET question='A replacement premise?' WHERE id=${a}`).rejects.toMatchObject({code:'23514'});
  await expect(t.sql`UPDATE review_answer_sources SET referenced=false WHERE answer_id=${a}`).rejects.toMatchObject({code:'23514'});
  expect(await count(f)).toBe(1);
});
