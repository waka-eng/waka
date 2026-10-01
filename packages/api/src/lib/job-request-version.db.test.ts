import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { MiddlewareHandler } from 'hono';
import type { AuthEnv } from './middleware.js';
import { createTopOfMindRoutes } from '../routes/top-of-mind.js';
import { createAdminBackgroundJobsRoutes } from '../routes/admin-background-jobs.js';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import { enqueueDeriveSignals, enqueueTopOfMindRefresh, enqueueRefreshPrinciples, postgresBackgroundJobStore } from './queue.js';
import { loadTopOfMindRefreshStatus } from './top-of-mind-refresh-status.js';

let t: TestDatabase;
let originalUrl: string;
let profileId: string;
let accountId: string;
let inspirationId: string;
let sequence = 0;
beforeAll(async () => {
  t = await createTestDatabase(); originalUrl = process.env.DB_CONNECTION_URL!;
  const url = new URL(originalUrl); url.searchParams.set('options', `-c search_path=${t.schemaName}`);
  process.env.DB_CONNECTION_URL = url.toString();
});
beforeEach(async () => {
  await t.truncateAll();
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES (${`request-${++sequence}@example.test`}) RETURNING id`;
  accountId = account.id as string;
  const [profile] = await t.sql`INSERT INTO profiles(account_id, type, name) VALUES (${account.id}, 'human', 'Owner') RETURNING id`;
  profileId = profile.id as string;
  const [source] = await t.sql`INSERT INTO inspirations(profile_id, text) VALUES (${profileId}, 'A source') RETURNING id`;
  inspirationId = source.id as string;
});
afterAll(async () => { process.env.DB_CONNECTION_URL = originalUrl; await t?.cleanup(); });
const request = () => enqueueDeriveSignals(profileId, inspirationId, 'edited');
const claim = (delay = 1000) => postgresBackgroundJobStore.claimNext(new Date(Date.now() + delay));
const auth: MiddlewareHandler<AuthEnv> = async (c, next) => {
  c.set('session', { sessionId: '00000000-0000-4000-8000-000000000001', account: { id: accountId, email: 'request@example.test' },
    profile: { id: profileId, accountId, type: 'human', name: 'Owner', preferredLocale: 'en-US' } });
  await next();
};

describe('numbered background requests', () => {
  it('upgrades a legacy completed row without inventing verified completion', async () => {
    await t.sql`CREATE TABLE legacy_job_request_versions (id uuid PRIMARY KEY, status text NOT NULL, result jsonb)`;
    const legacy = { kind: 'top_of_mind', topOfMindId: null, version: 0, outcome: 'empty' };
    await t.sql`INSERT INTO legacy_job_request_versions VALUES (gen_random_uuid(), 'succeeded', ${JSON.stringify(legacy)}::jsonb)`;
    const migration = readFileSync(new URL('../../../../drizzle/migrations/0040_job-request-versions.sql', import.meta.url), 'utf8')
      .replaceAll('"public"."background_jobs"', `"${t.schemaName}"."legacy_job_request_versions"`);
    await t.sql.begin(async (tx) => {
      for (const statement of migration.split('--> statement-breakpoint')) await tx.unsafe(statement);
    });
    expect((await t.sql`SELECT status, result, request_version::text, completed_version::text FROM legacy_job_request_versions`)[0])
      .toEqual({ status: 'succeeded', result: legacy, request_version: '1', completed_version: '0' });
    await expect(t.sql`UPDATE legacy_job_request_versions SET completed_version = 2`).rejects.toMatchObject({ code: '23514' });
  });

  it('carries the numbered receipt through the real refresh and status routes', async () => {
    const api = createTopOfMindRoutes({ getDatabase: () => t.db as never, authMiddleware: auth });
    await api.request('/refresh', { method: 'POST' });
    const response = await api.request('/refresh', { method: 'POST' });
    expect(response.status).toBe(202);
    const body = await response.json() as { jobId: string; requestVersion: string };
    expect(body).toMatchObject({ requestVersion: '2' });
    const status = await api.request(`/refresh/${body.jobId}?requestVersion=${body.requestVersion}`);
    expect(await status.json()).toMatchObject({ status: 'pending', requestVersion: '2', completedVersion: '0', result: null });
    expect((await api.request(`/refresh/${body.jobId}?requestVersion=-1`)).status).toBe(400);
  });

  it('an authorized operational retry gets a new request version and still serializes safely', async () => {
    const first = await request();
    await t.sql`UPDATE background_jobs SET status = 'failed' WHERE id = ${first.jobId}`;
    const api = createAdminBackgroundJobsRoutes({ getDatabase: () => t.db as never, authMiddleware: auth,
      adminGate: async (_c, next) => { await next(); }, adminAuthorization: async (_c, next) => { await next(); } });
    const response = await api.request(`/${first.jobId}/retry`, { method: 'POST' });
    expect(response.status).toBe(200);
    expect((await t.sql`SELECT request_version::text FROM background_jobs WHERE id = ${first.jobId}`)[0].request_version).toBe('2');
    expect((await api.request('/')).status).toBe(200);
  });

  it('does not expose an older or legacy result as completion of a newer reading request', async () => {
    const first = await enqueueTopOfMindRefresh(profileId, 'manual');
    const old = await claim(); const newer = await enqueueTopOfMindRefresh(profileId, 'manual');
    const result = { kind: 'top_of_mind' as const, topOfMindId: null, version: 0, outcome: 'empty' as const };
    await postgresBackgroundJobStore.markSucceeded(old!, result);
    expect(await loadTopOfMindRefreshStatus(t.db as never, profileId, first.jobId, newer.requestVersion))
      .toMatchObject({ status: 'pending', requestVersion: '2', completedVersion: '1', result: null });
    // Even a legacy/unaware writer claiming success cannot supply a newer receipt.
    await t.sql`UPDATE background_jobs SET status = 'succeeded', result = ${JSON.stringify(result)}::jsonb WHERE id = ${first.jobId}`;
    expect(await loadTopOfMindRefreshStatus(t.db as never, profileId, first.jobId, newer.requestVersion))
      .toMatchObject({ status: 'unknown', result: null });
    await t.sql`UPDATE background_jobs SET completed_version = 0 WHERE id = ${first.jobId}`;
    expect(await loadTopOfMindRefreshStatus(t.db as never, profileId, first.jobId))
      .toMatchObject({ status: 'unknown', completedVersion: '0', result: null });
    expect(await loadTopOfMindRefreshStatus(t.db as never, profileId, first.jobId, '3')).toBeNull();
    expect(await loadTopOfMindRefreshStatus(t.db as never, '00000000-0000-4000-8000-000000000001', first.jobId, '1')).toBeNull();
  });

  it('preserves request precision through enqueue, claim, completion and the status wire shape', async () => {
    const first = await enqueueTopOfMindRefresh(profileId, 'manual');
    await t.sql`UPDATE background_jobs SET request_version = 9007199254740992 WHERE id = ${first.jobId}`;
    const newer = await enqueueTopOfMindRefresh(profileId, 'manual');
    expect(newer.requestVersion).toBe('9007199254740993');
    const job = await claim();
    expect(job?.requestVersion).toBe(9007199254740993n);
    await postgresBackgroundJobStore.markSucceeded(job!, { kind: 'top_of_mind', topOfMindId: null, version: 0, outcome: 'empty' });
    const status = await loadTopOfMindRefreshStatus(t.db as never, profileId, first.jobId, newer.requestVersion);
    expect(status).toMatchObject({ status: 'succeeded', completedVersion: '9007199254740993' });
    expect(() => JSON.stringify(status)).not.toThrow();
  });

  it('coalesces pending work without losing which requests the claimed pass covers', async () => {
    const first = await request(), second = await request();
    expect(first).toMatchObject({ requestVersion: '1' });
    expect(second).toMatchObject({ jobId: first.jobId, requestVersion: '2', created: false });
    const job = await claim();
    expect(job).toMatchObject({ requestVersion: 2n });
    await postgresBackgroundJobStore.markSucceeded(job!, null);
    expect((await t.sql`SELECT request_version::text, completed_version::text FROM background_jobs WHERE id = ${first.jobId}`)[0])
      .toEqual({ request_version: '2', completed_version: '2' });
  });

  it('an older completion covers only its claimed requests, not an enqueue during the call', async () => {
    const first = await request(); const old = await claim(); const second = await request();
    expect(second).toMatchObject({ jobId: first.jobId, requestVersion: '2' });
    await postgresBackgroundJobStore.markSucceeded(old!, null);
    expect((await t.sql`SELECT status, request_version::text, completed_version::text FROM background_jobs WHERE id = ${first.jobId}`)[0])
      .toEqual({ status: 'pending', request_version: '2', completed_version: '1' });
    const current = await claim(3000);
    await postgresBackgroundJobStore.markSucceeded(current!, null);
    expect(await postgresBackgroundJobStore.markSucceeded(old!, null)).toBe(false);
    expect((await t.sql`SELECT status, completed_version::text FROM background_jobs WHERE id = ${first.jobId}`)[0])
      .toEqual({ status: 'succeeded', completed_version: '2' });
  });

  it('a failed attempt and a cadence hold acknowledge no new requests', async () => {
    const first = await request(); const job = await claim();
    await request();
    await postgresBackgroundJobStore.markFailedOrPending(job!, new Error('Synthetic failure'), true, new Date());
    const current = await claim(3000);
    await postgresBackgroundJobStore.holdJob(current!, new Date(Date.now() + 86_400_000));
    expect((await t.sql`SELECT request_version::text, completed_version::text FROM background_jobs WHERE id = ${first.jobId}`)[0])
      .toEqual({ request_version: '2', completed_version: '0' });
  });

  it('reusing a terminal source job gives a new request version, not a new identity or old completion', async () => {
    const first = await request(); await postgresBackgroundJobStore.markSucceeded((await claim())!, null);
    const second = await request();
    expect(second).toMatchObject({ jobId: first.jobId, requestVersion: '2' });
    expect((await t.sql`SELECT status, completed_version::text FROM background_jobs WHERE id = ${first.jobId}`)[0])
      .toEqual({ status: 'pending', completed_version: '1' });
  });

  it('rolls a request version back with its surrounding source transaction', async () => {
    const first = await request();
    await expect(t.db.transaction(async (tx) => {
      const queued = await enqueueDeriveSignals(profileId, inspirationId, 'edited', undefined, tx as never);
      expect(queued).toMatchObject({ requestVersion: '2' });
      throw new Error('Save rolled back');
    })).rejects.toThrow('Save rolled back');
    expect((await t.sql`SELECT request_version::text FROM background_jobs WHERE id = ${first.jobId}`)[0].request_version).toBe('1');
  });

  it('numbers a manual upgrade of a waiting read without starting a second job', async () => {
    const first = await enqueueTopOfMindRefresh(profileId, 'signals_changed');
    await t.sql`UPDATE background_jobs SET run_after = now() + interval '1 day' WHERE id = ${first.jobId}`;
    const manual = await enqueueTopOfMindRefresh(profileId, 'manual');
    expect(manual).toMatchObject({ jobId: first.jobId, requestVersion: '2' });
    expect(await claim()).toMatchObject({ id: first.jobId, requestVersion: 2n });
  });

  it('keeps a completed principle key stable, but numbers an explicitly retried failure', async () => {
    const first = await enqueueRefreshPrinciples(profileId, 'fixture');
    const job = await claim(); await postgresBackgroundJobStore.markSucceeded(job!, null);
    expect(await enqueueRefreshPrinciples(profileId, 'fixture')).toMatchObject({ jobId: first.jobId, requestVersion: '1' });
    await t.sql`UPDATE background_jobs SET status = 'failed' WHERE id = ${first.jobId}`;
    expect(await enqueueRefreshPrinciples(profileId, 'fixture', true)).toMatchObject({ jobId: first.jobId, requestVersion: '2' });
  });
});
