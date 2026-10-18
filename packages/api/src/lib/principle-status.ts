import {principleMaterialKey} from './principle-material-key.js';
import { eq } from "drizzle-orm";
import { backgroundJobs, profiles } from "../db/index.js";
import { getDb } from "./db.js";
import { loadPrincipleMaterial } from "./principle-generation.js";
import { enqueueRefreshPrinciples, enqueueTopOfMindRefresh, recoverPendingSignalSupport, wakeCommittedBackgroundJobs } from "./queue.js";
import { loadSignalSupportWorkState } from './signal-support-state.js';

type Database = ReturnType<typeof getDb>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Db = Database | Transaction;


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
  return { phase, eligible: material.eligibility.eligible,
    supportPending: support.pending,
    signalCount: material.eligibility.distinctSignals,
    topOfMindCount: material.eligibility.tomAppearances };
}

export async function requestPrincipleRefresh(db: Db, profileId: string, retry = false) {
  await db.transaction(async (tx) => {
    const sources = await recoverPendingSignalSupport(tx, profileId);
    if (sources.length) await enqueueTopOfMindRefresh(profileId, 'manual', tx);
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
  // A room mind's principles retired with the room engine: decided on the
  // profile's type before any material is loaded.
  const [profile] = await db.select({ type: profiles.type }).from(profiles).where(eq(profiles.id, profileId)).limit(1);
  if (profile?.type === "group") return;
  const material = await loadPrincipleMaterial(db, profileId);
  if (material.eligibility.eligible) {
    await enqueueRefreshPrinciples(profileId, principleMaterialKey(material), retry, transaction);
  }
}
