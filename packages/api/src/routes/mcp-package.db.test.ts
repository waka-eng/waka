/**
 * WHAT THIS MOCKS, AND WHY (gate G6)
 * `../lib/db.js` binds API queries to disposable Postgres. The actual public
 * archive runs in a child process against real HTTP routes and real key auth.
 * No client registration, personal credentials or model calls are involved.
 */
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
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
let t: TestDatabase, directory: string, legacyDirectory: string, origin: string;
let server: ReturnType<typeof serve>;
let subjects: Array<{ id: string; name: string; type: string; secret: string; keyId: string; readonly?:boolean; legacy?:boolean }>;
let loseNextSaveAck=false;
beforeAll(async () => {
  process.env.WAKA_BACKGROUND_JOB_AUTODRAIN='0';
  t = await createTestDatabase(); state.db = t.db;
  directory = await mkdtemp(join(tmpdir(), 'waka-mcp-contract-'));
  const root = resolve(process.cwd(), '../..');
  const manifest = JSON.parse(await readFile(join(root, 'packages/web/src/lib/mcp-distribution.json'), 'utf8'));
  execFileSync('tar', ['-xzf', process.env.WAKA_MCP_PACKAGE_PATH ?? join(root, 'packages/web/public/downloads', manifest.filename), '-C', directory]);
  legacyDirectory=join(directory,'legacy');await mkdir(legacyDirectory);
  execFileSync('tar',['-xzf',join(root,'packages/web/public/downloads/waka-mcp-0.1.0-client.6357c1646284-d2e5d35503e9.tgz'),'-C',legacyDirectory]);
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
    const [source]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${profile.id},${`Full synthetic source for ${profile.name}`}) RETURNING id`;
    await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url) VALUES(${profile.id},${source.id},'link','https://example.test/PRIVATE_CANARY_URL')`;
    await t.sql`INSERT INTO reflections(profile_id,inspiration_id,question,answer) VALUES(${profile.id},${source.id},'Exact fixture question','Exact multiline\nanswer')`;
    const [signal]=await t.sql`INSERT INTO signals(profile_id,statement,locked_at) VALUES(${profile.id},${`Owner kept wording for ${profile.name}`},now()) RETURNING id`;
    await t.sql`INSERT INTO signal_evidence(profile_id,owner_profile_id,signal_id,inspiration_id,quote,quote_source) VALUES(${profile.id},${profile.id},${signal.id},${source.id},'Full synthetic source','own')`;
    const [reading]=await t.sql`INSERT INTO top_of_minds(profile_id) VALUES(${profile.id}) RETURNING id`;
    await t.sql`INSERT INTO top_of_mind_entries(top_of_mind_id,type,body,locked_at) VALUES(${reading.id},'pattern',${`Locked reading for ${profile.name}`},now())`;
    await t.sql`INSERT INTO principles(profile_id,statement,type,origin,rank,locked_at) VALUES(${profile.id},${`Preserve words for ${profile.name}`},'maxim','declared',0,now())`;
    if(profile.type==='human'){
      const ro=await mintKeeperKey("read_only");const [row]=await t.sql`INSERT INTO keeper_keys(profile_id,token_hash,prefix,access) VALUES(${profile.id},${ro.tokenHash},${ro.prefix},'read_only') RETURNING id`;
      subjects.push({id:profile.id,name:'Read-only',type:profile.type,secret:ro.secret,keyId:row.id,readonly:true});
      for(const access of ['read_capture','read_only'] as const){
        const old=await mintKeeperKey(access);const [record]=await t.sql`INSERT INTO keeper_keys(profile_id,token_hash,prefix,access) VALUES(${profile.id},${old.tokenHash},${old.prefix},${access}) RETURNING id`;
        subjects.push({id:profile.id,name:access==='read_only'?'Old read-only':'Old capture',type:profile.type,secret:old.secret,keyId:record.id,readonly:access==='read_only',legacy:true});
      }
    }
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
  server = serve({ fetch: async req=>{
    const result=await app.fetch(req);
    if(loseNextSaveAck&&req.method==='POST'&&new URL(req.url).pathname==='/api/inspirations'&&result.status===201){loseNextSaveAck=false;return new Response('PRIVATE_CANARY_MALFORMED_ACK');}
    return result;
  }, hostname: '127.0.0.1', port: 0 });
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

it.each(['Noah', 'Anotherone', 'Me', 'Read-only', 'Old capture', 'Old read-only'])('the published MCP package verifies, reads and saves only %s memory, then stops on revocation', async name => {
  const subject = subjects.find(row => row.name === name)!;
  const type = subject.type;
  const foreign = subjects.find(row => row.type === 'agent' && row.id !== subject.id)!;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(TOKEN|SECRET|PASSWORD|KEY|^WAKA_|^NODE_OPTIONS$|^NODE_PATH$|^TSX_)/i.test(key)));
  const child = spawn(process.execPath, [join(subject.legacy?legacyDirectory:directory, 'package/server.mjs')], {
    env: { ...env, WAKA_API_URL: origin, WAKA_API_KEY: subject.secret, WAKA_PROFILE_ID: subject.id,
      WAKA_HOME: join(directory, subject.id), ...(subject.readonly?{WAKA_MCP_MODE:'read_only'}:{}) }, stdio: ['pipe', 'pipe', 'pipe'],
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
    const tools=await rpc('tools/list',{});
    if(subject.legacy){
      expect(tools.tools).toHaveLength(8);
      // Old registration still advertises capture; the actual new backend is
      // the authority, including when an old client ignores the new mode.
      const text=`Old immutable client ${subject.name}`;
      const result=await call('waka_add_inspiration',{text,source:'app'});
      expect(Boolean(result.isError)).toBe(Boolean(subject.readonly));
      expect(await t.sql`SELECT id FROM inspirations WHERE text=${text}`).toHaveLength(subject.readonly?0:1);
      expect((await call('waka_get_principles')).isError).not.toBe(true);
      expect((await call('waka_list_inspirations',{profileId:foreign.id})).isError).toBe(true);
      await t.sql`UPDATE keeper_keys SET revoked_at=now() WHERE id=${subject.keyId}`;
      expect((await call('waka_list_inspirations')).isError).toBe(true);
      return;
    }
    expect(tools.tools.map((tool:{name:string})=>tool.name)).toEqual(expect.arrayContaining(['waka_get_inspiration','waka_get_signal','waka_get_capture_status']));
    expect(tools.tools.some((tool:{name:string})=>tool.name==='waka_add_inspiration')).toBe(!subject.readonly);
    const text = `Only ${subject.name} owns this synthetic inspiration`;
    if(!subject.readonly){
      const requestId=randomUUID();loseNextSaveAck=true;
      const savedInspiration=await call('waka_add_inspiration',{requestId,text,source:'app',kind:'note'});
      expect(savedInspiration.isError).toBe(true);expect(savedInspiration.content[0].text).toContain('UNCERTAIN');expect(savedInspiration.content[0].text).not.toContain('PRIVATE_CANARY');
      expect(body(await call('waka_get_capture_status',{requestId}))).toMatchObject({state:'committed'});
      const replay=body(await call('waka_add_inspiration',{requestId,text,source:'app',kind:'note'}));expect(replay.state).toBe('committed');
      expect(await t.sql`SELECT profile_id FROM inspirations WHERE text=${text}`).toEqual([{profile_id:subject.id}]);
      const detail=body(await call('waka_get_inspiration',{id:replay.inspirationId}));expect(detail.text).toBe(text);expect(detail.materialRevision).toMatch(/^[1-9][0-9]*$/);
    }else{
      expect((await call('waka_add_inspiration',{requestId:randomUUID(),text,source:'app'})).isError).toBe(true);
      expect((await fetch(`${origin}/api/inspirations`,{method:'POST',headers:{Authorization:`Bearer ${subject.secret}`,'Content-Type':'application/json'},body:JSON.stringify({text})})).status).toBe(403);
    }
    expect(body(await call('waka_get_capture_status',{requestId:randomUUID()}))).toMatchObject({state:'not_observed'});
    await t.sql`UPDATE signal_evidence e SET material_revision=r.personal_revision FROM inspiration_revisions r WHERE e.profile_id=${subject.id} AND r.profile_id=e.owner_profile_id AND r.inspiration_id=e.inspiration_id`;
    const [fullSource]=await t.sql`SELECT i.id FROM inspirations i JOIN attachments a ON a.inspiration_id=i.id AND a.profile_id=i.profile_id WHERE i.profile_id=${subject.id} LIMIT 1`;
    const full=body(await call('waka_get_inspiration',{id:fullSource.id}));expect(full.attachments[0].type).toBe('link');expect(full.attachments[0].id).toBeTruthy();expect(full.reflections[0].answer).toBe('Exact multiline\nanswer');expect(JSON.stringify(full)).not.toContain('PRIVATE_CANARY_URL');
    const [sig]=await t.sql`SELECT id FROM signals WHERE profile_id=${subject.id} LIMIT 1`;
    const signal=body(await call('waka_get_signal',{id:sig.id}));expect(signal).toMatchObject({locked:true,unsupported:false,evidenceCount:1});expect(signal.evidence[0]).toMatchObject({current:true});
    await t.sql`UPDATE inspirations SET text=${`Updated owned source for ${subject.name}`} WHERE id=${signal.evidence[0].inspirationId}`;
    const stale=body(await call('waka_get_signal',{id:sig.id}));expect(stale).toMatchObject({supportPending:true,evidenceCount:0});expect(stale.evidence[0]).toMatchObject({current:false,quote:null,reason:null});
    const count=async()=>(await t.sql`SELECT count(*)::int AS n FROM consultations WHERE profile_id=${subject.id} AND surface='principles'`)[0]!.n;
    const before=await count();const principles=await call('waka_get_principles');expect(principles.isError).not.toBe(true);expect(principles.content[0].text).toContain(`Preserve words for ${subject.name==='Read-only'?'Me':subject.name}`);expect(await count()).toBe(before+1);
    for (const kind of ['audio', 'decision']) {
      await t.sql`INSERT INTO inspirations(profile_id,text,kind) VALUES(${subject.id},${`Own ${kind} capture`},${kind})`;
    }
    const listed = body(await call('waka_list_inspirations'));
    if(!subject.readonly)expect(JSON.stringify(listed)).toContain(text);
    expect(listed.inspirations.map((row: { kind: string }) => row.kind)).toEqual(expect.arrayContaining(['audio', 'decision', 'note']));
    for (const name of ['waka_list_signals', 'waka_get_profile', 'waka_get_principles']) {
      const result = await call(name);
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
    }
    expect((await call('waka_list_inspirations', { profileId: foreign.id })).isError).toBe(true);
    const [foreignSource]=await t.sql`SELECT id FROM inspirations WHERE profile_id=${foreign.id} LIMIT 1`;
    const [foreignSignal]=await t.sql`SELECT id FROM signals WHERE profile_id=${foreign.id} LIMIT 1`;
    expect((await call('waka_get_inspiration',{id:foreignSource.id})).isError).toBe(true);
    expect((await call('waka_get_signal',{id:foreignSignal.id})).isError).toBe(true);
    expect((await call('waka_add_inspiration', { requestId:randomUUID(),text: 'Must not cross', source: 'app', profileId: foreign.id })).isError).toBe(true);
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
