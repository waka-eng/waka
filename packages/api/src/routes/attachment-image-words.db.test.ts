/** WHAT THIS MOCKS, AND WHY (gate G6): `authMiddleware` supplies scoped
 * principals and `getDb` chooses disposable SQL; `client` returns a fixed
 * embedding vector. Actual routes, transactions, effective inputs, triggers,
 * recovery and jobs run. No model is called. */
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import { createAttachmentRoutes } from './attachments.js';
import { loadInspirationMaterial } from '../lib/inspiration-material.js';
import { ensureInspirationEmbedding } from '../lib/inspiration-embeddings.js';
import { readConversationMaterial } from '../lib/conversation-material.js';
import { recoverInspirationProcessing } from '../lib/inspiration-processing-recovery.js';
import { readInspirationProcessingStatus } from '../lib/inspiration-processing-status.js';
import type { AuthEnv } from '../lib/middleware.js';
const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('../lib/db.js', () => ({ getDb: () => state.db }));
let t: TestDatabase, sequence = 0;
beforeEach(async () => { t ??= await createTestDatabase(); await t.truncateAll(); state.db = t.db; vi.stubEnv('WAKA_BACKGROUND_JOB_AUTODRAIN', '0'); });
afterAll(async () => { vi.unstubAllEnvs(); await t?.cleanup(); });

const READ = 'Words: Start before you are ready.\nImage: A screenshot of a video with a burned-in caption.';
async function fixture(enrichment: { status: string | null; text: string | null; reason?: string | null } = { status: 'ready', text: READ }) {
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES (${`image-words-${++sequence}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${account.id},'human','Owner') RETURNING id`;
  const [source] = await t.sql`INSERT INTO inspirations(profile_id,text,visibility) VALUES (${profile.id},'','public') RETURNING id`;
  const [image] = await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,s3_key,content_type,enrichment_status,enrichment_kind,enrichment_text,enrichment_error_reason)
    VALUES (${profile.id},${source.id},'image','https://example.test/shot','owned/shot.png','image/png',${enrichment.status},
      ${enrichment.status === 'ready' ? 'image_description' : null},${enrichment.text},${enrichment.reason ?? null}) RETURNING id`;
  const app = new Hono<AuthEnv>();
  app.route('/api/attachments', createAttachmentRoutes({ getDatabase: () => t.db as never, authMiddleware: async (c, next) => {
    c.set('session', { sessionId: randomUUID(), account: { id: account.id, email: 'fixture@example.test' },
      profile: { id: profile.id, accountId: account.id, type: 'human', name: 'Owner', preferredLocale: 'en-US' } }); await next();
  } }));
  const path = `/api/attachments/${image.id}/words`;
  const edit = (correction: string | null, revision = '0') => app.request(path, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ correction, revision }) });
  return { app, path, edit, id: image.id as string, sourceId: source.id as string, profileId: profile.id as string };
}

it('shows the owner the words read, apart from the scene description', async () => {
  const f = await fixture();
  const response = await f.app.request(f.path);
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
  expect(await response.json()).toMatchObject({ attachmentId: f.id, inspirationId: f.sourceId, status: 'ready',
    text: 'Start before you are ready.', read: 'Start before you are ready.', correction: null, revision: '0', canEdit: true, canRetry: false });
});
it('does not expose or change another account image words, even on a public capture', async () => {
  const owner = await fixture(), other = await fixture();
  expect((await other.app.request(owner.path)).status).toBe(404);
  expect((await other.app.request(owner.path, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ correction: 'foreign', revision: '0' }) })).status).toBe(404);
  expect((await other.app.request(owner.path + '/retry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(404);
  expect((await t.sql`SELECT transcript_correction FROM attachments WHERE id=${owner.id}`)[0]?.transcript_correction).toBeNull();
});
it('carries the words inline on the inspiration attachment shape', async () => {
  const f = await fixture(); await f.edit('The line that stuck');
  const details = await (await f.app.request(`/api/attachments/${f.id}/details`)).json() as { attachment: { enrichment: { words: unknown } } };
  expect(details.attachment.enrichment.words).toEqual({ status: 'ready', text: 'The line that stuck',
    read: 'Start before you are ready.', correction: 'The line that stuck', revision: '1' });
});
it('flows a fix into material, conversation, embeddings and a new learning pass', async () => {
  const f = await fixture();
  const embed = vi.fn(async (_input: string) => Array.from({ length: 768 }, () => .1));
  const client = { model: 'fixture-embedding', embed };
  await ensureInspirationEmbedding({ db: t.db as never, profileId: f.profileId, inspirationId: f.sourceId, client });
  const before = await loadInspirationMaterial(t.db as never, f.profileId, f.sourceId, 'personal');
  const saved = await f.edit('You do not need permission to begin.');
  expect(saved.status).toBe(200);
  expect(await saved.json()).toMatchObject({ status: 'ready', text: 'You do not need permission to begin.', read: 'Start before you are ready.', revision: '1' });
  const material = await loadInspirationMaterial(t.db as never, f.profileId, f.sourceId, 'personal');
  /* The fix replaces the WORDS; the description of the picture stays. */
  expect(material?.attachmentRows).toMatchObject([{ kind: 'image_description', status: 'ready',
    text: 'Words: You do not need permission to begin.\nImage: A screenshot of a video with a burned-in caption.' }]);
  expect(material?.identity.revision).not.toBe(before?.identity.revision);
  expect(await t.sql`SELECT id FROM background_jobs WHERE type='derive_signals'`).toHaveLength(1);
  expect(await t.sql`SELECT id FROM inspiration_embeddings`).toHaveLength(0);
  await ensureInspirationEmbedding({ db: t.db as never, profileId: f.profileId, inspirationId: f.sourceId, client });
  expect(embed.mock.calls[1]?.[0]).toContain('You do not need permission to begin.');
  expect(embed.mock.calls[1]?.[0]).toContain('burned-in caption');
  expect(embed.mock.calls[1]?.[0]).not.toContain('Start before you are ready.');
  const [conversation] = await readConversationMaterial(t.db as never, f.profileId, ['permission']);
  expect(conversation?.text).toContain('Image (the words are your correction):\nWords: You do not need permission to begin.\nImage: A screenshot of a video with a burned-in caption.');
});
it('keeps a reading from before the two-part shape whole as the picture, under a fix, and quotes none of it', async () => {
  const legacy = 'A photograph of a cat on a sofa.';
  const f = await fixture({ status: 'ready', text: legacy });
  expect(await (await f.app.request(f.path)).json()).toMatchObject({ status: 'unknown', text: null, read: null });
  await f.edit('Cats know.');
  const material = await loadInspirationMaterial(t.db as never, f.profileId, f.sourceId, 'personal');
  expect(material?.attachmentRows).toMatchObject([{ text: 'Words: Cats know.\nImage: A photograph of a cat on a sofa.' }]);
});
it('reads the words and keeps the picture under a fix however the model formatted its labels', async () => {
  for (const reading of [
    'Here is what I see:\n**Words:** "Start before you are ready."\n**Image:** A reel with a caption.',
    '## WORDS:\nStart before you are ready.\n\n## image:\nA reel with a caption.',
    /* Image first (code review, 2026-11-08): the description was dropped. */
    'Image: A reel with a caption.\nWords: Start before you are ready.',
    '**Image:** A reel with a caption.\n\n**Words:** "Start before you are ready."',
  ]) {
    const f = await fixture({ status: 'ready', text: reading });
    expect(await (await f.app.request(f.path)).json(), reading).toMatchObject({ status: 'ready', text: 'Start before you are ready.' });
    await f.edit('Begin anyway.');
    const material = await loadInspirationMaterial(t.db as never, f.profileId, f.sourceId, 'personal');
    expect(material?.attachmentRows, reading).toMatchObject([{ text: 'Words: Begin anyway.\nImage: A reel with a caption.' }]);
  }
});
it('refuses a stale or empty fix and can return to the words read', async () => {
  const f = await fixture(); await f.edit('First fix');
  expect((await f.edit('Stale fix')).status).toBe(409);
  expect((await f.edit('   ', '1')).status).toBe(400);
  expect(await (await f.edit(null, '1')).json()).toMatchObject({ status: 'ready', correction: null, text: 'Start before you are ready.', revision: '2' });
});
it('asks for the line when the model found no words, and a fix answers it', async () => {
  const f = await fixture({ status: 'ready', text: 'Words: none\nImage: A photograph of a street at night.' });
  expect(await (await f.app.request(f.path)).json()).toMatchObject({ status: 'unreadable', text: null });
  expect(await (await f.edit('The sign said OPEN LATE')).json()).toMatchObject({ status: 'ready', text: 'The sign said OPEN LATE' });
});
it('reads an image that failed on an out-of-credit 402 again through inspiration recovery', async () => {
  const f = await fixture({ status: 'failed', text: null, reason: 'Image description failed (HTTP 402)' });
  // The queue spent its attempts while the account had no credit.
  await t.sql`INSERT INTO background_jobs(profile_id,type,payload,status,attempts,max_attempts,idempotency_key)
    VALUES (${f.profileId},'enrich_attachment',${JSON.stringify({ attachmentId: f.id, inspirationId: f.sourceId })}::jsonb,'failed',5,5,${`enrich_attachment:${f.id}`})`;
  expect(await (await f.app.request(f.path)).json()).toMatchObject({ status: 'retrying', canRetry: true });
  const input = { profileId: f.profileId, inspirationId: f.sourceId };
  expect(await readInspirationProcessingStatus(t.db as never, input)).toMatchObject({ stage: 'enrichment', phase: 'failed', canRetry: true });
  await recoverInspirationProcessing(t.db as never, input);
  expect((await t.sql`SELECT status::text, attempts FROM background_jobs WHERE type='enrich_attachment'`)[0]).toEqual({ status: 'pending', attempts: 0 });
  expect((await t.sql`SELECT enrichment_status::text, enrichment_error_reason, enrichment_retry_count FROM attachments WHERE id=${f.id}`)[0])
    .toEqual({ enrichment_status: 'pending', enrichment_error_reason: null, enrichment_retry_count: 1 });
  expect(await (await f.app.request(f.path)).json()).toMatchObject({ status: 'retrying', canRetry: false });
});
it('does not spend a model read on an image whose words the owner already gave', async () => {
  const f = await fixture({ status: 'failed', text: null, reason: 'Image description failed (HTTP 402)' });
  await f.edit('The line I remember');
  await recoverInspirationProcessing(t.db as never, { profileId: f.profileId, inspirationId: f.sourceId });
  expect(await t.sql`SELECT id FROM background_jobs WHERE type='enrich_attachment'`).toHaveLength(0);
});
it('retries a failed read directly and bounds it by the shared budget', async () => {
  const f = await fixture({ status: 'failed', text: null, reason: 'Image description transport failed' });
  const retry = () => f.app.request(f.path + '/retry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const first = await retry(); expect(first.status).toBe(202);
  expect(await first.json()).toMatchObject({ status: 'retrying', canRetry: false });
  await t.sql`UPDATE attachments SET enrichment_retry_count=3,enrichment_retry_window_at=now(),enrichment_status='failed' WHERE id=${f.id}`;
  await t.sql`UPDATE background_jobs SET status='failed' WHERE type='enrich_attachment'`;
  expect((await retry()).status).toBe(429);
});
