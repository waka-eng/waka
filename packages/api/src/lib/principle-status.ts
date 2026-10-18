import {principleMaterialKey} from './principle-material-key.js';
import { and, desc, eq } from "drizzle-orm";
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

/* NO SERVER-SIDE RETRY COOLDOWN. One stood here (a 429 inside three
   minutes of a retry) and every review round found another way round it. A
   provider refusal (402) costs nothing per press, so the guard against a
   button pressed repeatedly is the client's: Retry disables itself and says
   "Retrying…" until its request answers. */
export async function requestPrincipleRefresh(db: Db, profileId: string, retry = false) {
  await db.transaction(async (tx) => {
    const sources = await recoverPendingSignalSupport(tx, profileId);
    if (sources.length) await enqueueTopOfMindRefresh(profileId, 'manual', tx);
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
  // A room mind's material comes back empty from its profile read (room
  // principles retired with the room engine); never enqueue for one.
  const material = await loadPrincipleMaterial(db, profileId);
  if (!material.groupProfile && material.eligibility.eligible) {
    await enqueueRefreshPrinciples(profileId, principleMaterialKey(material), retry, transaction);
  }
}
