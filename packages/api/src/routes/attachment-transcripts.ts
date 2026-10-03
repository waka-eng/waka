import { and, eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { attachments, inspirations, profiles, type Attachment } from '../db/index.js';
import { getDb } from '../lib/db.js';
import { asAccountProfile, profileAccessError, type AuthEnv, type ProfileOperation } from '../lib/middleware.js';
import { wakeCommittedBackgroundJobs } from '../lib/queue.js';
import { attachmentAnalysisState, recoverAttachmentAnalysis } from '../lib/attachment-analysis-retry.js';
import { requestSignalDerivation } from '../lib/inspiration-derivation-requests.js';
import { MAX_TRANSCRIPT_CHARS } from '../lib/audio-transcription.js';

const revision = z.string().regex(/^(0|[1-9]\d{0,9})$/).refine(value => Number(value) <= 2147483646);
const editSchema = z.object({ revision, correction: z.string().max(MAX_TRANSCRIPT_CHARS).nullable() }).strict();
const retrySchema = z.object({ revision }).strict();

/** Mounted under attachment auth. Public captures never grant another
 * account access to this private raw-transcript editing surface. */
export function createAttachmentTranscriptRoutes(getDatabase: typeof getDb) {
  const routes = new Hono<AuthEnv>();
  async function access(c: Context<AuthEnv>, operation: ProfileOperation) {
    c.header('Cache-Control', 'private, no-store');
    const id = z.string().uuid().safeParse(c.req.param('attachmentId'));
    if (!id.success) return c.json({ error: 'Invalid recording' }, 400);
    const db = getDatabase(), session = c.get('session');
    const [found] = await db.select({ row: attachments, accountId: profiles.accountId, type: profiles.type })
      .from(attachments).innerJoin(profiles, eq(profiles.id, attachments.profileId))
      .where(and(eq(attachments.id, id.data), eq(attachments.type, 'audio'))).limit(1);
    if (!found || found.accountId !== session.profile.accountId) return c.json({ error: 'Recording not found' }, 404);
    const target = asAccountProfile({ id: found.row.profileId, accountId: found.accountId, type: found.type });
    if (!target) return c.json({ error: 'Recording not found' }, 404);
    const denied = await profileAccessError(db, session, target, operation);
    if (denied) return c.json(denied, 403);
    return { row: found.row, canEdit: !await profileAccessError(db, session, target, 'write') };
  }
  async function present(row: Attachment, canEdit: boolean) {
    const analysis = await attachmentAnalysisState(getDatabase(), row, canEdit);
    const transcript = row.enrichmentKind === 'audio_transcription' ? row.enrichmentText : null;
    return { attachmentId: row.id, inspirationId: row.inspirationId, profileId: row.profileId,
      revision: String(row.transcriptRevision), ...analysis, transcript, correction: row.transcriptCorrection,
      effectiveText: row.transcriptCorrection ?? transcript, correctedAt: row.transcriptCorrectedAt?.toISOString() ?? null,
      reason: row.enrichmentErrorReason, canEdit };
  }
  routes.get('/:attachmentId/transcript', async c => {
    const allowed = await access(c, 'read');
    if (allowed instanceof Response) return allowed;
    return c.json(await present(allowed.row, allowed.canEdit));
  });
  routes.patch('/:attachmentId/transcript', async c => {
    const allowed = await access(c, 'write');
    if (allowed instanceof Response) return allowed;
    const input = editSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: 'Enter a valid transcript correction' }, 400);
    const saved = await getDatabase().transaction(async tx => {
      const [parent] = await tx.select({ id: inspirations.id }).from(inspirations)
        .where(and(eq(inspirations.id, allowed.row.inspirationId), eq(inspirations.profileId, allowed.row.profileId))).for('update');
      if (!parent) return null;
      const [current] = await tx.select().from(attachments).where(and(eq(attachments.id, allowed.row.id), eq(attachments.profileId, allowed.row.profileId))).for('update');
      if (!current || current.type !== 'audio') return null;
      if (current.transcriptCorrection === input.data.correction) return current;
      if (String(current.transcriptRevision) !== input.data.revision) return 'conflict' as const;
      const [next] = await tx.update(attachments).set({ transcriptCorrection: input.data.correction,
        transcriptRevision: current.transcriptRevision + 1, transcriptCorrectedAt: input.data.correction === null ? null : new Date(), updatedAt: new Date() })
        .where(eq(attachments.id, current.id)).returning();
      await requestSignalDerivation({ profileId: current.profileId, inspirationId: current.inspirationId, reason: 'edited', changedSource: 'inspiration' }, tx);
      return next!;
    });
    if (!saved) return c.json({ error: 'Recording not found' }, 404);
    if (saved === 'conflict') return c.json({ error: 'This transcript changed. Your edit is still here.', code: 'transcript_changed' }, 409);
    await wakeCommittedBackgroundJobs();
    return c.json(await present(saved, true));
  });
  routes.post('/:attachmentId/transcript/retry', async c => {
    const allowed = await access(c, 'write');
    if (allowed instanceof Response) return allowed;
    const input = retrySchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: 'Invalid retry request' }, 400);
    const saved = await getDatabase().transaction(tx => recoverAttachmentAnalysis(tx, { profileId: allowed.row.profileId,
      attachmentId: allowed.row.id, expectedType: 'audio', transcriptRevision: input.data.revision }));
    if (!saved) return c.json({ error: 'Recording not found' }, 404);
    if (saved === 'rate_limited') return c.json({ error: 'This recording has reached its retry limit. Try again later.', code: 'transcript_retry_limit' }, 429);
    if (saved === 'conflict') return c.json({ error: 'This transcript changed. Reload it before retrying.', code: 'transcript_changed' }, 409);
    await wakeCommittedBackgroundJobs();
    return c.json(await present(saved, true), 202);
  });
  return routes;
}
