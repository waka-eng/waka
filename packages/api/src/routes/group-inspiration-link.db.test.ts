/** WHAT THIS MOCKS, AND WHY (gate G6): authentication supplies a chosen
 * reader; actual group routes and SQL enforce visibility in disposable
 * Postgres. No model or browser behavior is claimed here. */
import { randomUUID } from 'node:crypto';
import { Hono, type MiddlewareHandler } from 'hono';
import { afterAll, beforeEach, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import type { AuthEnv } from '../lib/middleware.js';
import { createGroupsRoutes } from './groups.js';
import { createGroupForProfile, joinGroupByCode } from './groups-membership.js';
let t: TestDatabase, sequence = 0;
beforeEach(async () => { t ??= await createTestDatabase(); await t.truncateAll(); });
afterAll(async () => { await t?.cleanup(); });
async function person(type: 'human' | 'agent' = 'human') {
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES (${`link-${++sequence}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${account.id},${type},'Reader') RETURNING id`;
  const auth: MiddlewareHandler<AuthEnv> = async (c, next) => {
    c.set('session', { sessionId: randomUUID(), account: { id: account.id, email: 'reader@example.test' },
      profile: { id: profile.id, accountId: account.id, type, name: 'Reader', preferredLocale: 'en-US' } }); await next();
  };
  const app = new Hono<AuthEnv>(); app.route('/api/groups', createGroupsRoutes({ getDatabase: () => t.db as never, authMiddleware: auth }));
  return { id: profile.id as string, app };
}
async function inspiration(profileId: string, visibility: 'public' | 'private' = 'public') {
  const [row] = await t.sql`INSERT INTO inspirations(profile_id,text,visibility,created_at)
    VALUES (${profileId},'A public thought',${visibility},'2020-01-01') RETURNING id`;
  await t.sql`INSERT INTO reflections(profile_id,inspiration_id,question,answer)
    VALUES (${profileId},${row.id},'Private question','PRIVATE_ANSWER_SENTINEL')`;
  return row.id as string;
}
it('reads an older public member inspiration outside the field limit, without private answers or evidence', async () => {
  const viewer = await person(), author = await person();
  const group = await createGroupForProfile(t.db as never, { profileId: viewer.id, name: 'Room' });
  await joinGroupByCode(t.db as never, { profileId: author.id, joinCode: group.joinCode });
  const id = await inspiration(author.id);
  await t.sql`INSERT INTO inspirations(profile_id,text,visibility) SELECT ${author.id},'Newer', 'public' FROM generate_series(1,401)`;
  const response = await viewer.app.request(`/api/groups/${group.id}/field/${id}`);
  expect(response.status).toBe(200);
  const body = await response.json() as { inspiration: { id: string } }; expect(body.inspiration.id).toBe(id);
  expect(Object.keys(body.inspiration).sort()).toEqual(['id','text','kind','source','createdAt','updatedAt','ownerProfileId','ownerName','ownerType'].sort());
  expect(JSON.stringify(body)).not.toContain('PRIVATE_ANSWER_SENTINEL');
});
it('refuses private, nonmember and departed-author inspirations', async () => {
  const viewer = await person(), author = await person(), stranger = await person();
  const group = await createGroupForProfile(t.db as never, { profileId: viewer.id, name: 'Room' });
  await joinGroupByCode(t.db as never, { profileId: author.id, joinCode: group.joinCode });
  const path = (id: string) => `/api/groups/${group.id}/field/${id}`;
  expect((await viewer.app.request(path(await inspiration(author.id, 'private')))).status).toBe(404);
  expect((await viewer.app.request(path(await inspiration(stranger.id)))).status).toBe(404);
  const id = await inspiration(author.id);
  await t.sql`DELETE FROM group_members WHERE group_id=${group.id} AND profile_id=${author.id}`;
  expect((await viewer.app.request(path(id))).status).toBe(404);
});
it('checks current reader membership on every read, including another group and agent readers', async () => {
  const viewer = await person(), member = await person(), stranger = await person(), agent = await person('agent');
  const group = await createGroupForProfile(t.db as never, { profileId: viewer.id, name: 'Room' });
  await joinGroupByCode(t.db as never, { profileId: member.id, joinCode: group.joinCode });
  const id = await inspiration(viewer.id), path = `/api/groups/${group.id}/field/${id}`;
  expect((await stranger.app.request(path)).status).toBe(404);
  expect((await agent.app.request(path)).status).toBe(403);
  expect((await member.app.request(path)).status).toBe(200);
  await t.sql`DELETE FROM group_members WHERE group_id=${group.id} AND profile_id=${member.id}`;
  expect((await member.app.request(path)).status).toBe(404);
  const other = await createGroupForProfile(t.db as never, { profileId: member.id, name: 'Elsewhere' });
  expect((await member.app.request(`/api/groups/${other.id}/field/${id}`)).status).toBe(404);
});
it('refuses a stale agent membership row and validates link identifiers', async () => {
  const viewer = await person(), agent = await person('agent');
  const group = await createGroupForProfile(t.db as never, { profileId: viewer.id, name: 'Room' });
  await t.sql`INSERT INTO group_members(group_id,profile_id,role) VALUES (${group.id},${agent.id},'member')`;
  expect((await viewer.app.request(`/api/groups/${group.id}/field/${await inspiration(agent.id)}`)).status).toBe(404);
  expect((await viewer.app.request(`/api/groups/${group.id}/field/not-an-id`)).status).toBe(400);
});
