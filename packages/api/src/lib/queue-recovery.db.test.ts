/** WHAT THIS MOCKS, AND WHY: `processor` completes jobs without model calls.
 * The real recovery query, budgets, claims and completion run on Postgres. */
import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/db.js';
import {readBackgroundJobRecoveryState,drainBackgroundJobs,enqueueDeriveSignals,postgresBackgroundJobStore,settleAbandonedExhaustedLeases} from './queue.js';
import {legacyDerivationRecoveryEligible,reconcileLegacyDerivationFailures} from './job-failure-recovery.js';
import {deliverTerminalJobNotices} from './job-failure-notices.js';
import {BackgroundJobHeldError} from './background-job-hold.js';
import {EMBEDDING_2_SPACE} from './embedding-2-space.js';
import {sql} from 'drizzle-orm';
import {getDb} from './db.js';
import {MalformedModelOutputError} from './model-provider.js';
import {inspectQueueRedrive} from './queue-redrive.js';
import postgres from 'postgres';
let t:TestDatabase;
const now=new Date('2026-10-05T12:00:00Z');
const connection=process.env.DB_CONNECTION_URL!;
beforeAll(async()=>{t=await createTestDatabase();const url=new URL(connection);url.searchParams.set('options',`-c search_path=${t.schemaName}`);process.env.DB_CONNECTION_URL=url.toString();});beforeEach(async()=>{await t.truncateAll();});afterAll(async()=>{await getDb().$client.end();await t?.cleanup();process.env.DB_CONNECTION_URL=connection;});
async function owner(){const [a]=await t.sql`INSERT INTO accounts(email) VALUES(${randomUUID()+'@example.test'}) RETURNING id`;const [p]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${a.id},'human','Synthetic recovery') RETURNING id`;return p.id;}

async function legacyDerivationFailure() {
  const profileId = await owner();
  const [{account_id: accountId}] = await t.sql`SELECT account_id FROM profiles WHERE id=${profileId}`;
  const [{id: sourceId}] = await t.sql`INSERT INTO inspirations(profile_id,text)
    VALUES(${profileId},'Synthetic previously failed inspiration') RETURNING id`;
  const job = await getDb().transaction(tx => enqueueDeriveSignals(profileId, sourceId, 'created', tx));
  const diagnostic = '{"category":"database","code":"55P03"}';
  await t.sql`UPDATE background_jobs SET status='failed', attempts=3, locked_at=${now.toISOString()},
    started_at=${now.toISOString()}, last_error=${diagnostic}, updated_at=${now.toISOString()} WHERE id=${job.jobId}`;
  await t.sql`INSERT INTO background_job_runs(account_id, job_id, request_version, attempt, started_at)
    SELECT ${accountId}, ${job.jobId}, 1, attempt, ${now.toISOString()}::timestamptz - (attempt * interval '1 minute')
    FROM generate_series(1,3) attempt`;
  return {profileId, accountId, sourceId, jobId: job.jobId, diagnostic};
}

async function blockLegacyDispatch(target: Awaited<ReturnType<typeof legacyDerivationFailure>>, status: string) {
  await t.sql`INSERT INTO embedding_index_attempts(account_id,profile_id,request_key,dispatch_family,purpose,space,
    source_kind,source_id,input_scope,input_hash,input_bytes,status)
    VALUES(${target.accountId},${target.profileId},${randomUUID()},'discovery','live',${EMBEDDING_2_SPACE.id},
      'inspiration',${target.sourceId},'personal',${'0'.repeat(64)},12,${status})`;
}

it('gives an already exhausted owned lock failure one delayed claim while preserving its historical starts', async () => {
  const target = await legacyDerivationFailure();
  const processor = vi.fn(async () => {});
  const next = new Date(now.getTime() + 30_000);
  const held = await legacyDerivationFailure();
  await blockLegacyDispatch(held, 'received');
  await t.sql`UPDATE background_jobs SET last_error='{"category":"unexpected"}', attempts=2 WHERE id=${held.jobId}`;
  const relay = 'arn:aws:lambda:us-west-2:111122223333:function:waka-production-JobFailureAlertFunction-fixture';
  const notify = vi.fn(async (_arn: string, _notice: unknown) => {});
  vi.stubEnv('WAKA_STAGE', 'production');
  vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', 'synthetic-worker');
  vi.stubEnv('WAKA_JOB_ALERT_RELAY_ARN', relay);
  try {
    await deliverTerminalJobNotices(getDb(), undefined, notify);
    expect(notify).toHaveBeenCalledExactlyOnceWith(relay,
      expect.objectContaining({ jobType: 'derive_signals', disposition: 'ambiguous' }));
    const noticed = await t.sql`SELECT id FROM background_jobs WHERE terminal_notice_sent_for=updated_at`;
    expect(noticed).toEqual([{ id: held.jobId }]);
  } finally { vi.unstubAllEnvs(); }

  expect(await drainBackgroundJobs({now, processor, limit: 1})).toMatchObject({claimed: 0});
  const snapshot = await getDb().execute<{eligible: boolean}>(sql`
    SELECT (${legacyDerivationRecoveryEligible}) AS eligible FROM background_jobs j WHERE j.id=${target.jobId}::uuid`);
  expect(snapshot).toEqual([{eligible: true}]);
  await t.sql.begin(async tx => {
    await tx`SELECT id FROM inspirations WHERE id=${target.sourceId} FOR UPDATE`;
    expect(await reconcileLegacyDerivationFailures(getDb(), now)).toBe(0);
  });
  const recovered = await Promise.all([reconcileLegacyDerivationFailures(getDb(), now), reconcileLegacyDerivationFailures(getDb(), now)]);
  expect(recovered.reduce((a, b) => a + b)).toBe(1);
  const [scheduled] = await t.sql`SELECT status, attempts, max_attempts, run_after, last_error,
    payload->>'terminalRecoveryVersion' AS recovery FROM background_jobs WHERE id=${target.jobId}`;
  expect(scheduled).toMatchObject({
    status: 'pending', attempts: 2, max_attempts: 3, last_error: target.diagnostic, recovery: '1',
  });
  expect(new Date(scheduled!.run_after).getTime()).toBe(next.getTime());
  expect(await t.sql`SELECT id FROM background_job_runs WHERE job_id=${target.jobId}`).toHaveLength(3);
  expect(await drainBackgroundJobs({now, processor, limit: 1})).toMatchObject({claimed: 0});
  expect(await drainBackgroundJobs({now: next, processor, limit: 1})).toMatchObject({succeeded: 1});
  expect(processor).toHaveBeenCalledOnce();
  expect(await t.sql`SELECT id FROM background_job_runs WHERE job_id=${target.jobId}`).toHaveLength(4);
  expect(await reconcileLegacyDerivationFailures(getDb(), next)).toBe(0);
});

it('holds old ambiguous and stale source failures and blocks a dispatch that appears after requeue', async () => {
  const ambiguous = await legacyDerivationFailure();
  await blockLegacyDispatch(ambiguous, 'received');
  await t.sql`UPDATE background_jobs SET last_error='{"category":"unexpected"}', attempts=2 WHERE id=${ambiguous.jobId}`;
  const reserved = await legacyDerivationFailure();
  await blockLegacyDispatch(reserved, 'reserved');
  const stale = await legacyDerivationFailure();
  await t.sql`UPDATE inspirations SET text='Synthetic revised source' WHERE id=${stale.sourceId}`;
  const late = await legacyDerivationFailure();
  expect(await reconcileLegacyDerivationFailures(getDb(), now)).toBe(1);
  await blockLegacyDispatch(late, 'unknown');
  const next = new Date(now.getTime() + 30_000);
  expect(await drainBackgroundJobs({now: next, limit: 1})).toMatchObject({failed: 1, retried: 0});
  expect((await t.sql`SELECT status, payload->>'failureDisposition' AS disposition, last_error
    FROM background_jobs WHERE id=${late.jobId}`)[0]).toEqual({
    status: 'failed', disposition: 'ambiguous', last_error: 'embedding_outcome_unknown',
  });
  expect(await t.sql`SELECT status FROM background_jobs
    WHERE id IN (${ambiguous.jobId},${reserved.jobId},${stale.jobId})`).toEqual(Array.from({length: 3}, () => ({status:'failed'})));
  expect(await reconcileLegacyDerivationFailures(getDb(), next)).toBe(0);
});

it('leaves a bounded legacy backlog recoverable for the next existing sweep', async () => {
  for (let i = 0; i < 9; i++) await legacyDerivationFailure();
  expect(await reconcileLegacyDerivationFailures(getDb(), now)).toBe(8);
  const remaining = await getDb().execute(sql`SELECT j.id FROM background_jobs j WHERE ${legacyDerivationRecoveryEligible}`);
  expect(remaining).toHaveLength(1);
  expect(await reconcileLegacyDerivationFailures(getDb(), now)).toBe(1);
  expect(await reconcileLegacyDerivationFailures(getDb(), now)).toBe(0);
});

it('does not re-enter an ordinary derivation retry while its source has an unresolved provider dispatch', async () => {
  const target = await legacyDerivationFailure();
  await t.sql`UPDATE background_jobs SET status='pending', locked_at=NULL, attempts=1, last_error='provider_http_503',
    run_after=${now.toISOString()} WHERE id=${target.jobId}`;
  await blockLegacyDispatch(target, 'received');
  expect(await drainBackgroundJobs({now, limit: 1})).toMatchObject({failed: 1, retried: 0});
  expect((await t.sql`SELECT status,last_error,payload->>'failureDisposition' AS disposition
    FROM background_jobs WHERE id=${target.jobId}`)[0]).toEqual({
    status: 'failed', last_error: 'embedding_outcome_unknown', disposition: 'ambiguous',
  });
});

it.each([
  [new Error('Synthetic lock conflict', {cause: {code:'55P03'}}), 'exhausted'],
  [new BackgroundJobHeldError(new Date(now.getTime() + 60_000), 'Synthetic unresolved work'), 'ambiguous'],
] as const)('stops a released legacy job after its one metered processor entry', async (error, disposition) => {
  const target = await legacyDerivationFailure();
  expect(await reconcileLegacyDerivationFailures(getDb(), now)).toBe(1);
  const due = new Date(now.getTime() + 30_000);
  const processor = vi.fn(async () => { throw error; });
  expect(await drainBackgroundJobs({now: due, processor, limit: 1})).toMatchObject({failed: 1, held: 0, retried: 0});
  expect(await reconcileLegacyDerivationFailures(getDb(), due)).toBe(0);
  expect(await t.sql`SELECT status, attempts, payload->>'failureDisposition' AS disposition
    FROM background_jobs WHERE id=${target.jobId}`).toEqual([{ status: 'failed', attempts: 3, disposition }]);
  expect(await t.sql`SELECT id FROM background_job_runs WHERE job_id=${target.jobId}`).toHaveLength(4);
  expect(processor).toHaveBeenCalledOnce();
});

it('previews and grants at most one extra claim for an exact pre-dispatch reply with a retryable database failure', async () => {
  const profileId = await owner();
  const foreignProfile = await owner();
  const [{ account_id: accountId }] = await t.sql`SELECT account_id FROM profiles WHERE id = ${profileId}`;
  const [{ account_id: foreignAccount }] = await t.sql`SELECT account_id FROM profiles WHERE id = ${foreignProfile}`;
  const conversationId = randomUUID(), userMessageId = randomUUID(), replyRequestId = randomUUID();
  await t.sql`INSERT INTO conversations (id, profile_id, revision) VALUES (${conversationId}, ${profileId}, 1)`;
  await t.sql`INSERT INTO conversation_messages (id, profile_id, conversation_id, position, role, content)
    VALUES (${userMessageId}, ${profileId}, ${conversationId}, 1, 'user', 'Synthetic saved turn')`;
  const failure = '{"category":"database","code":"40001"}';
  const [{ id: jobId }] = await t.sql`INSERT INTO background_jobs
    (profile_id, type, status, attempts, max_attempts, payload, idempotency_key, last_error, locked_at)
    VALUES (${profileId}, 'generate_conversation_reply', 'failed', 3, 3,
      ${JSON.stringify({ conversationId, replyRequestId })}::jsonb,
      ${`generate_conversation_reply:${profileId}:${replyRequestId}`}, ${failure}, clock_timestamp())
    RETURNING id`;
  await t.sql`INSERT INTO conversation_reply_requests
    (id, profile_id, conversation_id, user_message_id, job_id, conversation_revision, context_hash)
    VALUES (${replyRequestId}, ${profileId}, ${conversationId}, ${userMessageId}, ${jobId}, 1, 'fixture')`;
  const target = { accountId, profileId, jobId, replyRequestId, requestVersion: '1' };
  const db = getDb();
  const refused = { eligible: false, queued: false };
  const initial = await t.sql`SELECT * FROM background_jobs WHERE id = ${jobId}`;
  expect(await inspectQueueRedrive(db, target)).toEqual({ eligible: true, queued: false });
  expect(await inspectQueueRedrive(db, { ...target, accountId: foreignAccount }, true)).toEqual(refused);
  expect(await inspectQueueRedrive(db, { ...target, requestVersion: '2' }, true)).toEqual(refused);
  await t.sql`UPDATE background_jobs SET last_error = 'provider_http_503' WHERE id = ${jobId}`;
  expect(await inspectQueueRedrive(db, target, true)).toEqual(refused);
  await t.sql`UPDATE background_jobs SET last_error = ${failure} WHERE id = ${jobId}`;
  await t.sql`UPDATE conversation_reply_requests SET status = 'stopped' WHERE id = ${replyRequestId}`;
  expect(await inspectQueueRedrive(db, target, true)).toEqual(refused);
  await t.sql`UPDATE conversation_reply_requests SET status = 'pending' WHERE id = ${replyRequestId}`;
  await t.sql`UPDATE conversation_reply_requests SET retrieval_dispatched_at = now() WHERE id = ${replyRequestId}`;
  expect(await inspectQueueRedrive(db, target, true)).toEqual(refused);
  await t.sql`UPDATE conversation_reply_requests SET retrieval_dispatched_at = NULL, dispatched_at = now() WHERE id = ${replyRequestId}`;
  expect(await inspectQueueRedrive(db, target, true)).toEqual(refused);
  await t.sql`UPDATE conversation_reply_requests SET dispatched_at = NULL WHERE id = ${replyRequestId}`;
  await t.sql`UPDATE conversations SET revision = 2 WHERE id = ${conversationId}`;
  expect(await inspectQueueRedrive(db, target, true)).toEqual(refused);
  await t.sql`UPDATE conversations SET revision = 1 WHERE id = ${conversationId}`;
  expect(await t.sql`SELECT * FROM background_jobs WHERE id = ${jobId}`).toEqual(initial);

  const anotherConnection = postgres(connection, { max: 1, prepare: false });
  try {
    await anotherConnection.begin(async tx => {
      await tx`SELECT id FROM ${tx(t.schemaName)}.conversations WHERE id = ${conversationId} FOR UPDATE`;
      await expect(inspectQueueRedrive(db, target, true)).rejects.toMatchObject({ cause: { code: '55P03' } });
    });
  } finally { await anotherConnection.end(); }
  expect(await t.sql`SELECT * FROM background_jobs WHERE id = ${jobId}`).toEqual(initial);
  expect(await inspectQueueRedrive(db, target, true)).toEqual({ eligible: true, queued: true });
  expect(await inspectQueueRedrive(db, target, true)).toEqual(refused);
  expect((await t.sql`SELECT status, attempts, max_attempts, request_version::text, last_error FROM background_jobs WHERE id = ${jobId}`)[0])
    .toEqual({ status: 'pending', attempts: 3, max_attempts: 4, request_version: '1', last_error: failure });
});
it('counts only due supported work after grace, never scheduled waits or active leases',async()=>{
  const p=await owner();
  await t.sql`INSERT INTO background_jobs(profile_id,type,payload,status,run_after,locked_at,attempts,max_attempts) VALUES
    (${p},'derive_signals','{}','pending','2026-10-05T11:40:00Z',null,0,3),
    (${p},'refresh_top_of_mind','{}','pending','2026-10-06T12:00:00Z',null,0,3),
    (${p},'derive_signals','{}','pending','2026-10-05T11:58:00Z',null,0,3),
    (${p},'derive_signals','{}','running','2026-10-05T11:00:00Z','2026-10-05T11:50:00Z',1,3),
    (${p},'derive_signals','{}','running','2026-10-05T11:00:00Z','2026-10-05T11:35:00Z',1,3),
    (${p},'derive_signals','{}','running','2026-10-05T11:00:00Z','2026-10-05T11:40:00Z',3,3)`;
  expect(await readBackgroundJobRecoveryState(t.db as never,now)).toEqual({overdue:2,oldestOverdueMs:1200000,exhaustedLeases:1});
  expect((await t.sql`SELECT count(*)::int AS count FROM background_jobs WHERE status='pending'`)[0].count).toBe(3);
});
it('does not turn future work types into recovery candidates',async()=>{
  const p=await owner();await t.sql`ALTER TYPE background_job_type ADD VALUE 'future_recovery_test'`;
  await t.sql`INSERT INTO background_jobs(profile_id,type,payload,run_after) VALUES(${p},'future_recovery_test','{}','2026-10-05T10:00:00Z')`;
  expect(await readBackgroundJobRecoveryState(t.db as never,now)).toEqual({overdue:0,oldestOverdueMs:0,exhaustedLeases:0});
});
it('concurrent normal recovery drains never process the same durable job twice',async()=>{
  const p=await owner();await t.sql`INSERT INTO background_jobs(profile_id,type,payload,run_after) VALUES(${p},'derive_signals','{}','2026-10-05T10:00:00Z')`;
  const processor=vi.fn(async()=>{});
  await Promise.all([drainBackgroundJobs({limit:5,now,processor,overdueOnly:true}),drainBackgroundJobs({limit:5,now,processor,overdueOnly:true})]);
  expect(processor).toHaveBeenCalledOnce();
  expect((await t.sql`SELECT status,attempts FROM background_jobs`)[0]).toMatchObject({status:'succeeded',attempts:1});
});
it.each(['completed','claimed','deferred','exhausted'] as const)('does not claim a %s row selected by an older ranking snapshot',async change=>{
  const p=await owner();const [job]=await t.sql`INSERT INTO background_jobs(profile_id,type,payload,run_after) VALUES(${p},'derive_signals','{}','2026-10-05T10:00:00Z') RETURNING id`;
  const [schema]=await t.sql`SELECT oid::int AS id FROM pg_namespace WHERE nspname=${t.schemaName}`;
  const gate=postgres(connection,{max:1,prepare:false});
  let release!:()=>void,ready!:()=>void,renamed=false,view=false;
  const resume=new Promise<void>(resolve=>{release=resolve;}),locked=new Promise<void>(resolve=>{ready=resolve;});
  let holding:Promise<unknown>|undefined,claiming:Promise<unknown>|undefined;
  try{
    await t.sql.unsafe(`CREATE FUNCTION pause_recovery_claim() RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$ BEGIN PERFORM pg_advisory_xact_lock(${schema.id}, 17); RETURN true; END $$`);
    await t.sql`ALTER TABLE background_jobs RENAME TO recovery_claim_rows`;renamed=true;
    await t.sql`CREATE VIEW background_jobs AS SELECT * FROM recovery_claim_rows WHERE pause_recovery_claim()`;view=true;
    holding=gate.begin(async tx=>{await tx`SELECT pg_advisory_xact_lock(${schema.id},17)`;ready();await resume;});
    await locked;
    claiming=postgresBackgroundJobStore.claimNext(now);
    await vi.waitFor(async()=>{
      const [waiting]=await t.sql`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=${schema.id}::oid AND objid=17 AND NOT granted) AS waiting`;
      expect(waiting.waiting).toBe(true);
    },{timeout:3000,interval:10});
    // The claimant has its old snapshot but has not acquired the base-row lock.
    if(change==='completed')await t.sql`UPDATE recovery_claim_rows SET status='succeeded' WHERE id=${job.id}`;
    if(change==='claimed')await t.sql`UPDATE recovery_claim_rows SET status='running',locked_at=${now.toISOString()} WHERE id=${job.id}`;
    if(change==='deferred')await t.sql`UPDATE recovery_claim_rows SET run_after=${new Date(now.getTime()+3600000).toISOString()} WHERE id=${job.id}`;
    if(change==='exhausted')await t.sql`UPDATE recovery_claim_rows SET status='running',locked_at='2026-10-05T10:00:00Z',attempts=max_attempts WHERE id=${job.id}`;
    release();await holding;
    expect(await claiming).toBeNull();
    expect((await t.sql`SELECT status,attempts FROM recovery_claim_rows WHERE id=${job.id}`)[0]).toEqual({status:change==='completed'?'succeeded':change==='deferred'?'pending':'running',attempts:change==='exhausted'?3:0});
  }finally{
    release();await holding;await claiming?.catch(()=>{});await gate.end();
    if(view)await t.sql`DROP VIEW background_jobs`;
    if(renamed)await t.sql`ALTER TABLE recovery_claim_rows RENAME TO background_jobs`;
    await t.sql`DROP FUNCTION IF EXISTS pause_recovery_claim()`;
  }
});
it('normal account budgets defer overdue work without processing or changing its identity',async()=>{
  const p=await owner();await t.sql`INSERT INTO background_jobs(profile_id,type,payload,status,started_at,run_after)
    SELECT ${p},'derive_signals','{}','succeeded','2026-10-05T11:30:00Z','2026-10-05T11:00:00Z' FROM generate_series(1,60)`;
  const [job]=await t.sql`INSERT INTO background_jobs(profile_id,type,payload,run_after) VALUES(${p},'derive_signals','{}','2026-10-05T10:00:00Z') RETURNING id`;
  const processor=vi.fn(async()=>{}),result=await drainBackgroundJobs({limit:5,now,processor,overdueOnly:true});
  expect(processor).not.toHaveBeenCalled();expect(result).toMatchObject({claimed:0,deferred:1});
  const [held]=await t.sql`SELECT id,status,attempts,run_after FROM background_jobs WHERE id=${job.id}`;
  expect(held).toMatchObject({id:job.id,status:'pending',attempts:0});expect(new Date(held.run_after).getTime()).toBeGreaterThan(now.getTime());
  expect((await readBackgroundJobRecoveryState(t.db as never,now)).overdue).toBe(0);
});
it('the recovery selector skips newly due work and active leases while preserving normal wake-up behavior',async()=>{
  const p=await owner();await t.sql`INSERT INTO background_jobs(profile_id,type,payload,status,run_after,locked_at) VALUES
    (${p},'derive_signals','{}','pending','2026-10-05T11:58:00Z',null),
    (${p},'derive_signals','{}','running','2026-10-05T10:00:00Z','2026-10-05T11:50:00Z')`;
  const processor=vi.fn(async()=>{});expect(await drainBackgroundJobs({limit:5,now,processor,overdueOnly:true})).toMatchObject({claimed:0});
  expect(processor).not.toHaveBeenCalled();
  expect(await drainBackgroundJobs({limit:5,now,processor})).toMatchObject({claimed:1,succeeded:1});
  expect(processor).toHaveBeenCalledOnce();
});
it('the daily sweep settles only final-attempt leases no live worker can hold, keeping a requested rerun',async()=>{
  /* 2026-10-04T11:00 is 25 h before `now`; 11:00 today is 1 h — well past the
     15-minute stale interval, yet inside the margin a slow worker may use */
  const p=await owner();
  const rows=await t.sql`INSERT INTO background_jobs(profile_id,type,payload,status,run_after,locked_at,attempts,max_attempts,rerun_requested,request_version) VALUES
    (${p},'derive_signals','{"n":"crashed"}','running','2026-10-04T10:00:00Z','2026-10-04T11:00:00Z',3,3,false,1),
    (${p},'derive_signals','{"n":"rerun"}','running','2026-10-04T10:00:00Z','2026-10-04T11:00:00Z',3,3,true,2),
    (${p},'derive_signals','{"n":"slow"}','running','2026-10-05T10:00:00Z','2026-10-05T11:00:00Z',3,3,false,1),
    (${p},'derive_signals','{"n":"reclaimable"}','running','2026-10-04T10:00:00Z','2026-10-04T11:00:00Z',1,3,false,1)
    RETURNING id,payload->>'n' AS n`;
  const id=Object.fromEntries(rows.map(row=>[row.n,row.id]));
  const read=async(n:string)=>(await t.sql`SELECT status,attempts,rerun_requested,request_version::int AS version,last_error,locked_at FROM background_jobs WHERE id=${id[n]}`)[0]!;
  expect(await settleAbandonedExhaustedLeases(t.db as never,now)).toBe(2);
  expect(await read('crashed')).toMatchObject({status:'failed',attempts:3,rerun_requested:false});
  expect((await read('crashed')).last_error).toContain('abandoned_lease');
  // the newer request becomes one normal run, not the poison attempt revived
  expect(await read('rerun')).toMatchObject({status:'pending',attempts:0,rerun_requested:false,version:2,last_error:null,locked_at:null});
  expect(await read('slow'),'inside the margin: a live worker may still finish it').toMatchObject({status:'running',attempts:3});
  expect(await read('reclaimable'),'the claim reclaims it; not this sweep').toMatchObject({status:'running',attempts:1});
  expect(await settleAbandonedExhaustedLeases(t.db as never,now),'idempotent').toBe(0);
  expect((await readBackgroundJobRecoveryState(t.db as never,now)).exhaustedLeases).toBe(1);
  const processor=vi.fn(async()=>{});
  expect(await drainBackgroundJobs({limit:5,now,processor})).toMatchObject({claimed:2,succeeded:2});
  expect((await read('crashed')).status,'terminal until a new request').toBe('failed');
});
describe('malformed model output: one retry per request version, then a distinct terminal failure',()=>{
  const malformed=()=>new MalformedModelOutputError('signal extraction');
  const hour=3600000;
  async function job(maxAttempts:number){
    const p=await owner();
    const [row]=await t.sql`INSERT INTO background_jobs(profile_id,type,payload,run_after,max_attempts)
      VALUES(${p},'derive_signals','{}','2026-10-05T11:00:00Z',${maxAttempts}) RETURNING id`;
    return {row:async()=>(await t.sql`SELECT status,attempts,last_error,request_version::int AS version,malformed_retry_version::int AS spent FROM background_jobs WHERE id=${row.id}`)[0]!,id:row.id as string};
  }
  it('pays for two calls, never the full budget',async()=>{
    const j=await job(3),processor=vi.fn(async()=>{throw malformed();});
    expect(await drainBackgroundJobs({limit:5,now,processor})).toMatchObject({claimed:1,retried:1,failed:0});
    expect(await j.row()).toMatchObject({status:'pending',attempts:1,spent:1});
    expect(await drainBackgroundJobs({limit:5,now:new Date(now.getTime()+hour),processor})).toMatchObject({claimed:1,retried:0,failed:1});
    const settled=await j.row();
    expect(settled).toMatchObject({status:'failed',attempts:2});
    expect(settled.last_error).toContain('malformed_model_output');
    expect(await drainBackgroundJobs({limit:5,now:new Date(now.getTime()+2*hour),processor})).toMatchObject({claimed:0});
    expect(processor,'never a third call').toHaveBeenCalledTimes(2);
  });
  it('an unrelated failure in between neither resets nor spends the malformed retry',async()=>{
    const j=await job(5);let call=0;
    const processor=vi.fn(async()=>{call+=1;throw call===2?new Error('Synthetic serialization rollback', {cause: {code:'40001'}}):malformed();});
    for(let pass=0;pass<3;pass+=1)await drainBackgroundJobs({limit:5,now:new Date(now.getTime()+pass*hour),processor});
    expect(processor).toHaveBeenCalledTimes(3);
    const settled=await j.row();
    expect(settled).toMatchObject({status:'failed',attempts:3,spent:1});
    expect(settled.last_error).toContain('malformed_model_output');
  });
  it('a newer request version earns its own single retry',async()=>{
    const j=await job(5),processor=vi.fn(async()=>{throw malformed();});
    await drainBackgroundJobs({limit:5,now,processor});
    expect(await j.row()).toMatchObject({status:'pending',spent:1,version:1});
    // what enqueueKeyedJob does to a pending row when an edit lands: the version moves
    await t.sql`UPDATE background_jobs SET request_version=request_version+1 WHERE id=${j.id}`;
    expect(await drainBackgroundJobs({limit:5,now:new Date(now.getTime()+hour),processor})).toMatchObject({retried:1,failed:0});
    expect(await j.row()).toMatchObject({status:'pending',spent:2,version:2});
    expect(await drainBackgroundJobs({limit:5,now:new Date(now.getTime()+2*hour),processor})).toMatchObject({retried:0,failed:1});
    expect(processor).toHaveBeenCalledTimes(3);
  });
});
