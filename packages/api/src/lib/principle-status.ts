import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { backgroundJobs, principles } from "../db/index.js";
import { getDb } from "./db.js";
import { loadPrincipleMaterial, PRINCIPLE_MIN_SIGNALS } from "./principle-generation.js";
import { groupPrincipleReadable } from "./group-output.js";
import { enqueueRefreshPrinciples } from "./queue.js";

type Database = ReturnType<typeof getDb>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Db = Database | Transaction;

/** Stable evidence identity: opening a page cannot purchase another model pass. */
export function principleMaterialKey(material: Awaited<ReturnType<typeof loadPrincipleMaterial>>): string {
  return createHash("sha256").update(JSON.stringify({
    policy: "principles-v2", groupId: material.groupId, locale: material.preferredLocale,
    signals: material.activeSignals.map((signal) => ({
      id: signal.id, statement: signal.statement,
      evidence: material.evidence.get(signal.id)?.evidenceAt.map((at) => at.toISOString()).sort(),
      versions: material.evidence.get(signal.id)?.tomVersionIds.slice().sort(),
    })).sort((a, b) => a.id.localeCompare(b.id)),
  })).digest("hex");
}

export async function loadPrincipleStatus(db: Db, profileId: string) {
  const material = await loadPrincipleMaterial(db, profileId);
  const key = principleMaterialKey(material);
  const [job] = await db.select({ status: backgroundJobs.status }).from(backgroundJobs)
    .where(eq(backgroundJobs.idempotencyKey, `refresh_principles:${profileId}:${key}`)).limit(1);
  const phase = !material.eligibility.eligible ? "waiting"
    : job?.status === "failed" ? "failed"
    : job?.status === "succeeded" ? "ready"
    : job ? "processing" : "pending";
  const withheld = material.groupId ? await db.select({ id: principles.id }).from(principles)
    .where(and(eq(principles.profileId, profileId), sql`(${groupPrincipleReadable(material.groupId, PRINCIPLE_MIN_SIGNALS)}) IS NOT TRUE`)).limit(1) : [];
  return { phase, eligible: material.eligibility.eligible,
    restricted: withheld.length > 0,
    signalCount: material.eligibility.distinctSignals,
    topOfMindCount: material.eligibility.tomAppearances };
}

export async function requestPrincipleRefresh(db: Db, profileId: string, retry = false) {
  await enqueueEligiblePrinciples(db, profileId, retry);
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
