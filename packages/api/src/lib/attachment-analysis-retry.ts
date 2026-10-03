import { and, eq } from 'drizzle-orm';
import { attachments, backgroundJobs, inspirations, type Attachment } from '../db/index.js';
import type { getDb } from './db.js';
import { enqueueEnrichAttachment, STALE_LOCK_SECONDS } from './queue.js';

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];
type Reader = Pick<Tx, 'select'>;
export const ENRICHMENT_RETRY_WINDOW_MS = 60 * 60 * 1000;
export const MAX_ENRICHMENT_RETRIES = 3;
function budget(row: Attachment) {
  const active = row.enrichmentRetryWindowAt && Date.now() - row.enrichmentRetryWindowAt.getTime() < ENRICHMENT_RETRY_WINDOW_MS;
  return { count: active ? row.enrichmentRetryCount : 0, windowAt: active ? row.enrichmentRetryWindowAt! : new Date() };
}
export async function attachmentAnalysisState(db: Reader, row: Attachment, canEdit: boolean) {
  const [job] = await db.select({ status: backgroundJobs.status, lockedAt: backgroundJobs.lockedAt,
    attempts: backgroundJobs.attempts, maxAttempts: backgroundJobs.maxAttempts }).from(backgroundJobs)
    .where(and(eq(backgroundJobs.profileId, row.profileId), eq(backgroundJobs.idempotencyKey, `enrich_attachment:${row.id}`))).limit(1);
  const exhaustedLease = job?.status === 'running' && job.attempts >= job.maxAttempts &&
    (!job.lockedAt || job.lockedAt.getTime() < Date.now() - STALE_LOCK_SECONDS * 1000);
  const active = job && ['pending', 'running'].includes(job.status) && !exhaustedLease;
  const status = row.enrichmentStatus === 'ready' ? 'ready' : active ? 'pending'
    : row.enrichmentStatus === 'pending' ? 'failed' : row.enrichmentStatus ?? 'unavailable';
  const window = budget(row);
  const retryAfter = status !== 'ready' && status !== 'pending' && window.count >= MAX_ENRICHMENT_RETRIES
    ? new Date(window.windowAt.getTime() + ENRICHMENT_RETRY_WINDOW_MS).toISOString() : null;
  return { status, retryAfter, canRetry: canEdit && row.type !== 'file' && !retryAfter && status !== 'pending' && status !== 'ready' };
}

/** All recovery doors share the same atomic budget and job identity. */
export async function recoverAttachmentAnalysis(tx: Tx, input: {
  profileId: string; attachmentId: string; expectedType?: Attachment['type']; transcriptRevision?: string;
}): Promise<Attachment | null | 'conflict' | 'rate_limited'> {
  const [snapshot] = await tx.select({ inspirationId: attachments.inspirationId }).from(attachments)
    .where(and(eq(attachments.id, input.attachmentId), eq(attachments.profileId, input.profileId))).limit(1);
  if (!snapshot) return null;
  const [parent] = await tx.select({ id: inspirations.id }).from(inspirations)
    .where(and(eq(inspirations.id, snapshot.inspirationId), eq(inspirations.profileId, input.profileId))).for('update');
  if (!parent) return null;
  const [current] = await tx.select().from(attachments)
    .where(and(eq(attachments.id, input.attachmentId), eq(attachments.profileId, input.profileId))).for('update');
  if (!current || current.type === 'file' || current.inspirationId !== snapshot.inspirationId || (input.expectedType && current.type !== input.expectedType)) return null;
  const [job] = await tx.select().from(backgroundJobs)
    .where(and(eq(backgroundJobs.profileId, current.profileId), eq(backgroundJobs.idempotencyKey, `enrich_attachment:${current.id}`))).for('update', { noWait: true });
  if (current.enrichmentStatus === 'ready' || job?.status === 'pending') return current;
  if (job?.status === 'running') {
    const stale = !job.lockedAt || job.lockedAt.getTime() < Date.now() - STALE_LOCK_SECONDS * 1000;
    if (!stale || job.attempts < job.maxAttempts) return current;
    await tx.update(backgroundJobs).set({ status: 'failed', lockedAt: null }).where(eq(backgroundJobs.id, job.id));
  }
  if (input.transcriptRevision !== undefined && String(current.transcriptRevision) !== input.transcriptRevision) return 'conflict';
  const window = budget(current);
  if (window.count >= MAX_ENRICHMENT_RETRIES) return 'rate_limited';
  const [next] = await tx.update(attachments).set({ enrichmentStatus: 'pending', enrichmentErrorReason: null,
    ...(current.type === 'audio' ? { transcriptRevision: current.transcriptRevision + 1 } : {}),
    enrichmentRetryCount: window.count + 1, enrichmentRetryWindowAt: window.windowAt, updatedAt: new Date(),
  }).where(eq(attachments.id, current.id)).returning();
  await enqueueEnrichAttachment(current.profileId, current.id, current.inspirationId, tx);
  return next!;
}
