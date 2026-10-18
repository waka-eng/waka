import {principleMaterialKey} from './principle-material-key.js';
import { and, desc, eq, sql } from "drizzle-orm";
import { backgroundJobs } from "../db/index.js";
import { getDb } from "./db.js";
import { loadPrincipleMaterial } from "./principle-generation.js";
import { enqueueRefreshPrinciples, enqueueTopOfMindRefresh, recoverPendingSignalSupport, wakeCommittedBackgroundJobs } from "./queue.js";
import { loadSignalSupportWorkState } from './signal-support-state.js';

type Database = ReturnType<typeof getDb>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Db = Database | Transaction;


/**
 * IS THE READING STUCK, AS OPPOSED TO SLOW.
 *
 * When the model provider refuses — out of credit is a 402 and the founder's
 * live case — the job that writes a person's reading fails after its
 * retries, and nothing told the person. Home went on showing the last
 * reading and a save sat unread with no sign that anything was wrong.
 *
 * THE READING JOB ALONE, AND ITS OWN LATEST ROW. The first version took the
 * latest of the reading AND principles jobs, which was wrong both ways: a
 * principles job failing for its own reasons (it has its own `phase:
 * 'failed'` and its own Try again) raised "reading is paused", and a
 * principles success after a failed reading hid the failure. Each type
 * answers for itself now; this one is the reading's. Signal support has
 * its own failed phase too, so it is not folded in here either.
 *
 * Signal derivation is deliberately not here. Each save already reports and
 * retries its own derivation (`/inspirations/:id/processing`).
 */
async function latestReadingJob(db: Db, profileId: string) {
  const [latest] = await db.select({ status: backgroundJobs.status }).from(backgroundJobs)
    .where(and(eq(backgroundJobs.profileId, profileId), eq(backgroundJobs.type, "refresh_top_of_mind")))
    .orderBy(desc(backgroundJobs.updatedAt)).limit(1);
  return latest ?? null;
}

/** How soon a person may retry again: a retry that fails at once (no credit
    is a 402) must not become a button that bills a request per press.
    Measured from the CREATION of the most recent reading job a retry
    enqueued (`payload.retry`), whatever became of it — so a 402 loop is
    throttled whether that job failed, is still pending, or is running. An
    automatic failure enqueues nothing marked, so it never starts a cooldown:
    the first Retry after it always goes through. Inside the cooldown a retry
    re-queues neither the reading nor pending signal support (both spend
    model calls); failed principles behind the same Try again are still
    restarted. */
export const READING_RETRY_COOLDOWN_MS = 3 * 60_000;

/** When the latest retry-enqueued reading job was created, if any. */
async function latestRetryAt(db: Db, profileId: string): Promise<Date | null> {
  const [row] = await db.select({ createdAt: backgroundJobs.createdAt }).from(backgroundJobs)
    .where(and(eq(backgroundJobs.profileId, profileId), eq(backgroundJobs.type, "refresh_top_of_mind"),
      sql`${backgroundJobs.payload}->>'retry' = 'true'`))
    .orderBy(desc(backgroundJobs.createdAt)).limit(1);
  return row?.createdAt ?? null;
}

/** A retry asked for inside the cooldown. The route answers 429 with when. */
export class ReadingRetryThrottled extends Error {
  constructor(readonly retryAfterSeconds: number) { super("The reading was retried moments ago"); }
}

export async function loadPrincipleStatus(db: Db, profileId: string) {
  const material = await loadPrincipleMaterial(db, profileId);
  const key = principleMaterialKey(material);
  const [job] = await db.select({ status: backgroundJobs.status }).from(backgroundJobs)
    .where(eq(backgroundJobs.idempotencyKey, `refresh_principles:${profileId}:${key}`)).limit(1);
  const support = await loadSignalSupportWorkState(db, profileId);
  const phase = support.active ? support.running ? 'processing' : 'pending' : support.failed ? 'failed' : !material.eligibility.eligible ? "waiting"
    : job?.status === "failed" ? "failed"
    : job?.status === "succeeded" ? "ready"
    : job ? "processing" : "pending";
  const readingPaused = (await latestReadingJob(db, profileId))?.status === "failed";
  return { phase, eligible: material.eligibility.eligible,
    readingPaused,
    supportPending: support.pending,
    signalCount: material.eligibility.distinctSignals,
    topOfMindCount: material.eligibility.tomAppearances };
}

export async function requestPrincipleRefresh(db: Db, profileId: string, retry = false, now = new Date()) {
  let throttledSeconds = 0;
  if (retry) {
    /* THE COOLDOWN IS CHECKED BEFORE ANYTHING IS ENQUEUED, on every path a
       person's retry can take. */
    const last = await latestRetryAt(db, profileId);
    const wait = last ? last.getTime() + READING_RETRY_COOLDOWN_MS - now.getTime() : 0;
    if (wait > 0) throttledSeconds = Math.ceil(wait / 1000);
  }
  let restarted = false;
  await db.transaction(async (tx) => {
    /* Re-queuing pending signal support spends model calls too, so a
       throttled retry skips it; a plain refresh behaves as before. */
    const sources = throttledSeconds ? [] : await recoverPendingSignalSupport(tx, profileId);
    if (sources.length) {
      restarted = true;
      await enqueueTopOfMindRefresh(profileId, 'manual', tx, { retry });
    }
    /* A RETRY ALSO RESTARTS A READING THAT FAILED. Before, it re-enqueued
       principles and pending support only, so "Try again" under a paused
       reading asked for the one job that was not the problem. Only on an
       explicit retry, and only when the latest reading job did fail — a
       plain refresh still never buys a synthesis nobody asked for. */
    if (retry && !sources.length && !throttledSeconds) {
      if ((await latestReadingJob(tx, profileId))?.status === "failed") {
        restarted = true;
        await enqueueTopOfMindRefresh(profileId, 'manual', tx, { retry: true });
      }
    }
    if (await enqueueEligiblePrinciples(tx, profileId, retry, tx)) restarted = true;
  });
  await wakeCommittedBackgroundJobs();
  /* Inside the cooldown with nothing else to restart: say so, as a 429. */
  if (throttledSeconds && !restarted) throw new ReadingRetryThrottled(throttledSeconds);
  return loadPrincipleStatus(db, profileId);
}

/** Reading publication and its next job commit together. No wake or model call
 * may escape this transaction; the existing worker drains the committed tail. */
export async function enqueuePrinciplesAfterReading(tx: Transaction, profileId: string) {
  await enqueueEligiblePrinciples(tx, profileId, false, tx);
}

/** True when this call put principles work in motion: a new job for new
    material, or a failed/stalled one reset by an explicit retry. Either way
    the retry did something, so it answers 202, never 429. */
async function enqueueEligiblePrinciples(db: Db, profileId: string, retry: boolean, transaction?: Transaction): Promise<boolean> {
  // A room mind's material comes back empty from its profile read (room
  // principles retired with the room engine); never enqueue for one.
  const material = await loadPrincipleMaterial(db, profileId);
  if (material.groupProfile || !material.eligibility.eligible) return false;
  const result = await enqueueRefreshPrinciples(profileId, principleMaterialKey(material), retry, transaction);
  return result.created;
}
