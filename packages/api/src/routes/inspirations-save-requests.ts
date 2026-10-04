import { and, asc, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { attachments, inspirationSaveRequests, inspirations, reflections } from '../db/index.js';
import { getDb } from '../lib/db.js';
import type { AuthEnv } from '../lib/middleware.js';
import { InspirationSaveError, type InspirationSaveTransaction, type SavedInspirationReference } from '../lib/inspiration-save-requests.js';
import { attachmentSelection, serializeAttachment } from './attachments.js';
import { inspirationSelection, reflectionSelection, serializeInspirationDetail, serializeReflection } from './inspirations-serialization.js';
import { resolveTargetProfile } from './inspirations-tenancy.js';
import { profileQuerySchema, uuidSchema } from './inspirations-validation.js';
import {readConversationOrigin} from '../lib/conversation-capture.js';

export async function readSavedInspiration(tx: InspirationSaveTransaction, profileId: string, saved: SavedInspirationReference) {
  const [source] = await tx.select(inspirationSelection).from(inspirations)
    .where(and(eq(inspirations.profileId, profileId), eq(inspirations.id, saved.inspirationId))).for('key share', { noWait: true });
  if (!source) throw new InspirationSaveError(410, 'saved_item_removed', 'That saved item was removed.');
  const media = await tx.select(attachmentSelection).from(attachments)
    .where(and(eq(attachments.profileId, profileId), eq(attachments.inspirationId, source.id))).orderBy(asc(attachments.createdAt), asc(attachments.id));
  const answers = await tx.select(reflectionSelection).from(reflections)
    .where(and(eq(reflections.profileId, profileId), eq(reflections.inspirationId, source.id))).orderBy(asc(reflections.createdAt), asc(reflections.id));
  return { inspiration: {...serializeInspirationDetail(source, { attachments: media.map(serializeAttachment), reflections: answers }),conversationOrigin:await readConversationOrigin(tx,profileId,source.id)}, processing: saved.processing };
}

export async function readSavedReflection(tx: InspirationSaveTransaction, profileId: string, saved: SavedInspirationReference) {
  if (!saved.reflectionId) throw new InspirationSaveError(410, 'saved_item_removed', 'That saved item was removed.');
  const [answer] = await tx.select(reflectionSelection).from(reflections)
    .where(and(eq(reflections.profileId, profileId), eq(reflections.inspirationId, saved.inspirationId), eq(reflections.id, saved.reflectionId))).for('key share', { noWait: true });
  if (!answer) throw new InspirationSaveError(410, 'saved_item_removed', 'That saved item was removed.');
  return { reflection: serializeReflection(answer), processing: saved.processing };
}

export function registerSaveRequestRoutes(routes: Hono<AuthEnv>, getDatabase: typeof getDb) {
  routes.get('/save-requests/:requestId', async (c) => {
    c.header('Cache-Control', 'private, no-store');
    const id = uuidSchema.safeParse(c.req.param('requestId')), query = profileQuerySchema.safeParse(c.req.query());
    if (!id.success || !query.success) return c.json({ error: 'Invalid save request' }, 400);
    const db = getDatabase();
    const target = await resolveTargetProfile(db, c.get('session'), query.data.profile, 'read');
    if (!target.ok) return c.json(target.body, target.status);
    const [saved] = await db.select().from(inspirationSaveRequests).where(and(eq(inspirationSaveRequests.profileId, target.profileId),
      eq(inspirationSaveRequests.requestId, id.data))).limit(1);
    // An in-flight transaction is intentionally invisible: not found means
    // no committed record was observed, not permission to choose a new key.
    if (!saved) return c.json({ error: 'No committed save found', code: 'save_not_found' }, 404);
    if (!saved.inspirationId || !saved.processing) return c.json({ error: 'That saved item was removed.', code: 'saved_item_removed' }, 410);
    if (saved.processing.profileId !== target.profileId || saved.processing.inspirationId !== saved.inspirationId) throw new Error('Invalid stored save binding');
    return c.json({ saveRequest: { requestId: saved.requestId, operation: saved.operation, inspirationId: saved.inspirationId,
      reflectionId: saved.reflectionId, processing: saved.processing, createdAt: saved.createdAt.toISOString() } });
  });
}
