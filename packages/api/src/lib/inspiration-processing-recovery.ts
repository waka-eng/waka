import { and, eq, sql } from 'drizzle-orm';
import { attachments, backgroundJobs, generationRevisions, inspirationProcessing, inspirations, profiles, topOfMinds } from '../db/index.js';
import { getDb } from './db.js';
import { readInspirationProcessingStatus } from './inspiration-processing-status.js';
import { enqueueDeriveSignals, enqueueEnrichAttachment, enqueueTopOfMindRefresh, STALE_LOCK_SECONDS, wakeCommittedBackgroundJobs } from './queue.js';
import { parseTopOfMindRefreshResult } from './top-of-mind-refresh-status.js';

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

async function recoverableJob(tx: Tx, profileId: string, jobId: string | null): Promise<boolean> {
  if (!jobId) return true;
  const [job] = await tx.select().from(backgroundJobs).where(and(eq(backgroundJobs.id, jobId), eq(backgroundJobs.profileId, profileId)))
    .for('update', { noWait: true });
  if (!job) return true;
  const stale = !job.lockedAt || job.lockedAt.getTime() < Date.now() - STALE_LOCK_SECONDS * 1000;
  if (job.status === 'pending' || (job.status === 'running' && (!stale || job.attempts < job.maxAttempts))) return false;
  if (job.status === 'running') await tx.update(backgroundJobs).set({ status: 'failed', lockedAt: null }).where(eq(backgroundJobs.id, job.id));
  return true;
}

/** Explicit recovery, never a status-read side effect. Active/held work is
 * observed, not restarted. New jobs are committed before their wake-up. */
export async function recoverInspirationProcessing(db: ReturnType<typeof getDb>, input: {
  profileId: string; inspirationId: string; receiptId?: string;
}) {
  const recovered = await db.transaction(async (tx) => {
    const [owner] = await tx.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, input.profileId)).for('key share', { noWait: true });
    if (!owner) return null;
    await tx.select({ id: generationRevisions.profileId }).from(generationRevisions)
      .where(eq(generationRevisions.profileId, input.profileId)).for('update', { noWait: true });
    const [source] = await tx.select({ id: inspirations.id }).from(inspirations)
      .where(and(eq(inspirations.id, input.inspirationId), eq(inspirations.profileId, input.profileId))).for('update', { noWait: true });
    if (!source) return null;
    const status = await readInspirationProcessingStatus(tx, input);
    if (!status || !status.canRetry) return status;
    if (status.stage === 'enrichment') {
      const missing = await tx.select({ id: attachments.id }).from(attachments).where(and(eq(attachments.profileId, input.profileId),
        eq(attachments.inspirationId, input.inspirationId), sql`(${attachments.enrichmentStatus} IS NULL OR ${attachments.enrichmentStatus}::text IN ('pending','failed'))`));
      for (const attachment of missing) {
        const [job] = await tx.select({ id: backgroundJobs.id }).from(backgroundJobs)
          .where(and(eq(backgroundJobs.profileId, input.profileId), eq(backgroundJobs.type, 'enrich_attachment'),
            eq(backgroundJobs.idempotencyKey, `enrich_attachment:${attachment.id}`))).limit(1);
        if (await recoverableJob(tx, input.profileId, job?.id ?? null)) await enqueueEnrichAttachment(input.profileId, attachment.id, input.inspirationId, tx);
      }
    } else {
      const [receipt] = status.receipt ? await tx.select().from(inspirationProcessing)
        .where(and(eq(inspirationProcessing.id, status.receipt.id), eq(inspirationProcessing.profileId, input.profileId), eq(inspirationProcessing.ownerProfileId, input.profileId))).limit(1) : [];
      if (receipt?.derivedAt) {
        const result = parseTopOfMindRefreshResult(receipt.result);
        const owned = !result?.topOfMindId || (await tx.select({ id: topOfMinds.id }).from(topOfMinds)
          .where(and(eq(topOfMinds.id, result.topOfMindId), eq(topOfMinds.profileId, input.profileId), eq(topOfMinds.version, result.version))).limit(1)).length > 0;
        if (result && owned) {
          await tx.update(inspirationProcessing).set({ completedAt: new Date(), result }).where(eq(inspirationProcessing.id, receipt.id));
        } else if (await recoverableJob(tx, input.profileId, receipt.readingJobId)) {
          const reading = await enqueueTopOfMindRefresh(input.profileId, 'signals_changed', tx);
          await tx.update(inspirationProcessing).set({ readingJobId: reading.jobId, readingRequestVersion: BigInt(reading.requestVersion),
            result: null, completedAt: null }).where(eq(inspirationProcessing.id, receipt.id));
        }
      } else {
        const [job] = await tx.select({ id: backgroundJobs.id }).from(backgroundJobs)
          .where(and(eq(backgroundJobs.profileId, input.profileId), eq(backgroundJobs.type, 'derive_signals'),
            eq(backgroundJobs.idempotencyKey, `derive_signals:${input.inspirationId}`))).limit(1);
        if (await recoverableJob(tx, input.profileId, job?.id ?? null)) await enqueueDeriveSignals(input.profileId, input.inspirationId, 'edited', undefined, tx);
      }
    }
    return readInspirationProcessingStatus(tx, input);
  });
  if (recovered) await wakeCommittedBackgroundJobs();
  return recovered;
}
