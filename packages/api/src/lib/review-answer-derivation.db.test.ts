/** WHAT THIS MOCKS, AND WHY (gate G6): `ModelProvider` supplies grounded
 * synthetic decisions and `StatementEmbeddingClient` supplies deterministic
 * vectors. Real source loading, matching, metadata, queue and erasure run.
 * No provider requests or remote databases are used. */
import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {createReviewSession} from './review-sessions.js';
import {deriveSignalsForReviewAnswer} from './review-answer-derivation.js';
import {getProfileSignal,updateSignalStatement,dismissProfileSignal} from '../routes/signals.js';
import {loadReviewAnswerMaterial} from './review-answer-material.js';
import type {ModelProvider,ReviewAnswerDerivationInput,ReviewAnswerDerivationResult} from './model-provider.js';
import {readGenerationRevision} from './generation-revision.js';
import {writeReviewEvidence} from './review-evidence.js';
let t:TestDatabase,sequence=0;
const vector=[1,...Array<number>(767).fill(0)],embedding={model:'review-test',embed:vi.fn(async()=>vector)};
const judge=vi.fn(async()=>({relation:'same' as 'same'|'independent'|'opposed'}));
const derive=vi.fn<(input:ReviewAnswerDerivationInput)=>Promise<ReviewAnswerDerivationResult>>(async(input)=>({assessments:input.claims.map(row=>({signalId:row.signalId,verdict:'supported',quote:input.answer})),
  statements:input.discover?[{statement:'I leave room to reconsider plans.',quote:input.answer}]:[]}));
const provider={name:'fixture',deriveReviewAnswer:derive,judgeSignalMatch:judge} as unknown as ModelProvider;
beforeAll(async()=>{t=await createTestDatabase();});beforeEach(async()=>{await t.truncateAll();derive.mockClear();judge.mockClear();embedding.embed.mockClear();});afterAll(async()=>{await t?.cleanup();});
async function fixture(){
  const [account]=await t.sql`INSERT INTO accounts(email) VALUES (${`review-derive-${++sequence}@example.test`}) RETURNING id`;
  const [profile]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${account.id},'human','Owner') RETURNING id`;
  const [origin]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES (${profile.id},'A little room for something unplanned') RETURNING id`;
  const session=(await createReviewSession(t.db as never,profile.id,{id:randomUUID(),inspirationIds:[origin.id]}))!;
  const id=randomUUID();await t.sql`INSERT INTO review_answers(id,profile_id,session_id,question_job_id,input_hash,context_hash,question,answer,source_count)
    VALUES(${id},${profile.id},${session.id},${randomUUID()},'fixture','fixture','What stayed with you?','I leave room to change my plans.',1)`;
  await t.sql`INSERT INTO review_answer_sources(profile_id,session_id,answer_id,inspiration_id,source_revision,referenced) VALUES(${profile.id},${session.id},${id},${origin.id},1,true)`;
  const input={profileId:profile.id as string,sessionId:session.id,answerId:id};
  const run=(beforeCommit?:NonNullable<Parameters<typeof deriveSignalsForReviewAnswer>[1]>['beforeCommit'])=>deriveSignalsForReviewAnswer(input,{db:t.db as never,modelProvider:provider,embeddingClient:embedding,beforeCommit});
  return {input,originId:origin.id as string,accountId:account.id as string,run};
}
it('queues metadata with the answer and mints one grounded signal, not a copied inspiration',async()=>{
  const f=await fixture();expect((await t.sql`SELECT payload FROM background_jobs WHERE type='derive_review_answer'`)[0].payload).toMatchObject({answerId:f.input.answerId,sessionId:f.input.sessionId});
  const result=await f.run();expect(result.status).toBe('derived');
  expect(await t.sql`SELECT id FROM inspirations`).toHaveLength(1);expect(await t.sql`SELECT answer_id FROM signal_review_evidence`).toHaveLength(1);
  const [signal]=await t.sql`SELECT id FROM signals`;expect(await getProfileSignal(t.db as never,{profileId:f.input.profileId,signalId:signal.id})).toMatchObject({status:'emerging',evidenceCount:1});
  const [receipt]=await t.sql`SELECT discovery_hash,derived_at,reading_job_id FROM review_answer_processing`;
  expect(receipt).toMatchObject({discovery_hash:expect.any(String),reading_job_id:expect.any(String)});expect(receipt.derived_at).not.toBeNull();expect(Number.isFinite(new Date(receipt.derived_at).getTime())).toBe(true);
  await f.run();expect(derive).toHaveBeenCalledTimes(1);expect(embedding.embed).toHaveBeenCalledTimes(1);expect(await t.sql`SELECT id FROM signals`).toHaveLength(1);
});
it('withdraws explicit negative support without deleting locked words or undoing it through discovery',async()=>{
  const f=await fixture();await f.run();const [signal]=await t.sql`SELECT id FROM signals`;
  await t.sql`UPDATE signals SET locked_at=now() WHERE id=${signal.id}`;
  await t.sql`UPDATE review_answers SET answer='I no longer want room to change my plans.' WHERE id=${f.input.answerId}`;
  derive.mockImplementationOnce(async input=>({assessments:input.claims.map(row=>({signalId:row.signalId,verdict:'unsupported',quote:null})),statements:[]}));
  await f.run();expect(await t.sql`SELECT answer_id FROM signal_review_evidence`).toHaveLength(0);
  const [kept]=await t.sql`SELECT statement,locked_at,unsupported_at FROM signals WHERE id=${signal.id}`;
  expect(kept.statement).toBe('I leave room to reconsider plans.');expect(kept.locked_at).not.toBeNull();expect(kept.unsupported_at).not.toBeNull();expect(Number.isFinite(new Date(kept.locked_at).getTime())).toBe(true);expect(Number.isFinite(new Date(kept.unsupported_at).getTime())).toBe(true);
  expect((await t.sql`SELECT last_explicit FROM review_signal_support`)[0].last_explicit).toBe('unsupported');
});
it('does not overwrite a human edit and reassesses it without discovery for unchanged material',async()=>{
  const f=await fixture();await f.run();const [signal]=await t.sql`SELECT id FROM signals`;
  await updateSignalStatement(t.db as never,{profileId:f.input.profileId,signalId:signal.id,statement:'The wording I chose myself.'});
  const before=derive.mock.calls.length;await f.run();expect(derive.mock.calls.slice(before).map(row=>row[0].discover)).toEqual([false]);
  expect((await t.sql`SELECT statement FROM signals WHERE id=${signal.id}`)[0].statement).toBe('The wording I chose myself.');
});
it('rejects late input and keeps the authored answer rather than committing stale output',async()=>{
  const f=await fixture();derive.mockImplementationOnce(async input=>{await t.sql`UPDATE review_answers SET answer='My changed current thought about rest.' WHERE id=${f.input.answerId}`;return {assessments:[],statements:[{statement:'I leave room to reconsider plans.',quote:input.answer}]};});
  await expect(f.run()).rejects.toThrow(/material changed/);expect(await t.sql`SELECT id FROM signals`).toHaveLength(0);
  expect((await t.sql`SELECT answer FROM review_answers WHERE id=${f.input.answerId}`)[0].answer).toBe('My changed current thought about rest.');
});
it('remembers a current unresolved verdict and does not convert it into withdrawal',async()=>{
  const f=await fixture();await f.run();await t.sql`UPDATE review_answers SET answer='I am not sure what I want here yet.' WHERE id=${f.input.answerId}`;
  derive.mockImplementationOnce(async input=>({assessments:input.claims.map(row=>({signalId:row.signalId,verdict:'unresolved',quote:null})),statements:[]}));
  expect((await f.run()).status).toBe('needs_context');expect(await t.sql`SELECT answer_id FROM signal_review_evidence`).toHaveLength(1);
  const calls=derive.mock.calls.length;expect((await f.run()).status).toBe('needs_context');expect(derive).toHaveBeenCalledTimes(calls);
});
it('stops using an invalidated AI question and reads current origins for reassessment',async()=>{
  const f=await fixture();await f.run();const before=await readGenerationRevision(t.db as never,{profileId:f.input.profileId});
  await t.sql`UPDATE inspirations SET text='A corrected current source' WHERE id=${f.originId}`;
  const current=await loadReviewAnswerMaterial(t.db as never,f.input.profileId,f.input.answerId);expect(current?.question).toBeNull();expect(current?.sources[0]?.material.inspiration.text).toBe('A corrected current source');
  expect((await readGenerationRevision(t.db as never,{profileId:f.input.profileId}))!.revision).toBeGreaterThan(before!.revision);
  await f.run();expect(derive.mock.calls.at(-1)?.[0].contextChanged).toBe(true);
});
it('reconciles a deleted answer without making another model call',async()=>{
  const f=await fixture();await f.run();const calls=derive.mock.calls.length;
  await t.sql`UPDATE review_answers SET answer=NULL,question=NULL,connection=NULL,input_hash='',deleted_at=now() WHERE id=${f.input.answerId}`;
  const [job]=await t.sql`SELECT payload FROM background_jobs WHERE type='derive_review_answer'`;
  expect(job.payload.signalIds).toHaveLength(1);
  await deriveSignalsForReviewAnswer({...f.input,signalIds:job.payload.signalIds},{db:t.db as never,modelProvider:provider,embeddingClient:embedding});
  expect(derive).toHaveBeenCalledTimes(calls);expect(await t.sql`SELECT answer_id FROM review_answer_processing`).toHaveLength(0);
  expect((await t.sql`SELECT status FROM signals`)[0].status).toBe('retired');
});
it('honors an owner dismissal rather than reminting the same signal',async()=>{
  const f=await fixture();await f.run();const [signal]=await t.sql`SELECT id FROM signals`;
  await dismissProfileSignal(t.db as never,{profileId:f.input.profileId,signalId:signal.id});
  await t.sql`UPDATE review_answers SET answer='I still leave room to reconsider my plans.' WHERE id=${f.input.answerId}`;await f.run();
  expect(await t.sql`SELECT id FROM signals`).toHaveLength(1);const [row]=await t.sql`SELECT dismissed_at,status FROM signals`;
  expect(row.status).toBe('retired');expect(row.dismissed_at).not.toBeNull();expect(Number.isFinite(new Date(row.dismissed_at).getTime())).toBe(true);
  expect((await t.sql`SELECT review_answer_id FROM suppressions`)[0].review_answer_id).toBe(f.input.answerId);
});
it('keeps a committed withdrawal when later discovery fails, and retries only discovery',async()=>{
  const f=await fixture();await f.run();await t.sql`UPDATE review_answers SET answer='I no longer want room to change my plans.' WHERE id=${f.input.answerId}`;
  derive.mockImplementationOnce(async input=>({assessments:input.claims.map(row=>({signalId:row.signalId,verdict:'unsupported',quote:null})),statements:[]}));
  derive.mockRejectedValueOnce(new Error('Synthetic discovery failure'));
  await expect(f.run()).rejects.toThrow('Synthetic discovery failure');
  expect(await t.sql`SELECT answer_id FROM signal_review_evidence`).toHaveLength(0);
  expect((await t.sql`SELECT last_explicit FROM review_signal_support`)[0].last_explicit).toBe('unsupported');
  const calls=derive.mock.calls.length;await f.run();expect(derive.mock.calls.slice(calls).map(row=>row[0].discover)).toEqual([true]);
  expect(await t.sql`SELECT answer_id FROM signal_review_evidence`).toHaveLength(0);
});
it('does not clear an explicit withdrawal when the next assessment is unresolved',async()=>{
  const f=await fixture();await f.run();await t.sql`UPDATE review_answers SET answer='I no longer want room to change my plans.' WHERE id=${f.input.answerId}`;
  derive.mockImplementationOnce(async input=>({assessments:input.claims.map(row=>({signalId:row.signalId,verdict:'unsupported',quote:null})),statements:[]}));await f.run();
  await t.sql`UPDATE review_answers SET answer='I am not sure about that anymore.' WHERE id=${f.input.answerId}`;
  derive.mockImplementationOnce(async input=>({assessments:input.claims.map(row=>({signalId:row.signalId,verdict:'unresolved',quote:null})),statements:[]}));
  expect((await f.run()).status).toBe('needs_context');
  expect((await t.sql`SELECT verdict,last_explicit FROM review_signal_support`)[0]).toMatchObject({verdict:'unresolved',last_explicit:'unsupported'});
  expect(await t.sql`SELECT answer_id FROM signal_review_evidence`).toHaveLength(0);
});
it('asks the semantic judge even for identical vectors instead of merging opposing wording',async()=>{
  const f=await fixture();await f.run();
  await t.sql`UPDATE review_answers SET answer='I now prefer fixed plans, not room for improvisation.' WHERE id=${f.input.answerId}`;
  derive.mockImplementationOnce(async input=>({assessments:input.claims.map(row=>({signalId:row.signalId,verdict:'unsupported',quote:null})),statements:[]}));
  derive.mockImplementationOnce(async input=>({assessments:[],statements:[{statement:'I prefer fixed plans over improvisation.',quote:input.answer}]}));
  judge.mockResolvedValueOnce({relation:'opposed'});await f.run();
  expect(judge).toHaveBeenCalledTimes(1);expect(await t.sql`SELECT id FROM signals`).toHaveLength(2);
  expect(await t.sql`SELECT id FROM signal_contradictions`).toHaveLength(1);
});
it('resumes more than one support batch without reassessing the committed first batch',async()=>{
  const f=await fixture(),material=(await loadReviewAnswerMaterial(t.db as never,f.input.profileId,f.input.answerId))!;
  for(let i=0;i<22;i++){
    const [signal]=await t.sql`INSERT INTO signals(profile_id,statement) VALUES(${f.input.profileId},${`Synthetic supported statement ${i}`}) RETURNING id`;
    await t.db.transaction(tx=>writeReviewEvidence(tx as never,material,signal.id));
  }
  await t.sql`UPDATE review_answers SET answer='I still leave room to change my plans.' WHERE id=${f.input.answerId}`;
  expect((await f.run()).status).toBe('partial');expect(derive.mock.calls.map(row=>row[0].claims.length)).toEqual([20]);
  await f.run();expect(derive.mock.calls.map(row=>row[0].claims.length)).toEqual([20,2,0]);
  const assessed=derive.mock.calls.flatMap(row=>row[0].claims.map(claim=>claim.signalId));expect(new Set(assessed).size).toBe(22);
});
