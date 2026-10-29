/**
 * WHAT THIS MOCKS, AND WHY (gate G6)
 * `../lib/db.js` binds production queries to disposable Postgres.
 * `../lib/attachment-sweep.js` records external cleanup without deleting real
 * objects. Authentication, routes, FK cascades and key lookup are real.
 * `JWT_SECRET` supplies a synthetic signing key for these sessions only.
 */
import { Hono } from 'hono';
import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import { profilesRoutes } from './profiles.js';
import { mintAgentKey, lookupAgentKeySession } from '../lib/agent-key-auth.js';
import { signSessionToken } from '../lib/auth.js';
import { createSessionRow, lookupSession } from '../lib/session.js';
import type { AuthEnv } from '../lib/middleware.js';

const state = vi.hoisted(() => ({ db: null as unknown, sweep: vi.fn() }));
vi.mock('../lib/db.js', () => ({ getDb: () => state.db }));
vi.mock('../lib/attachment-sweep.js', () => ({ sweepAttachmentObjects: state.sweep }));
let t: TestDatabase;
beforeEach(async () => {
  t ??= await createTestDatabase();
  await t.truncateAll();
  state.db = t.db;
  state.sweep.mockReset().mockResolvedValue(undefined);
  vi.stubEnv('JWT_SECRET', 'profile-deletion-synthetic-test-signing-key');
});
afterAll(async () => { vi.unstubAllEnvs(); await t?.cleanup(); });

it('removes only the owned agent, revokes both credentials, cancels its work and retains sibling memory', async () => {
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES('profile-delete@example.test') RETURNING id`;
  const [human] = await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${account.id},'human','Owner') RETURNING id`;
  const [agent] = await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${account.id},'agent','Noah') RETURNING id`;
  const [sibling] = await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${account.id},'agent','Anotherone') RETURNING id`;
  const [source] = await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${agent.id},'Noah memory') RETURNING id`;
  await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${sibling.id},'Sibling memory')`;
  await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,s3_key)
    VALUES(${agent.id},${source.id},'image','https://example.test/photo','noah/live')`;
  await t.sql`INSERT INTO deleted_inspirations(id,profile_id,text,source,visibility,kept_at,attachments)
    VALUES(gen_random_uuid(),${agent.id},'deleted','app','private',now(),'[{"s3Key":"noah/deleted"}]'::jsonb)`;
  await t.sql`INSERT INTO background_jobs(profile_id,type,payload,status,locked_at)
    VALUES(${agent.id},'derive_signals',${JSON.stringify({ inspirationId: source.id })}::jsonb,'running',now())`;
  const key = await mintAgentKey();
  await t.sql`INSERT INTO agent_keys(profile_id,token_hash,prefix) VALUES(${agent.id},${key.tokenHash},${key.prefix})`;
  const ownerToken = await signSessionToken({ profileId: human.id, email: 'profile-delete@example.test' });
  const agentToken = await signSessionToken({ profileId: agent.id, email: 'profile-delete@example.test' });
  await createSessionRow({ profileId: human.id, token: ownerToken });
  await createSessionRow({ profileId: agent.id, token: agentToken });
  expect(await lookupAgentKeySession(key.secret)).not.toBeNull();
  expect(await lookupSession(agentToken)).not.toBeNull();
  const app = new Hono<AuthEnv>();
  app.route('/api/profiles', profilesRoutes);
  const remove = (id: string, token: string) => app.request(`/api/profiles/${id}`, {
    method: 'DELETE', headers: { authorization: `Bearer ${token}` },
  });
  expect((await remove(agent.id, key.secret)).status).toBe(403);
  expect((await remove(human.id, ownerToken)).status).toBe(404);
  expect((await remove(agent.id, ownerToken)).status).toBe(200);
  expect((await remove(agent.id, ownerToken)).status).toBe(404);
  expect(await lookupAgentKeySession(key.secret)).toBeNull();
  expect(await lookupSession(agentToken)).toBeNull();
  expect(await lookupSession(ownerToken)).not.toBeNull();
  expect((await app.request('/api/profiles', { headers: { authorization: `Bearer ${key.secret}` } })).status).toBe(401);
  for (const table of ['inspirations', 'attachments', 'deleted_inspirations', 'background_jobs', 'sessions', 'agent_keys']) {
    expect(await t.sql`SELECT profile_id FROM ${t.sql(table)} WHERE profile_id=${agent.id}`).toHaveLength(0);
  }
  expect(await t.sql`SELECT text FROM inspirations WHERE profile_id=${sibling.id}`).toEqual([{ text: 'Sibling memory' }]);
  expect(state.sweep).toHaveBeenCalledExactlyOnceWith(expect.arrayContaining(['noah/live', 'noah/deleted']));
});
