/**
 * The background queue's worker.
 *
 * Normally the API invokes it the moment work is enqueued, so a capture starts
 * deriving immediately. Short transient failures request bounded native async
 * redelivery, without sleeping here. Once a day a cron invokes it
 * as a safety net, for the error paths a push cannot cover: a job whose
 * backoff outlived the invocation that failed it, a row still locked by a
 * worker that died, an enqueue whose wake-up call never landed.
 * An explicitly invoked recovery event can inspect overdue work and take one
 * normal pass of five claims after grace. No periodic recovery poll is deployed.
 *
 * Because no continuous poller drives normal work, this drains until the queue is *dry*
 * rather than running a single batch. The pipeline enqueues as it goes — a
 * finished derivation asks for a synthesis — so stopping after one batch
 * would leave the second half of a person's pipeline waiting for tomorrow's
 * sweep. The passes are bounded: an unbounded loop plus a job that keeps
 * re-arming itself is a Lambda that runs until its timeout, every time.
 */

import { runBackgroundJobWorker,readBackgroundJobRecoveryState,settleAbandonedExhaustedLeases,hasNearTermBackgroundJobRetry,readBackgroundJobWakeReferences,hasNearTermRequestedReading,collectReadingWakeReferences,type BackgroundJobRetryWake } from "./lib/queue.js";
import {QUEUE_RECOVERY_LIMITS,recordQueueRecovery} from './lib/queue-recovery.js';
import {sweepDeletedShelf} from './lib/deleted-shelf.js';
import {sweepStaleStagedAttachments} from './lib/conversation-attachments.js';
import {sweepAttachmentObjects} from './lib/attachment-sweep.js';
import {getDb} from './lib/db.js';

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

/** The daily cron's EventBridge event, and nothing else. */
export function isScheduledEvent(event:unknown):boolean{
  return Boolean(event&&typeof event==='object'&&(event as {source?:unknown}).source==='aws.events'&&(event as {'detail-type'?:unknown})['detail-type']==='Scheduled Event');
}

/**
 * The daily run's housekeeping: final-attempt leases whose worker died
 * (`settleAbandonedExhaustedLeases` — here, once a day, never on the drain
 * path), the deleted shelf's expired copies, for the people who never open it
 * again (`sweepDeletedShelf`), and chat uploads staged for a message never
 * sent, past their week (`sweepStaleStagedAttachments`). Each sweep's failure
 * is logged and swallowed — one never stops another, and none costs the
 * queue its pass.
 */
async function runScheduledSweeps(now=new Date()){
  try{const settled=await settleAbandonedExhaustedLeases(getDb(),now);if(settled)console.info('[abandoned-lease-sweep]',JSON.stringify({settled}));}
  catch(error){console.warn('[abandoned-lease-sweep] failed',error instanceof Error?error.message:String(error));}
  try{const swept=await sweepDeletedShelf(getDb(),now);if(swept)console.info('[deleted-shelf-sweep]',JSON.stringify({swept}));}
  catch(error){console.warn('[deleted-shelf-sweep] failed',error instanceof Error?error.message:String(error));}
  try{const swept=await sweepStaleStagedAttachments(getDb(),now,sweepAttachmentObjects);if(swept)console.info('[staged-attachment-sweep]',JSON.stringify({swept}));}
  catch(error){console.warn('[staged-attachment-sweep] failed',error instanceof Error?error.message:String(error));}
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
  // Only our known asynchronous enqueue event opts into native error retries.
  // Local calls, daily sweeps and recovery must not manufacture Lambda errors.
  const asyncEnqueue = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME && event && typeof event==='object' && (event as {mode?:unknown}).mode==='enqueue');
  const wakes=asyncEnqueue?readBackgroundJobWakeReferences((event as {wakes?:unknown}).wakes):[];
  /* The daily sweeps (`runScheduledSweeps`) run only on the scheduled event —
     not on an enqueue or a local wake, which are a person's work waiting. */
  if(isScheduledEvent(event))await runScheduledSweeps();
  const retries:BackgroundJobRetryWake[]=[];
  const total = { claimed: 0, held: 0, succeeded: 0, retried: 0, failed: 0, deferred: 0 };
  let passes = 0;

  const drain=async()=>{
  while (passes < MAX_DRAIN_PASSES) {
    const result = await runBackgroundJobWorker({ limit, ...(asyncEnqueue?{onTransientRetry:(retry:BackgroundJobRetryWake)=>{retries.push(retry);}}:{}) });
    passes += 1;
    total.claimed += result.claimed;
    total.held += result.held;
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

  return { ...total, passes, exhaustedPasses: passes >= MAX_DRAIN_PASSES };
  };
  const collected=asyncEnqueue?await collectReadingWakeReferences(drain):{result:await drain(),wakes:[]};
  const drained=collected.result;
  const requested=readBackgroundJobWakeReferences([...new Map([...wakes,...collected.wakes].map(row=>[row.id,row])).values()].slice(0,50));
  console.log("[background-worker] drained background jobs", drained);
  if(asyncEnqueue && retries.length && await hasNearTermBackgroundJobRetry(retries)){
    // This error asks Lambda's existing async queue for at most two more
    // deliveries. The next delivery still uses normal due-time, lease and
    // budget checks. Completed work is not replayed. Expected retry signals
    // count in Lambda Errors, not as permanently failed database jobs.
    console.info('[background-worker] transient retry remains; requesting bounded async redelivery');
    throw new Error('BackgroundJobRetryScheduled');
  }
  if(asyncEnqueue&&requested.length&&await hasNearTermRequestedReading(requested)){
    console.info('[background-worker] requested reading remains near-term; requesting bounded async redelivery');
    throw new Error('BackgroundJobWakeScheduled');
  }
  return drained;
}
