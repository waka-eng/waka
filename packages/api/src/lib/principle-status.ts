import {principleMaterialKey} from './principle-material-key.js';
import { and, desc, eq, sql } from "drizzle-orm";
import { backgroundJobs, principles } from "../db/index.js";
import { getDb } from "./db.js";
import { loadPrincipleMaterial, PRINCIPLE_MIN_SIGNALS } from "./principle-generation.js";
import { groupPrincipleReadable } from "./group-output.js";
import { enqueueGroupTopOfMindRefresh, enqueueRefreshPrinciples, enqueueTopOfMindRefresh, recoverPendingSignalSupport, wakeCommittedBackgroundJobs } from "./queue.js";
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
  const [latest] = await db.select({ status: backgroundJobs.status, createdAt: backgroundJobs.createdAt }).from(backgroundJobs)
    .where(and(eq(backgroundJobs.profileId, profileId), eq(backgroundJobs.type, "refresh_top_of_mind")))
    .orderBy(desc(backgroundJobs.updatedAt)).limit(1);
  return latest ?? null;
}

/** How soon a failed reading may be retried again: a retry that fails at
    once (no credit) must not become a button that bills a request per press. */
export const READING_RETRY_COOLDOWN_MS = 3 * 60_000;

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
  const withheld = material.groupId ? await db.select({ id: principles.id }).from(principles)
    .where(and(eq(principles.profileId, profileId), sql`(${groupPrincipleReadable(material.groupId, PRINCIPLE_MIN_SIGNALS)}) IS NOT TRUE`)).limit(1) : [];
  const readingPaused = (await latestReadingJob(db, profileId))?.status === "failed";
  return { phase, eligible: material.eligibility.eligible,
    readingPaused,
    supportPending: support.pending,
    restricted: withheld.length > 0,
    signalCount: material.eligibility.distinctSignals,
    topOfMindCount: material.eligibility.tomAppearances };
}

export async function requestPrincipleRefresh(db: Db, profileId: string, retry = false, now = new Date()) {
  if (retry) {
    const reading = await latestReadingJob(db, profileId);
    if (reading?.status === "failed") {
      const wait = reading.createdAt.getTime() + READING_RETRY_COOLDOWN_MS - now.getTime();
      if (wait > 0) throw new ReadingRetryThrottled(Math.ceil(wait / 1000));
    }
  }
  await db.transaction(async (tx) => {
    const sources = await recoverPendingSignalSupport(tx, profileId);
    if (sources.length) {
      const groupId = sources[0]!.groupId;
      if (groupId) await enqueueGroupTopOfMindRefresh(sources[0]!.ownerProfileId, groupId, 'manual', tx);
      else await enqueueTopOfMindRefresh(profileId, 'manual', tx);
    }
    /* A RETRY ALSO RESTARTS A READING THAT FAILED. Before, it re-enqueued
       principles and pending support only, so "Try again" under a paused
       reading asked for the one job that was not the problem. Only on an
       explicit retry, and only when the latest reading job did fail — a
       plain refresh still never buys a synthesis nobody asked for. */
    if (retry && !sources.length) {
      if ((await latestReadingJob(tx, profileId))?.status === "failed") await enqueueTopOfMindRefresh(profileId, 'manual', tx);
    }
    await enqueueEligiblePrinciples(tx, profileId, retry, tx);
  });
  await wakeCommittedBackgroundJobs();
  return loadPrincipleStatus(db, profileId);
}

/** Reading publication and its next job commit together. No wake or model call
 * may escape this transaction; the existing worker drains the committed tail. */
export async function enqueuePrinciplesAfterReading(tx: Transaction, profileId: string) {
  await enqueueEligiblePrinciples(tx, profileId, false, tx);
}

async function enqueueEligiblePrinciples(db: Db, profileId: string, retry: boolean, transaction?: Transaction) {
  const material = await loadPrincipleMaterial(db, profileId);
  if (material.eligibility.eligible) {
    await enqueueRefreshPrinciples(profileId, principleMaterialKey(material), retry, transaction);
  }
}
