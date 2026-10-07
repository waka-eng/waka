/** Only getDb is redirected to a disposable loopback schema. Real migration,
 * SQL transactions, PKCE hashing, token signing and session rows execute. No
 * OAuth provider, deployment, paid request or shared database is involved. */
import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../db/index.js';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import type { getDb } from '../lib/db.js';
const fixtureState = vi.hoisted(() => ({ db: undefined as unknown as ReturnType<typeof getDb> }));
vi.mock('../lib/db.js', () => ({ getDb: () => fixtureState.db }));
import { mobileAuthRoutes } from './auth-mobile.js';
import { issueMobileCode, mobileChallenge, mobileDigest } from '../lib/mobile-handoff.js';
import { requireAuth, type AuthEnv } from '../lib/middleware.js';
const app = new Hono().route('/api/auth/mobile', mobileAuthRoutes);
const protectedApp = new Hono<AuthEnv>().get('/private', requireAuth, c => c.json({ profileId: c.get('session').profile.id }));
let fixture: TestDatabase, profileId: string, concurrentSql: Sql;
const state = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url');
const binding = { appId: 'im.waka.app.dev' as const, state, challenge: mobileChallenge(verifier) };
beforeAll(async () => {
  const host = new URL(process.env.DB_CONNECTION_URL!).hostname;
  if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error('Mobile auth SQL checks require explicit loopback Postgres.');
  fixture = await createTestDatabase();
  concurrentSql = postgres(process.env.DB_CONNECTION_URL!, { max: 2, prepare: false,
    connection: { search_path: `${fixture.schemaName},public` }, onnotice: () => {} });
  fixtureState.db = drizzle(concurrentSql, { schema });
});
beforeEach(async () => {
  await fixture.truncateAll();
  const [account] = await fixture.sql`INSERT INTO accounts (email, onboarding_completed_at) VALUES ('mobile-fixture@example.test', now()) RETURNING id`;
  const [profile] = await fixture.sql`INSERT INTO profiles (account_id, type, name) VALUES (${account!.id}, 'human', 'Mobile fixture') RETURNING id`;
  profileId = profile!.id;
});
afterAll(async () => { await concurrentSql?.end({ timeout: 2 }); await fixture?.cleanup(); });
const exchange = (code: string, overrides: Record<string, unknown> = {}) => app.request('/api/auth/mobile/exchange', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, appId: binding.appId, state, verifier, ...overrides }),
});
it('exchanges once for the same human account and stores only a code hash', async () => {
  const code = await issueMobileCode(profileId, binding);
  const [stored] = await fixture.sql`SELECT * FROM mobile_login_codes`;
  expect(stored!.code_hash).toBe(mobileDigest(code)); expect(JSON.stringify(stored)).not.toContain(code);
  const response = await exchange(code); expect(response.status).toBe(200);
  const body = await response.json() as { profile: { id: string; type: string }; token: string }; expect(body.profile.id).toBe(profileId); expect(body.profile.type).toBe('human');
  expect(body.token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/); expect(response.headers.get('Set-Cookie')).toBeNull();
  expect(await fixture.sql`SELECT id FROM sessions`).toHaveLength(1); expect((await exchange(code)).status).toBe(401);
});
it('rejects wrong app, state and verifier without consuming the legitimate code', async () => {
  const code = await issueMobileCode(profileId, binding);
  for (const overrides of [ { appId: 'im.waka.app' }, { state: randomBytes(32).toString('base64url') }, { verifier: randomBytes(32).toString('base64url') } ]) {
    expect((await exchange(code, overrides)).status).toBe(401);
  }
  expect(await fixture.sql`SELECT id FROM sessions`).toHaveLength(0);
  expect((await exchange(code)).status).toBe(200);
});
it('expires without issuing a session', async () => {
  const code = await issueMobileCode(profileId, binding);
  await fixture.sql`UPDATE mobile_login_codes SET expires_at = now() - interval '1 second'`;
  expect((await exchange(code)).status).toBe(401); expect(await fixture.sql`SELECT id FROM sessions`).toHaveLength(0);
});
it('concurrent exchanges mint exactly one session', async () => {
  const code = await issueMobileCode(profileId, binding);
  const responses = await Promise.all([exchange(code), exchange(code)]);
  expect(responses.map(response => response.status).sort()).toEqual([200, 401]);
  expect(await fixture.sql`SELECT id FROM sessions`).toHaveLength(1);
});
it('never issues an agent-profile handoff', async () => {
  const [agent] = await fixture.sql`INSERT INTO profiles (account_id, type, name) SELECT account_id, 'agent', 'Agent fixture' FROM profiles WHERE id = ${profileId} RETURNING id`;
  await expect(issueMobileCode(agent!.id, binding)).rejects.toThrow('human');
  expect(await fixture.sql`SELECT id FROM mobile_login_codes`).toHaveLength(0);
});
it('a minted mobile session is refused once its server lifetime expires', async () => {
  const code = await issueMobileCode(profileId, binding);
  const body = await (await exchange(code)).json() as { token: string };
  const headers = { Authorization: `Bearer ${body.token}` };
  expect((await protectedApp.request('/private', { headers })).status).toBe(200);
  await fixture.sql`UPDATE sessions SET expires_at = now() - interval '1 second'`;
  expect((await protectedApp.request('/private', { headers })).status).toBe(401);
});
