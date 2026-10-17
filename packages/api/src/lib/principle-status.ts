import {principleMaterialKey} from './principle-material-key.js';
import { and, desc, eq, inArray, sql } from "drizzle-orm";
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
 * live case — the jobs that write a person's reading fail after their
 * retries, and nothing told the person. Home went on showing the last
 * reading, principles went on saying nothing, and a save sat unread with no
 * sign that anything was wrong or that anything could be done.
 *
 * The answer is the LATEST of the two jobs that write what a person reads on
 * those pages — the reading and the principles — or a failed signal-support
 * pass, which blocks both. Latest, not any: a failure an hour ago that a
 * later success already repaired is history, not a state.
 *
 * Signal derivation is deliberately not here. Each save already reports and
 * retries its own derivation (`/inspirations/:id/processing`), and the retry
 * below could not repair one: it enqueues readings, not derivations.
 */
async function readingPausedFor(db: Db, profileId: string, supportFailed: boolean): Promise<boolean> {
  if (supportFailed) return true;
  const [latest] = await db.select({ status: backgroundJobs.status }).from(backgroundJobs)
    .where(and(eq(backgroundJobs.profileId, profileId), inArray(backgroundJobs.type, ["refresh_top_of_mind", "refresh_principles"])))
    .orderBy(desc(backgroundJobs.updatedAt)).limit(1);
  return latest?.status === "failed";
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
  const readingPaused = await readingPausedFor(db, profileId, support.failed);
  return { phase, eligible: material.eligibility.eligible,
    readingPaused,
    supportPending: support.pending,
    restricted: withheld.length > 0,
    signalCount: material.eligibility.distinctSignals,
    topOfMindCount: material.eligibility.tomAppearances };
}

export async function requestPrincipleRefresh(db: Db, profileId: string, retry = false) {
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
      const [reading] = await tx.select({ status: backgroundJobs.status }).from(backgroundJobs)
        .where(and(eq(backgroundJobs.profileId, profileId), eq(backgroundJobs.type, "refresh_top_of_mind")))
        .orderBy(desc(backgroundJobs.updatedAt)).limit(1);
      if (reading?.status === "failed") await enqueueTopOfMindRefresh(profileId, 'manual', tx);
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
