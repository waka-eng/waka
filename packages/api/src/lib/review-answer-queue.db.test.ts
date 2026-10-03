/** WHAT THIS MOCKS, AND WHY (gate G6): `ModelProvider` returns synthetic
 * grounded decisions and `fetch` permits only the embedding endpoint with a
 * fixed vector. Real queue claims, metering, migrations and persistence run
 * against disposable Postgres; no paid provider or remote database calls. */
import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {createReviewSession} from './review-sessions.js';
import {getDb} from './db.js';
import {setDefaultModelProviderForTests,type ModelProvider,type ReviewAnswerDerivationInput,type ReviewAnswerDerivationResult,type TopOfMindSynthesisInput} from './model-provider.js';
import {postgresBackgroundJobStore,processBackgroundJob,reserveReviewModelRun} from './queue.js';
import {MODEL_BUDGET_JOBS_PER_ACCOUNT} from './model-budget.js';
import {loadReviewProcessingStatus,recordReviewReadingResult,recoverReviewProcessing} from './review-processing.js';

let t:TestDatabase,sequence=0,during:(()=>Promise<void>)|null=null;
const connectionString=process.env.DB_CONNECTION_URL!;
const derive=vi.fn<(input:ReviewAnswerDerivationInput)=>Promise<ReviewAnswerDerivationResult>>(async(input)=>{
  await during?.();
  return {assessments:input.claims.map(row=>({signalId:row.signalId,verdict:'supported' as const,quote:input.answer})),
    statements:input.discover?[{statement:'I leave room to reconsider plans.',quote:input.answer}]:[]};
});
beforeAll(async()=>{
  t=await createTestDatabase();const url=new URL(connectionString);
  url.searchParams.set('options',`-c search_path=${t.schemaName}`);process.env.DB_CONNECTION_URL=url.toString();
});
beforeEach(async()=>{
  await t.truncateAll();derive.mockClear();during=null;
  setDefaultModelProviderForTests({name:'review-queue-fixture',deriveReviewAnswer:derive,
    synthesizeTopOfMind:async(input:TopOfMindSynthesisInput)=>({entries:input.signals.length?[{type:'pattern',body:'I leave room to reconsider plans.',citedSignalIds:[input.signals[0].id]}]:[]}),
    judgeSignalMatch:async()=>({relation:'same'})} as unknown as ModelProvider);
  vi.stubEnv('GEMINI_API_KEY','synthetic-test-key');
  vi.stubGlobal('fetch',vi.fn(async(url:unknown)=>{
    if(!String(url).startsWith('https://generativelanguage.googleapis.com/')||!String(url).includes(':embedContent'))throw new Error('Unexpected network request');
    return Response.json({embedding:{values:[1,...Array<number>(767).fill(0)]}});
  }));
});
afterAll(async()=>{setDefaultModelProviderForTests(null);vi.unstubAllGlobals();vi.unstubAllEnvs();await getDb().$client.end();await t?.cleanup();process.env.DB_CONNECTION_URL=connectionString;});
async function fixture(){
  const [account]=await t.sql`INSERT INTO accounts(email) VALUES(${`review-queue-${++sequence}@example.test`}) RETURNING id`;
  const [profile]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${account.id},'human','Owner') RETURNING id`;
  const [origin]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${profile.id},'Room for something unplanned') RETURNING id`;
  const session=(await createReviewSession(t.db as never,profile.id,{id:randomUUID(),inspirationIds:[origin.id]}))!;
  const answerId=randomUUID();
  await t.sql`INSERT INTO review_answers(id,profile_id,session_id,question_job_id,input_hash,context_hash,question,answer,source_count)
    VALUES(${answerId},${profile.id},${session.id},${randomUUID()},'fixture','fixture','What stayed with you?','I leave room to change my plans.',1)`;
  await t.sql`INSERT INTO review_answer_sources(profile_id,session_id,answer_id,inspiration_id,source_revision,referenced)
    VALUES(${profile.id},${session.id},${answerId},${origin.id},1,true)`;
  return {answerId,sessionId:session.id,originId:origin.id as string,profileId:profile.id as string,accountId:account.id as string};
}
async function claim(){
  await t.sql`UPDATE background_jobs SET run_after=now()+interval '1 day' WHERE type<>'derive_review_answer'`;
  await t.sql`UPDATE background_jobs SET run_after=now()-interval '1 second' WHERE type='derive_review_answer' AND status='pending'`;
  const job=await postgresBackgroundJobStore.claimNext(new Date());expect(job?.type).toBe('derive_review_answer');return job!;
}
const usage=(accountId:string)=>postgresBackgroundJobStore.usageForAccount(accountId,new Date(Date.now()-3600000));
const status=(f:Awaited<ReturnType<typeof fixture>>)=>loadReviewProcessingStatus(t.db as never,f.profileId,f.sessionId);

it('reads pending without creating work and completes through the real reading publication callback',async()=>{
  const f=await fixture();const before=await t.sql`SELECT id,request_version FROM background_jobs`;
  expect(await status(f)).toMatchObject({phase:'pending',answerCount:1,completedCount:0,result:null,canRetry:false});
  expect(await t.sql`SELECT id,request_version FROM background_jobs`).toEqual(before);expect(derive).not.toHaveBeenCalled();
  const job=await claim();await processBackgroundJob(job);await postgresBackgroundJobStore.markSucceeded(job,null);
  expect(await status(f)).toMatchObject({phase:'pending',completedCount:0,result:null});
  await t.sql`UPDATE background_jobs SET run_after=now()-interval '1 second' WHERE type='refresh_top_of_mind'`;
  const reading=await postgresBackgroundJobStore.claimNext(new Date());expect(reading?.type).toBe('refresh_top_of_mind');
  const result=await processBackgroundJob(reading!);expect(result).toBeDefined();
  // Publication is committed, even if the worker loses its success response.
  expect(await status(f)).toMatchObject({phase:'ready',completedCount:1,result});
  await postgresBackgroundJobStore.markSucceeded(reading!,result!);
  expect(await status(f)).toMatchObject({phase:'ready',result});
});
it('keeps the exact earlier publication when extraction finishes later and its queue row is gone',async()=>{
  const f=await fixture(),job=await claim();await processBackgroundJob(job);
  const [receipt]=await t.sql`SELECT reading_job_id,reading_request_version::text FROM review_answer_processing`;
  await t.sql`UPDATE review_answer_processing SET derived_at=NULL WHERE answer_id=${f.answerId}`;
  const [old]=await t.sql`INSERT INTO top_of_minds(profile_id) VALUES(${f.profileId}) RETURNING id`;
  const result={kind:'top_of_mind' as const,topOfMindId:old.id as string,version:1,outcome:'changed' as const};
  await recordReviewReadingResult(t.db as never,{profileId:f.profileId,jobId:receipt.reading_job_id,requestVersion:'0',result});
  expect((await t.sql`SELECT result FROM review_answer_processing`)[0].result).toBeNull();
  await recordReviewReadingResult(t.db as never,{profileId:f.profileId,jobId:receipt.reading_job_id,requestVersion:receipt.reading_request_version,result});
  expect((await t.sql`SELECT completed_at FROM review_answer_processing`)[0].completed_at).toBeNull();
  await t.sql`DELETE FROM background_jobs WHERE id=${receipt.reading_job_id}`;
  await t.sql`UPDATE top_of_minds SET status='superseded' WHERE id=${old.id}`;
  await t.sql`INSERT INTO top_of_minds(profile_id,version) VALUES(${f.profileId},2)`;
  await processBackgroundJob(job);expect(derive).toHaveBeenCalledTimes(1);
  expect(await status(f)).toMatchObject({phase:'ready',result});
});
it('withholds a completed result as soon as the source requests a newer derivation',async()=>{
  const f=await fixture(),job=await claim();await processBackgroundJob(job);await postgresBackgroundJobStore.markSucceeded(job,null);
  const [receipt]=await t.sql`SELECT reading_job_id,reading_request_version::text FROM review_answer_processing`;
  const input={profileId:f.profileId,jobId:receipt.reading_job_id,requestVersion:receipt.reading_request_version,result:{kind:'top_of_mind' as const,topOfMindId:null,version:0,outcome:'empty' as const}};
  await recordReviewReadingResult(t.db as never,input);expect((await status(f))?.phase).toBe('ready');
  await t.sql`UPDATE inspirations SET text='A current correction' WHERE id=${f.originId}`;
  expect(await status(f)).toMatchObject({phase:'pending',completedCount:0,result:null});
  const other=await fixture();expect(await loadReviewProcessingStatus(t.db as never,other.profileId,f.sessionId)).toBeNull();
});
it('retries only a failed reading and observes repeated retries without resetting active work',async()=>{
  const f=await fixture(),job=await claim();await processBackgroundJob(job);await postgresBackgroundJobStore.markSucceeded(job,null);
  await t.sql`UPDATE background_jobs SET status='failed' WHERE type='refresh_top_of_mind'`;
  expect(await status(f)).toMatchObject({phase:'failed',canRetry:true,result:null});
  expect(await recoverReviewProcessing(t.db as never,f.profileId,f.sessionId)).toMatchObject({phase:'pending',canRetry:false});
  const after=await t.sql`SELECT id,status,request_version FROM background_jobs WHERE type='refresh_top_of_mind' ORDER BY id`;
  await recoverReviewProcessing(t.db as never,f.profileId,f.sessionId);
  expect(await t.sql`SELECT id,status,request_version FROM background_jobs WHERE type='refresh_top_of_mind' ORDER BY id`).toEqual(after);
  expect(derive).toHaveBeenCalledTimes(1);expect(await t.sql`SELECT id FROM review_answers`).toHaveLength(1);
});
it('rolls back result recording with publication and rejects a foreign reading',async()=>{
  const f=await fixture(),job=await claim();await processBackgroundJob(job);
  const [receipt]=await t.sql`SELECT reading_job_id,reading_request_version::text FROM review_answer_processing`;
  const input={profileId:f.profileId,jobId:receipt.reading_job_id,requestVersion:receipt.reading_request_version,result:{kind:'top_of_mind' as const,topOfMindId:null,version:0,outcome:'empty' as const}};
  await expect(t.db.transaction(async tx=>{await recordReviewReadingResult(tx as never,input);throw new Error('Rollback publication');})).rejects.toThrow('Rollback publication');
  expect((await t.sql`SELECT result FROM review_answer_processing`)[0].result).toBeNull();
  const other=await fixture(),[foreign]=await t.sql`INSERT INTO top_of_minds(profile_id) VALUES(${other.profileId}) RETURNING id`;
  await expect(recordReviewReadingResult(t.db as never,{...input,result:{...input.result,topOfMindId:foreign.id,version:1,outcome:'changed'}})).rejects.toThrow('owner changed');
});
it('shows unresolved support as a normal outcome and does not offer a pointless retry',async()=>{
  const f=await fixture(),first=await claim();await processBackgroundJob(first);await postgresBackgroundJobStore.markSucceeded(first,null);
  await t.sql`UPDATE review_answers SET answer='I am not sure what I want here yet.' WHERE id=${f.answerId}`;
  derive.mockImplementationOnce(async input=>({assessments:input.claims.map(row=>({signalId:row.signalId,verdict:'unresolved',quote:null})),statements:[]}));
  const next=await claim();await processBackgroundJob(next);await postgresBackgroundJobStore.markSucceeded(next,null);
  expect(await status(f)).toMatchObject({phase:'needs_context',canRetry:false,completedCount:0,result:null});
});
it('does not present one completed answer as completion for another still-pending thought',async()=>{
  const f=await fixture(),job=await claim();await processBackgroundJob(job);await postgresBackgroundJobStore.markSucceeded(job,null);
  const [receipt]=await t.sql`SELECT reading_job_id,reading_request_version::text FROM review_answer_processing`;
  await recordReviewReadingResult(t.db as never,{profileId:f.profileId,jobId:receipt.reading_job_id,requestVersion:receipt.reading_request_version,result:{kind:'top_of_mind',topOfMindId:null,version:0,outcome:'empty'}});
  expect((await status(f))?.phase).toBe('ready');
  const answerId=randomUUID();
  await t.sql`INSERT INTO review_answers(id,profile_id,session_id,question_job_id,input_hash,context_hash,question,answer,source_count)
    VALUES(${answerId},${f.profileId},${f.sessionId},${randomUUID()},'fixture','fixture','What else?','One more thought is still being read.',1)`;
  await t.sql`INSERT INTO review_answer_sources(profile_id,session_id,answer_id,inspiration_id,source_revision,referenced)
    VALUES(${f.profileId},${f.sessionId},${answerId},${f.originId},1,true)`;
  expect(await status(f)).toMatchObject({phase:'pending',answerCount:2,completedCount:1,result:null});
});
it('names only existing principles with current owned support from this review',async()=>{
  const f=await fixture(),job=await claim();await processBackgroundJob(job);
  const [reviewSignal]=await t.sql`SELECT id FROM signals WHERE profile_id=${f.profileId}`;
  const signalIds=[reviewSignal.id];
  for(let i=0;i<2;i++){
    const [source]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${f.profileId},${`Independent example ${i}`}) RETURNING id`;
    const [signal]=await t.sql`INSERT INTO signals(profile_id,statement) VALUES(${f.profileId},${`Existing supported signal ${i}`}) RETURNING id`;
    await t.sql`INSERT INTO signal_evidence(profile_id,owner_profile_id,signal_id,inspiration_id,statement_revision,material_revision)
      VALUES(${f.profileId},${f.profileId},${signal.id},${source.id},1,1)`;signalIds.push(signal.id);
  }
  const [principle]=await t.sql`INSERT INTO principles(profile_id,statement,type,origin,rank) VALUES(${f.profileId},'An existing supported principle','maxim','declared',0) RETURNING id`;
  for(const signalId of signalIds)await t.sql`INSERT INTO principle_signals(profile_id,principle_id,signal_id,statement_revision,principle_statement_revision)
    VALUES(${f.profileId},${principle.id},${signalId},1,1)`;
  const [receipt]=await t.sql`SELECT reading_job_id,reading_request_version::text FROM review_answer_processing`;
  await recordReviewReadingResult(t.db as never,{profileId:f.profileId,jobId:receipt.reading_job_id,requestVersion:receipt.reading_request_version,result:{kind:'top_of_mind',topOfMindId:null,version:0,outcome:'empty'}});
  expect((await status(f))?.relatedPrinciples).toEqual([{id:principle.id,statement:'An existing supported principle'}]);
  await t.sql`UPDATE signals SET statement='Changed wording not yet checked' WHERE id=${signalIds[1]}`;
  expect((await status(f))?.relatedPrinciples).toEqual([]);expect(await t.sql`SELECT id FROM principles`).toHaveLength(1);
});

it('runs the real router, replays without another charge and meters a new lease on the same keyed job',async()=>{
  const f=await fixture(),job=await claim();
  expect((await usage(f.accountId)).startedInWindow).toBe(0);
  await processBackgroundJob(job);await processBackgroundJob(job);
  expect(derive).toHaveBeenCalledTimes(1);expect(await t.sql`SELECT id FROM signals`).toHaveLength(1);
  expect((await usage(f.accountId)).startedInWindow).toBe(1);
  expect(await postgresBackgroundJobStore.markSucceeded(job,null)).toBe(true);
  await t.sql`UPDATE review_answers SET answer='I still leave room to reconsider my plans.' WHERE id=${f.answerId}`;
  const next=await claim();expect(next.id).toBe(job.id);expect(next.lockedAt).not.toEqual(job.lockedAt);
  await processBackgroundJob(next);expect((await usage(f.accountId)).startedInWindow).toBe(2);
  expect(await t.sql`SELECT id FROM review_model_runs`).toHaveLength(2);
  expect(await postgresBackgroundJobStore.markSucceeded(next,null)).toBe(true);
});
it('fences a reclaimed worker before output and retains its already-spent attempt',async()=>{
  const f=await fixture(),job=await claim();
  during=async()=>{await t.sql`UPDATE background_jobs SET locked_at=locked_at+interval '1 second',attempts=attempts+1 WHERE id=${job.id}`;};
  await expect(processBackgroundJob(job)).rejects.toThrow(/ownership changed/);
  expect(await t.sql`SELECT id FROM signals`).toHaveLength(0);expect(await t.sql`SELECT answer_id FROM review_answer_processing`).toHaveLength(0);
  expect((await usage(f.accountId)).startedInWindow).toBe(1);
  await expect(reserveReviewModelRun(job)).rejects.toThrow(/ownership changed/);
});
it('preserves spend after job deletion and rejects cross-profile billing and result references',async()=>{
  const f=await fixture(),job=await claim();await processBackgroundJob(job);await reserveReviewModelRun(job);
  expect((await usage(f.accountId)).startedInWindow).toBe(1);
  const other=await fixture();
  await expect(t.sql`INSERT INTO review_model_runs(profile_id,job_id,lease_at) VALUES(${other.profileId},${job.id},now()+interval '1 minute')`).rejects.toThrow(/foreign key/);
  const [foreignJob]=await t.sql`SELECT id FROM background_jobs WHERE profile_id=${other.profileId} AND type='derive_review_answer'`;
  await expect(t.sql`UPDATE review_answer_processing SET derivation_job_id=${foreignJob.id} WHERE answer_id=${f.answerId}`).rejects.toThrow(/foreign key/);
  await expect(t.sql`UPDATE review_answer_processing SET reading_job_id=${foreignJob.id} WHERE answer_id=${f.answerId}`).rejects.toThrow(/foreign key/);
  await t.sql`DELETE FROM background_jobs WHERE id=${job.id}`;
  expect((await t.sql`SELECT profile_id,derivation_job_id FROM review_answer_processing WHERE answer_id=${f.answerId}`)[0]).toMatchObject({profile_id:f.profileId,derivation_job_id:null});
  expect((await t.sql`SELECT job_id FROM review_model_runs`)[0].job_id).toBeNull();
  expect((await usage(f.accountId)).startedInWindow).toBe(1);expect((await usage(other.accountId)).startedInWindow).toBe(0);
});
it('holds before the provider when the account budget has been consumed since claiming',async()=>{
  const f=await fixture(),job=await claim();
  await t.sql`INSERT INTO review_model_runs(profile_id,lease_at) SELECT ${f.profileId}::uuid,now() FROM generate_series(1,${MODEL_BUDGET_JOBS_PER_ACCOUNT})`;
  await expect(processBackgroundJob(job)).rejects.toThrow(/budget waits/);expect(derive).not.toHaveBeenCalled();
  expect((await usage(f.accountId)).startedInWindow).toBe(MODEL_BUDGET_JOBS_PER_ACCOUNT);
  expect(await t.sql`SELECT id FROM signals`).toHaveLength(0);
});
