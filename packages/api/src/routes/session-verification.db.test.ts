import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/db.js';
import type { getDb } from '../lib/db.js';

const state = vi.hoisted(() => ({ db: undefined as unknown as ReturnType<typeof getDb> }));
vi.mock('../lib/db.js', () => ({ getDb: () => state.db }));
import { cliAuthRoutes } from './auth-cli.js';
import { sessionsRoutes } from './sessions.js';
import { signSessionToken } from '../lib/auth.js';
import { createSessionRow } from '../lib/session.js';
import { agentKeyRoutes } from './agent-keys.js';

let fixture: TestDatabase;
let human: string, agent: string, sibling: string, humanToken: string, agentToken: string;
const app = new Hono().route('/api/auth/cli', cliAuthRoutes).route('/api/sessions', sessionsRoutes).route('/api/agent-keys', agentKeyRoutes);
beforeAll(async () => {
  fixture = await createTestDatabase(); state.db = fixture.db as unknown as ReturnType<typeof getDb>;
});
afterAll(async () => { await fixture?.cleanup(); });
beforeEach(async () => {
  await fixture.truncateAll();
  const [account] = await fixture.sql`INSERT INTO accounts(email) VALUES ('verification@example.test') RETURNING id`;
  const rows = await fixture.sql`INSERT INTO profiles(account_id,type,name) VALUES
    (${account.id},'human','Human'), (${account.id},'agent','Noah'), (${account.id},'agent','Another') RETURNING id`;
  [human, agent, sibling] = rows.map(row => row.id);
  humanToken = await signSessionToken({ profileId: human, email: 'verification@example.test' });
  agentToken = await signSessionToken({ profileId: agent, email: 'verification@example.test' });
  await createSessionRow({ profileId: human, token: humanToken });
  await createSessionRow({ profileId: agent, token: agentToken, deviceLabel: 'Claude Code · Noah' });
});
const verify = (profileId: string, token = agentToken) => app.request('/api/auth/cli/verify', {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ profileId }),
});
const list = async () => (await (await app.request('/api/sessions', {
  headers: { Authorization: `Bearer ${humanToken}` },
})).json()) as { sessions: Array<{ profile: { id: string }; verifiedAt: string | null }> };

it('shows verification only after the bound agent checks its own profile', async () => {
  expect((await list()).sessions.every(row => row.verifiedAt === null)).toBe(true);
  const response = await verify(agent);
  expect(response.status).toBe(200);
  const body = await response.json() as { profile: { id: string }; verifiedAt: string };
  expect(body.profile.id).toBe(agent);
  const rows = (await list()).sessions;
  expect(rows.find(row => row.profile.id === agent)?.verifiedAt).toBe(body.verifiedAt);
  expect(rows.find(row => row.profile.id === human)?.verifiedAt).toBeNull();
});

it('rejects sibling and human targets without marking any session verified', async () => {
  expect((await verify(sibling)).status).toBe(403);
  expect((await verify(human)).status).toBe(403);
  expect((await list()).sessions.every(row => row.verifiedAt === null)).toBe(true);
});

it('refuses expired credentials and omits them from the live connection list', async () => {
  await fixture.sql`UPDATE sessions SET expires_at=now()-interval '1 second' WHERE profile_id=${agent}`;
  expect((await verify(agent)).status).toBe(401);
  expect((await list()).sessions.map(row => row.profile.id)).toEqual([human]);
});

it.each([undefined, 'Bearer ', 'bearer \t  ', 'Basic ignored'])('does not count a browser cookie as MCP verification with header %s', async authorization => {
  const response = await app.request('/api/auth/cli/verify', { method: 'POST',
    headers: { Cookie: `waka_session=${humanToken}`, 'Content-Type': 'application/json', ...(authorization === undefined ? {} : { Authorization: authorization }) },
    body: JSON.stringify({ profileId: human }) });
  expect(response.status).toBe(403);
});

it('verifies an agent API key only for its bound profile and refuses it after revocation', async () => {
  const created = await app.request('/api/agent-keys', { method: 'POST',
    headers: { Authorization: `Bearer ${humanToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId: agent, label: 'MCP test' }) });
  expect(created.status).toBe(201);
  const { key } = await created.json() as { key: { id: string; secret: string } };
  expect((await verify(sibling, key.secret)).status).toBe(403);
  expect((await verify(human, key.secret)).status).toBe(403);
  const response = await verify(agent, key.secret);
  expect(response.status).toBe(200);
  expect((await response.json() as { profile: { id: string } }).profile.id).toBe(agent);
  const listed = await app.request('/api/agent-keys', { headers: { Authorization: `Bearer ${humanToken}` } });
  const { keys } = await listed.json() as { keys: Array<{ id: string; lastUsedAt: string | null; secret?: string }> };
  expect(keys.find(row => row.id === key.id)?.lastUsedAt).toBeTruthy();
  expect(keys[0]).not.toHaveProperty('secret');
  expect((await list()).sessions.every(row => row.verifiedAt === null)).toBe(true);
  expect((await app.request(`/api/agent-keys/${key.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${humanToken}` } })).status).toBe(200);
  expect((await verify(agent, key.secret)).status).toBe(401);
});

it('accepts a case-insensitive bearer scheme without treating browser cookies as proof', async () => {
  const response = await app.request('/api/auth/cli/verify', { method: 'POST',
    headers: { Authorization: `bearer ${agentToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId: agent }) });
  expect(response.status).toBe(200);
});
