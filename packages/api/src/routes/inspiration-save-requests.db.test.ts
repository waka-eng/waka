/** Lost-response reconciliation through real routes, transactions and isolated
 * Postgres. Only authentication and the database entry point are injected;
 * no worker/model is run and no queue or authored-row writer is mocked. */
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../db/index.js';
import { Hono } from 'hono';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import { createInspirationsRoutes } from './inspirations.js';
import type { AuthEnv } from '../lib/middleware.js';
import type { readSavedInspiration, readSavedReflection } from './inspirations-save-requests.js';

type InspirationBody = Awaited<ReturnType<typeof readSavedInspiration>>;
type AnswerBody = Awaited<ReturnType<typeof readSavedReflection>>;

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('../lib/db.js', () => ({ getDb: () => state.db }));
let t: TestDatabase, sequence = 0;
beforeEach(async () => { t ??= await createTestDatabase(); await t.truncateAll(); state.db = t.db; });
afterAll(async () => { await t?.cleanup(); });
async function fixture() {
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES (${`save-${++sequence}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles(account_id, type, name) VALUES (${account.id}, 'human', 'Owner') RETURNING id`;
  const makeApp = (database = t.db) => {
    const app = new Hono<AuthEnv>();
    app.route('/api/inspirations', createInspirationsRoutes({ getDatabase: () => database as never,
      authMiddleware: async (c, next) => {
        c.set('session', { sessionId: randomUUID(), account: { id: account.id as string, email: 'save@example.test' },
          profile: { id: profile.id as string, accountId: account.id as string, type: 'human', name: 'Owner', preferredLocale: 'en-US' } });
        await next();
      },
    }));
    return app;
  };
  const app = makeApp();
  const post = (path: string, key: string, body: unknown) => app.request(`/api/inspirations${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body),
  });
  return { app, post, makeApp, profileId: profile.id as string, accountId: account.id as string };
}

describe('idempotent capture and answer saves', () => {
  it('upgrades existing sources without inventing historical request identities', async () => {
    const folder = fileURLToPath(new URL('../../../../drizzle/migrations/', import.meta.url));
    const staged = mkdtempSync(join(tmpdir(), 'waka-before-save-requests-'));
    const previous = process.env.WAKA_TEST_MIGRATIONS_DIR;
    let legacy: TestDatabase | undefined;
    try {
      for (const file of readdirSync(folder).filter((name) => name.endsWith('.sql') && name < '0042_')) copyFileSync(join(folder, file), join(staged, file));
      process.env.WAKA_TEST_MIGRATIONS_DIR = staged;
      legacy = await createTestDatabase();
      if (previous === undefined) delete process.env.WAKA_TEST_MIGRATIONS_DIR; else process.env.WAKA_TEST_MIGRATIONS_DIR = previous;
      const [account] = await legacy.sql`INSERT INTO accounts(email) VALUES ('legacy-save@example.test') RETURNING id`;
      const [profile] = await legacy.sql`INSERT INTO profiles(account_id, type, name) VALUES (${account.id}, 'human', 'Legacy') RETURNING id`;
      const [source] = await legacy.sql`INSERT INTO inspirations(profile_id, text) VALUES (${profile.id}, 'Earlier capture') RETURNING id`;
      await legacy.sql`INSERT INTO reflections(profile_id, inspiration_id, question, answer) VALUES (${profile.id}, ${source.id}, 'Why?', 'Earlier answer')`;
      const migration = readFileSync(join(folder, '0042_inspiration-save-requests.sql'), 'utf8');
      await legacy.sql.begin(async (tx) => {
        for (const statement of migration.split('--> statement-breakpoint')) await tx.unsafe(statement);
      });
      expect(await legacy.sql`SELECT request_id FROM inspiration_save_requests`).toHaveLength(0);
      expect(await legacy.sql`SELECT text FROM inspirations`).toEqual([{ text: 'Earlier capture' }]);
      expect(await legacy.sql`SELECT answer FROM reflections`).toEqual([{ answer: 'Earlier answer' }]);
      await legacy.sql`DELETE FROM inspirations WHERE id = ${source.id}`;
      expect(await legacy.sql`SELECT id FROM reflections`).toHaveLength(0);
    } finally {
      if (previous === undefined) delete process.env.WAKA_TEST_MIGRATIONS_DIR; else process.env.WAKA_TEST_MIGRATIONS_DIR = previous;
      await legacy?.cleanup();
      rmSync(staged, { recursive: true, force: true });
    }
  });
  it('returns the same capture and processing request when the first response was lost', async () => {
    const f = await fixture(), key = randomUUID();
    const first = await (await f.post('', key, { text: 'One thought', reflections: [{ question: 'Why?', answer: 'It matters' }] })).json() as InspirationBody;
    const retried = await f.post('', key, { text: 'One thought', reflections: [{ question: 'Why?', answer: 'It matters' }] });
    const second = await retried.json() as InspirationBody;
    expect(await t.sql`SELECT id FROM inspirations`).toHaveLength(1);
    expect(retried.status).toBe(200);
    expect(second.inspiration.id).toBe(first.inspiration.id);
    expect(second.processing).toEqual(first.processing);
    expect(await t.sql`SELECT id FROM inspirations`).toHaveLength(1);
    expect(await t.sql`SELECT id FROM reflections`).toHaveLength(1);
    expect((await t.sql`SELECT request_version::text FROM background_jobs WHERE type = 'derive_signals'`)[0].request_version).toBe('1');
  });

  it('returns the same saved answer instead of deepening the source twice', async () => {
    const f = await fixture();
    const source = await (await f.post('', randomUUID(), { text: 'A capture' })).json() as InspirationBody;
    const path = `/${source.inspiration.id}/reflections`, key = randomUUID();
    const first = await (await f.post(path, key, { question: 'Why?', answer: 'My answer' })).json() as AnswerBody;
    const retried = await f.post(path, key, { question: 'Why?', answer: 'My answer' });
    const second = await retried.json() as AnswerBody;
    expect(await t.sql`SELECT id FROM reflections`).toHaveLength(1);
    expect(retried.status).toBe(200);
    expect(second.reflection.id).toBe(first.reflection.id);
    expect(second.processing).toEqual(first.processing);
    expect(await t.sql`SELECT id FROM reflections`).toHaveLength(1);
    expect((await t.sql`SELECT request_version::text FROM background_jobs WHERE type = 'derive_signals'`)[0].request_version).toBe('2');
  });

  it('rejects a request identity reused for different words', async () => {
    const f = await fixture(), key = randomUUID();
    await f.post('', key, { text: 'Original words' });
    expect((await f.post('', key, { text: 'Different words' })).status).toBe(409);
    expect(await t.sql`SELECT text FROM inspirations`).toEqual([{ text: 'Original words' }]);
  });

  it('finds a committed save by request identity without another write', async () => {
    const f = await fixture(), key = randomUUID();
    const saved = await (await f.post('', key, { text: 'PRIVATE_AUTHORED_WORDS' })).json() as InspirationBody;
    const response = await f.app.request(`/api/inspirations/save-requests/${key}`);
    expect(response.status).toBe(200);
    const found = await response.json() as { saveRequest: unknown };
    expect(found.saveRequest).toMatchObject({ requestId: key, operation: 'inspiration', inspirationId: saved.inspiration.id, processing: saved.processing });
    expect(JSON.stringify(found)).not.toContain('PRIVATE_AUTHORED_WORDS');
    expect(await t.sql`SELECT id FROM inspirations`).toHaveLength(1);
  });

  it('normalizes harmless input and UUID casing without conflating distinct saves', async () => {
    const f = await fixture(), key = randomUUID();
    const original = await (await f.post('', key, { text: '  A thought  ', reflections: [{ question: ' Why? ', answer: '' }] })).json() as InspirationBody;
    const response = await f.post('', key.toUpperCase(), { text: 'A thought', source: 'app', visibility: 'private', citedPrincipleIds: [],
      reflections: [{ question: 'Why?', skipped: false }] });
    expect(response.status).toBe(200);
    expect((await response.json() as InspirationBody).inspiration.id).toBe(original.inspiration.id);
    expect((await f.post('', randomUUID(), { text: 'A thought' })).status).toBe(201);
    expect(await t.sql`SELECT id FROM inspirations`).toHaveLength(2);
  });

  it('returns current edited content and visibility without restoring the original words', async () => {
    const f = await fixture(), key = randomUUID();
    const original = await (await f.post('', key, { text: 'Original words', visibility: 'public' })).json() as InspirationBody;
    await t.sql`UPDATE inspirations SET text = 'Edited words', visibility = 'private' WHERE id = ${original.inspiration.id}`;
    const response = await f.post('', key, { text: 'Original words', visibility: 'public' });
    expect(await response.json()).toMatchObject({ inspiration: { id: original.inspiration.id, text: 'Edited words', visibility: 'private' },
      saveRequest: { requestId: key, replayed: true } });
    expect(await t.sql`SELECT id FROM inspirations`).toHaveLength(1);
  });

  it('retains a tombstone so an old request cannot recreate a deleted capture', async () => {
    const f = await fixture(), key = randomUUID();
    const body = { text: 'PRIVATE_CAPTURE', reflections: [{ question: 'PRIVATE_QUESTION', answer: 'PRIVATE_ANSWER' }] };
    const first = await (await f.post('', key, body)).json() as InspirationBody;
    await t.sql`DELETE FROM inspirations WHERE id = ${first.inspiration.id}`;
    const retry = await f.post('', key, body);
    expect(retry.status).toBe(410);
    expect(await retry.json()).toMatchObject({ code: 'saved_item_removed' });
    expect((await f.app.request(`/api/inspirations/save-requests/${key}`)).status).toBe(410);
    const rows = await t.sql`SELECT * FROM inspiration_save_requests`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ inspiration_id: null, reflection_id: null, processing: null });
    expect(JSON.stringify(rows)).not.toMatch(/PRIVATE_CAPTURE|PRIVATE_QUESTION|PRIVATE_ANSWER/);
    expect(await t.sql`SELECT id FROM inspirations`).toHaveLength(0);
    expect(await t.sql`SELECT id FROM reflections`).toHaveLength(0);
  });

  it('does not recreate a deleted answer, while its capture remains replayable', async () => {
    const f = await fixture(), inspirationKey = randomUUID(), key = randomUUID();
    const source = await (await f.post('', inspirationKey, { text: 'A capture' })).json() as InspirationBody;
    const path = `/${source.inspiration.id}/reflections`, body = { question: 'Why?', answer: 'Private answer' };
    const first = await (await f.post(path, key, body)).json() as AnswerBody;
    await t.sql`DELETE FROM reflections WHERE id = ${first.reflection.id}`;
    expect((await f.post(path, key, body)).status).toBe(410);
    const inspiration = await f.post('', inspirationKey, { text: 'A capture' });
    expect(inspiration.status).toBe(200);
    expect((await inspiration.json() as InspirationBody).inspiration.reflections).toEqual([]);
    expect(await t.sql`SELECT id FROM reflections`).toHaveLength(0);
  });

  it('keeps request identity profile-scoped and does not expose another profile through lookup', async () => {
    const a = await fixture(), b = await fixture(), key = randomUUID();
    const first = await (await a.post('', key, { text: 'One person' })).json() as InspirationBody;
    expect((await b.app.request(`/api/inspirations/save-requests/${key}`)).status).toBe(404);
    expect((await b.app.request(`/api/inspirations/save-requests/${key}?profile=${a.profileId}`)).status).toBe(404);
    const second = await (await b.post('', key, { text: 'Another person' })).json() as InspirationBody;
    expect(second.inspiration.id).not.toBe(first.inspiration.id);
    expect(await t.sql`SELECT request_id FROM inspiration_save_requests`).toHaveLength(2);
  });

  it('refuses to reuse a capture identity for an answer, or an answer identity on another capture', async () => {
    const f = await fixture(), inspirationKey = randomUUID(), answerKey = randomUUID();
    const a = await (await f.post('', inspirationKey, { text: 'First' })).json() as InspirationBody;
    const b = await (await f.post('', randomUUID(), { text: 'Second' })).json() as InspirationBody;
    const body = { question: 'Why?', answer: 'An answer' };
    expect((await f.post(`/${a.inspiration.id}/reflections`, inspirationKey, body)).status).toBe(409);
    expect((await f.post(`/${a.inspiration.id}/reflections`, answerKey, body)).status).toBe(201);
    expect((await f.post(`/${b.inspiration.id}/reflections`, answerKey, body)).status).toBe(409);
    expect(await t.sql`SELECT id FROM reflections`).toHaveLength(1);
  });

  it('enforces tenant-bearing result references in Postgres, not just the HTTP resolver', async () => {
    const a = await fixture(), b = await fixture(), key = randomUUID();
    await a.post('', key, { text: 'One person' });
    const other = await (await b.post('', randomUUID(), { text: 'Another person' })).json() as InspirationBody;
    await expect(t.sql`UPDATE inspiration_save_requests SET inspiration_id = ${other.inspiration.id} WHERE profile_id = ${a.profileId} AND request_id = ${key}`)
      .rejects.toMatchObject({ code: '23503' });
  });

  it('erases request metadata with its account without blocking parent cascades', async () => {
    const f = await fixture();
    const source = await (await f.post('', randomUUID(), { text: 'A capture' })).json() as InspirationBody;
    await f.post(`/${source.inspiration.id}/reflections`, randomUUID(), { question: 'Why?', answer: 'An answer' });
    await t.sql`DELETE FROM accounts WHERE id = ${f.accountId}`;
    expect(await t.sql`SELECT request_id FROM inspiration_save_requests`).toHaveLength(0);
    expect(await t.sql`SELECT id FROM inspirations`).toHaveLength(0);
  });

  it('rolls back words, answers, jobs and the key when save-record persistence fails', async () => {
    const f = await fixture(), key = randomUUID();
    await t.sql`CREATE FUNCTION refuse_save_request() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'synthetic request-store failure'; END; $$ LANGUAGE plpgsql`;
    await t.sql`CREATE TRIGGER refuse_save_request BEFORE INSERT ON inspiration_save_requests FOR EACH ROW EXECUTE FUNCTION refuse_save_request()`;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const body = { text: 'A capture', experience: 'One experience', reflections: [{ question: 'Why?', answer: 'An answer' }] };
    try {
      expect((await f.post('', key, body)).status).toBe(500);
      for (const table of ['inspirations', 'reflections', 'experiences', 'background_jobs', 'inspiration_processing', 'inspiration_save_requests']) {
        expect(await t.sql.unsafe(`SELECT * FROM ${table}`), table).toHaveLength(0);
      }
    } finally {
      log.mockRestore();
      await t.sql`DROP TRIGGER refuse_save_request ON inspiration_save_requests`;
      await t.sql`DROP FUNCTION refuse_save_request()`;
    }
    expect((await f.post('', key, body)).status).toBe(201);
    expect(await t.sql`SELECT id FROM inspirations`).toHaveLength(1);
  });

  it('reports a confirmed concurrent request as in progress, without claiming a missing lookup failed', async () => {
    const f = await fixture(), key = randomUUID();
    const other = postgres(process.env.DB_CONNECTION_URL!, { max: 1, prepare: false, connection: { search_path: t.schemaName } });
    let acquired!: () => void, release!: () => void;
    const locked = new Promise<void>((resolve) => { acquired = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    const held = other.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`inspiration-save:${f.profileId}:${key}`}, 0))`;
      acquired(); await released;
    });
    try {
      await locked;
      const response = await f.post('', key, { text: 'Only once' });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'save_in_progress' });
      const missing = await f.app.request(`/api/inspirations/save-requests/${key}`);
      expect(missing.status).toBe(404);
      expect(await missing.json()).toMatchObject({ code: 'save_not_found' });
      expect(await t.sql`SELECT id FROM inspirations`).toHaveLength(0);
    } finally { release(); await held; await other.end(); }
    expect((await f.post('', key, { text: 'Only once' })).status).toBe(201);
  });

  it('commits one source and one queue request across simultaneous connections', async () => {
    const f = await fixture(), key = randomUUID(), body = { text: 'One simultaneous thought' };
    const other = postgres(process.env.DB_CONNECTION_URL!, { max: 1, prepare: false, connection: { search_path: t.schemaName } });
    try {
      const app = f.makeApp(drizzle(other, { schema }));
      const results = await Promise.all([f.post('', key, body), app.request('/api/inspirations', {
        method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body),
      })]);
      expect(results.filter((response) => response.status === 201)).toHaveLength(1);
      expect(results.every((response) => [200, 201, 409].includes(response.status))).toBe(true);
      const replay = await f.post('', key, body);
      expect(replay.status).toBe(200);
      expect(await t.sql`SELECT id FROM inspirations`).toHaveLength(1);
      expect((await t.sql`SELECT request_version::text FROM background_jobs WHERE type = 'derive_signals'`)[0].request_version).toBe('1');
    } finally { await other.end(); }
  });

  it('does not hang or repeat a save while its existing result is being changed', async () => {
    const f = await fixture(), key = randomUUID(), body = { text: 'A capture' };
    const source = await (await f.post('', key, body)).json() as InspirationBody;
    const other = postgres(process.env.DB_CONNECTION_URL!, { max: 1, prepare: false, connection: { search_path: t.schemaName } });
    let acquired!: () => void, release!: () => void;
    const locked = new Promise<void>((resolve) => { acquired = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    const held = other.begin(async (tx) => {
      await tx`SELECT id FROM inspirations WHERE id = ${source.inspiration.id} FOR UPDATE`;
      acquired(); await released;
    });
    try {
      await locked;
      const response = await f.post('', key, body);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'save_in_progress' });
      expect(await t.sql`SELECT id FROM inspirations`).toHaveLength(1);
    } finally { release(); await held; await other.end(); }
    expect((await f.post('', key, body)).status).toBe(200);
  });

  it('rejects malformed keys before writing, while keyless creates remain independent', async () => {
    const f = await fixture();
    expect((await f.post('', 'not-a-uuid', { text: 'No write' })).status).toBe(400);
    expect(await t.sql`SELECT id FROM inspirations`).toHaveLength(0);
    for (let index = 0; index < 2; index += 1) {
      expect((await f.app.request('/api/inspirations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'A separate intention' }) })).status).toBe(201);
    }
    expect(await t.sql`SELECT id FROM inspirations`).toHaveLength(2);
    expect(await t.sql`SELECT request_id FROM inspiration_save_requests`).toHaveLength(0);
  });
});
