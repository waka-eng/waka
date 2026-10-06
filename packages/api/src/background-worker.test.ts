import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handler } from "./background-worker.js";
import { runBackgroundJobWorker,readBackgroundJobRecoveryState } from "./lib/queue.js";

/** WHAT THIS MOCKS, AND WHY: `runBackgroundJobWorker` supplies completed pass
 * counts; `readBackgroundJobRecoveryState` supplies eligibility counts. SQL
 * eligibility and real claims are tested separately on disposable Postgres. */

/** A pass over an empty queue: nothing taken, nothing pushed out of the way. */
const IDLE_PASS = { claimed: 0, held: 0, succeeded: 0, retried: 0, failed: 0, deferred: 0 };

vi.mock("./lib/queue.js", () => ({
  runBackgroundJobWorker: vi.fn(),
  readBackgroundJobRecoveryState:vi.fn(),
}));

beforeEach(() => {
  // `mockReset` and not `clearAllMocks`, because the tests below queue
  // one-shot results with `mockResolvedValueOnce`. Clearing only forgets the
  // calls; an unconsumed one-shot survives into the next test and answers a
  // question it was never asked — which is exactly how a handler that stops
  // early hides behind a test that stopped early too.
  vi.mocked(runBackgroundJobWorker).mockReset().mockResolvedValue(IDLE_PASS);
  vi.mocked(readBackgroundJobRecoveryState).mockReset().mockResolvedValue({overdue:0,oldestOverdueMs:0,exhaustedLeases:0});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("background worker cron handler", () => {
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
