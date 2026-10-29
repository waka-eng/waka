/** WHAT THIS MOCKS, AND WHY (gate G6): `authMiddleware` supplies scoped
 * principals and `getDb` chooses disposable SQL; `readAttachment` supplies a
 * deferred model result and `client` returns a fixed embedding vector. Actual
 * routes, transactions, effective inputs, triggers and exports run. */
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import { createAttachmentRoutes } from './attachments.js';
import { enrichAttachment } from '../lib/signal-enrichment.js';
import { loadInspirationMaterial } from '../lib/inspiration-material.js';
import { assembleProfileExport } from '../lib/profile-export.js';
import { ensureInspirationEmbedding } from '../lib/inspiration-embeddings.js';
import type { AuthEnv } from '../lib/middleware.js';
const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('../lib/db.js', () => ({ getDb: () => state.db }));
let t: TestDatabase, sequence = 0;
beforeEach(async () => { t ??= await createTestDatabase(); await t.truncateAll(); state.db = t.db; vi.stubEnv('WAKA_BACKGROUND_JOB_AUTODRAIN', '0'); });
afterAll(async () => { vi.unstubAllEnvs(); await t?.cleanup(); });
async function fixture() {
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES (${`transcript-${++sequence}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${account.id},'human','Owner') RETURNING id`;
  const [source] = await t.sql`INSERT INTO inspirations(profile_id,text,visibility) VALUES (${profile.id},'Authored note','public') RETURNING id`;
  const [audio] = await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,s3_key,content_type,enrichment_status,enrichment_kind,enrichment_text)
    VALUES (${profile.id},${source.id},'audio','https://example.test/clip','owned/clip.webm','audio/webm','ready','audio_transcription','Machine words') RETURNING id`;
  const app = new Hono<AuthEnv>();
  app.route('/api/attachments', createAttachmentRoutes({ getDatabase: () => t.db as never, authMiddleware: async (c, next) => {
    c.set('session', { sessionId: randomUUID(), account: { id: account.id, email: 'fixture@example.test' },
      profile: { id: profile.id, accountId: account.id, type: 'human', name: 'Owner', preferredLocale: 'en-US' } }); await next();
  } }));
  const path = `/api/attachments/${audio.id}/transcript`;
  const edit = (correction: string | null, revision = '0') => app.request(path, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ correction, revision }) });
  return { app, path, edit, id: audio.id as string, sourceId: source.id as string, profileId: profile.id as string };
}
it('stores a correction separately and uses it as one effective source with a new material revision', async () => {
  const f = await fixture();
  const before = await loadInspirationMaterial(t.db as never, f.profileId, f.sourceId, 'personal');
  const saved = await f.edit('My corrected words'); expect(saved.status).toBe(200);
  expect(await saved.json()).toMatchObject({ transcript: 'Machine words', correction: 'My corrected words', effectiveText: 'My corrected words', revision: '1' });
  const material = await loadInspirationMaterial(t.db as never, f.profileId, f.sourceId, 'personal');
  expect(material?.inspiration.text).toBe('Authored note');
  expect(material?.attachmentRows).toHaveLength(1); expect(material?.attachmentRows[0]?.text).toBe('My corrected words');
  expect(material?.identity.revision).not.toBe(before?.identity.revision);
  expect(await t.sql`SELECT id FROM background_jobs WHERE type='derive_signals'`).toHaveLength(1);
  expect((await f.edit('My corrected words')).status).toBe(200);
  expect(await (await f.app.request(f.path)).json()).toMatchObject({ revision: '1' });
});
it('refuses a stale different edit and can explicitly return to original wording', async () => {
  const f = await fixture(); await f.edit('New wording');
  expect((await f.edit('Stale wording')).status).toBe(409);
  expect(await (await f.edit(null, '1')).json()).toMatchObject({ correction: null, effectiveText: 'Machine words', revision: '2' });
});
it('does not expose or change another account transcript even on a public capture', async () => {
  const owner = await fixture(), other = await fixture();
  expect((await other.app.request(owner.path)).status).toBe(404);
  expect((await other.app.request(owner.path, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ correction: 'foreign', revision: '0' }) })).status).toBe(404);
  expect((await other.app.request(owner.path + '/retry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"revision":"0"}' })).status).toBe(404);
});
it('rejects a late machine result after an owner correction, keeping the correction and original', async () => {
  const f = await fixture();
  // Exercise a real in-flight reread, rather than a replay of cached success.
  await t.sql`UPDATE attachments SET enrichment_status='pending' WHERE id=${f.id}`;
  await expect(enrichAttachment(f.id, { db: t.db as never, readAttachment: async () => {
    expect((await f.edit('Owner wins')).status).toBe(200);
    return { result: { status: 'ready', kind: 'audio_transcription', reason: null, text: 'Late machine words' } };
  } })).rejects.toThrow('Attachment material changed');
  expect(await (await f.app.request(f.path)).json()).toMatchObject({ correction: 'Owner wins', transcript: 'Machine words', effectiveText: 'Owner wins' });
});
it('retries failed work once without discarding a correction', async () => {
  const f = await fixture(); await f.edit('Correction remains');
  await t.sql`UPDATE attachments SET enrichment_status='failed' WHERE id=${f.id}`;
  const retry = () => f.app.request(f.path + '/retry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"revision":"1"}' });
  expect((await retry()).status).toBe(202); expect((await retry()).status).toBe(202);
  const [job] = await t.sql`SELECT request_version::text FROM background_jobs WHERE type='enrich_attachment'`;
  expect(job?.request_version).toBe('1');
  expect(await (await f.app.request(f.path)).json()).toMatchObject({ correction: 'Correction remains', status: 'pending', revision: '2', canRetry: false });
});
it('exports both versions and removes them with the parent inspiration', async () => {
  const f = await fixture(); await f.edit('Exported correction');
  const exported = await assembleProfileExport(t.db as never, f.profileId);
  expect(exported.attachments[0]).toMatchObject({ enrichmentText: 'Machine words', transcriptCorrection: 'Exported correction' });
  expect(() => JSON.stringify(exported)).not.toThrow();
  await t.sql`DELETE FROM inspirations WHERE id=${f.sourceId}`;
  expect((await f.app.request(f.path)).status).toBe(404);
  expect((await f.edit('Cannot restore', '1')).status).toBe(404);
  expect(await t.sql`SELECT id FROM attachments`).toHaveLength(0);
});
it('accepts an empty correction as no words rather than reverting to machine output', async () => {
  const f = await fixture(); await f.edit('');
  expect(await (await f.app.request(f.path)).json()).toMatchObject({ effectiveText: '', correction: '' });
  expect((await loadInspirationMaterial(t.db as never, f.profileId, f.sourceId, 'personal'))?.attachmentRows[0]?.text).toBe('');
});
it('withdraws stale quoted machine words and updates both private and public material', async () => {
  const f = await fixture();
  const [signal] = await t.sql`INSERT INTO signals(profile_id,statement) VALUES (${f.profileId},'A generated pattern') RETURNING id`;
  await t.sql`INSERT INTO signal_evidence(profile_id,owner_profile_id,signal_id,inspiration_id,reason,quote,quote_source)
    VALUES (${f.profileId},${f.profileId},${signal.id},${f.sourceId},'Old explanation','Machine words','enrichment')`;
  await f.edit('Corrected source words');
  expect((await t.sql`SELECT reason, quote, quote_source FROM signal_evidence WHERE signal_id=${signal.id}`)[0])
    .toEqual({ reason: null, quote: null, quote_source: null });
  expect((await loadInspirationMaterial(t.db as never, f.profileId, f.sourceId, 'public'))?.attachmentRows[0]?.text).toBe('Corrected source words');
});
it('does not commit an unprocessed correction if the durable learning request fails', async () => {
  const f = await fixture();
  await t.sql`CREATE FUNCTION reject_transcript_job() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'queue unavailable'; END; $$ LANGUAGE plpgsql`;
  await t.sql`CREATE TRIGGER reject_transcript_job BEFORE INSERT ON background_jobs FOR EACH ROW EXECUTE FUNCTION reject_transcript_job()`;
  try {
    expect((await f.edit('Must roll back')).status).toBe(500);
    expect(await (await f.app.request(f.path)).json()).toMatchObject({ correction: null, revision: '0', transcript: 'Machine words' });
    await t.sql`UPDATE attachments SET enrichment_status='failed' WHERE id=${f.id}`;
    const retry = await f.app.request(f.path + '/retry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"revision":"0"}' });
    expect(retry.status).toBe(500);
    expect((await t.sql`SELECT enrichment_retry_count, transcript_revision, enrichment_status FROM attachments WHERE id=${f.id}`)[0])
      .toEqual({ enrichment_retry_count: 0, transcript_revision: 0, enrichment_status: 'failed' });
  } finally {
    await t.sql`DROP TRIGGER reject_transcript_job ON background_jobs`; await t.sql`DROP FUNCTION reject_transcript_job()`;
  }
});
it('rebuilds embeddings and attachment material from the correction only', async () => {
  const f = await fixture();
  const embed = vi.fn(async (_input: string) => Array.from({ length: 768 }, () => .1));
  const client = { model: 'fixture-embedding', embed };
  await ensureInspirationEmbedding({ db: t.db as never, profileId: f.profileId, inspirationId: f.sourceId, client });
  expect(embed.mock.calls[0]?.[0]).toContain('Machine words');
  await f.edit('Corrected words for retrieval');
  expect(await t.sql`SELECT id FROM inspiration_embeddings`).toHaveLength(0);
  await ensureInspirationEmbedding({ db: t.db as never, profileId: f.profileId, inspirationId: f.sourceId, client });
  expect(embed.mock.calls[1]?.[0]).toContain('Corrected words for retrieval');
  expect(embed.mock.calls[1]?.[0]).not.toContain('Machine words');
  /* Was read through the room input contract (`loadGroupInputAttachments`),
     deleted with the room engine; the personal material loader reads the
     same effective attachment text. */
  expect((await loadInspirationMaterial(t.db as never, f.profileId, f.sourceId, 'personal'))?.attachmentRows)
    .toMatchObject([{ kind: 'audio_transcription', text: 'Corrected words for retrieval' }]);
});
it('bounds explicit retry requests across failures and allows recovery after the window', async () => {
  const f = await fixture();
  const fail = async () => {
    await t.sql`UPDATE attachments SET enrichment_status='failed' WHERE id=${f.id}`;
    await t.sql`UPDATE background_jobs SET status='failed' WHERE type='enrich_attachment'`;
  };
  const retry = (revision: string) => f.app.request(f.path + '/retry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ revision }) });
  for (let count = 0; count < 3; count += 1) { await fail(); expect((await retry(String(count))).status).toBe(202); }
  await fail(); expect((await retry('3')).status).toBe(429);
  expect(await (await f.app.request(f.path)).json()).toMatchObject({ canRetry: false, retryAfter: expect.any(String) });
  await t.sql`UPDATE attachments SET enrichment_retry_window_at=now()-interval '2 hours' WHERE id=${f.id}`;
  expect((await retry('3')).status).toBe(202);
  expect((await t.sql`SELECT enrichment_retry_count FROM attachments WHERE id=${f.id}`)[0]?.enrichment_retry_count).toBe(1);
});
