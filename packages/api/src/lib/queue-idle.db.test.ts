/** WHAT THIS MOCKS, AND WHY (gate G6)
 * `./db.js` binds queue queries to disposable Postgres; the processor never
 * calls a provider. Fake timers observe a scheduled drain without starting it.
 * The extra enum value represents a newer API talking to an older worker.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('./db.js', () => ({ getDb: () => state.db }));
import { drainBackgroundJobs, enqueueSignalReembed, postgresBackgroundJobStore, sweepBackgroundJobRuns } from './queue.js';
let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase(); state.db = t.db;
  await t.sql`ALTER TYPE background_job_type ADD VALUE 'future_worker_job'`;
});
beforeEach(async () => { await t.truncateAll(); vi.stubEnv('WAKA_BACKGROUND_JOB_AUTODRAIN', '0'); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
afterAll(async () => { await t?.cleanup(); });
async function fixture(type: string, attempts = 0) {
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES('idle-queue@example.test') RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${account.id},'human','Idle') RETURNING id`;
  await t.sql`INSERT INTO background_jobs(profile_id,type,payload,attempts,max_attempts)
    VALUES(${profile.id},${type}::background_job_type,'{}',${attempts},3)`;
  return { accountId: account.id as string, profileId: profile.id as string };
}
it('never starts a pending job after its attempt allowance is exhausted', async () => {
  await fixture('reembed_signal', 3);
  const processor = vi.fn(async () => {});
  expect(await drainBackgroundJobs({ processor, limit: 1 })).toMatchObject({ claimed: 0 });
  expect(processor).not.toHaveBeenCalled();
  expect((await t.sql`SELECT attempts,status FROM background_jobs`)[0]).toEqual({ attempts: 3, status: 'pending' });
});
it('does not schedule an idle local drain for work this worker cannot process', async () => {
  await fixture('future_worker_job');
  await t.sql`INSERT INTO background_jobs(profile_id,type,payload,attempts,max_attempts)
    SELECT profile_id,'reembed_signal','{}',3,3 FROM background_jobs LIMIT 1`;
  vi.stubEnv('WAKA_BACKGROUND_JOB_AUTODRAIN', '1');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const timers = vi.spyOn(globalThis, 'setTimeout');
  await drainBackgroundJobs({ limit: 0 });
  expect(timers.mock.calls.filter(([, delay]) => Number(delay) <= 1000)).toHaveLength(0);
  await t.sql`INSERT INTO background_jobs(profile_id,type,payload,run_after)
    SELECT profile_id,'reembed_signal','{}',now()+interval '10 minutes' FROM background_jobs LIMIT 1`;
  await drainBackgroundJobs({ limit: 0 });
  await drainBackgroundJobs({ limit: 0 });
  expect(timers.mock.calls.filter(([, delay]) => Number(delay) > 500_000 && Number(delay) < 610_000)).toHaveLength(1);
});

it('counts repeated starts of one keyed job and retains that cost after its profile is removed', async () => {
  const f = await fixture('reembed_signal');
  await t.sql`DELETE FROM background_jobs`;
  const signalId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const since = new Date(Date.now() - 3_600_000);
  const first = await enqueueSignalReembed(f.profileId, signalId);
  const job1 = await postgresBackgroundJobStore.claimNext(new Date(Date.now() + 50));
  expect(job1).not.toBeNull(); await postgresBackgroundJobStore.markSucceeded(job1!, null);
  const second = await enqueueSignalReembed(f.profileId, signalId);
  expect(second.jobId).toBe(first.jobId);
  const job2 = await postgresBackgroundJobStore.claimNext(new Date(Date.now() + 100));
  expect(job2).not.toBeNull(); await postgresBackgroundJobStore.markSucceeded(job2!, null);
  expect((await postgresBackgroundJobStore.usageForAccount(f.accountId, since)).startedInWindow).toBe(2);
  await t.sql`DELETE FROM profiles WHERE id=${f.profileId}`;
  expect((await postgresBackgroundJobStore.usageForAccount(f.accountId, since)).startedInWindow).toBe(2);
  await t.sql`DELETE FROM accounts WHERE id=${f.accountId}`;
  expect(await t.sql`SELECT id FROM background_job_runs WHERE account_id=${f.accountId}`).toHaveLength(0);
});
it('hands back only the held claim, preserving the cost of its earlier failed attempt', async () => {
  const f = await fixture('reembed_signal');
  const now = new Date(Date.now() + 50), since = new Date(now.getTime() - 3_600_000);
  const first = await postgresBackgroundJobStore.claimNext(now);
  await postgresBackgroundJobStore.markFailedOrPending(first!, new Error('Synthetic transport failure'), false, now);
  const second = await postgresBackgroundJobStore.claimNext(new Date(now.getTime() + 31_000));
  expect(second).not.toBeNull();
  await postgresBackgroundJobStore.holdJob(second!, new Date(now.getTime() + 120_000));
  expect((await postgresBackgroundJobStore.usageForAccount(f.accountId, since)).startedInWindow).toBe(1);
});

it('reaps only old usage records when maintenance is explicitly invoked', async () => {
  const f = await fixture('reembed_signal');
  await t.sql`INSERT INTO background_job_runs(account_id,job_id,attempt,started_at)
    VALUES(${f.accountId},gen_random_uuid(),1,now()-interval '3 days'),
      (${f.accountId},gen_random_uuid(),1,now()-interval '1 hour')`;
  expect(await sweepBackgroundJobRuns(t.db as never)).toBe(1);
  expect(await t.sql`SELECT id FROM background_job_runs`).toHaveLength(1);
});
