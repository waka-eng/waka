/** WHAT THIS MOCKS, AND WHY (gate G6)
 * `../lib/db.js` points real auth/routes at a disposable PG17 schema. No
 * middleware or authorization is replaced, and no external service is used. */
import {randomUUID} from 'node:crypto';
import {Hono} from 'hono';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {mintKeeperKey,lookupKeeperKeySession} from '../lib/keeper-key-auth.js';
import {verifySessionToken} from '../lib/auth.js';
import {requireAuth,resolveProfileAccess,type AuthEnv} from '../lib/middleware.js';
import {inspirationsRoutes} from './inspirations.js';
import {meHandler} from './auth-me.js';
import {cliAuthRoutes} from './auth-cli.js';
const state=vi.hoisted(()=>({db:null as unknown}));
vi.mock('../lib/db.js',()=>({getDb:()=>state.db}));
let t:TestDatabase;
beforeAll(async()=>{t=await createTestDatabase();state.db=t.db;vi.stubEnv('WAKA_BACKGROUND_JOB_AUTODRAIN','0');});
afterAll(async()=>{await t?.cleanup();vi.unstubAllEnvs();});
it('enforces read_only in direct HTTP and the matrix while keeping auth/read receipts distinct from memory writes',async()=>{
  const [account]=await t.sql`INSERT INTO accounts(email) VALUES('readonly@example.test') RETURNING id`;
  const [profile]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${account.id},'human','Owner') RETURNING id`;
  const key=await mintKeeperKey('read_only');
  expect(key.secret.startsWith('waka_keeper_')).toBe(false);expect(await verifySessionToken(key.secret)).toBeNull();
  await t.sql`INSERT INTO keeper_keys(profile_id,token_hash,prefix,access) VALUES(${profile.id},${key.tokenHash},${key.prefix},'read_only')`;
  const legacy=await mintKeeperKey();await t.sql`INSERT INTO keeper_keys(profile_id,token_hash,prefix,access) VALUES(${profile.id},${legacy.tokenHash},${legacy.prefix},'read_only')`;
  expect(await lookupKeeperKeySession(legacy.secret,t.db as never)).toBeNull();
  const session=await lookupKeeperKeySession(key.secret,t.db as never);expect(session).toMatchObject({keyScoped:true,keeperAccess:'read_only'});
  const app=new Hono<AuthEnv>();app.get('/api/auth/me',requireAuth,meHandler);app.route('/api/auth/cli',cliAuthRoutes);app.route('/api/inspirations',inspirationsRoutes);
  app.post('/api/harvest',requireAuth,c=>c.json({shouldNeverRun:true}));
  const headers={Authorization:`Bearer ${key.secret}`,'Content-Type':'application/json'};
  const me=await app.request('/api/auth/me',{headers});expect(me.status).toBe(200);
  expect(await me.json()).toMatchObject({profile:{id:profile.id},mcp:{version:2,memoryAccess:'read_only'}});
  for(const path of ['/api/inspirations','/api/harvest'])expect((await app.request(path,{method:'POST',headers,body:JSON.stringify({text:'Must not save',requestId:randomUUID()})})).status).toBe(403);
  for(const method of ['PATCH','DELETE'])expect((await app.request(`/api/inspirations/${randomUUID()}`,{method,headers,body:method==='PATCH'?'{}':undefined})).status).toBe(403);
  expect(resolveProfileAccess(session!,{id:profile.id,accountId:account.id,type:'human'},'capture')).toBe('denied');
  expect(resolveProfileAccess(session!,{id:profile.id,accountId:account.id,type:'human'},'read')).toBe('allowed');
  expect(resolveProfileAccess(session!,{id:randomUUID(),accountId:account.id,type:'agent'},'read')).toBe('denied');
  expect((await app.request('/api/auth/cli/verify',{method:'POST',headers,body:JSON.stringify({profileId:profile.id})})).status).toBe(200);
  expect((await t.sql`SELECT last_used_at FROM keeper_keys WHERE token_hash=${key.tokenHash}`)[0]!.last_used_at).not.toBeNull();
  expect(await t.sql`SELECT id FROM inspirations WHERE profile_id=${profile.id}`).toHaveLength(0);
  await t.sql`UPDATE keeper_keys SET access='read_capture' WHERE token_hash=${key.tokenHash}`;
  expect(await lookupKeeperKeySession(key.secret,t.db as never)).toBeNull();
  await t.sql`UPDATE keeper_keys SET access='read_only' WHERE token_hash=${key.tokenHash}`;
  await t.sql`UPDATE keeper_keys SET revoked_at=now() WHERE token_hash=${key.tokenHash}`;
  expect((await app.request('/api/auth/me',{headers})).status).toBe(401);
});
it('distinguishes an unkeyed lost acknowledgement from exact keyed replay without changing words or double charging',async()=>{
  const [account]=await t.sql`INSERT INTO accounts(email) VALUES('replay@example.test') RETURNING id`;
  const [profile]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${account.id},'human','Owner') RETURNING id`;
  const key=await mintKeeperKey();await t.sql`INSERT INTO keeper_keys(profile_id,token_hash,prefix) VALUES(${profile.id},${key.tokenHash},${key.prefix})`;
  const app=new Hono<AuthEnv>();app.route('/api/inspirations',inspirationsRoutes);
  const headers={Authorization:`Bearer ${key.secret}`,'Content-Type':'application/json'};
  const body=JSON.stringify({text:'Exact synthetic multiline\nwords',source:'app'});
  // Discard the first committed response: the old keyless contract cannot dedup.
  expect((await app.request('/api/inspirations',{method:'POST',headers,body})).status).toBe(201);
  expect((await app.request('/api/inspirations',{method:'POST',headers,body})).status).toBe(201);
  expect(await t.sql`SELECT id FROM inspirations WHERE profile_id=${profile.id}`).toHaveLength(2);
  const requestId=randomUUID();const keyed={...headers,'Idempotency-Key':requestId};
  const results=await Promise.all([app.request('/api/inspirations',{method:'POST',headers:keyed,body}),app.request('/api/inspirations',{method:'POST',headers:keyed,body})]);
  expect(results.map(r=>r.status).sort()).toEqual([200,201]);
  const saved=await Promise.all(results.map(r=>r.json() as Promise<{inspiration:{id:string;text:string}}>));
  expect(saved[0]!.inspiration).toMatchObject({id:saved[1]!.inspiration.id,text:'Exact synthetic multiline\nwords'});
  expect(await t.sql`SELECT id FROM inspirations WHERE profile_id=${profile.id}`).toHaveLength(3);
  expect((await app.request('/api/inspirations',{method:'POST',headers:keyed,body:JSON.stringify({text:'Changed words',source:'app'})})).status).toBe(409);
  const lookup=await app.request(`/api/inspirations/save-requests/${requestId}`,{headers});expect(lookup.status).toBe(200);
  const other=await app.request(`/api/inspirations/save-requests/${randomUUID()}`,{headers});expect(other.status).toBe(404);
});
