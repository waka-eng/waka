/** Only the database target and Google token exchange are replaced. Real
 * routes, credential issuance, authentication and SQL run on disposable PG. */
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import type { getDb } from '../lib/db.js';

const state = vi.hoisted(() => ({ db: undefined as unknown as ReturnType<typeof getDb> }));
vi.mock('../lib/db.js', () => ({ getDb: () => state.db }));
vi.mock('../lib/google-oauth.js', () => ({
  getGoogleClientId: () => 'test-google-client', getGoogleClientSecret: () => 'test-google-secret',
  getGoogleRedirectUri: () => 'http://localhost/api/auth/google/callback',
  getOAuthRedirectOrigin: () => 'http://localhost',
}));
import { app } from '../index.js';
import { signSessionToken } from '../lib/auth.js';
import { createSessionRow } from '../lib/session.js';

let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); state.db = t.db as ReturnType<typeof getDb>; });
beforeEach(async () => { await t.truncateAll(); });
afterEach(() => { vi.unstubAllGlobals(); });
afterAll(async () => { await t?.cleanup(); });
const request = (path: string, token?: string, body?: unknown) => app.request(path, {
  method: body ? 'POST' : 'GET',
  headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
async function owner() {
  const email = `${randomUUID()}@example.test`;
  const signed = await request('/api/auth/signup', undefined, { email, password: 'synthetic-password-123', name: 'Owner' });
  expect(signed.status).toBe(201);
  const { token } = await signed.json() as { token: string };
  const key = await (await request('/api/keeper-keys', token, { label: 'Before Google' })).json() as any;
  const agents: Array<{ profileId: string; secret: string }> = [];
  for (const name of ['noah', 'anotherone']) {
    const { profile } = await (await request('/api/profiles', token, { name })).json() as any;
    const { key } = await (await request('/api/agent-keys', token, { profileId: profile.id })).json() as any;
    agents.push({ profileId: profile.id, secret: key.secret });
  }
  const [profile] = await t.sql`SELECT p.id FROM profiles p JOIN accounts a ON a.id=p.account_id WHERE a.email=${email} AND p.type='human'`;
  return { email, token, profileId: profile.id as string, keeper: key.key.secret as string, agents };
}
async function link(email: string) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const claims = { iss: 'https://accounts.google.com', aud: 'test-google-client', exp: Math.floor(Date.now() / 1000) + 60,
    sub: `google-${email}`, email, email_verified: true, name: 'Verified owner' };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id_token: `${encode({ alg: 'none' })}.${encode(claims)}.signature` }),
    { status: 200, headers: { 'Content-Type': 'application/json' } })));
  return app.request('/api/auth/google/callback?code=test-code&state=test-state', {
    redirect: 'manual', headers: { Cookie: 'waka_oauth_state=test-state; waka_oauth_pkce=test-verifier' },
  });
}

it('revokes every old profile credential and sign-in code, while preserving other accounts and subsequent Google sessions', async () => {
  const victim = await owner(), other = await owner();
  const agentSessions: string[] = [];
  for (const agent of victim.agents) {
    const token = await signSessionToken({ profileId: agent.profileId, email: victim.email });
    await createSessionRow({ profileId: agent.profileId, token, deviceLabel: 'Local MCP' });
    agentSessions.push(token);
  }
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  for (const profileId of [victim.profileId, ...victim.agents.map(agent => agent.profileId), other.profileId]) {
    await t.sql`INSERT INTO cli_login_codes(profile_id,code_hash,expires_at) VALUES(${profileId},${hash(randomUUID())},now()+interval '2 minutes')`;
  }
  for (const profileId of [victim.profileId, other.profileId]) {
    await t.sql`INSERT INTO mobile_login_codes(profile_id,code_hash,app_id,state_hash,challenge,expires_at)
      VALUES(${profileId},${hash(randomUUID())},'test.app',${hash('state')},${hash('challenge')},now()+interval '2 minutes')`;
  }
  for (const token of [victim.token, victim.keeper, ...victim.agents.map(agent => agent.secret), ...agentSessions]) {
    expect((await request('/api/inspirations', token)).status).toBe(200);
  }
  const linked = await link(victim.email);
  expect(linked.status).toBe(302);
  for (const token of [victim.token, victim.keeper, ...victim.agents.map(agent => agent.secret), ...agentSessions]) {
    expect((await request('/api/inspirations', token)).status).toBe(401);
    expect((await request('/api/inspirations', token, { text: 'Old credentials must not write.' })).status).toBe(401);
  }
  expect(await t.sql`SELECT profile_id FROM cli_login_codes`).toEqual([{ profile_id: other.profileId }]);
  expect(await t.sql`SELECT profile_id FROM mobile_login_codes`).toEqual([{ profile_id: other.profileId }]);
  expect((await t.sql`SELECT password_hash FROM accounts WHERE email=${victim.email}`)[0].password_hash).toBeNull();
  for (const token of [other.token, other.keeper, ...other.agents.map(agent => agent.secret)]) {
    expect((await request('/api/inspirations', token)).status).toBe(200);
  }
  const fresh = linked.headers.get('set-cookie')!.match(/waka_session=([^;]+)/)![1]!;
  const { key } = await (await request('/api/agent-keys', fresh, { profileId: victim.agents[0]!.profileId })).json() as any;
  expect((await request('/api/inspirations', fresh, { text: 'The verified owner can still save.' })).status).toBe(201);
  expect((await link(victim.email)).status).toBe(302);
  expect((await request('/api/auth/me', fresh)).status).toBe(200);
  expect((await request('/api/inspirations', key.secret)).status).toBe(200);
});

it('rolls back the identity link and every earlier revocation if revoking keys fails', async () => {
  const victim = await owner();
  await t.sql`CREATE FUNCTION reject_key_revocation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected revocation failure'; END $$`;
  await t.sql`CREATE TRIGGER reject_key_revocation BEFORE UPDATE ON agent_keys FOR EACH ROW EXECUTE FUNCTION reject_key_revocation()`;
  try {
    const linked = await link(victim.email);
    expect(linked.status).toBe(500);
    expect(linked.headers.get('set-cookie') ?? '').not.toContain('waka_session=');
    const [account] = await t.sql`SELECT password_hash,google_sub FROM accounts WHERE email=${victim.email}`;
    expect(account.password_hash).not.toBeNull(); expect(account.google_sub).toBeNull();
    for (const token of [victim.token, victim.keeper, ...victim.agents.map(agent => agent.secret)]) {
      expect((await request('/api/inspirations', token)).status).toBe(200);
    }
    expect(await t.sql`SELECT id FROM keeper_keys WHERE revoked_at IS NOT NULL`).toHaveLength(0);
  } finally {
    await t.sql`DROP TRIGGER reject_key_revocation ON agent_keys`;
    await t.sql`DROP FUNCTION reject_key_revocation()`;
  }
});
