import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as jobWakes from './lib/background-job-wake.js';
import { handler, isScheduledEvent } from "./background-worker.js";
import { sweepStaleStagedAttachments } from "./lib/conversation-attachments.js";
import { sweepDeletedShelf } from "./lib/deleted-shelf.js";
import { runBackgroundJobWorker,readBackgroundJobRecoveryState,settleAbandonedExhaustedLeases,sweepBackgroundJobRuns,hasNearTermBackgroundJobRetry,hasNearTermRequestedReading,type BackgroundJobRetryWake } from "./lib/queue.js";

/** WHAT THIS MOCKS, AND WHY (gate G6): `runBackgroundJobWorker` supplies completed pass
 * counts; `readBackgroundJobRecoveryState` supplies eligibility counts. SQL
 * eligibility and real claims are tested separately on disposable Postgres.
 * The job-wake helpers isolate Scheduler transport; their actual state queries
 * and cancellation races are covered in background-job-wake.db.test.ts. */

/** A pass over an empty queue: nothing taken, nothing pushed out of the way. */
const IDLE_PASS = { claimed: 0, held: 0, succeeded: 0, retried: 0, failed: 0, deferred: 0 };

vi.mock('./lib/background-job-wake.js', async original => ({
  ...await original<typeof import('./lib/background-job-wake.js')>(),
  armBackgroundJobLease: vi.fn(), cancelBackgroundJobLease: vi.fn(), cancelBackgroundJobWakes: vi.fn(),
  prepareBackgroundJobWake: vi.fn(), recoverBackgroundJobWakes: vi.fn(), retireBackgroundJobWake: vi.fn(),
}));

vi.mock("./lib/queue.js", async original => ({
  ...await original<typeof import('./lib/queue.js')>(),
  runBackgroundJobWorker: vi.fn(),
  readBackgroundJobRecoveryState:vi.fn(),
  settleAbandonedExhaustedLeases:vi.fn(),
  sweepBackgroundJobRuns:vi.fn(),
  hasNearTermBackgroundJobRetry:vi.fn(),
  hasNearTermRequestedReading:vi.fn(),
}));

vi.mock("./lib/conversation-attachments.js", async original => ({
  ...await original<typeof import('./lib/conversation-attachments.js')>(),
  sweepStaleStagedAttachments: vi.fn(),
}));
vi.mock("./lib/deleted-shelf.js", async original => ({
  ...await original<typeof import('./lib/deleted-shelf.js')>(),
  sweepDeletedShelf: vi.fn(),
}));
vi.mock("./lib/db.js", async original => ({
  ...await original<typeof import('./lib/db.js')>(),
  getDb: vi.fn(() => ({})),
}));

beforeEach(() => {
  vi.mocked(jobWakes.armBackgroundJobLease).mockReset().mockResolvedValue(true);
  vi.mocked(jobWakes.cancelBackgroundJobLease).mockReset().mockResolvedValue(undefined);
  vi.mocked(jobWakes.cancelBackgroundJobWakes).mockReset().mockResolvedValue(undefined);
  vi.mocked(jobWakes.prepareBackgroundJobWake).mockReset().mockResolvedValue(false);
  vi.mocked(jobWakes.recoverBackgroundJobWakes).mockReset().mockResolvedValue(undefined);
  vi.mocked(jobWakes.retireBackgroundJobWake).mockReset().mockResolvedValue(undefined);

  vi.mocked(sweepStaleStagedAttachments).mockReset().mockResolvedValue(0);
  vi.mocked(sweepDeletedShelf).mockReset().mockResolvedValue(0);
  vi.mocked(settleAbandonedExhaustedLeases).mockReset().mockResolvedValue(0);
  vi.mocked(sweepBackgroundJobRuns).mockReset().mockResolvedValue(0);
  // `mockReset` and not `clearAllMocks`, because the tests below queue
  // one-shot results with `mockResolvedValueOnce`. Clearing only forgets the
  // calls; an unconsumed one-shot survives into the next test and answers a
  // question it was never asked — which is exactly how a handler that stops
  // early hides behind a test that stopped early too.
  vi.mocked(runBackgroundJobWorker).mockReset().mockResolvedValue(IDLE_PASS);
  vi.mocked(readBackgroundJobRecoveryState).mockReset().mockResolvedValue({overdue:0,oldestOverdueMs:0,exhaustedLeases:0});
  vi.mocked(hasNearTermBackgroundJobRetry).mockReset().mockResolvedValue(false);
  vi.mocked(hasNearTermRequestedReading).mockReset().mockResolvedValue(false);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("background worker cron handler", () => {
  const wake={id:'00000000-0000-4000-8000-000000000001',profileId:'00000000-0000-4000-8000-000000000002',requestVersion:'1'};
  it('retains a requested reading wake when debounce leaves an otherwise idle asynchronous drain',async()=>{
    vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME','test-worker');vi.mocked(hasNearTermRequestedReading).mockResolvedValue(true);
    await expect(handler({mode:'enqueue',wakes:[wake]})).rejects.toThrow('BackgroundJobWakeScheduled');
    expect(hasNearTermRequestedReading).toHaveBeenCalledExactlyOnceWith([wake]);
    expect(runBackgroundJobWorker).toHaveBeenCalledOnce();
  });
  it('does not redeliver completed, long-held or malformed reading requests',async()=>{
    vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME','test-worker');
    expect(await handler({mode:'enqueue',wakes:[wake]})).toMatchObject({claimed:0});
    vi.mocked(hasNearTermRequestedReading).mockClear();
    expect(await handler({mode:'enqueue',wakes:[{...wake,id:'--profile=PRIVATE'}]})).toMatchObject({claimed:0});
    expect(hasNearTermRequestedReading).not.toHaveBeenCalled();
  });
  it('does not opt local calls or recovery into reading-wake redelivery',async()=>{
    vi.mocked(hasNearTermRequestedReading).mockResolvedValue(true);
    expect(await handler({mode:'enqueue',wakes:[wake]})).toMatchObject({claimed:0});
    vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME','test-worker');
    expect(await handler({mode:'recovery',wakes:[wake]})).toMatchObject({claimed:0});
    expect(hasNearTermRequestedReading).not.toHaveBeenCalled();
  });
  const retry:BackgroundJobRetryWake={id:'synthetic-job',profileId:'synthetic-profile',attempts:1,updatedAt:new Date('2026-10-06T12:00:00Z'),runAfter:new Date('2026-10-06T12:00:30Z')};
  function transientPass(){
    vi.mocked(runBackgroundJobWorker).mockImplementationOnce(async options=>{
      options?.onTransientRetry?.(retry);
      return {...IDLE_PASS,claimed:1,retried:1};
    });
  }
  it('requests native redelivery only for a verified still-pending transient failure from an async enqueue',async()=>{
    vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME','test-worker');transientPass();
    vi.mocked(hasNearTermBackgroundJobRetry).mockResolvedValue(true);
    await expect(handler({mode:'enqueue'})).rejects.toThrow('BackgroundJobRetryScheduled');
    expect(runBackgroundJobWorker).toHaveBeenCalledTimes(2);
    expect(hasNearTermBackgroundJobRetry).toHaveBeenCalledExactlyOnceWith([retry]);
  });
  it('does not signal a failure already completed, rearmed, claimed or put on hold during the drain',async()=>{
    vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME','test-worker');transientPass();
    expect(await handler({mode:'enqueue'})).toMatchObject({retried:1,passes:2});
    expect(hasNearTermBackgroundJobRetry).toHaveBeenCalledExactlyOnceWith([retry]);
  });
  it.each([undefined,{mode:'enqueue'},{source:'aws.events'}])('never manufactures native retry errors for local or non-enqueue calls: %j',async event=>{
    if((event as {source?:string}|undefined)?.source)vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME','test-worker');
    transientPass();vi.mocked(hasNearTermBackgroundJobRetry).mockResolvedValue(true);
    expect(await handler(event)).toMatchObject({retried:1});
    expect(hasNearTermBackgroundJobRetry).not.toHaveBeenCalled();
  });
  it.each(['succeeded','held','failed','deferred'] as const)('does not signal native retry for %s-only work',async outcome=>{
    vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME','test-worker');
    vi.mocked(runBackgroundJobWorker).mockResolvedValueOnce({...IDLE_PASS,claimed:outcome==='deferred'?0:1,[outcome]:1});
    expect(await handler({mode:'enqueue'})).toMatchObject({[outcome]:1});
    expect(hasNearTermBackgroundJobRetry).not.toHaveBeenCalled();
  });
  it('recovery never opts into native retry signaling, even after a transient failure',async()=>{
    vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME','test-worker');transientPass();
    vi.mocked(readBackgroundJobRecoveryState).mockResolvedValue({overdue:1,oldestOverdueMs:600000,exhaustedLeases:0});
    expect(await handler({mode:'recovery'})).toMatchObject({retried:1,passes:1});
    expect(hasNearTermBackgroundJobRetry).not.toHaveBeenCalled();
  });
  it('observes but never drains a queue without overdue eligible work',async()=>{
    vi.mocked(readBackgroundJobRecoveryState).mockResolvedValue({overdue:0,oldestOverdueMs:0,exhaustedLeases:2});
    expect(await handler({mode:'recovery'})).toMatchObject({passes:0,recovery:{overdue:0,exhaustedLeases:2}});
    expect(runBackgroundJobWorker).not.toHaveBeenCalled();
  });
  it('recovery takes one bounded normal pass even when more jobs remain',async()=>{
    vi.mocked(readBackgroundJobRecoveryState).mockResolvedValue({overdue:200,oldestOverdueMs:3600000,exhaustedLeases:0});
    vi.mocked(runBackgroundJobWorker).mockResolvedValue({...IDLE_PASS,claimed:5,succeeded:5});
    expect(await handler({mode:'recovery'})).toMatchObject({claimed:5,passes:1});
    expect(runBackgroundJobWorker).toHaveBeenCalledExactlyOnceWith({limit:5,overdueOnly:true});
  });
  it('recovery respects normal budget deferral without another pass',async()=>{
    vi.mocked(readBackgroundJobRecoveryState).mockResolvedValue({overdue:1,oldestOverdueMs:3600000,exhaustedLeases:0});
    vi.mocked(runBackgroundJobWorker).mockResolvedValue({...IDLE_PASS,deferred:25});
    expect(await handler({mode:'recovery'})).toMatchObject({claimed:0,deferred:25,passes:1});
    expect(runBackgroundJobWorker).toHaveBeenCalledOnce();
  });
  it('a failed recovery read cannot silently claim work',async()=>{
    vi.mocked(readBackgroundJobRecoveryState).mockRejectedValue(new Error('Unavailable'));
    await expect(handler({mode:'recovery'})).rejects.toThrow('Unavailable');
    expect(runBackgroundJobWorker).not.toHaveBeenCalled();
  });
  it("drains a bounded number of background jobs by default", async () => {
    await handler();

    expect(runBackgroundJobWorker).toHaveBeenCalledWith({ limit: 5 });
  });

  it("clamps the cron drain limit from the environment", async () => {
    vi.stubEnv("WAKA_BACKGROUND_JOB_CRON_LIMIT", "100");

    await handler();

    expect(runBackgroundJobWorker).toHaveBeenCalledWith({ limit: 25 });
  });

  /**
   * A pass that claimed nothing is no longer proof the queue is empty.
   *
   * Since the per-account model budget landed, a drain can end having claimed
   * nothing because it spent its whole deferral allowance stepping over
   * accounts that are at their cap — while somebody else's job sits behind
   * them, due, runnable, and untouched. The handler used to read that as "the
   * queue is dry" and end the invocation, which handed that person's
   * generation to the next unrelated enqueue or to tomorrow's cron sweep.
   */
  it("keeps draining when a pass only deferred, and reaches the work behind the cap", async () => {
    vi.mocked(runBackgroundJobWorker)
      .mockResolvedValueOnce({ claimed: 0, held: 0, succeeded: 0, retried: 0, failed: 0, deferred: 25 })
      .mockResolvedValueOnce({ held: 0, claimed: 1, succeeded: 1, retried: 0, failed: 0, deferred: 0 });

    const drained = await handler();

    expect(runBackgroundJobWorker).toHaveBeenCalledTimes(3);
    expect(drained).toMatchObject({ claimed: 1, succeeded: 1, deferred: 25, passes: 3 });
  });

  /**
   * The other half of the same condition, so the fix cannot become "always
   * keep going": a pass that claimed nothing and moved nothing has found a
   * queue with nothing due, and holding the invocation open to re-ask holds a
   * database connection open for the same answer.
   */
  it("still stops on a pass that claimed nothing and deferred nothing", async () => {
    const drained = await handler();

    expect(runBackgroundJobWorker).toHaveBeenCalledTimes(1);
    expect(drained).toMatchObject({ claimed: 0, deferred: 0, passes: 1 });
  });
});

/* Two daily sweeps share the scheduled event: the deleted shelf's expired
   copies and chat uploads staged for a message never sent. */
describe("the daily sweeps: the deleted shelf and abandoned staged chat uploads", () => {
  const scheduled = { source: "aws.events", "detail-type": "Scheduled Event" };
  it("are the scheduled cron's alone, never an enqueue or a local wake", async () => {
    expect(isScheduledEvent(scheduled)).toBe(true);
    expect(isScheduledEvent({ mode: "enqueue" })).toBe(false);
    expect(isScheduledEvent(undefined)).toBe(false);
    expect(isScheduledEvent({ source: "aws.events", "detail-type": "Something Else" })).toBe(false);
    await handler();
    await handler({ mode: "enqueue" });
    await handler({ mode: "recovery" });
    expect(sweepStaleStagedAttachments).not.toHaveBeenCalled();
    expect(sweepDeletedShelf).not.toHaveBeenCalled();
    expect(settleAbandonedExhaustedLeases, "never on the drain or recovery path").not.toHaveBeenCalled();
    expect(sweepBackgroundJobRuns).not.toHaveBeenCalled();
    await handler(scheduled);
    expect(sweepStaleStagedAttachments).toHaveBeenCalledTimes(1);
    expect(sweepDeletedShelf).toHaveBeenCalledTimes(1);
    expect(settleAbandonedExhaustedLeases).toHaveBeenCalledTimes(1);
    expect(sweepBackgroundJobRuns).toHaveBeenCalledTimes(1);
    expect(runBackgroundJobWorker).toHaveBeenCalledTimes(3);
  });
  it("a failed abandoned-lease settle never costs the other sweeps or the queue its pass", async () => {
    vi.mocked(settleAbandonedExhaustedLeases).mockRejectedValueOnce(new Error("db down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(handler(scheduled)).resolves.toMatchObject({ passes: 1 });
    expect(sweepDeletedShelf).toHaveBeenCalledTimes(1);
    expect(sweepStaleStagedAttachments).toHaveBeenCalledTimes(1);
    expect(runBackgroundJobWorker).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("[abandoned-lease-sweep] failed", "db down");
    warn.mockRestore();
  });
  it("a failed staged-upload sweep never costs the queue its pass", async () => {
    vi.mocked(sweepStaleStagedAttachments).mockRejectedValueOnce(new Error("bucket down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(handler(scheduled)).resolves.toMatchObject({ passes: 1 });
    expect(runBackgroundJobWorker).toHaveBeenCalledTimes(1);
    expect(sweepDeletedShelf).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("[staged-attachment-sweep] failed", "bucket down");
    warn.mockRestore();
  });
  it("a failed shelf sweep still lets the staged-upload sweep and the queue run", async () => {
    vi.mocked(sweepDeletedShelf).mockRejectedValueOnce(new Error("db down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(handler(scheduled)).resolves.toMatchObject({ passes: 1 });
    expect(sweepStaleStagedAttachments).toHaveBeenCalledTimes(1);
    expect(runBackgroundJobWorker).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("[deleted-shelf-sweep] failed", "db down");
    warn.mockRestore();
  });
});

describe('one-time recovery events', () => {
  it('returns without a drain or follow-up scheduling for an invalid delivery', async () => {
    await expect(handler({ mode: 'job_wake', wake: { profileId: 'stale' } })).resolves.toMatchObject({ claimed: 0, passes: 0 });
    expect(runBackgroundJobWorker).not.toHaveBeenCalled(); expect(jobWakes.recoverBackgroundJobWakes).not.toHaveBeenCalled();
  });
  it('a stale valid delivery only repairs missing timers in its own profile without running models', async () => {
    vi.stubEnv('WAKA_BACKGROUND_JOB_WAKE_ROLE', 'role'); vi.stubEnv('WAKA_BACKGROUND_JOB_WAKE_GROUP', 'group');
    const wake = { kind: 'pending', profileId: '00000000-0000-4000-8000-000000000002',
      runAfter: '2026-10-29T12:00:00.000000Z', token: '00000000-0000-4000-8000-000000000003' };
    await expect(handler({ mode: 'job_wake', wake }, { invokedFunctionArn: 'worker' })).resolves.toMatchObject({ claimed: 0, passes: 0 });
    expect(jobWakes.prepareBackgroundJobWake).toHaveBeenCalledExactlyOnceWith(wake);
    expect(jobWakes.recoverBackgroundJobWakes).toHaveBeenCalledExactlyOnceWith('worker', wake.profileId);
    expect(runBackgroundJobWorker).not.toHaveBeenCalled(); expect(jobWakes.retireBackgroundJobWake).not.toHaveBeenCalled();
  });
  it('a recovery batch only arms known work and does not run model jobs', async () => {
    await handler({ mode: 'wake_recovery' }, { invokedFunctionArn: 'worker' });
    expect(jobWakes.recoverBackgroundJobWakes).toHaveBeenCalledExactlyOnceWith('worker');
    expect(runBackgroundJobWorker).not.toHaveBeenCalled();
  });
  it('uses exact scheduling instead of extra native retry pings when configured', async () => {
    vi.stubEnv('WAKA_BACKGROUND_JOB_WAKE_ROLE', 'role'); vi.stubEnv('WAKA_BACKGROUND_JOB_WAKE_GROUP', 'group');
    vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', 'worker');
    vi.mocked(runBackgroundJobWorker).mockResolvedValueOnce({ ...IDLE_PASS, claimed: 1, retried: 1 }).mockResolvedValue(IDLE_PASS);
    vi.mocked(hasNearTermBackgroundJobRetry).mockResolvedValue(true);
    await expect(handler({ mode: 'enqueue' }, { invokedFunctionArn: 'worker' })).resolves.toMatchObject({ retried: 1 });
    const options = vi.mocked(runBackgroundJobWorker).mock.calls[0]![0]!;
    expect(options.onClaimed).toBeTypeOf('function'); expect(options.onSettled).toBeTypeOf('function');
    const job = { id: 'job', payload: {} } as import('./db/index.js').BackgroundJob;
    await options.onClaimed!(job); expect(jobWakes.armBackgroundJobLease).toHaveBeenCalledWith(job, 'worker');
    await options.onSettled!(job); expect(jobWakes.cancelBackgroundJobLease).toHaveBeenCalledWith(job);
    vi.mocked(jobWakes.armBackgroundJobLease).mockResolvedValue(false);
    await expect(options.onClaimed!(job)).rejects.toMatchObject({ reason: 'support' });
    expect(hasNearTermBackgroundJobRetry).not.toHaveBeenCalled();
  });
});
