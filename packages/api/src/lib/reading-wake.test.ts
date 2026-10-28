/** AWS transport is replaced; real queue ownership/due-time remains covered by SQL tests. */
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ execute: vi.fn(), send: vi.fn() }));
vi.mock('./db.js', () => ({ getDb: () => ({ execute: state.execute }) }));
vi.mock('@aws-sdk/client-scheduler', () => ({ SchedulerClient: class { send = state.send; }, CreateScheduleCommand: class { constructor(readonly input: unknown) {} } }));
import { readingWakeInput, scheduleDeferredReadings, recoverDeferredReadingWakes } from './reading-wake.js';
const wake = { id: '11111111-1111-4111-8111-111111111111', profileId: '22222222-2222-4222-8222-222222222222', requestVersion: '2' };
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
it('schedules at or after the deadline, deduplicates it, deletes on completion and sends identifiers only', () => {
  const input = readingWakeInput({ ...wake, runAfter: '2026-10-29T12:00:00.123Z' }, 'worker', 'role', 'group');
  expect(input.ScheduleExpression).toBe('at(2026-10-29T12:00:01)');
  expect(input.ActionAfterCompletion).toBe('DELETE');
  expect(input.Target.RetryPolicy.MaximumRetryAttempts).toBe(5);
  expect(JSON.parse(input.Target.Input)).toEqual({ mode: 'enqueue', wakes: [wake] });
  expect(readingWakeInput({ ...wake, requestVersion: '3', runAfter: '2026-10-29T12:00:00.123Z' }, 'worker', 'role', 'group').Name).toBe(input.Name);
});
it('does nothing in local/tests and rejects malformed hints before reading the queue', async () => {
  await scheduleDeferredReadings([wake], 'worker'); expect(state.execute).not.toHaveBeenCalled();
  vi.stubEnv('WAKA_READING_WAKE_ROLE', 'role'); vi.stubEnv('WAKA_READING_WAKE_GROUP', 'group');
  await scheduleDeferredReadings([{ ...wake, profileId: 'not-a-profile' }], 'worker'); expect(state.execute).not.toHaveBeenCalled();
});
it('accepts a concurrent identical schedule, but surfaces transport failure for bounded worker retry', async () => {
  vi.stubEnv('WAKA_READING_WAKE_ROLE', 'role'); vi.stubEnv('WAKA_READING_WAKE_GROUP', 'group');
  state.execute.mockResolvedValue([{ id: wake.id, profile_id: wake.profileId, request_version: '3', run_after: '2026-10-29T12:00:00Z' }]);
  state.send.mockRejectedValueOnce({ name: 'ConflictException' }); await expect(scheduleDeferredReadings([wake], 'worker')).resolves.toBeUndefined();
  state.send.mockRejectedValueOnce(new Error('Unavailable')); await expect(scheduleDeferredReadings([wake], 'worker')).rejects.toThrow('Unavailable');
});
it('continues a full recovery batch without relying on more traffic, and stops when empty', async () => {
  vi.stubEnv('WAKA_READING_WAKE_ROLE', 'role'); vi.stubEnv('WAKA_READING_WAKE_GROUP', 'group');
  state.execute.mockReset().mockResolvedValueOnce(Array.from({ length: 50 }, () => ({
    id: wake.id, profile_id: wake.profileId, request_version: wake.requestVersion,
  }))).mockResolvedValueOnce([]); // Rows may settle while this recovery is running.
  state.send.mockReset().mockResolvedValue({});
  const earliest = Date.now() + 180_000;
  await recoverDeferredReadingWakes('worker');
  const input = state.send.mock.calls[0][0].input;
  expect(input.Name).toMatch(/^waka-reading-recovery-/);
  expect(JSON.parse(input.Target.Input)).toEqual({ mode: 'enqueue', wakes: [] });
  expect(Date.parse(input.ScheduleExpression.slice(3, -1) + 'Z')).toBeGreaterThanOrEqual(earliest);
  expect(input.ActionAfterCompletion).toBe('DELETE');
  state.execute.mockResolvedValue([]); await recoverDeferredReadingWakes('worker');
  expect(state.send).toHaveBeenCalledTimes(1);
});
