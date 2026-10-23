/** WHAT THIS MOCKS, AND WHY: `getDb` uses disposable Postgres. Real consent,
 * code exchange, JWT/session authentication and memory routes run unchanged.
 * No user credentials, browser consent or model calls are used. */
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
const state = vi.hoisted(() => ({ db: null as any }));
vi.mock('../lib/db.js', () => ({ getDb: () => state.db }));
import { signSessionToken } from '../lib/auth.js';
import { createSessionRow } from '../lib/session.js';
import { requireAuth, type AuthEnv } from '../lib/middleware.js';
import { cliAuthRoutes } from './auth-cli.js';
import { meHandler } from './auth-me.js';
import { profilesRoutes } from './profiles.js';
import { inspirationsRoutes } from './inspirations.js';
import { signalsRoutes } from './signals.js';
import { topOfMindRoutes } from './top-of-mind.js';
import { principlesRoutes } from './principles.js';

let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); state.db = t.db; });
afterAll(async () => { await t?.cleanup(); });

it('binds Noah and anotherone tokens to their exact profiles and refuses every cross-profile memory request', async () => {
  const email = `mcp-${randomUUID()}@example.test`;
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES(${email}) RETURNING id`;
  const owners = await t.sql<{id:string;name:string;type:'human'|'agent'}[]>`INSERT INTO profiles(account_id,type,name)
    VALUES(${account.id},'human','Me'),(${account.id},'agent','noah'),(${account.id},'agent','anotherone') RETURNING id,name,type`;
  const human = owners.find(row => row.type === 'human')!;
  const ownerToken = await signSessionToken({profileId:human.id,email});
  await createSessionRow({profileId:human.id,token:ownerToken});
  const app = new Hono<AuthEnv>();
  app.route('/api/auth/cli',cliAuthRoutes);
  app.get('/api/auth/me',requireAuth,meHandler);
  app.route('/api/profiles',profilesRoutes);
  app.route('/api/inspirations',inspirationsRoutes);
  app.route('/api/signals',signalsRoutes);
  app.route('/api/top-of-mind',topOfMindRoutes);
  app.route('/api/principles',principlesRoutes);
  const headers = (token:string) => ({Authorization:`Bearer ${token}`,'Content-Type':'application/json'});
  const tokens = new Map<string,string>();
  for (const agent of owners.filter(row => row.type === 'agent')) {
    const start = await app.request(`/api/auth/cli/start?${new URLSearchParams({profile:agent.id,state:randomUUID(),callback:'http://127.0.0.1:9191/callback',device:agent.name})}`,{headers:headers(ownerToken)});
    expect(start.status).toBe(200);
    const fields:Record<string,string> = {};
    for (const field of (await start.text()).matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)) fields[field[1]!] = field[2]!.replace(/&amp;/g,'&');
    const consent = await app.request('/api/auth/cli/consent',{method:'POST',headers:{Authorization:`Bearer ${ownerToken}`,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...fields,profileId:agent.id}).toString()});
    expect(consent.status).toBe(302);
    const code = new URL(consent.headers.get('location')!).searchParams.get('code');
    const exchange = await app.request('/api/auth/cli/exchange',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});
    expect(exchange.status).toBe(200);
    const credential = await exchange.json() as {token:string;profile:{id:string;name:string;type:string}};
    expect(credential.profile).toEqual({id:agent.id,name:agent.name,type:'agent'});
    tokens.set(agent.id,credential.token);
    const identity = await (await app.request('/api/auth/me',{headers:headers(credential.token)})).json() as any;
    expect(identity.profile.id).toBe(agent.id);
    const roster = await (await app.request('/api/profiles',{headers:headers(credential.token)})).json() as any;
    expect(roster.profiles.map((row:any) => row.id)).toEqual([agent.id]);
    expect(roster.profiles[0].hasInspirations).toBe(false);
    const inspirationResponse = await app.request('/api/inspirations',{method:'POST',headers:headers(credential.token),body:JSON.stringify({text:`Only ${agent.name} remembers this`})});
    expect(inspirationResponse.status).toBe(201);
    expect((await inspirationResponse.json() as any).inspiration.profileId).toBe(agent.id);
    const updated = await (await app.request('/api/profiles',{headers:headers(credential.token)})).json() as any;
    expect(updated.profiles[0].hasInspirations).toBe(true);
  }
  const agents = owners.filter(row => row.type === 'agent');
  await t.sql`INSERT INTO agent_read_grants(grantee_profile_id,target_profile_id,granted_by_profile_id)
    VALUES(${agents[0]!.id},${agents[1]!.id},${human.id}),(${agents[1]!.id},${agents[0]!.id},${human.id})`;
  for (const agent of agents) {
    const token = tokens.get(agent.id)!;
    const own = await (await app.request('/api/inspirations',{headers:headers(token)})).json() as any;
    expect(own.inspirations.map((row:any) => row.textPreview)).toEqual([`Only ${agent.name} remembers this`]);
    for (const other of owners.filter(row => row.id !== agent.id)) {
      for (const path of ['inspirations','signals','top-of-mind','principles']) {
        expect((await app.request(`/api/${path}?profile=${other.id}`,{headers:headers(token)})).status,`${agent.name} → ${other.name}: ${path}`).toBe(403);
      }
      expect((await app.request(`/api/inspirations?profile=${other.id}`,{method:'POST',headers:headers(token),body:JSON.stringify({text:'Must not cross profiles'})})).status).toBe(403);
    }
  }
  expect(await t.sql`SELECT id FROM inspirations`).toHaveLength(2);
});
