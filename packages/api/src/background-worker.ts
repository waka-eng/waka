/**
 * The background queue's worker.
 *
 * Woken two ways. Normally the API invokes it the moment work is enqueued, so
 * a capture starts deriving in the same second. Once a day a cron invokes it
 * as a safety net, for the error paths a push cannot cover: a job whose
 * backoff outlived the invocation that failed it, a row still locked by a
 * worker that died, an enqueue whose wake-up call never landed.
 * A dev-only recovery event checks overdue work every fifteen minutes, taking
 * one normal pass of five claims after grace; daily and push drains remain.
 *
 * Because nothing polls behind it, this drains until the queue is *dry*
 * rather than running a single batch. The pipeline enqueues as it goes — a
 * finished derivation asks for a synthesis — so stopping after one batch
 * would leave the second half of a person's pipeline waiting for tomorrow's
 * sweep. The passes are bounded: an unbounded loop plus a job that keeps
 * re-arming itself is a Lambda that runs until its timeout, every time.
 */

import { runBackgroundJobWorker,readBackgroundJobRecoveryState } from "./lib/queue.js";
import {QUEUE_RECOVERY_LIMITS,recordQueueRecovery} from './lib/queue-recovery.js';

const DEFAULT_CRON_LIMIT = 5;
const MAX_CRON_LIMIT = 25;

/**
 * Enough passes for the deepest real chain (enrich → derive → synthesize,
 * plus a group refresh) across a burst of captures, and few enough that a
 * pathological re-arming job cannot hold the invocation open indefinitely.
 */
const MAX_DRAIN_PASSES = 12;

function parseCronLimit(raw: string | undefined): number {
  if (!raw) return DEFAULT_CRON_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_CRON_LIMIT;
  return Math.min(parsed, MAX_CRON_LIMIT);
}

export async function handler(event?:unknown) {
  if(event&&typeof event==='object'&&(event as {mode?:unknown}).mode==='recovery'){
    const state=await readBackgroundJobRecoveryState();recordQueueRecovery(state);
    if(!state.overdue)return {claimed:0,succeeded:0,retried:0,failed:0,deferred:0,passes:0,exhaustedPasses:false,recovery:state};
    const result=await runBackgroundJobWorker({limit:QUEUE_RECOVERY_LIMITS.claims,overdueOnly:true});
    try{console.info('[queue-recovery-result]',JSON.stringify({claimed:result.claimed,succeeded:result.succeeded,retried:result.retried,failed:result.failed,deferred:result.deferred}));}catch{/* Logging cannot retry completed work. */}
    return {...result,passes:1,exhaustedPasses:false,recovery:state};
  }
  const limit = parseCronLimit(process.env.WAKA_BACKGROUND_JOB_CRON_LIMIT);
  const total = { claimed: 0, succeeded: 0, retried: 0, failed: 0, deferred: 0 };
  let passes = 0;

  while (passes < MAX_DRAIN_PASSES) {
    const result = await runBackgroundJobWorker({ limit });
    passes += 1;
    total.claimed += result.claimed;
    total.succeeded += result.succeeded;
    total.retried += result.retried;
    total.failed += result.failed;
    // Work pushed out because its account had spent its model budget. Carried
    // into the summary because an invocation that claimed nothing is otherwise
    // indistinguishable from an idle one — "quiet" and "one account is at its
    // cap and everyone else's queue is empty" are very different mornings.
    total.deferred += result.deferred;

    // Nothing was due, *and* nothing was moved out of the way. Both halves
    // matter now. Before the model budget existed, a pass that claimed nothing
    // could only mean the head-of-queue read found nothing runnable, so
    // `claimed === 0` was the whole test. It no longer is: a drain also ends
    // with nothing claimed when it spent its deferral allowance stepping over
    // accounts that are at their cap (`MAX_BUDGET_DEFERRALS_PER_DRAIN` in
    // lib/queue.ts) — and the person waiting behind those accounts has work
    // that is runnable this second. Stopping there handed their generation to
    // the next unrelated enqueue, or to tomorrow's cron.
    //
    // A pass that deferred is a pass that made progress: every row it touched
    // now carries a future `run_after`, so the next pass reads a queue that
    // has genuinely moved and reaches work this one never got to. That is why
    // continuing terminates rather than spinning — and `MAX_DRAIN_PASSES`
    // bounds it regardless.
    //
    // Work scheduled for a future backoff is still deliberately left for the
    // next wake-up rather than slept on: holding the invocation open would
    // also hold a database connection open, which is the cost this whole
    // design is avoiding.
    if (result.claimed === 0 && result.deferred === 0) break;
  }

  const drained = { ...total, passes, exhaustedPasses: passes >= MAX_DRAIN_PASSES };
  console.log("[background-worker] drained background jobs", drained);
  return drained;
}
