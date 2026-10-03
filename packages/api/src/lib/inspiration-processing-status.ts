import { and, desc, eq, sql } from 'drizzle-orm';
import { backgroundJobs, inspirationProcessing, inspirationRevisions, inspirations, topOfMinds, type BackgroundJobResult } from '../db/index.js';
import { getDb } from './db.js';
import { parseTopOfMindRefreshResult } from './top-of-mind-refresh-status.js';
import type { InspirationProcessingReceipt } from './inspiration-processing.js';
import { STALE_LOCK_SECONDS } from './queue.js';
import { ENRICHMENT_RETRY_WINDOW_MS, MAX_ENRICHMENT_RETRIES } from './attachment-analysis-retry.js';
import { effectiveAttachmentStatus } from './attachment-material.js';

type Database = ReturnType<typeof getDb>;
type Reader = Pick<Database, 'select' | 'execute'>;
type Phase = 'queued' | 'processing' | 'waiting' | 'ready' | 'failed' | 'unknown';
export interface InspirationProcessingStatus {
  profileId: string;
  inspirationId: string;
  receipt: Pick<InspirationProcessingReceipt, 'id' | 'profileId' | 'inspirationId' | 'materialRevision'> | null;
  currentMaterialRevision: string | null;
  requestedMaterialRevision: string | null;
  latestDerivedRevision: string;
  latestCompletedRevision: string;
  superseded: boolean;
  phase: Phase;
  stage: 'enrichment' | 'derivation' | 'reading' | null;
  runAfter: string | null;
  result: BackgroundJobResult | null;
  unavailableAttachments: number;
  canRetry: boolean;
}

const leaseExpired = (lockedAt: Date | null, now: Date) => !lockedAt || lockedAt.getTime() < now.getTime() - STALE_LOCK_SECONDS * 1000;
function jobState(job: typeof backgroundJobs.$inferSelect | undefined, now: Date): { phase: Phase; runAfter: string | null } {
  if (!job || job.status === 'succeeded') return { phase: 'unknown', runAfter: null };
  if (job.status === 'failed' || (job.status === 'running' && leaseExpired(job.lockedAt, now) && job.attempts >= job.maxAttempts)) return { phase: 'failed', runAfter: null };
  if (job.status === 'running' && !leaseExpired(job.lockedAt, now)) return { phase: 'processing', runAfter: null };
  return { phase: job.runAfter > now ? 'waiting' : 'queued', runAfter: job.runAfter > now ? job.runAfter.toISOString() : null };
}

/** All reads share one snapshot. The requested receipt must be owned before
 * following newer material; an unrelated ID must never become a latest lookup. */
export async function loadInspirationProcessingStatus(db: Database, input: {
  profileId: string; inspirationId: string; receiptId?: string;
}): Promise<InspirationProcessingStatus | null> {
  return db.transaction((tx) => readInspirationProcessingStatus(tx, input), { isolationLevel: 'repeatable read', accessMode: 'read only' });
}

export async function readInspirationProcessingStatus(db: Reader, input: {
  profileId: string; inspirationId: string; receiptId?: string;
}): Promise<InspirationProcessingStatus | null> {
  const now = new Date();
  const [source] = await db.select({ id: inspirations.id, revision: inspirationRevisions.personalRevision }).from(inspirations)
    .leftJoin(inspirationRevisions, and(eq(inspirationRevisions.inspirationId, inspirations.id), eq(inspirationRevisions.profileId, inspirations.profileId)))
    .where(and(eq(inspirations.id, input.inspirationId), eq(inspirations.profileId, input.profileId))).limit(1);
  if (!source) return null;
  const scope = and(eq(inspirationProcessing.profileId, input.profileId), eq(inspirationProcessing.ownerProfileId, input.profileId), eq(inspirationProcessing.inspirationId, input.inspirationId));
  const [requested] = input.receiptId ? await db.select().from(inspirationProcessing)
    .where(and(scope, eq(inspirationProcessing.id, input.receiptId))).limit(1) : [];
  if (input.receiptId && !requested) return null;
  const [current] = source.revision === null ? [] : await db.select().from(inspirationProcessing)
    .where(and(scope, eq(inspirationProcessing.materialRevision, source.revision)))
    .orderBy(desc(inspirationProcessing.createdAt), desc(inspirationProcessing.derivationRequestVersion), desc(inspirationProcessing.id)).limit(1);
  const [progress] = await db.execute(sql`SELECT
    coalesce(max(material_revision) FILTER (WHERE derived_at IS NOT NULL), 0)::text AS derived,
    coalesce(max(material_revision) FILTER (WHERE completed_at IS NOT NULL), 0)::text AS completed
    FROM inspiration_processing WHERE profile_id = ${input.profileId}::uuid AND owner_profile_id = ${input.profileId}::uuid
      AND inspiration_id = ${input.inspirationId}::uuid`);
  const receipt = current ? {
    id: current.id, profileId: input.profileId, inspirationId: input.inspirationId, materialRevision: current.materialRevision.toString(),
  } : null;
  const state: InspirationProcessingStatus = { profileId: input.profileId, inspirationId: input.inspirationId, receipt,
    currentMaterialRevision: source.revision?.toString() ?? null, requestedMaterialRevision: requested?.materialRevision.toString() ?? null,
    latestDerivedRevision: String(progress?.derived ?? '0'), latestCompletedRevision: String(progress?.completed ?? '0'),
    superseded: Boolean(requested && requested.id !== current?.id), phase: 'unknown', stage: null,
    runAfter: null, result: null, unavailableAttachments: 0, canRetry: true };

  const [media] = await db.execute(sql`SELECT
    count(*) FILTER (WHERE a.material_status::text = 'unavailable')::int AS unavailable,
    count(*) FILTER (WHERE a.material_status IS NULL OR a.material_status::text IN ('pending','failed'))::int AS unfinished,
    coalesce(bool_or(j.status::text = 'failed' OR (j.status::text = 'running' AND (j.locked_at IS NULL OR j.locked_at < now() - ${STALE_LOCK_SECONDS} * interval '1 second') AND j.attempts >= j.max_attempts))
      FILTER (WHERE a.material_status IS NULL OR a.material_status::text IN ('pending','failed')), false) AS failed,
    coalesce(bool_or(j.id IS NULL OR j.status::text = 'succeeded')
      FILTER (WHERE a.material_status IS NULL OR a.material_status::text IN ('pending','failed')), false) AS untracked,
    coalesce(bool_or(j.status::text = 'running' AND j.locked_at >= now() - ${STALE_LOCK_SECONDS} * interval '1 second')
      FILTER (WHERE a.material_status IS NULL OR a.material_status::text IN ('pending','failed')), false) AS running,
    coalesce(bool_or(a.enrichment_retry_count < ${MAX_ENRICHMENT_RETRIES} OR a.enrichment_retry_window_at IS NULL OR
      a.enrichment_retry_window_at <= now() - ${ENRICHMENT_RETRY_WINDOW_MS} * interval '1 millisecond')
      FILTER (WHERE a.material_status IS NULL OR a.material_status::text IN ('pending','failed')), false) AS retry_allowed,
    min(j.run_after) FILTER (WHERE j.status::text = 'pending' AND (a.material_status IS NULL OR a.material_status::text IN ('pending','failed'))) AS run_after
    FROM (SELECT attachments.*, ${effectiveAttachmentStatus} AS material_status FROM attachments) a
    LEFT JOIN background_jobs j ON j.idempotency_key = 'enrich_attachment:' || a.id::text
      AND j.profile_id = a.profile_id AND j.type::text = 'enrich_attachment'
      AND j.payload->>'inspirationId' = a.inspiration_id::text
    WHERE a.profile_id = ${input.profileId}::uuid AND a.inspiration_id = ${input.inspirationId}::uuid`);
  state.unavailableAttachments = Number(media?.unavailable ?? 0);
  if (Number(media?.unfinished ?? 0) > 0) {
    const runAfter = media?.run_after ? new Date(String(media.run_after)) : null;
    state.stage = 'enrichment';
    state.phase = media?.failed ? 'failed' : media?.untracked ? 'unknown' : media?.running ? 'processing' : runAfter && runAfter > now ? 'waiting' : 'queued';
    state.runAfter = state.phase === 'waiting' ? runAfter!.toISOString() : null;
    state.canRetry = (state.phase === 'failed' || state.phase === 'unknown') && media?.retry_allowed === true;
    return state;
  }
  if (!current) {
    const [active] = await db.select().from(backgroundJobs).where(and(eq(backgroundJobs.profileId, input.profileId),
      eq(backgroundJobs.type, 'derive_signals'), eq(backgroundJobs.idempotencyKey, `derive_signals:${input.inspirationId}`))).limit(1);
    Object.assign(state, jobState(active, now));
    state.stage = 'derivation';
    state.canRetry = state.phase === 'failed' || state.phase === 'unknown';
    return state;
  }
  if (current.completedAt && current.derivedAt) {
    const result = parseTopOfMindRefreshResult(current.result);
    const owned = !result?.topOfMindId || (await db.select({ id: topOfMinds.id }).from(topOfMinds)
      .where(and(eq(topOfMinds.id, result.topOfMindId), eq(topOfMinds.profileId, input.profileId), eq(topOfMinds.version, result.version))).limit(1)).length > 0;
    if (result && owned) return { ...state, phase: 'ready', result, canRetry: false };
    return state;
  }
  state.stage = current.derivedAt ? 'reading' : 'derivation';
  const jobId = current.derivedAt ? current.readingJobId : current.derivationJobId;
  const required = current.derivedAt ? current.readingRequestVersion : current.derivationRequestVersion;
  const [job] = jobId ? await db.select().from(backgroundJobs).where(and(eq(backgroundJobs.id, jobId),
    eq(backgroundJobs.profileId, input.profileId), eq(backgroundJobs.type, current.derivedAt ? 'refresh_top_of_mind' : 'derive_signals'))).limit(1) : [];
  if (job && required !== null && job.requestVersion >= required) Object.assign(state, jobState(job, now));
  state.canRetry = state.phase === 'failed' || state.phase === 'unknown';
  return state;
}
