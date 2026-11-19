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
afterEach(() => { vi.unstubAllGlobals();vi.unstubAllEnvs(); });
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
    const [profile] = await t.sql`INSERT INTO profiles(account_id,type,name) SELECT p.account_id,'agent',${name} FROM profiles p JOIN accounts a ON a.id=p.account_id WHERE a.email=${email} AND p.type='human' RETURNING id`;
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
  const protectedProfiles = [victim.profileId, ...victim.agents.map(a => a.profileId)];
  for (const [index, profileId] of protectedProfiles.entries()) {
    await t.sql`UPDATE profiles SET public_handle=${'previous-handle-'+index},public_profile_enabled=true,
      public_top_of_mind_enabled=true WHERE id=${profileId}`;
  }
  await t.sql`UPDATE profiles SET public_handle='unrelated-handle',public_profile_enabled=true,
    public_top_of_mind_enabled=true WHERE id=${other.profileId}`;
  const [privateMaterial] = await t.sql`INSERT INTO inspirations(profile_id,text)
    VALUES(${victim.profileId},'Synthetic pre-link material') RETURNING id`;
  expect((await request('/api/public/profiles/previous-handle-0')).status).toBe(200);

  const [linked, concurrent] = await Promise.all([link(victim.email), link(victim.email)]);
  expect(linked.status).toBe(302);
  expect(concurrent.status).toBe(302);
  expect(await t.sql`SELECT public_handle,public_profile_enabled,public_top_of_mind_enabled
    FROM profiles WHERE id = ANY(${protectedProfiles}::uuid[])`).toEqual(
    protectedProfiles.map(() => ({public_handle:null,public_profile_enabled:false,public_top_of_mind_enabled:false})),
  );
  expect((await request('/api/public/profiles/previous-handle-0')).status).toBe(404);
  expect((await request('/api/public/profiles/unrelated-handle')).status).toBe(200);
  expect(await t.sql`SELECT id FROM inspirations WHERE id=${privateMaterial.id}`).toHaveLength(1);
  const otherFresh = concurrent.headers.get('set-cookie')!.match(/waka_session=([^;]+)/)![1]!;
  expect((await request('/api/auth/me', otherFresh)).status).toBe(200);
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

it.each(['profile', 'password'] as const)('holds an already-admitted %s request across recovery', async operation => {
  const victim = await owner();
  const real = state.db;
  let entered!: () => void, resume!: () => void;
  const beforeTransaction = new Promise<void>(resolve => { entered = resolve; });
  const wait = new Promise<void>(resolve => { resume = resolve; });
  state.db = new Proxy(real, {
    get(target, key, receiver) {
      if (key !== 'transaction') return Reflect.get(target, key, receiver);
      return async (...args: Parameters<typeof real.transaction>) => {
        entered();
        await wait;
        return real.transaction(...args);
      };
    },
  });
  const inFlight = operation === 'password'
    ? request('/api/auth/login', undefined, {email:victim.email,password:'synthetic-password-123'})
    : app.request('/api/auth/me/profile', {method:'PATCH', headers:{'Content-Type':'application/json',
      Authorization:'Bearer '+victim.token}, body:JSON.stringify({
        name:'Stale change',preferredLocale:'en-US',publicHandle:'stale-public',publicProfileEnabled:true,publicTopOfMindEnabled:true,
      })});
  try {
    await Promise.race([beforeTransaction, Promise.resolve(inFlight).then(() => { throw new Error('Expected guarded transaction'); })]);
    state.db = real;
    expect((await link(victim.email)).status).toBe(302);
  } finally {
    state.db = real;
    resume();
  }
  const rejected = await inFlight;
  expect(rejected.status).toBe(401);
  expect(rejected.headers.getSetCookie()).toHaveLength(0);
  expect((await request('/api/public/profiles/stale-public')).status).toBe(404);
});

it('keeps the configured web, Capacitor bearer and JSON nonbrowser password clients usable',async()=>{
  vi.stubEnv('PUBLIC_WEB_URL','https://waka.im');
  const email=randomUUID()+'@example.test',password='synthetic-password-123';
  const body=JSON.stringify({email,password});
  const content={'Content-Type':'application/json; charset=utf-8'};
  const signup=await app.request('https://waka.im/api/auth/signup', {
    method:'POST',headers:{...content,Origin:'https://waka.im'},body,
  });
  expect(signup.status).toBe(201);
  const native=await app.request('https://waka.im/api/auth/login',{
    method:'POST',headers:{...content,Origin:'capacitor://localhost'},body,
  });
  expect(native.status).toBe(200);
  expect(native.headers.get('Access-Control-Allow-Origin')).toBe('capacitor://localhost');
  expect(native.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  const {token}=await native.json() as {token:string};
  expect((await request('/api/auth/me',token)).status).toBe(200);
  expect((await request('/api/auth/login',undefined,{email,password})).status).toBe(200);
});

it('omits bound query values and database detail from API logs and responses', async () => {
  const marker = 'private-synthetic-signup-value';
  await t.sql`CREATE FUNCTION refuse_signup_test() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'synthetic signup error' USING DETAIL=NEW.email; END $$`;
  await t.sql`CREATE TRIGGER refuse_signup_test BEFORE INSERT ON accounts FOR EACH ROW EXECUTE FUNCTION refuse_signup_test()`;
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const response = await request('/api/auth/signup', undefined, { email: marker+'@example.test', password: 'synthetic-password-123' });
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Internal Server Error');
    expect(response.headers.getSetCookie()).toHaveLength(0);
    expect(log).toHaveBeenCalledWith('[api] unhandled request failure', {category:'database',code:'P0001'});
    expect(JSON.stringify(log.mock.calls)).not.toContain(marker);
  } finally {
    log.mockRestore();
    await t.sql`DROP TRIGGER refuse_signup_test ON accounts`;
    await t.sql`DROP FUNCTION refuse_signup_test()`;
  }
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

it('uses the same new-human helper for Google signup and missing-human repair, with concurrent repair coalesced',async()=>{
 vi.stubEnv('WAKA_ENROLL_NEW_EMPTY_HUMAN_EMBEDDING_2','1');vi.stubEnv('WAKA_STAGE','development');vi.stubEnv('SST_RESOURCE_App',JSON.stringify({name:'waka',stage:'development'}));
 const email=randomUUID()+'@example.test';expect((await link(email)).status).toBe(302);
 const[first]=await t.sql`SELECT p.id,e.active_space,e.active_epoch::text AS epoch FROM accounts a JOIN profiles p ON p.account_id=a.id LEFT JOIN profile_embedding_indexes e ON e.profile_id=p.id WHERE a.email=${email}`;
 expect(first).toMatchObject({active_space:'waka.embedding.gemini-2.text-retrieval.v1.768.raw',epoch:'1'});
 const recovery=randomUUID()+'@example.test';const[a]=await t.sql`INSERT INTO accounts(email,google_sub) VALUES(${recovery},${'google-'+recovery}) RETURNING id`;
 const attempts=await Promise.all([link(recovery),link(recovery)]);expect(attempts.map(r=>r.status)).toEqual([302,302]);
 const repaired=await t.sql`SELECT p.id,e.active_space,e.active_epoch::text AS epoch FROM profiles p LEFT JOIN profile_embedding_indexes e ON e.profile_id=p.id WHERE p.account_id=${a.id} AND p.type='human'`;
 expect(repaired).toHaveLength(1);expect(repaired[0]).toMatchObject({active_space:'waka.embedding.gemini-2.text-retrieval.v1.768.raw',epoch:'1'});
 expect(await t.sql`SELECT id FROM embedding_index_attempts WHERE account_id=${a.id}`).toHaveLength(0);
});
it('does not enroll an existing native Google login even with the future enrollment flag enabled',async()=>{
 const email=randomUUID()+'@example.test';expect((await link(email)).status).toBe(302);
 vi.stubEnv('WAKA_ENROLL_NEW_EMPTY_HUMAN_EMBEDDING_2','1');vi.stubEnv('WAKA_STAGE','development');vi.stubEnv('SST_RESOURCE_App',JSON.stringify({name:'waka',stage:'development'}));
 expect((await link(email)).status).toBe(302);
 expect(await t.sql`SELECT e.profile_id FROM profile_embedding_indexes e JOIN profiles p ON p.id=e.profile_id JOIN accounts a ON a.id=p.account_id WHERE a.email=${email}`).toHaveLength(0);
});
