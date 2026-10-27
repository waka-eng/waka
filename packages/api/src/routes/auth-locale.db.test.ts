import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import type { AuthEnv } from '../lib/middleware.js';

const state = vi.hoisted(() => ({ db: null as unknown }));
const wake = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../lib/db.js', () => ({ getDb: () => state.db }));
vi.mock('../lib/queue.js', async original => ({
  ...await original<typeof import('../lib/queue.js')>(), wakeCommittedBackgroundJobs: wake,
}));
import { preferencesHandler, profileHandler } from './auth-me.js';

let t: TestDatabase;
let profileId: string;
let accountId: string;
let sessionLocale: 'en-US' | 'ko-KR' = 'en-US';
const app = new Hono<AuthEnv>();
app.use('*', async (c, next) => {
  c.set('session', { sessionId: 'test', account: { id: accountId, email: 'locale@example.test' },
    profile: { id: profileId, accountId, type: 'human', name: 'Reader', preferredLocale: sessionLocale } });
  await next();
});
app.patch('/preferences', preferencesHandler);
app.patch('/profile', profileHandler);
const save = (path: string, preferredLocale = 'ko-KR') => app.request(path, { method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(path === '/profile' ? { name: 'Reader', preferredLocale, completeOnboarding: true } : { preferredLocale }),
});

beforeAll(async () => { t = await createTestDatabase(); state.db = t.db; });
afterAll(async () => { await t?.cleanup(); });
beforeEach(async () => {
  await t.sql`DROP TRIGGER IF EXISTS reject_locale_queue ON background_jobs`;
  await t.truncateAll(); wake.mockClear(); sessionLocale = 'en-US';
  const [a] = await t.sql`INSERT INTO accounts(email) VALUES ('locale@example.test') RETURNING id`;
  const [p] = await t.sql`INSERT INTO profiles(account_id,type,name,preferred_locale) VALUES (${a.id},'human','Reader','en-US') RETURNING id`;
  accountId = a.id as string; profileId = p.id as string;
});

it.each(['/preferences', '/profile'])('%s rolls back the language and onboarding if enqueue fails, then retries successfully', async path => {
  await t.sql`CREATE OR REPLACE FUNCTION reject_locale_queue() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'queue unavailable'; END $$`;
  await t.sql`CREATE TRIGGER reject_locale_queue BEFORE INSERT OR UPDATE ON background_jobs FOR EACH ROW EXECUTE FUNCTION reject_locale_queue()`;
  expect((await save(path)).status).toBe(500);
  expect((await t.sql`SELECT preferred_locale FROM profiles WHERE id=${profileId}`)[0]!.preferred_locale).toBe('en-US');
  expect((await t.sql`SELECT onboarding_completed_at FROM accounts WHERE id=${accountId}`)[0]!.onboarding_completed_at).toBeNull();
  expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);
  expect(wake).not.toHaveBeenCalled();
  await t.sql`DROP TRIGGER reject_locale_queue ON background_jobs`;
  expect((await save(path)).status).toBe(200);
  const jobs = await t.sql`SELECT profile_id, payload FROM background_jobs WHERE type='refresh_top_of_mind'`;
  expect(jobs).toHaveLength(1); expect(jobs[0]!.profile_id).toBe(profileId);
  expect(jobs[0]!.payload).toEqual({ reason: 'manual' });
  expect(wake).toHaveBeenCalledOnce();
});

it.each(['/preferences', '/profile'])('%s reads the locked profile instead of a stale session and coalesces repeated saves', async path => {
  sessionLocale = 'ko-KR'; // session claims this is unchanged; the stored row is still English
  expect((await save(path)).status).toBe(200);
  expect((await save(path)).status).toBe(200);
  expect(await t.sql`SELECT id FROM background_jobs WHERE type='refresh_top_of_mind'`).toHaveLength(1);
  expect(wake).toHaveBeenCalledOnce();
});
