/** WHAT THIS MOCKS, AND WHY (gate G6): `getDb` selects a disposable Postgres
 * schema and `readAttachment` supplies provider outcomes. Real enrichment
 * transactions, source fences, cache reuse and downstream queue writes run. */
import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import { enrichAttachment } from './signal-enrichment.js';
const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('./db.js', () => ({ getDb: () => state.db }));
let t: TestDatabase, sequence = 0;
beforeEach(async () => { t ??= await createTestDatabase(); await t.truncateAll(); state.db = t.db; vi.stubEnv('WAKA_BACKGROUND_JOB_AUTODRAIN', '0'); });
afterAll(async () => { vi.unstubAllEnvs(); await t?.cleanup(); });
async function fixture() {
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES (${`audio-${++sequence}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${account.id},'human','Owner') RETURNING id`;
  const [source] = await t.sql`INSERT INTO inspirations(profile_id,text) VALUES (${profile.id},'My own note') RETURNING id`;
  const [attachment] = await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,s3_key,content_type,enrichment_status)
    VALUES (${profile.id},${source.id},'audio','https://example.test/clip','owned/clip.webm','audio/webm','pending') RETURNING id`;
  return { profileId: profile.id as string, inspirationId: source.id as string, attachmentId: attachment.id as string };
}
const ready = async () => ({ result: { status: 'ready' as const, kind: 'audio_transcription' as const, reason: null, text: 'Words heard in the recording.' } });
it('commits the transcript and learning request without rewriting the original note', async () => {
  const f = await fixture();
  await enrichAttachment(f.attachmentId, { db: t.db as never, readAttachment: ready });
  expect((await t.sql`SELECT enrichment_status, enrichment_kind, enrichment_text FROM attachments WHERE id=${f.attachmentId}`)[0])
    .toEqual({ enrichment_status: 'ready', enrichment_kind: 'audio_transcription', enrichment_text: 'Words heard in the recording.' });
  expect((await t.sql`SELECT text FROM inspirations WHERE id=${f.inspirationId}`)[0]?.text).toBe('My own note');
  const jobs = await t.sql`SELECT profile_id FROM background_jobs WHERE type='derive_signals'`;
  expect(jobs).toEqual([{ profile_id: f.profileId }]);
  expect(await t.sql`SELECT id FROM inspiration_processing`).toHaveLength(1);
});
it('reuses committed audio enrichment without object credentials or a second model call', async () => {
  const f = await fixture();
  await enrichAttachment(f.attachmentId, { db: t.db as never, readAttachment: ready });
  const before = await t.sql`SELECT request_version::text FROM background_jobs WHERE type='derive_signals'`;
  expect(await enrichAttachment(f.attachmentId, { db: t.db as never })).toMatchObject({ status: 'ready', text: 'Words heard in the recording.' });
  expect(await t.sql`SELECT request_version::text FROM background_jobs WHERE type='derive_signals'`).toEqual(before);
});
it('does not publish a result after the attachment resource changes', async () => {
  const f = await fixture();
  await expect(enrichAttachment(f.attachmentId, { db: t.db as never, readAttachment: async () => {
    await t.sql`UPDATE attachments SET s3_key='owned/replacement.webm' WHERE id=${f.attachmentId}`;
    return ready();
  } })).rejects.toThrow('Attachment material changed');
  expect((await t.sql`SELECT enrichment_text FROM attachments WHERE id=${f.attachmentId}`)[0]?.enrichment_text).toBeNull();
  expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);
});
it('never recreates audio or transcript after source deletion during transcription', async () => {
  const f = await fixture();
  expect(await enrichAttachment(f.attachmentId, { db: t.db as never, readAttachment: async () => {
    await t.sql`DELETE FROM inspirations WHERE id=${f.inspirationId}`;
    return ready();
  } })).toEqual({ status: 'missing' });
  expect(await t.sql`SELECT id FROM attachments`).toHaveLength(0);
  expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);
});
it('rolls back the transcript when the worker loses its write claim', async () => {
  const f = await fixture();
  await expect(enrichAttachment(f.attachmentId, { db: t.db as never, readAttachment: ready,
    beforeCommit: async () => { throw new Error('claim lost'); } })).rejects.toThrow('claim lost');
  expect((await t.sql`SELECT enrichment_status, enrichment_text FROM attachments WHERE id=${f.attachmentId}`)[0])
    .toEqual({ enrichment_status: 'pending', enrichment_text: null });
  expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);
});
