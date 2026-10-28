import { Hono } from 'hono';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import { createInspirationsRoutes } from './inspirations.js';
import { enqueueDeriveSignals, enqueueTopOfMindRefresh } from '../lib/queue.js';
import type { AuthEnv } from '../lib/middleware.js';

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('../lib/db.js', () => ({ getDb: () => state.db }));
let t: TestDatabase;
let sequence = 0;
beforeEach(async () => { t ??= await createTestDatabase(); await t.truncateAll(); state.db = t.db; });
afterAll(async () => { await t?.cleanup(); });
async function fixture(keyScoped = false) {
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES (${`status-${++sequence}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles(account_id, type, name) VALUES (${account.id}, 'human', 'Owner') RETURNING id`;
  const [source] = await t.sql`INSERT INTO inspirations(profile_id, text) VALUES (${profile.id}, 'PRIVATE_SOURCE') RETURNING id`;
  const request = await enqueueDeriveSignals(profile.id as string, source.id as string, 'created');
  const app = new Hono<AuthEnv>();
  app.route('/api/inspirations', createInspirationsRoutes({ getDatabase: () => t.db as never,
    authMiddleware: async (c, next) => {
      c.set('session', { sessionId: '00000000-0000-4000-8000-000000000001', ...(keyScoped ? { keyScoped: true as const } : {}), account: { id: account.id as string, email: 'test@example.test' },
        profile: { id: profile.id as string, accountId: account.id as string, type: 'human', name: 'Owner', preferredLocale: 'en-US' } });
      await next();
    },
  }));
  const url = `/api/inspirations/${source.id}/processing`;
  return { app, url, profileId: profile.id as string, sourceId: source.id as string, request };
}
const retry = (f: Awaited<ReturnType<typeof fixture>>) => f.app.request(`${f.url}/retry`, { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify({ receiptId: f.request.receipt.id }) });

describe('source processing status and recovery', () => {
  it('does not offer a write action to a read-and-capture keeper credential', async () => {
    const f = await fixture(true);
    await t.sql`UPDATE background_jobs SET status = 'failed' WHERE id = ${f.request.jobId}`;
    expect(await (await f.app.request(f.url)).json()).toMatchObject({ phase: 'failed', canRetry: false });
  });
  it('reads scoped metadata without queueing work or echoing source/provider text', async () => {
    const f = await fixture();
    await t.sql`UPDATE background_jobs SET last_error = 'PRIVATE_PROVIDER' WHERE id = ${f.request.jobId}`;
    const before = await t.sql`SELECT request_version FROM background_jobs`;
    const response = await f.app.request(`${f.url}?receipt=${f.request.receipt.id}`);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(body).toMatchObject({ phase: 'queued', stage: 'derivation', currentMaterialRevision: '1', latestCompletedRevision: '0', result: null });
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE_SOURCE|PRIVATE_PROVIDER/);
    expect(await t.sql`SELECT request_version FROM background_jobs`).toEqual(before);
  });

  it('follows newer material while refusing unrelated receipts and other profiles', async () => {
    const f = await fixture(), other = await fixture();
    await t.sql`UPDATE inspirations SET text = 'A newer edit' WHERE id = ${f.sourceId}`;
    const next = await enqueueDeriveSignals(f.profileId, f.sourceId, 'edited');
    expect(await (await f.app.request(`${f.url}?receipt=${f.request.receipt.id}`)).json())
      .toMatchObject({ superseded: true, currentMaterialRevision: '2', receipt: { id: next.receipt.id }, phase: 'queued' });
    expect((await f.app.request(`${f.url}?receipt=${other.request.receipt.id}`)).status).toBe(404);
    expect((await other.app.request(`${f.url}?receipt=${f.request.receipt.id}`)).status).toBe(404);
  });

  it('does not expose a partial publication as readiness before derivation finishes', async () => {
    const f = await fixture();
    await t.sql`UPDATE inspiration_processing SET result = '{"kind":"top_of_mind","topOfMindId":null,"version":0,"outcome":"empty"}'::jsonb WHERE id = ${f.request.receipt.id}`;
    expect(await (await f.app.request(f.url)).json()).toMatchObject({ phase: 'queued', result: null });
    await t.sql`UPDATE inspiration_processing SET derived_at = now(), completed_at = now() WHERE id = ${f.request.receipt.id}`;
    expect(await (await f.app.request(f.url)).json()).toMatchObject({ phase: 'ready', result: { outcome: 'empty' }, canRetry: false });
  });

  it('reports a held read and checks it without creating another request', async () => {
    const f = await fixture(); const reading = await enqueueTopOfMindRefresh(f.profileId, 'signals_changed');
    await t.sql`UPDATE inspiration_processing SET derived_at = now(), reading_job_id = ${reading.jobId}, reading_request_version = ${reading.requestVersion}::bigint WHERE id = ${f.request.receipt.id}`;
    await t.sql`UPDATE background_jobs SET run_after = now() + interval '1 day' WHERE id = ${reading.jobId}`;
    expect(await (await f.app.request(f.url)).json()).toMatchObject({ phase: 'waiting', stage: 'reading', runAfter: expect.any(String), canRetry: false });
    await retry(f);
    expect((await t.sql`SELECT request_version::text FROM background_jobs WHERE id = ${reading.jobId}`)[0].request_version).toBe('1');
  });

  it('retries failed derivation without duplicating the inspiration or restarting active work twice', async () => {
    const f = await fixture();
    await t.sql`UPDATE background_jobs SET status = 'failed' WHERE id = ${f.request.jobId}`;
    expect(await (await f.app.request(f.url)).json()).toMatchObject({ phase: 'failed', canRetry: true });
    expect(await (await retry(f)).json()).toMatchObject({ phase: 'queued', receipt: { materialRevision: '1' } });
    await retry(f);
    expect((await t.sql`SELECT request_version::text FROM background_jobs WHERE id = ${f.request.jobId}`)[0].request_version).toBe('2');
    expect(await t.sql`SELECT id FROM inspirations`).toHaveLength(1);
  });

  it('recovers an exhausted crashed lease, but does not interrupt a fresh running worker', async () => {
    const f = await fixture();
    await t.sql`UPDATE background_jobs SET status = 'running', attempts = max_attempts, locked_at = now() WHERE id = ${f.request.jobId}`;
    expect(await (await retry(f)).json()).toMatchObject({ phase: 'processing', canRetry: false });
    await t.sql`UPDATE background_jobs SET locked_at = now() - interval '20 minutes' WHERE id = ${f.request.jobId}`;
    expect(await (await retry(f)).json()).toMatchObject({ phase: 'queued' });
    expect((await t.sql`SELECT attempts, request_version::text FROM background_jobs WHERE id = ${f.request.jobId}`)[0]).toEqual({ attempts: 0, request_version: '2' });
  });

  it('retries only the failed reading when derivation is already committed', async () => {
    const f = await fixture(); const reading = await enqueueTopOfMindRefresh(f.profileId, 'signals_changed');
    await t.sql`UPDATE inspiration_processing SET derived_at = now(), reading_job_id = ${reading.jobId}, reading_request_version = ${reading.requestVersion}::bigint WHERE id = ${f.request.receipt.id}`;
    await t.sql`UPDATE background_jobs SET status = 'failed' WHERE id = ${reading.jobId}`;
    expect(await (await retry(f)).json()).toMatchObject({ phase: 'queued', stage: 'reading' });
    expect((await t.sql`SELECT request_version::text FROM background_jobs WHERE id = ${f.request.jobId}`)[0].request_version).toBe('1');
    expect(await t.sql`SELECT id FROM inspiration_processing`).toHaveLength(1);
  });

  it('waits for attachment enrichment and recovers its failed job without another save', async () => {
    const f = await fixture();
    await t.sql`INSERT INTO attachments(profile_id, inspiration_id, type, url, enrichment_status)
      VALUES (${f.profileId}, ${f.sourceId}, 'link', 'https://example.test/fixture', 'failed')`;
    expect(await (await f.app.request(f.url)).json()).toMatchObject({ phase: 'unknown', stage: 'enrichment', result: null });
    expect(await (await retry(f)).json()).toMatchObject({ phase: 'queued', stage: 'enrichment' });
    expect(await t.sql`SELECT id FROM background_jobs WHERE type = 'enrich_attachment'`).toHaveLength(1);
    expect(await t.sql`SELECT id FROM inspirations`).toHaveLength(1);
  });

  it('retains completed metadata after queue cleanup, without requesting new work', async () => {
    const f = await fixture();
    await t.sql`UPDATE inspiration_processing SET derived_at = now(), completed_at = now(),
      result = '{"kind":"top_of_mind","topOfMindId":null,"version":0,"outcome":"empty"}'::jsonb WHERE id = ${f.request.receipt.id}`;
    await t.sql`DELETE FROM background_jobs WHERE id = ${f.request.jobId}`;
    expect(await (await f.app.request(`${f.url}?receipt=${f.request.receipt.id}`)).json())
      .toMatchObject({ phase: 'ready', receipt: { id: f.request.receipt.id }, result: { outcome: 'empty' }, canRetry: false });
    expect(await (await retry(f)).json()).toMatchObject({ phase: 'ready' });
    expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);
  });

  it('does not certify legacy data from a succeeded job without a material receipt', async () => {
    const f = await fixture();
    await t.sql`DELETE FROM inspiration_processing WHERE id = ${f.request.receipt.id}`;
    await t.sql`UPDATE background_jobs SET status = 'succeeded' WHERE id = ${f.request.jobId}`;
    expect(await (await f.app.request(f.url)).json()).toMatchObject({ phase: 'unknown', receipt: null, result: null,
      latestDerivedRevision: '0', latestCompletedRevision: '0', canRetry: true });
  });

  it('does not expose a foreign or missing artifact even from a completed receipt', async () => {
    const f = await fixture(), other = await fixture();
    const [artifact] = await t.sql`INSERT INTO top_of_minds(profile_id, version, reason) VALUES (${other.profileId}, 1, 'regenerated') RETURNING id`;
    await t.sql`UPDATE inspiration_processing SET derived_at = now(), completed_at = now(),
      result = ${JSON.stringify({ kind: 'top_of_mind', topOfMindId: artifact.id, version: 1, outcome: 'changed' })}::jsonb WHERE id = ${f.request.receipt.id}`;
    expect(await (await f.app.request(f.url)).json()).toMatchObject({ phase: 'unknown', result: null, canRetry: true });
    await t.sql`DELETE FROM top_of_minds WHERE id = ${artifact.id}`;
    expect(await (await f.app.request(f.url)).json()).toMatchObject({ phase: 'unknown', result: null });
    expect(await (await retry(f)).json()).toMatchObject({ phase: 'queued', stage: 'reading', result: null });
    expect((await t.sql`SELECT request_version::text FROM background_jobs WHERE id = ${f.request.jobId}`)[0].request_version).toBe('1');
  });

  it('rolls back retry and its numbered job when recording the receipt fails', async () => {
    const f = await fixture();
    await t.sql`UPDATE background_jobs SET status = 'failed' WHERE id = ${f.request.jobId}`;
    await t.sql`CREATE FUNCTION refuse_processing_retry() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'synthetic receipt failure'; END; $$ LANGUAGE plpgsql`;
    await t.sql`CREATE TRIGGER refuse_processing_retry BEFORE INSERT ON inspiration_processing FOR EACH ROW EXECUTE FUNCTION refuse_processing_retry()`;
    // Hono emits the thrown database error; silence only this expected failure.
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await retry(f)).status).toBe(500);
      expect((await t.sql`SELECT status, request_version::text FROM background_jobs WHERE id = ${f.request.jobId}`)[0]).toEqual({ status: 'failed', request_version: '1' });
      expect(await t.sql`SELECT id FROM inspiration_processing`).toHaveLength(1);
      expect(await t.sql`SELECT id FROM inspirations`).toHaveLength(1);
    } finally {
      log.mockRestore();
      await t.sql`DROP TRIGGER refuse_processing_retry ON inspiration_processing`;
      await t.sql`DROP FUNCTION refuse_processing_retry()`;
    }
  });
});

it('discovers current processing across tabs, counts multiple saves and never crosses a profile', async () => {
  const f = await fixture(), foreign = await fixture();
  const [second] = await t.sql`INSERT INTO inspirations(profile_id,text) VALUES (${f.profileId},'SECOND_PRIVATE_SOURCE') RETURNING id`;
  const request = await enqueueDeriveSignals(f.profileId, String(second.id), 'created');
  await t.sql`UPDATE background_jobs SET status='failed', last_error='PRIVATE_PROVIDER' WHERE id=${request.jobId}`;
  const response = await f.app.request('/api/inspirations/processing');
  expect(response.status).toBe(200);
  const body = await response.json() as { items: Array<{ inspirationId: string; phase: string }> };
  expect(body).toMatchObject({ profileId: f.profileId, total: 2, failed: 1 });
  expect(body.items[0]).toMatchObject({ inspirationId: second.id, phase: 'failed' });
  expect(JSON.stringify(body)).not.toMatch(/PRIVATE_SOURCE|PRIVATE_PROVIDER/);
  expect((await foreign.app.request(`/api/inspirations/processing?profile=${f.profileId}`)).status).toBe(404);
  await t.sql`DELETE FROM inspirations WHERE id=${second.id}`;
  expect(await (await f.app.request('/api/inspirations/processing')).json()).toMatchObject({ total: 1, failed: 0 });
});
