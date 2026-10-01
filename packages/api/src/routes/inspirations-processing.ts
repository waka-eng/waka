import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../lib/db.js';
import type { AuthEnv } from '../lib/middleware.js';
import { loadInspirationProcessingStatus } from '../lib/inspiration-processing-status.js';
import { recoverInspirationProcessing } from '../lib/inspiration-processing-recovery.js';
import { resolveTargetProfile } from './inspirations-tenancy.js';
import { profileQuerySchema, uuidSchema } from './inspirations-validation.js';

export function registerProcessingRoutes(routes: Hono<AuthEnv>, getDatabase: typeof getDb): void {
  routes.post('/:id/processing/retry', async (c) => {
    c.header('Cache-Control', 'private, no-store');
    const id = uuidSchema.safeParse(c.req.param('id'));
    const query = profileQuerySchema.safeParse(c.req.query());
    const body = z.object({ receiptId: uuidSchema.optional() }).strict().safeParse(await c.req.json().catch(() => null));
    if (!id.success || !query.success || !body.success) return c.json({ error: 'Invalid processing retry' }, 400);
    const db = getDatabase();
    const target = await resolveTargetProfile(db, c.get('session'), query.data.profile, 'write');
    if (!target.ok) return c.json(target.body, target.status);
    try {
      const status = await recoverInspirationProcessing(db, { profileId: target.profileId, inspirationId: id.data, receiptId: body.data.receiptId });
      if (!status) return c.json({ error: 'Processing request not found' }, 404);
      return c.json(status, status.phase === 'ready' ? 200 : 202);
    } catch (error) {
      const code = (error as { code?: string; cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code;
      if (code === '55P03') return c.json({ error: 'An update is already in progress. Check again shortly.' }, 409);
      throw error;
    }
  });

  routes.get('/:id/processing', async (c) => {
    c.header('Cache-Control', 'private, no-store');
    const id = uuidSchema.safeParse(c.req.param('id'));
    const query = profileQuerySchema.extend({ receipt: uuidSchema.optional() }).safeParse(c.req.query());
    if (!id.success || !query.success) return c.json({ error: 'Invalid processing request' }, 400);
    const db = getDatabase();
    const target = await resolveTargetProfile(db, c.get('session'), query.data.profile, 'read');
    if (!target.ok) return c.json(target.body, target.status);
    const status = await loadInspirationProcessingStatus(db, { profileId: target.profileId, inspirationId: id.data, receiptId: query.data.receipt });
    if (!status) return c.json({ error: 'Processing request not found' }, 404);
    const writer = await resolveTargetProfile(db, c.get('session'), target.profileId, 'write');
    return c.json({ ...status, canRetry: status.canRetry && writer.ok && !c.get('session').keyScoped });
  });
}
