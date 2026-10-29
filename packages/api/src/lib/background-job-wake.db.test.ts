/** WHAT THIS MOCKS, AND WHY (gate G6)
 * `./db.js` binds actual queue queries to disposable Postgres.
 * `@aws-sdk/client-scheduler` captures timers without creating AWS resources.
 * Processors are scripted; deadlines, leases and publications use real SQL.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
const state = vi.hoisted(() => ({ db: null as unknown, send: vi.fn() }));
vi.mock('./db.js', () => ({ getDb: () => state.db }));
vi.mock('@aws-sdk/client-scheduler', () => ({ SchedulerClient: class { send = state.send; },
  CreateScheduleCommand: class CreateScheduleCommand { constructor(readonly input: unknown) {} },
  DeleteScheduleCommand: class DeleteScheduleCommand { constructor(readonly input: unknown) {} } }));
import { armBackgroundJobLease, cancelBackgroundJobLease, cancelBackgroundJobWakes, prepareBackgroundJobWake, recoverBackgroundJobWakes,
  type BackgroundJobWake, retireBackgroundJobWake } from './background-job-wake.js';
import { drainBackgroundJobs, postgresBackgroundJobStore } from './queue.js';
let t: TestDatabase;
const creates = () => state.send.mock.calls.filter(([command]) => command.constructor.name === 'CreateScheduleCommand');
const deletes = () => state.send.mock.calls.filter(([command]) => command.constructor.name === 'DeleteScheduleCommand');
const event = (index = 0): BackgroundJobWake => JSON.parse(creates()[index]![0].input.Target.Input).wake;
beforeAll(async () => { t = await createTestDatabase(); state.db = t.db; });
beforeEach(async () => {
  await t.truncateAll(); state.send.mockReset().mockResolvedValue({});
  vi.stubEnv('WAKA_BACKGROUND_JOB_AUTODRAIN', '0');
  vi.stubEnv('WAKA_BACKGROUND_JOB_WAKE_ROLE', 'role'); vi.stubEnv('WAKA_BACKGROUND_JOB_WAKE_GROUP', 'group');
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
afterAll(async () => { await t?.cleanup(); });
async function fixture(count = 1, type: 'human' | 'agent' = 'human') {
  const [a] = await t.sql`INSERT INTO accounts(email) VALUES('job-wakes@example.test') RETURNING id`;
  const [p] = await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${a.id},${type},'Owner') RETURNING id`;
  for (let i = 0; i < count; i++) await t.sql`INSERT INTO background_jobs(profile_id,type,payload,run_after)
    VALUES(${p.id},'reembed_signal','{}','2026-10-29T12:00:00.000001Z')`;
  return { accountId: a.id as string, profileId: p.id as string };
}
it('groups a large budget hold by profile/deadline and does not recreate acknowledged timers', async () => {
  await fixture(60); await recoverBackgroundJobWakes('worker');
  expect(creates()).toHaveLength(1); expect(event()).toMatchObject({ kind: 'pending', runAfter: '2026-10-29T12:00:00.000001Z' });
  expect((await t.sql`SELECT count(*)::int AS n FROM background_jobs WHERE payload ? 'pendingWake'`)[0]!.n).toBe(60);
  await recoverBackgroundJobWakes('worker'); expect(creates()).toHaveLength(1);
});
it('refuses early and mismatched-profile deliveries before any claim, then admits only due work', async () => {
  await fixture(); await recoverBackgroundJobWakes('worker'); const wake = event();
  expect(await prepareBackgroundJobWake(wake, new Date('2026-10-29T12:00:00Z'))).toBe(false);
  expect(await prepareBackgroundJobWake({ ...wake, profileId: randomUUID() }, new Date('2026-10-29T12:00:01Z'))).toBe(false);
  expect(await prepareBackgroundJobWake(wake, new Date('2026-10-29T12:00:01Z'))).toBe(true);
});
it('does not wake cancelled, exhausted, completed or rescheduled pending work', async () => {
  await fixture(); await recoverBackgroundJobWakes('worker'); const wake = event();
  for (const patch of ["status='succeeded'", "status='pending',attempts=max_attempts", "attempts=0,run_after=run_after+interval '1 day'"]) {
    await t.sql.unsafe(`UPDATE background_jobs SET ${patch}`);
    expect(await prepareBackgroundJobWake(wake, new Date('2026-11-01T12:00:01Z'))).toBe(false);
  }
  await t.sql`DELETE FROM background_jobs`; expect(await prepareBackgroundJobWake(wake)).toBe(false);
});
it('retains a shared timer until the last pending member is removed', async () => {
  await fixture(2); await recoverBackgroundJobWakes('worker'); const wake = event();
  const [one] = await t.sql`DELETE FROM background_jobs WHERE id=(SELECT id FROM background_jobs LIMIT 1) RETURNING payload`;
  await cancelBackgroundJobWakes([one!.payload]); expect(deletes()).toHaveLength(0);
  const [last] = await t.sql`DELETE FROM background_jobs RETURNING payload`;
  await cancelBackgroundJobWakes([last!.payload]); expect(deletes()).toHaveLength(1);
  expect(await prepareBackgroundJobWake(wake)).toBe(false);
});
it('cleans up a timer created during a concurrent deletion rather than acknowledging nonexistent work', async () => {
  await fixture(); state.send.mockImplementationOnce(async () => { await t.sql`DELETE FROM background_jobs`; return {}; });
  await recoverBackgroundJobWakes('worker'); expect(creates()).toHaveLength(1); expect(deletes()).toHaveLength(1);
});
it('recovers schedule transport failure through later activity without an idle timer', async () => {
  await fixture(); state.send.mockRejectedValueOnce(new Error('Synthetic transport failure'));
  await expect(recoverBackgroundJobWakes('worker')).rejects.toThrow('Synthetic transport failure');
  expect((await t.sql`SELECT payload FROM background_jobs`)[0]!.payload).toEqual({});
  await recoverBackgroundJobWakes('worker'); expect(creates()).toHaveLength(2);
  await recoverBackgroundJobWakes('worker'); expect(creates()).toHaveLength(2);
});
it('arms an active lease once, does not cancel it on missed settlement, and cancels after success', async () => {
  await fixture(); const now = new Date('2026-10-29T12:00:01Z');
  const job = await postgresBackgroundJobStore.claimNext(now); expect(job).not.toBeNull();
  await armBackgroundJobLease(job!, 'worker'); const wake = event();
  await recoverBackgroundJobWakes('worker'); expect(creates()).toHaveLength(1);
  await cancelBackgroundJobLease(job!); expect(deletes()).toHaveLength(0);
  expect(await prepareBackgroundJobWake(wake, new Date(now.getTime() + 900_000))).toBe(false);
  await postgresBackgroundJobStore.markSucceeded(job!, null); await cancelBackgroundJobLease(job!);
  expect(deletes()).toHaveLength(1); expect(await prepareBackgroundJobWake(wake, new Date(now.getTime() + 901_000))).toBe(false);
});
it('reclaims a crashed lease once across duplicate deliveries and refuses the superseded watchdog', async () => {
  await fixture(); const now = new Date('2026-10-29T12:00:01Z'); const job = await postgresBackgroundJobStore.claimNext(now);
  await armBackgroundJobLease(job!, 'worker'); const wake = event(); const after = new Date(now.getTime() + 901_000);
  expect(await prepareBackgroundJobWake(wake, after)).toBe(true);
  const processor = vi.fn(async () => {});
  await Promise.all([drainBackgroundJobs({ now: after, limit: 1, processor }), drainBackgroundJobs({ now: after, limit: 1, processor })]);
  expect(processor).toHaveBeenCalledOnce(); expect(await prepareBackgroundJobWake(wake, after)).toBe(false);
});
it.each([false, true])('settles an expired final attempt without buying a fourth call; newer request = %s', async newer => {
  await fixture(); await t.sql`UPDATE background_jobs SET attempts=2`;
  const now = new Date('2026-10-29T12:00:01Z'), job = await postgresBackgroundJobStore.claimNext(now);
  await armBackgroundJobLease(job!, 'worker'); const wake = event();
  if (newer) await t.sql`UPDATE background_jobs SET request_version=request_version+1,rerun_requested=true`;
  expect(await prepareBackgroundJobWake(wake, new Date(now.getTime() + 901_000))).toBe(newer);
  const [row] = await t.sql`SELECT status,attempts,request_version::text FROM background_jobs`;
  expect(row).toMatchObject(newer ? { status: 'pending', attempts: 0, request_version: '2' } : { status: 'failed', attempts: 3 });
});
it('does not bypass an account budget when a pending deadline is delivered', async () => {
  const f = await fixture(); await recoverBackgroundJobWakes('worker'); const wake = event(); const now = new Date('2026-10-29T12:00:01Z');
  await t.sql`INSERT INTO background_job_runs(account_id,job_id,attempt,started_at)
    SELECT ${f.accountId},gen_random_uuid(),1,'2026-10-29T11:59:00Z' FROM generate_series(1,60)`;
  expect(await prepareBackgroundJobWake(wake, now)).toBe(true);
  const processor = vi.fn(async () => {}); expect(await drainBackgroundJobs({ now, processor })).toMatchObject({ claimed: 0, deferred: 1 });
  expect(processor).not.toHaveBeenCalled(); await recoverBackgroundJobWakes('worker'); expect(creates()).toHaveLength(2);
});

it('cancels the old deadline when a whole group moves, and keeps it when members remain', async () => {
  await fixture(2); await recoverBackgroundJobWakes('worker'); const old = event();
  await t.sql`UPDATE background_jobs SET run_after=run_after+interval '1 hour' WHERE id=(SELECT id FROM background_jobs LIMIT 1)`;
  await recoverBackgroundJobWakes('worker'); expect(creates()).toHaveLength(2); expect(deletes()).toHaveLength(0);
  await t.sql`UPDATE background_jobs SET run_after='2026-10-29T14:00:00Z'`;
  await recoverBackgroundJobWakes('worker'); expect(creates()).toHaveLength(3); expect(deletes()).toHaveLength(2);
  expect(await prepareBackgroundJobWake(old, new Date('2026-10-30T12:00:00Z'))).toBe(false);
});
it('returns an unspent attempt on scheduler outage without running the provider', async () => {
  await fixture(); const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  state.send.mockRejectedValue(new Error('Synthetic scheduler outage'));
  const processor = vi.fn(async () => {});
  expect(await drainBackgroundJobs({ now: new Date('2026-10-29T12:00:01Z'), limit: 1, processor,
    onClaimed: job => armBackgroundJobLease(job, 'worker').then(() => {}) })).toMatchObject({ held: 1, failed: 0 });
  expect(processor).not.toHaveBeenCalled();
  expect((await t.sql`SELECT status,attempts FROM background_jobs`)[0]).toEqual({ status: 'pending', attempts: 0 });
  expect(await t.sql`SELECT id FROM background_job_runs`).toHaveLength(0); warn.mockRestore();
});
it('account removal cancels recorded schedules after the erasure transaction', async () => {
  const f = await fixture(); await recoverBackgroundJobWakes('worker'); const wake = event();
  const { eraseAccount } = await import('./account-erasure.js');
  await eraseAccount(f.accountId, { db: t.db as never, deleteAttachmentObjects: async () => {} });
  expect(deletes()).toHaveLength(1); expect(await prepareBackgroundJobWake(wake)).toBe(false);
});
it('an owned agent removal cancels its schedules without changing the human session', async () => {
  const f = await fixture(1, 'agent'); await recoverBackgroundJobWakes('worker'); const wake = event();
  const [human] = await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${f.accountId},'human','Human') RETURNING id`;
  const { signSessionToken } = await import('./auth.js'); const { createSessionRow, lookupSession } = await import('./session.js');
  const token = await signSessionToken({ profileId: human!.id, email: 'job-wakes@example.test' });
  await createSessionRow({ profileId: human!.id, token });
  const { Hono } = await import('hono'); const { profilesRoutes } = await import('../routes/profiles.js');
  const app = new Hono().route('/api/profiles', profilesRoutes);
  expect((await app.request(`/api/profiles/${f.profileId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
  expect(deletes()).toHaveLength(1); expect(await prepareBackgroundJobWake(wake)).toBe(false);
  expect(await lookupSession(token)).not.toBeNull();
});
it('removing an inspiration cancels its source timer after committing the delete', async () => {
  const f = await fixture();
  const [source] = await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${f.profileId},'Synthetic timer source') RETURNING id`;
  await t.sql`UPDATE background_jobs SET type='derive_signals',payload=${JSON.stringify({ inspirationId: source!.id, reason: 'created' })}::jsonb`;
  await recoverBackgroundJobWakes('worker'); const wake = event();
  const { signSessionToken } = await import('./auth.js'); const { createSessionRow } = await import('./session.js');
  const token = await signSessionToken({ profileId: f.profileId, email: 'job-wakes@example.test' });
  await createSessionRow({ profileId: f.profileId, token });
  const { Hono } = await import('hono'); const { inspirationsRoutes } = await import('../routes/inspirations.js');
  const app = new Hono().route('/api/inspirations', inspirationsRoutes);
  expect((await app.request(`/api/inspirations/${source!.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
  expect(deletes()).toHaveLength(1); expect(await prepareBackgroundJobWake(wake)).toBe(false);
});

it('cancels only the losing timer across concurrent scheduling attempts', async () => {
  await fixture(); let arrivals = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  state.send.mockImplementation(async command => {
    if (command.constructor.name === 'CreateScheduleCommand') { if (++arrivals === 2) release(); await gate; }
    return {};
  });
  await Promise.all([recoverBackgroundJobWakes('worker'), recoverBackgroundJobWakes('worker')]);
  expect(creates()).toHaveLength(2); expect(deletes()).toHaveLength(1);
  const [row] = await t.sql`SELECT payload FROM background_jobs`;
  const active = row!.payload.pendingWake as BackgroundJobWake;
  expect(await prepareBackgroundJobWake(active, new Date('2026-10-29T12:00:01Z'))).toBe(true);
  if (active.kind !== 'pending') throw new Error('Expected a pending group');
  const stale = [event(0), event(1)].find(wake => wake.kind === 'pending' && wake.token !== active.token)!;
  expect(await prepareBackgroundJobWake(stale, new Date('2026-10-29T12:00:01Z'))).toBe(false);
});
it('cancellation cannot remove a newer group created during the delete request', async () => {
  const f = await fixture(); await recoverBackgroundJobWakes('worker'); const old = event();
  const [removed] = await t.sql`DELETE FROM background_jobs RETURNING payload`;
  state.send.mockImplementationOnce(async () => {
    await t.sql`INSERT INTO background_jobs(profile_id,type,payload,run_after)
      VALUES(${f.profileId},'reembed_signal','{}','2026-10-29T12:00:00.000001Z')`;
    await recoverBackgroundJobWakes('worker'); return {};
  });
  await cancelBackgroundJobWakes([removed!.payload]);
  expect(creates()).toHaveLength(2); expect(deletes()).toHaveLength(1);
  expect(await prepareBackgroundJobWake(old, new Date('2026-10-29T12:00:01Z'))).toBe(false);
  expect(await prepareBackgroundJobWake(event(1), new Date('2026-10-29T12:00:01Z'))).toBe(true);
});
it('retires a delivered group before scheduling a new one for unfinished work', async () => {
  await fixture(); await recoverBackgroundJobWakes('worker'); const old = event();
  await retireBackgroundJobWake(old); await recoverBackgroundJobWakes('worker');
  expect(creates()).toHaveLength(2); expect(deletes()).toHaveLength(1);
  expect(creates()[0]![0].input.Name).not.toBe(creates()[1]![0].input.Name);
  expect(await prepareBackgroundJobWake(old, new Date('2026-10-29T12:00:01Z'))).toBe(false);
});
it('does not run the provider after deletion wins the lease acknowledgement race', async () => {
  await fixture(); const job = await postgresBackgroundJobStore.claimNext(new Date('2026-10-29T12:00:01Z'));
  state.send.mockImplementationOnce(async () => { await t.sql`DELETE FROM background_jobs`; return {}; });
  expect(await armBackgroundJobLease(job!, 'worker')).toBe(false);
  expect(creates()).toHaveLength(1); expect(deletes()).toHaveLength(1);
});

it('coalesces later arrivals into a replacement timer for the same profile deadline', async () => {
  const f = await fixture(); await recoverBackgroundJobWakes('worker'); const old = event();
  await t.sql`INSERT INTO background_jobs(profile_id,type,payload,run_after)
    VALUES(${f.profileId},'reembed_signal','{}','2026-10-29T12:00:00.000001Z')`;
  await recoverBackgroundJobWakes('worker');
  expect(creates()).toHaveLength(2); expect(deletes()).toHaveLength(1);
  expect(await t.sql`SELECT DISTINCT payload->'pendingWake'->>'token' AS token FROM background_jobs`).toHaveLength(1);
  expect(await prepareBackgroundJobWake(old, new Date('2026-10-29T12:00:01Z'))).toBe(false);
  expect(await prepareBackgroundJobWake(event(1), new Date('2026-10-29T12:00:01Z'))).toBe(true);
});
