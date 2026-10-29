/** WHAT THIS MOCKS, AND WHY (gate G6)
 * `./db.js` supplies controlled queue snapshots. `@aws-sdk/client-scheduler`
 * records commands without AWS credentials. Real eligibility/races use SQL.
 * `console.warn` is inspected for safe failure visibility without private data.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ execute: vi.fn(), send: vi.fn() }));
vi.mock('./db.js', () => ({ getDb: () => ({ execute: state.execute }) }));
vi.mock('@aws-sdk/client-scheduler', () => ({
  SchedulerClient: class { send = state.send; },
  CreateScheduleCommand: class CreateScheduleCommand { constructor(readonly input: unknown) {} },
  DeleteScheduleCommand: class DeleteScheduleCommand { constructor(readonly input: unknown) {} },
}));
import { backgroundJobWakeInput, readBackgroundJobWake, armBackgroundJobLease, cancelBackgroundJobLease,
  cancelBackgroundJobWakes, prepareBackgroundJobWake, recoverBackgroundJobWakes } from './background-job-wake.js';
import type { BackgroundJob } from '../db/index.js';
const profileId = '22222222-2222-4222-8222-222222222222';
const pending = { kind: 'pending' as const, profileId, token: '33333333-3333-4333-8333-333333333333', runAfter: '2026-10-29T12:00:00.000001Z' };
const lease = { kind: 'lease' as const, id: '11111111-1111-4111-8111-111111111111', profileId,
  requestVersion: '2', lockedAt: '2026-10-29T12:00:00.000000Z', attempt: 1 };
const job = { id: lease.id, profileId, requestVersion: 2n, lockedAt: new Date(lease.lockedAt), attempts: 1 } as BackgroundJob;
const enable = () => { vi.stubEnv('WAKA_BACKGROUND_JOB_WAKE_ROLE', 'role'); vi.stubEnv('WAKA_BACKGROUND_JOB_WAKE_GROUP', 'group'); };
beforeEach(() => { state.execute.mockReset().mockResolvedValue([]); state.send.mockReset().mockResolvedValue({}); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it('uses only self-deleting at schedules and rounds past SQL precision and strict lease expiry', () => {
  const input = backgroundJobWakeInput(pending, 'worker', 'role', 'group', new Date('2026-10-29T10:00:00Z'));
  expect(input.ScheduleExpression).toBe('at(2026-10-29T12:00:01)'); expect(input.ActionAfterCompletion).toBe('DELETE');
  expect(JSON.parse(input.Target!.Input!)).toEqual({ mode: 'job_wake', wake: pending });
  const watchdog = backgroundJobWakeInput(lease, 'worker', 'role', 'group', new Date(lease.lockedAt));
  expect(watchdog.ScheduleExpression).toBe('at(2026-10-29T12:15:01)');
  expect(backgroundJobWakeInput({ ...lease, attempt: 2 }, 'worker', 'role', 'group').Name).not.toBe(watchdog.Name);
  expect(backgroundJobWakeInput(pending, 'worker', 'role', 'group').Name).toBe(input.Name);
  expect(backgroundJobWakeInput({ token: pending.token, runAfter: pending.runAfter, profileId, kind: 'pending' }, 'worker', 'role', 'group').Name).toBe(input.Name);
});
it.each([null, {}, { ...lease, profileId: 'wrong' }, { ...lease, attempt: 1e20 },
  { ...lease, requestVersion: '9223372036854775808' }, { ...pending, runAfter: '2026-02-30T12:00:00.000Z' }])('refuses malformed events before DB access: %j', async value => {
  expect(readBackgroundJobWake(value)).toBeNull(); expect(await prepareBackgroundJobWake(value)).toBe(false);
  expect(state.execute).not.toHaveBeenCalled();
});
it('creates no timers, schedules or queue reads without deployment configuration', async () => {
  await armBackgroundJobLease(job, 'worker'); await recoverBackgroundJobWakes('worker');
  await cancelBackgroundJobWakes([{ leaseWake: lease }]);
  expect(state.execute).not.toHaveBeenCalled(); expect(state.send).not.toHaveBeenCalled();
});
it('does not schedule again when recovery finds no work', async () => {
  enable(); await recoverBackgroundJobWakes('worker');
  expect(state.execute).toHaveBeenCalledTimes(2); expect(state.send).not.toHaveBeenCalled();
});
it('accepts an identical schedule conflict, but never invents a successful acknowledgement', async () => {
  enable(); state.send.mockRejectedValueOnce({ name: 'ConflictException' });
  state.execute.mockResolvedValue([{ id: lease.id }]); await armBackgroundJobLease(job, 'worker');
  expect(state.send).toHaveBeenCalledOnce(); expect(state.execute).toHaveBeenCalledOnce();
});
it('hands back an unspent claim when lease scheduling fails and logs no provider body', async () => {
  enable(); const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  state.send.mockRejectedValue(new Error('private provider body'));
  await expect(armBackgroundJobLease(job, 'worker')).rejects.toMatchObject({ reason: 'support' });
  expect(state.execute).not.toHaveBeenCalled(); expect(JSON.stringify(warn.mock.calls)).not.toContain('private');
});
it('cancels a just-created watchdog if the job disappears before acknowledgement', async () => {
  enable(); expect(await armBackgroundJobLease(job, 'worker')).toBe(false);
  expect(state.send.mock.calls.map(([command]) => command.constructor.name)).toEqual(['CreateScheduleCommand', 'DeleteScheduleCommand']);
});
it('retains the watchdog when settlement did not release the original lease', async () => {
  enable(); state.execute.mockResolvedValue([{ active: true }]);
  await cancelBackgroundJobLease(job); expect(state.send).not.toHaveBeenCalled();
  state.execute.mockResolvedValue([{ active: false }]);
  await cancelBackgroundJobLease(job); expect(state.send).toHaveBeenCalledOnce();
});
it('does not let failed cleanup overwrite completed work', async () => {
  enable(); const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  state.send.mockRejectedValue(new Error('private provider body'));
  await expect(cancelBackgroundJobWakes([{ leaseWake: lease }])).resolves.toBeUndefined();
  expect(warn).toHaveBeenCalled(); expect(JSON.stringify(warn.mock.calls)).not.toContain('private');
});
it('does not continue a full batch after its work settles during scheduling', async () => {
  enable(); state.execute.mockResolvedValueOnce(Array.from({ length: 50 }, () => ({ profile_id: profileId, run_after: pending.runAfter })));
  for (let i = 0; i < 50; i++) state.execute.mockResolvedValueOnce([{ id: lease.id }]);
  state.execute.mockResolvedValueOnce([]).mockResolvedValueOnce([{ present: false }]);
  await recoverBackgroundJobWakes('worker');
  expect(state.send.mock.calls.some(([command]) => command.input.Name.startsWith('waka-job-batch-'))).toBe(false);
});
it('continues once only while unarmed work remains, using at rather than a recurring expression', async () => {
  enable(); state.execute.mockResolvedValueOnce(Array.from({ length: 50 }, () => ({ profile_id: profileId, run_after: pending.runAfter })));
  for (let i = 0; i < 50; i++) state.execute.mockResolvedValueOnce([{ id: lease.id }]);
  state.execute.mockResolvedValueOnce([]).mockResolvedValueOnce([{ present: true }]);
  await recoverBackgroundJobWakes('worker');
  const batch = state.send.mock.calls.at(-1)![0].input;
  expect(batch.ScheduleExpression).toMatch(/^at\(/); expect(batch.ActionAfterCompletion).toBe('DELETE');
  expect(JSON.parse(batch.Target.Input)).toEqual({ mode: 'wake_recovery' });
});
