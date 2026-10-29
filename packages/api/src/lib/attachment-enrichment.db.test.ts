/** WHAT THIS MOCKS, AND WHY (gate G6): `getDb` selects a disposable local
 * Postgres schema; `readAttachment` supplies controlled source/provider
 * outcomes. Real enrichment transactions, source fences and queue writes run.
 * No external URL, object storage or model is contacted. */
import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import { enrichAttachment } from './signal-enrichment.js';

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('./db.js', () => ({ getDb: () => state.db }));
let t: TestDatabase, sequence = 0;
beforeEach(async () => {
  t ??= await createTestDatabase(); await t.truncateAll(); state.db = t.db;
  vi.stubEnv('WAKA_BACKGROUND_JOB_AUTODRAIN', '0');
});
afterAll(async () => { vi.unstubAllEnvs(); await t?.cleanup(); });

const kinds = { link: 'page_body', image: 'image_description', audio: 'audio_transcription' } as const;
async function fixture(type: keyof typeof kinds) {
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES (${`attachment-${++sequence}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${account.id},'agent','Source owner') RETURNING id`;
  const [source] = await t.sql`INSERT INTO inspirations(profile_id,text) VALUES (${profile.id},'My original words') RETURNING id`;
  const [attachment] = await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,enrichment_status)
    VALUES (${profile.id},${source.id},${type},'https://example.test/source','pending') RETURNING id`;
  return { profileId: profile.id as string, inspirationId: source.id as string, attachmentId: attachment.id as string };
}
const ready = (type: keyof typeof kinds) => ({ result: { status: 'ready' as const, kind: kinds[type], reason: null, text: 'Source material read at save time.' } });

it.each(['link', 'image', 'audio'] as const)('reuses committed %s material without reading it or scheduling learning again', async type => {
  const f = await fixture(type), read = vi.fn(async () => ready(type));
  await enrichAttachment(f.attachmentId, { db: t.db as never, readAttachment: read });
  const before = await t.sql`SELECT profile_id,request_version::text FROM background_jobs WHERE type='derive_signals'`;
  expect(before).toEqual([{ profile_id: f.profileId, request_version: '1' }]);
  expect(await enrichAttachment(f.attachmentId, { db: t.db as never, readAttachment: read })).toMatchObject(ready(type).result);
  expect(read).toHaveBeenCalledOnce();
  expect(await t.sql`SELECT profile_id,request_version::text FROM background_jobs WHERE type='derive_signals'`).toEqual(before);
  expect((await t.sql`SELECT text FROM inspirations WHERE id=${f.inspirationId}`)[0]?.text).toBe('My original words');
});

it.each(['link', 'image', 'audio'] as const)('cannot replace successful %s material with a slower failed attempt', async type => {
  const f = await fixture(type); let release!: () => void, entered = false;
  const held = new Promise<void>(resolve => { release = resolve; });
  const slower = enrichAttachment(f.attachmentId, { db: t.db as never, readAttachment: async () => {
    entered = true; await held; return { result: { status: 'failed', reason: 'Network failed' } };
  } });
  await vi.waitFor(() => expect(entered).toBe(true));
  try { await enrichAttachment(f.attachmentId, { db: t.db as never, readAttachment: async () => ready(type) }); }
  finally { release(); }
  if (type === 'audio') await expect(slower).rejects.toThrow('Attachment material changed');
  else expect(await slower).toMatchObject(ready(type).result);
  expect((await t.sql`SELECT enrichment_status,enrichment_text FROM attachments WHERE id=${f.attachmentId}`)[0])
    .toEqual({ enrichment_status: 'ready', enrichment_text: 'Source material read at save time.' });
  expect(await t.sql`SELECT request_version::text FROM background_jobs WHERE type='derive_signals'`).toEqual([{ request_version: '1' }]);
});

it.each(['link', 'image'] as const)('refuses stale %s material after its source changes', async type => {
  const f = await fixture(type);
  await expect(enrichAttachment(f.attachmentId, { db: t.db as never, readAttachment: async () => {
    await t.sql`UPDATE attachments SET url='https://example.test/replacement' WHERE id=${f.attachmentId}`;
    return ready(type);
  } })).rejects.toThrow('Attachment material changed');
  expect((await t.sql`SELECT enrichment_text FROM attachments WHERE id=${f.attachmentId}`)[0]?.enrichment_text).toBeNull();
  expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);
});

it.each(['link', 'image'] as const)('does not recreate %s material after the inspiration is deleted', async type => {
  const f = await fixture(type);
  expect(await enrichAttachment(f.attachmentId, { db: t.db as never, readAttachment: async () => {
    await t.sql`DELETE FROM inspirations WHERE id=${f.inspirationId}`; return ready(type);
  } })).toEqual({ status: 'missing' });
  expect(await t.sql`SELECT id FROM attachments`).toHaveLength(0);
  expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);
});
