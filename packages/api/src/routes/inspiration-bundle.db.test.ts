/** WHAT THIS MOCKS, AND WHY (gate G6): `authMiddleware`, `getDb` and
 * `attachmentHead` supply the local principal, disposable database and S3
 * transport. Hono, transactions, persistence, queue writes and replay are real. */
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import type { AuthEnv } from '../lib/middleware.js';
import type { AttachmentHead } from '../lib/inspiration-attachments.js';
import { createInspirationsRoutes } from './inspirations.js';
import type { readSavedInspiration } from './inspirations-save-requests.js';
type Saved = Awaited<ReturnType<typeof readSavedInspiration>>;
const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('../lib/db.js', () => ({ getDb: () => state.db }));
let t: TestDatabase, sequence = 0;
beforeEach(async () => { t ??= await createTestDatabase(); await t.truncateAll(); state.db = t.db; vi.stubEnv('ATTACHMENTS_BUCKET', 'bundle-fixture'); });
afterAll(async () => { vi.unstubAllEnvs(); await t?.cleanup(); });
async function fixture(head: AttachmentHead = async () => ({ ContentLength: 120, ContentType: 'audio/webm' })) {
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES (${`bundle-${++sequence}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${account.id},'human','Owner') RETURNING id`;
  const app = new Hono<AuthEnv>();
  app.route('/api/inspirations', createInspirationsRoutes({ getDatabase: () => t.db as never, attachmentHead: head,
    authMiddleware: async (c, next) => { c.set('session', { sessionId: randomUUID(), account: { id: account.id, email: 'owner@example.test' },
      profile: { id: profile.id, accountId: account.id, type: 'human', name: 'Owner', preferredLocale: 'en-US' } }); await next(); } }));
  const audio = { type: 'audio', key: `profiles/${profile.id}/attachments/1-voice.webm`, name: 'Recording.webm', contentType: 'audio/webm', size: 120 };
  const post = (body: unknown, requestId = randomUUID()) => app.request('/api/inspirations', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestId }, body: JSON.stringify(body) });
  return { app, audio, post, profileId: profile.id as string };
}
it('commits attachment-only audio and link rows in the original save and replays without S3 or duplicates', async () => {
  const head = vi.fn<AttachmentHead>().mockResolvedValueOnce({ ContentLength: 120, ContentType: 'audio/webm' }).mockRejectedValue(new Error('Now offline'));
  const f = await fixture(head), requestId = randomUUID();
  const input = { text: '', kind: 'mixed', attachments: [f.audio, { type: 'link', url: 'https://example.test/kept' }] };
  const response = await f.post(input, requestId); expect(response.status).toBe(201);
  const saved = await response.json() as Saved;
  expect(saved.inspiration.text).toBe(''); expect(saved.inspiration.attachments).toHaveLength(2);
  const again = await f.post(input, requestId); expect(again.status).toBe(200);
  expect((await again.json() as Saved).inspiration.id).toBe(saved.inspiration.id);
  expect(await t.sql`SELECT id FROM inspirations`).toHaveLength(1);
  expect(await t.sql`SELECT id FROM attachments`).toHaveLength(2);
  expect(await t.sql`SELECT request_id FROM inspiration_save_requests`).toHaveLength(1);
  expect(head).toHaveBeenCalledOnce();
  expect((await f.app.request(`/api/inspirations/save-requests/${requestId}`)).status).toBe(200);
});
it('rolls back the source, attachments, jobs and save identity when an upload cannot be verified', async () => {
  const f = await fixture(async () => { throw new Error('S3 unavailable'); });
  const response = await f.post({ text: 'Keep these together', attachments: [{ type: 'link', url: 'https://example.test/link' }, f.audio] });
  expect(response.status).toBe(503);
  for (const table of ['inspirations', 'attachments', 'background_jobs', 'inspiration_save_requests']) expect(await t.sql.unsafe(`SELECT * FROM ${table}`)).toHaveLength(0);
});
it('binds the complete manifest to the save identity', async () => {
  const f = await fixture(), key = randomUUID();
  expect((await f.post({ text: 'A thought', attachments: [f.audio] }, key)).status).toBe(201);
  expect((await f.post({ text: 'A thought', attachments: [{ ...f.audio, name: 'Different recording' }] }, key)).status).toBe(409);
  expect(await t.sql`SELECT id FROM inspirations`).toHaveLength(1); expect(await t.sql`SELECT id FROM attachments`).toHaveLength(1);
});
it('refuses an upload from another profile without touching object storage or persisting partial content', async () => {
  const head = vi.fn<AttachmentHead>(); const f = await fixture(head);
  const response = await f.post({ attachments: [{ ...f.audio, key: `profiles/${randomUUID()}/attachments/1-other.webm` }] });
  expect(response.status).toBe(403); expect(head).not.toHaveBeenCalled();
  expect(await t.sql`SELECT id FROM inspirations`).toHaveLength(0);
});
it('replaying a deleted source cannot resurrect its attachments', async () => {
  const f = await fixture(), key = randomUUID(), input = { attachments: [f.audio] };
  const first = await (await f.post(input, key)).json() as Saved;
  await t.sql`DELETE FROM inspirations WHERE id=${first.inspiration.id}`;
  expect((await f.post(input, key)).status).toBe(410);
  expect(await t.sql`SELECT id FROM inspirations`).toHaveLength(0); expect(await t.sql`SELECT id FROM attachments`).toHaveLength(0);
});
it('a note carries a file: verified like a photo, recorded unavailable, never queued, and an executable is refused', async () => {
  const f = await fixture(async () => ({ ContentLength: 2048, ContentType: 'application/pdf' }));
  const file = { type: 'file', key: `profiles/${f.profileId}/attachments/2-plan.pdf`, name: 'Plan.pdf', contentType: 'application/pdf', size: 2048 };
  const response = await f.post({ text: 'The lease, for later.', kind: 'note', attachments: [file] });
  expect(response.status).toBe(201);
  const saved = await response.json() as Saved;
  expect(saved.inspiration.attachments).toMatchObject([{ type: 'file', name: 'Plan.pdf', contentType: 'application/pdf', size: 2048, enrichment: { status: 'unavailable' } }]);
  expect(await t.sql`SELECT id FROM background_jobs WHERE type::text = 'enrich_attachment'`).toHaveLength(0);
  expect((await f.post({ text: 'x', attachments: [{ ...file, key: `profiles/${f.profileId}/attachments/3-run.exe`, contentType: 'application/x-msdownload' }] })).status).toBe(400);
});
it('one stored object backs one attachment: a note cannot reuse an upload that is already attached', async () => {
  /* Security review 2026-10-16: deleting a note that reused a chat message's
     object would delete the chat's file with it. */
  const f = await fixture();
  expect((await f.post({ text: 'First', attachments: [f.audio] })).status).toBe(201);
  const reused = await f.post({ text: 'Second', attachments: [f.audio] });
  expect(reused.status).toBe(409);
  expect(await reused.json()).toMatchObject({ code: 'attachment_already_attached' });
  // The same object twice in one save never reaches storage: the schema refuses it.
  const twice = { ...f.audio, key: `profiles/${f.profileId}/attachments/9-twice.webm` };
  expect((await f.post({ text: 'Third', attachments: [twice, twice] })).status).toBe(400);
  expect(await t.sql`SELECT id FROM inspirations`).toHaveLength(1);
  expect(await t.sql`SELECT id FROM attachments`).toHaveLength(1);
});
