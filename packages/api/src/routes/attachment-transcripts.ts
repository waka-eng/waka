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
import { MAX_IMAGE_DESCRIPTION_CHARS } from '../lib/image-description.js';
import { imageWordsState } from '../lib/image-words.js';

const revision = z.string().regex(/^(0|[1-9]\d{0,9})$/).refine(value => Number(value) <= 2147483646);
const editSchema = z.object({ revision, correction: z.string().max(MAX_TRANSCRIPT_CHARS).nullable() }).strict();
const retrySchema = z.object({ revision }).strict();
/** An image's fix is a line the owner read there; reverting is `null`, and
 * "no words" is what the machine already says when it found none. */
const wordsEditSchema = z.object({ revision,
  correction: z.string().trim().min(1).max(MAX_IMAGE_DESCRIPTION_CHARS).nullable() }).strict();

/** Mounted under attachment auth. Public captures never grant another
 * account access to this private raw-transcript editing surface, nor to the
 * words read from a saved image (`/:attachmentId/words`), which share it:
 * one correction column, one revision, one recovery budget. */
export function createAttachmentTranscriptRoutes(getDatabase: typeof getDb) {
  const routes = new Hono<AuthEnv>();
  async function access(c: Context<AuthEnv>, operation: ProfileOperation, kind: 'audio' | 'image' = 'audio') {
    c.header('Cache-Control', 'private, no-store');
    const noun = kind === 'audio' ? 'Recording' : 'Image';
    const id = z.string().uuid().safeParse(c.req.param('attachmentId'));
    if (!id.success) return c.json({ error: `Invalid ${noun.toLowerCase()}` }, 400);
    const db = getDatabase(), session = c.get('session');
    const [found] = await db.select({ row: attachments, accountId: profiles.accountId, type: profiles.type })
      .from(attachments).innerJoin(profiles, eq(profiles.id, attachments.profileId))
      .where(and(eq(attachments.id, id.data), eq(attachments.type, kind))).limit(1);
    // A chat photo is never read, so it has no words to show or fix.
    if (!found || found.accountId !== session.profile.accountId || !found.row.inspirationId) return c.json({ error: `${noun} not found` }, 404);
    const target = asAccountProfile({ id: found.row.profileId, accountId: found.accountId, type: found.type });
    if (!target) return c.json({ error: `${noun} not found` }, 404);
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
  /** One correction path for both kinds. The column change itself advances
   * the inspiration's material revision and withdraws stale quotes,
   * embeddings and questions (attachment triggers, migrations 0051/0054);
   * the derivation request re-reads the source with the owner's words. */
  async function correct(row: Attachment, kind: 'audio' | 'image', input: { revision: string; correction: string | null }) {
    return getDatabase().transaction(async tx => {
      const inspirationId = row.inspirationId;
      if (!inspirationId) return null;
      const [parent] = await tx.select({ id: inspirations.id }).from(inspirations)
        .where(and(eq(inspirations.id, inspirationId), eq(inspirations.profileId, row.profileId))).for('update');
      if (!parent) return null;
      const [current] = await tx.select().from(attachments).where(and(eq(attachments.id, row.id), eq(attachments.profileId, row.profileId))).for('update');
      if (!current || current.type !== kind) return null;
      if (current.transcriptCorrection === input.correction) return current;
      if (String(current.transcriptRevision) !== input.revision) return 'conflict' as const;
      const [next] = await tx.update(attachments).set({ transcriptCorrection: input.correction,
        transcriptRevision: current.transcriptRevision + 1, transcriptCorrectedAt: input.correction === null ? null : new Date(), updatedAt: new Date() })
        .where(eq(attachments.id, current.id)).returning();
      await requestSignalDerivation({ profileId: current.profileId, inspirationId, reason: 'edited' }, tx);
      return next!;
    });
  }
  routes.patch('/:attachmentId/transcript', async c => {
    const allowed = await access(c, 'write');
    if (allowed instanceof Response) return allowed;
    const input = editSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: 'Enter a valid transcript correction' }, 400);
    const saved = await correct(allowed.row, 'audio', input.data);
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

  async function presentWords(row: Attachment, canEdit: boolean) {
    const analysis = await attachmentAnalysisState(getDatabase(), row, canEdit);
    return { attachmentId: row.id, inspirationId: row.inspirationId, profileId: row.profileId,
      ...imageWordsState(row, analysis.status as 'pending' | 'ready' | 'failed' | 'unavailable'),
      correctedAt: row.transcriptCorrectedAt?.toISOString() ?? null,
      canEdit, canRetry: analysis.canRetry, retryAfter: analysis.retryAfter };
  }
  routes.get('/:attachmentId/words', async c => {
    const allowed = await access(c, 'read', 'image');
    if (allowed instanceof Response) return allowed;
    return c.json(await presentWords(allowed.row, allowed.canEdit));
  });
  routes.patch('/:attachmentId/words', async c => {
    const allowed = await access(c, 'write', 'image');
    if (allowed instanceof Response) return allowed;
    const input = wordsEditSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: 'Enter the words as they appear' }, 400);
    const saved = await correct(allowed.row, 'image', input.data);
    if (!saved) return c.json({ error: 'Image not found' }, 404);
    if (saved === 'conflict') return c.json({ error: 'These words changed. Your edit is still here.', code: 'words_changed' }, 409);
    await wakeCommittedBackgroundJobs();
    return c.json(await presentWords(saved, true));
  });
  routes.post('/:attachmentId/words/retry', async c => {
    const allowed = await access(c, 'write', 'image');
    if (allowed instanceof Response) return allowed;
    if (!z.object({}).strict().safeParse(await c.req.json().catch(() => null)).success) return c.json({ error: 'Invalid retry request' }, 400);
    /* The owner already gave the words: a read could change nothing shown,
       so it is refused rather than paid for (code review, 2026-11-08). */
    if (allowed.row.transcriptCorrection !== null) return c.json({ error: 'You already gave the words for this image.', code: 'words_given' }, 409);
    const saved = await getDatabase().transaction(tx => recoverAttachmentAnalysis(tx, { profileId: allowed.row.profileId,
      attachmentId: allowed.row.id, expectedType: 'image' }));
    if (!saved || saved === 'conflict') return c.json({ error: 'Image not found' }, 404);
    if (saved === 'rate_limited') return c.json({ error: 'This image has reached its retry limit. Try again later.', code: 'words_retry_limit' }, 429);
    await wakeCommittedBackgroundJobs();
    return c.json(await presentWords(saved, true), 202);
  });
  return routes;
}
