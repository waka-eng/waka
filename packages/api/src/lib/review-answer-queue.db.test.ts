/** WHAT THIS MOCKS, AND WHY (gate G6): `ModelProvider` returns synthetic
 * grounded decisions and `fetch` permits only the embedding endpoint with a
 * fixed vector. Real queue claims, metering, migrations and persistence run
 * against disposable Postgres; no paid provider or remote database calls. */
import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {createReviewSession} from './review-sessions.js';
import {getDb} from './db.js';
import {setDefaultModelProviderForTests,type ModelProvider,type ReviewAnswerDerivationInput} from './model-provider.js';
import {postgresBackgroundJobStore,processBackgroundJob,reserveReviewModelRun} from './queue.js';
import {MODEL_BUDGET_JOBS_PER_ACCOUNT} from './model-budget.js';

let t:TestDatabase,sequence=0,during:(()=>Promise<void>)|null=null;
const connectionString=process.env.DB_CONNECTION_URL!;
const derive=vi.fn(async(input:ReviewAnswerDerivationInput)=>{
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
  return {answerId,profileId:profile.id as string,accountId:account.id as string};
}
async function claim(){
  await t.sql`UPDATE background_jobs SET run_after=now()+interval '1 day' WHERE type<>'derive_review_answer'`;
  await t.sql`UPDATE background_jobs SET run_after=now()-interval '1 second' WHERE type='derive_review_answer' AND status='pending'`;
  const job=await postgresBackgroundJobStore.claimNext(new Date());expect(job?.type).toBe('derive_review_answer');return job!;
}
const usage=(accountId:string)=>postgresBackgroundJobStore.usageForAccount(accountId,new Date(Date.now()-3600000));

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
