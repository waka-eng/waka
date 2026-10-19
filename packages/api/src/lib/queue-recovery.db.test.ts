/** WHAT THIS MOCKS, AND WHY: `processor` completes jobs without model calls.
 * The real recovery query, budgets, claims and completion run on Postgres. */
import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/db.js';
import {readBackgroundJobRecoveryState,drainBackgroundJobs,postgresBackgroundJobStore} from './queue.js';
import {getDb} from './db.js';
import postgres from 'postgres';
let t:TestDatabase;
const now=new Date('2026-10-05T12:00:00Z');
const connection=process.env.DB_CONNECTION_URL!;
beforeAll(async()=>{t=await createTestDatabase();const url=new URL(connection);url.searchParams.set('options',`-c search_path=${t.schemaName}`);process.env.DB_CONNECTION_URL=url.toString();});beforeEach(async()=>{await t.truncateAll();});afterAll(async()=>{await getDb().$client.end();await t?.cleanup();process.env.DB_CONNECTION_URL=connection;});
async function owner(){const [a]=await t.sql`INSERT INTO accounts(email) VALUES(${randomUUID()+'@example.test'}) RETURNING id`;const [p]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${a.id},'human','Synthetic recovery') RETURNING id`;return p.id;}
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
