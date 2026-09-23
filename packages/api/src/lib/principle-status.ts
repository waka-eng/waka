import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { backgroundJobs } from "../db/index.js";
import { getDb } from "./db.js";
import { loadPrincipleMaterial } from "./principle-generation.js";
import { enqueueRefreshPrinciples } from "./queue.js";

type Db = ReturnType<typeof getDb>;

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
  return { phase, eligible: material.eligibility.eligible,
    signalCount: material.eligibility.distinctSignals,
    topOfMindCount: material.eligibility.tomAppearances };
}

export async function requestPrincipleRefresh(db: Db, profileId: string, retry = false) {
  const material = await loadPrincipleMaterial(db, profileId);
  if (material.eligibility.eligible) {
    await enqueueRefreshPrinciples(profileId, principleMaterialKey(material), retry);
  }
  return loadPrincipleStatus(db, profileId);
}
