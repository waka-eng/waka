/** WHAT THIS MOCKS, AND WHY: processors finish/fail without provider calls.
 * Real retry settlement, eligibility, budgets, holds and concurrent claims
 * run on disposable Postgres. AWS redelivery itself is a documented contract,
 * not a measured cloud claim; handler signaling has separate unit coverage. */
import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/db.js';
import {getDb} from './db.js';
import {BackgroundJobHeldError} from './background-job-hold.js';
import {drainBackgroundJobs,hasNearTermBackgroundJobRetry,hasNearTermRequestedReading,collectReadingWakeReferences,enqueueTopOfMindRefresh,postgresBackgroundJobStore,type BackgroundJobRetryWake} from './queue.js';
let t:TestDatabase;
const connection=process.env.DB_CONNECTION_URL!;
const now=new Date('2026-10-06T12:00:00Z');
const later=(seconds:number)=>new Date(now.getTime()+seconds*1000);
beforeAll(async()=>{t=await createTestDatabase();const url=new URL(connection);url.searchParams.set('options',`-c search_path=${t.schemaName}`);process.env.DB_CONNECTION_URL=url.toString();});
beforeEach(async()=>{await t.truncateAll();});
afterAll(async()=>{await getDb().$client.end();await t?.cleanup();process.env.DB_CONNECTION_URL=connection;});
async function fixture(attempts=0,maxAttempts=5){
  const [account]=await t.sql`INSERT INTO accounts(email) VALUES(${randomUUID()+'@example.test'}) RETURNING id`;
  const [profile]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${account.id},'human','Synthetic retry') RETURNING id`;
  const [job]=await t.sql`INSERT INTO background_jobs(profile_id,type,payload,run_after,attempts,max_attempts) VALUES(${profile.id},'derive_signals','{}',${now.toISOString()},${attempts},${maxAttempts}) RETURNING id`;
  return {id:job.id as string,profileId:profile.id as string,accountId:account.id as string};
}
it('wakes only the requested unread reading near its due time, without replaying another job',async()=>{
  const job=await fixture();await t.sql`UPDATE background_jobs SET type='refresh_top_of_mind',run_after=${later(17).toISOString()},request_version=2,completed_version=0 WHERE id=${job.id}`;
  const wake={id:job.id,profileId:job.profileId,requestVersion:'2'};
  expect(await hasNearTermRequestedReading([wake],t.db as never,now)).toBe(true);
  expect(await hasNearTermRequestedReading([{...wake,id:randomUUID()}],t.db as never,now)).toBe(false);
  expect(await hasNearTermRequestedReading([{...wake,profileId:randomUUID()}],t.db as never,now)).toBe(false);
  await t.sql`UPDATE background_jobs SET request_version=3,completed_version=2 WHERE id=${job.id}`;
  expect(await hasNearTermRequestedReading([wake],t.db as never,now)).toBe(true);
  await t.sql`UPDATE background_jobs SET request_version=2 WHERE id=${job.id}`;
  await t.sql`UPDATE background_jobs SET completed_version=2 WHERE id=${job.id}`;
  expect(await hasNearTermRequestedReading([wake],t.db as never,now)).toBe(false);
});
it('tracks only readings actually enqueued in a drain, and refuses a rolled-back follow-up',async()=>{
  const job=await fixture();
  const collected=await collectReadingWakeReferences(()=>enqueueTopOfMindRefresh(job.profileId,'signals_changed',t.db as never));
  expect(collected.wakes).toEqual([{id:collected.result.jobId,profileId:job.profileId,requestVersion:collected.result.requestVersion}]);
  expect(await hasNearTermRequestedReading(collected.wakes,t.db as never,new Date())).toBe(true);
  const other=await fixture();const rolled=await collectReadingWakeReferences(async()=>{
    try{await t.db.transaction(async tx=>{await enqueueTopOfMindRefresh(other.profileId,'signals_changed',tx as never);throw Error('Synthetic rollback');});}catch(error){expect((error as Error).message).toBe('Synthetic rollback');}
  });
  expect(rolled.wakes).toHaveLength(1);expect(await hasNearTermRequestedReading(rolled.wakes,t.db as never,new Date())).toBe(false);
});
it('leaves running, exhausted and next-day reading work to its existing lease/recovery policy',async()=>{
  const job=await fixture();const wake={id:job.id,profileId:job.profileId,requestVersion:'1'};
  await t.sql`UPDATE background_jobs SET type='refresh_top_of_mind',run_after=${later(86400).toISOString()} WHERE id=${job.id}`;
  expect(await hasNearTermRequestedReading([wake],t.db as never,now)).toBe(false);
  await t.sql`UPDATE background_jobs SET run_after=${now.toISOString()},status='running',locked_at=${now.toISOString()} WHERE id=${job.id}`;
  expect(await hasNearTermRequestedReading([wake],t.db as never,now)).toBe(false);
  await t.sql`UPDATE background_jobs SET status='pending',locked_at=NULL,attempts=max_attempts WHERE id=${job.id}`;
  expect(await hasNearTermRequestedReading([wake],t.db as never,now)).toBe(false);
});
async function fail(){
  const retries:BackgroundJobRetryWake[]=[];
  const result=await drainBackgroundJobs({now,limit:1,processor:async()=>{throw new Error('Synthetic transport failure');},onTransientRetry:retry=>{retries.push(retry);}});
  return {retries,result};
}
const pending=(retries:BackgroundJobRetryWake[],at=now)=>hasNearTermBackgroundJobRetry(retries,t.db as never,at);
it('wakes a real transient retry, obeys its due time and completes it only once across duplicate deliveries',async()=>{
  await fixture();const {retries,result}=await fail();
  expect(result).toMatchObject({retried:1});expect(retries).toHaveLength(1);expect(retries[0].runAfter).toEqual(later(30));expect(await pending(retries)).toBe(true);
  const processor=vi.fn(async()=>{});
  expect(await drainBackgroundJobs({now:later(29),processor})).toMatchObject({claimed:0});
  await Promise.all([drainBackgroundJobs({now:later(30),processor}),drainBackgroundJobs({now:later(30),processor})]);
  expect(processor).toHaveBeenCalledOnce();expect(await pending(retries,later(30))).toBe(false);
  expect(await drainBackgroundJobs({now:later(31),processor})).toMatchObject({claimed:0});expect(processor).toHaveBeenCalledOnce();
});
it('ignores budget deferral even when the row retains its earlier error',async()=>{
  const job=await fixture(),{retries}=await fail();
  await postgresBackgroundJobStore.deferAccountBacklog({accountId:job.accountId,now:later(31),until:later(90)});
  expect((await t.sql`SELECT last_error FROM background_jobs WHERE id=${job.id}`)[0].last_error).not.toBeNull();
  expect(await pending(retries,later(31))).toBe(false);
});
it.each(['cadence','support'] as const)('ignores %s holds and hands back the claim attempt',async reason=>{
  await fixture();const {retries}=await fail();
  const result=await drainBackgroundJobs({now:later(30),processor:async()=>{throw new BackgroundJobHeldError(later(90),'Synthetic wait',reason);}});
  expect(result).toMatchObject({held:1,retried:0});expect(await pending(retries,later(30))).toBe(false);
  expect((await t.sql`SELECT attempts,last_error FROM background_jobs`)[0]).toMatchObject({attempts:1,last_error:null});
});
it('ignores stale hints after another worker claims the job, without touching its lease',async()=>{
  await fixture();const {retries}=await fail(),claimed=await postgresBackgroundJobStore.claimNext(later(30));
  expect(claimed).not.toBeNull();expect(await pending(retries,later(30))).toBe(false);
  expect((await t.sql`SELECT status,attempts FROM background_jobs`)[0]).toEqual({status:'running',attempts:2});
});
it('ignores source reruns and mismatched profile hints',async()=>{
  const job=await fixture(),{retries}=await fail();
  expect(await pending([{...retries[0],profileId:randomUUID()}])).toBe(false);
  await t.sql`UPDATE background_jobs SET attempts=0,last_error=null,updated_at=${later(1).toISOString()},run_after=${later(1).toISOString()} WHERE id=${job.id}`;
  expect(await pending(retries)).toBe(false);
});
it('does not signal an exhausted attempt or a stale settlement whose ownership was lost',async()=>{
  await fixture(0,1);const exhausted=await fail();expect(exhausted.result).toMatchObject({failed:1,retried:0});expect(exhausted.retries).toEqual([]);
  const job=await fixture();const retries:BackgroundJobRetryWake[]=[];
  await drainBackgroundJobs({now,limit:1,onTransientRetry:retry=>{retries.push(retry);},processor:async()=>{
    await t.sql`UPDATE background_jobs SET status='succeeded',locked_at=null WHERE id=${job.id}`;
    throw new Error('Stale worker failed after losing ownership');
  }});
  expect(retries).toHaveLength(1);expect(await pending(retries)).toBe(false);
});
it('leaves longer exponential backoff to recovery rather than manufacturing repeated immediate wakes',async()=>{
  await fixture(3);const {retries}=await fail();expect(retries[0].runAfter).toEqual(later(240));expect(await pending(retries)).toBe(false);
});
