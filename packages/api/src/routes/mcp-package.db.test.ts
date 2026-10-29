/**
 * WHAT THIS MOCKS, AND WHY (gate G6)
 * `../lib/db.js` binds API queries to disposable Postgres. The actual public
 * archive runs in a child process against real HTTP routes and real key auth.
 * No client registration, personal credentials or model calls are involved.
 */
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import { mintAgentKey } from '../lib/agent-key-auth.js';
import { mintKeeperKey } from '../lib/keeper-key-auth.js';
import { requireAuth, type AuthEnv } from '../lib/middleware.js';
import { meHandler } from './auth-me.js';
import { cliAuthRoutes } from './auth-cli.js';
import { profilesRoutes } from './profiles.js';
import { inspirationsRoutes } from './inspirations.js';
import { signalsRoutes } from './signals.js';
import { topOfMindRoutes } from './top-of-mind.js';
import { principlesRoutes, principlesMarkdownRoutes } from './principles.js';

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('../lib/db.js', () => ({ getDb: () => state.db }));
let t: TestDatabase, directory: string, origin: string;
let server: ReturnType<typeof serve>;
let subjects: Array<{ id: string; name: string; type: string; secret: string; keyId: string }>;
beforeAll(async () => {
  t = await createTestDatabase(); state.db = t.db;
  directory = await mkdtemp(join(tmpdir(), 'waka-mcp-contract-'));
  const root = resolve(process.cwd(), '../..');
  const manifest = JSON.parse(await readFile(join(root, 'packages/web/src/lib/mcp-distribution.json'), 'utf8'));
  execFileSync('tar', ['-xzf', join(root, 'packages/web/public/downloads', manifest.filename), '-C', directory]);
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES('mcp-contract@example.test') RETURNING id`;
  const rows = await t.sql`INSERT INTO profiles(account_id,type,name) VALUES
    (${account.id},'human','Me'),(${account.id},'agent','Noah'),(${account.id},'agent','Anotherone') RETURNING id,type,name`;
  subjects = [];
  for (const profile of rows) {
    const key = profile.type === 'human' ? await mintKeeperKey() : await mintAgentKey();
    const table = profile.type === 'human' ? 'keeper_keys' : 'agent_keys';
    const [saved] = await t.sql`INSERT INTO ${t.sql(table)}(profile_id,token_hash,prefix,created_at)
      VALUES(${profile.id},${key.tokenHash},${key.prefix},now()-interval '2 years') RETURNING id`;
    subjects.push({ id: profile.id, name: profile.name, type: profile.type, secret: key.secret, keyId: saved!.id });
  }
  const app = new Hono<AuthEnv>();
  app.get('/api/auth/me', requireAuth, meHandler);
  app.route('/api/auth/cli', cliAuthRoutes);
  app.route('/api/profiles', profilesRoutes);
  app.route('/api/inspirations', inspirationsRoutes);
  app.route('/api/signals', signalsRoutes);
  app.route('/api/top-of-mind', topOfMindRoutes);
  app.route('/api/principles', principlesRoutes);
  app.route('/api/principles.md', principlesMarkdownRoutes);
  server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  if (server) {
    if ('closeAllConnections' in server) server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  if (directory) await rm(directory, { recursive: true, force: true });
  await t?.cleanup();
});

it.each(['Noah', 'Anotherone', 'Me'])('the published MCP package verifies, reads and saves only %s memory, then stops on revocation', async name => {
  const subject = subjects.find(row => row.name === name)!;
  const type = subject.type;
  const foreign = subjects.find(row => row.type === 'agent' && row.id !== subject.id)!;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(TOKEN|SECRET|PASSWORD|KEY|^WAKA_|^NODE_OPTIONS$|^NODE_PATH$|^TSX_)/i.test(key)));
  const child = spawn(process.execPath, [join(directory, 'package/server.mjs')], {
    env: { ...env, WAKA_API_URL: origin, WAKA_API_KEY: subject.secret, WAKA_PROFILE_ID: subject.id,
      WAKA_HOME: join(directory, subject.id) }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout });
  let id = 0;
  async function rpc(method: string, params: unknown): Promise<any> {
    const requestId = ++id;
    return new Promise((resolve, reject) => {
      const done = (line: string) => {
        const message = JSON.parse(line);
        if (message.id !== requestId) return;
        clearTimeout(timer); lines.off('line', done);
        if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result);
      };
      const timer = setTimeout(() => { lines.off('line', done); reject(new Error(`MCP ${method} timed out`)); }, 5000);
      lines.on('line', done);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n');
    });
  }
  const call = (name: string, args: Record<string, unknown> = {}) => rpc('tools/call', { name, arguments: args });
  const body = (result: any) => { expect(result.isError, JSON.stringify(result)).not.toBe(true); return JSON.parse(result.content[0].text); };
  try {
    await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'real-api-fixture', version: '1.0' } });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    expect(body(await call('waka_verify_connection', { profileId: subject.id })).profile.id).toBe(subject.id);
    expect(body(await call('waka_list_profiles')).map((row: { id: string }) => row.id)).toEqual([subject.id]);
    const text = `Only ${subject.name} owns this synthetic inspiration`;
    const savedInspiration = await call('waka_add_inspiration', { text, source: 'app', kind: 'note' });
    expect(savedInspiration.isError, JSON.stringify(savedInspiration)).not.toBe(true);
    expect(savedInspiration.content[0].text).toContain('Captured into WAKA');
    expect(await t.sql`SELECT profile_id FROM inspirations WHERE text=${text}`).toEqual([{ profile_id: subject.id }]);
    for (const kind of ['audio', 'decision']) {
      await t.sql`INSERT INTO inspirations(profile_id,text,kind) VALUES(${subject.id},${`Own ${kind} capture`},${kind})`;
    }
    const listed = body(await call('waka_list_inspirations'));
    expect(JSON.stringify(listed)).toContain(text);
    expect(listed.inspirations.map((row: { kind: string }) => row.kind)).toEqual(expect.arrayContaining(['audio', 'decision', 'note']));
    for (const name of ['waka_list_signals', 'waka_get_profile', 'waka_get_principles']) {
      const result = await call(name);
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
    }
    expect((await call('waka_list_inspirations', { profileId: foreign.id })).isError).toBe(true);
    expect((await call('waka_add_inspiration', { text: 'Must not cross', source: 'app', profileId: foreign.id })).isError).toBe(true);
    const direct = await fetch(`${origin}/api/inspirations?profile=${foreign.id}`, { headers: { Authorization: `Bearer ${subject.secret}` } });
    expect(direct.status).toBe(403);
    const headers = { Authorization: `Bearer ${subject.secret}`, 'Content-Type': 'application/json' };
    expect((await fetch(`${origin}/api/auth/cli/verify`, { method: 'POST', headers,
      body: JSON.stringify({ profileId: foreign.id }) })).status).toBe(403);
    expect((await fetch(`${origin}/api/auth/cli/start?callback=http://127.0.0.1:9191/callback&state=test`, { headers })).status).toBe(403);
    expect((await fetch(`${origin}/api/profiles`, { method: 'POST', headers,
      body: JSON.stringify({ name: 'Must not mint a profile' }) })).status).toBe(403);
    if (type === 'human') {
      const [saved] = await t.sql`SELECT id FROM inspirations WHERE profile_id=${subject.id}`;
      for (const method of ['PATCH', 'DELETE']) {
        expect((await fetch(`${origin}/api/inspirations/${saved!.id}`, { method, headers,
          ...(method === 'PATCH' ? { body: JSON.stringify({ text: 'Must not edit' }) } : {}) })).status).toBe(403);
      }
    }
    const table = type === 'human' ? 'keeper_keys' : 'agent_keys';
    await t.sql`UPDATE ${t.sql(table)} SET revoked_at=now() WHERE id=${subject.keyId}`;
    const revoked = await call('waka_list_inspirations');
    expect(revoked.isError).toBe(true);
    expect(revoked.content[0].text).toContain('revoked');
    expect(await t.sql`SELECT id FROM inspirations WHERE text='Must not cross'`).toHaveLength(0);
  } finally {
    lines.close();
    if (child.exitCode === null && child.signalCode === null) { child.kill(); await once(child, 'close'); }
  }
}, 15000);
