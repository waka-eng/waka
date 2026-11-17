/** WHAT THIS MOCKS, AND WHY (gate G6): `getDb` selects a disposable schema;
 * `GeminiEmbeddingClient.embed` is deterministic for the first-capture case.
 * Real signup/login, bcrypt, sessions, source/work/job triggers and SQL execute.
 * All data is synthetic; no provider or deployed database is used. */
import {randomUUID} from 'node:crypto';
import bcrypt from 'bcryptjs';
import {Hono} from 'hono';
import {afterAll,afterEach,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {indexEmbeddingSource} from '../lib/embedding-indexer.js';
import {EMBEDDING_2_SPACE} from '../lib/embedding-2-space.js';
import type {getDb} from '../lib/db.js';
const state=vi.hoisted(()=>({db:undefined as unknown as ReturnType<typeof getDb>}));
vi.mock('../lib/db.js',()=>({getDb:()=>state.db}));
import {signupHandler,loginHandler} from './auth-password.js';
const app=new Hono().post('/signup',signupHandler).post('/login',loginHandler);
let fixture:TestDatabase;
beforeAll(async()=>{fixture=await createTestDatabase();state.db=fixture.db as unknown as ReturnType<typeof getDb>;});
beforeEach(async()=>{await fixture.truncateAll();});
afterAll(async()=>{await fixture?.cleanup();});
afterEach(()=>vi.unstubAllEnvs());
const send=(path:string,email:string,password:string)=>app.request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});

it.each(['a'.repeat(72),'가'.repeat(24),'😀'.repeat(18)])('registers and signs in with a complete boundary password',async password=>{
  const email=randomUUID()+'@example.test';
  const signup=await send('/signup',email,password);expect(signup.status).toBe(201);
  const [account]=await fixture.sql`SELECT password_hash FROM accounts WHERE email=${email}`;
  expect(await bcrypt.compare(password,account.password_hash)).toBe(true);
  const login=await send('/login',email,password);expect(login.status).toBe(200);
  expect(login.headers.get('set-cookie')).toContain('HttpOnly');
  expect(await fixture.sql`SELECT id FROM sessions`).toHaveLength(2);
});
it.each(['a'.repeat(73),'가'.repeat(25),'😀'.repeat(19)])('refuses oversized registration without identity/session rows',async password=>{
  expect((await send('/signup',randomUUID()+'@example.test',password)).status).toBe(400);
  for(const table of ['accounts','profiles','sessions'])expect(await fixture.sql.unsafe(`SELECT count(*)::int AS n FROM ${table}`)).toEqual([{n:0}]);
});
it('logs an existing long-password account in without rewriting its hash',async()=>{
  const email=randomUUID()+'@example.test',password='a'.repeat(72)+'legacy suffix',hash=await bcrypt.hash(password,4);
  const [account]=await fixture.sql`INSERT INTO accounts(email,password_hash) VALUES(${email},${hash}) RETURNING id`;
  await fixture.sql`INSERT INTO profiles(account_id,type,name) VALUES(${account.id},'human','Synthetic existing user')`;
  expect((await send('/login',email,password)).status).toBe(200);
  expect((await fixture.sql`SELECT password_hash FROM accounts WHERE id=${account.id}`)[0].password_hash).toBe(hash);
  expect((await send('/login',email,'b'+password.slice(1))).status).toBe(401);
});
it('returns a generic login refusal for malformed Unicode without creating a session',async()=>{
  const email=randomUUID()+'@example.test';
  expect((await send('/signup',email,'synthetic password')).status).toBe(201);
  expect((await send('/login',email,'password\uD800x')).status).toBe(401);
  expect(await fixture.sql`SELECT id FROM sessions`).toHaveLength(1);
});

it('enrolls a new signup only with the closed enrollment flag and leaves an existing login native',async()=>{
 const nativeEmail=randomUUID()+'@example.test';expect((await send('/signup',nativeEmail,'synthetic-password-123')).status).toBe(201);
 vi.stubEnv('WAKA_ENROLL_NEW_EMPTY_HUMAN_EMBEDDING_2','1');vi.stubEnv('WAKA_STAGE','development');vi.stubEnv('SST_RESOURCE_App',JSON.stringify({name:'waka',stage:'development'}));
 expect((await send('/login',nativeEmail,'synthetic-password-123')).status).toBe(200);
 expect(await fixture.sql`SELECT e.profile_id FROM profile_embedding_indexes e JOIN profiles p ON p.id=e.profile_id JOIN accounts a ON a.id=p.account_id WHERE a.email=${nativeEmail}`).toHaveLength(0);
 const email=randomUUID()+'@example.test';expect((await send('/signup',email,'synthetic-password-123')).status).toBe(201);
 expect((await fixture.sql`SELECT e.active_space,e.active_epoch::text AS epoch FROM profile_embedding_indexes e JOIN profiles p ON p.id=e.profile_id JOIN accounts a ON a.id=p.account_id WHERE a.email=${email}`)[0]).toMatchObject({active_space:'waka.embedding.gemini-2.text-retrieval.v1.768.raw',epoch:'1'});
 expect(await fixture.sql`SELECT id FROM embedding_index_attempts`).toHaveLength(0);
});
it('rolls back signup entirely when enabled enrollment has no trusted production App identity',async()=>{
 vi.stubEnv('WAKA_ENROLL_NEW_EMPTY_HUMAN_EMBEDDING_2','1');vi.stubEnv('WAKA_STAGE','production');
 const email=randomUUID()+'@example.test';expect((await send('/signup',email,'synthetic-password-123')).status).toBe(500);
 expect(await fixture.sql`SELECT id FROM accounts WHERE email=${email}`).toHaveLength(0);
 expect(await fixture.sql`SELECT profile_id FROM profile_embedding_indexes`).toHaveLength(0);
});

it('creates normal durable index intent for the first capture of a helper-enrolled human and settles with one fake request',async()=>{
 vi.stubEnv('WAKA_ENROLL_NEW_EMPTY_HUMAN_EMBEDDING_2','1');vi.stubEnv('WAKA_STAGE','development');vi.stubEnv('SST_RESOURCE_App',JSON.stringify({name:'waka',stage:'development'}));
 const email=randomUUID()+'@example.test';expect((await send('/signup',email,'synthetic-password-123')).status).toBe(201);
 const[p]=await fixture.sql`SELECT p.id FROM profiles p JOIN accounts a ON a.id=p.account_id WHERE a.email=${email} AND p.type='human'`;
 const[i]=await fixture.sql`INSERT INTO inspirations(profile_id,text) VALUES(${p.id},'First exact synthetic capture after enrollment.') RETURNING id,text`;
 const[work]=await fixture.sql`SELECT requested_version>completed_version AS pending FROM embedding_index_work WHERE profile_id=${p.id} AND source_id=${i.id} AND space=${EMBEDDING_2_SPACE.id}`;expect(work.pending).toBe(true);
 expect(await fixture.sql`SELECT id FROM background_jobs WHERE profile_id=${p.id} AND type='index_embedding'`).toHaveLength(1);
 const embed=vi.fn(async()=>[1,...Array<number>(767).fill(0)]);
 await indexEmbeddingSource(fixture.db,{profileId:p.id,sourceKind:'inspiration',sourceId:i.id,space:EMBEDDING_2_SPACE.id},{client:{model:EMBEDDING_2_SPACE.id,embed}});
 expect(embed).toHaveBeenCalledOnce();expect((await fixture.sql`SELECT requested_version=completed_version AS settled,outcome FROM embedding_index_work WHERE profile_id=${p.id} AND source_id=${i.id} AND space=${EMBEDDING_2_SPACE.id}`)[0]).toMatchObject({settled:true,outcome:'current'});
 expect((await fixture.sql`SELECT text FROM inspirations WHERE id=${i.id}`)[0].text).toBe(i.text);
});

it('leaves production signup native with enrollment explicitly off',async()=>{
 vi.stubEnv('WAKA_ENROLL_NEW_EMPTY_HUMAN_EMBEDDING_2','0');vi.stubEnv('WAKA_STAGE','production');vi.stubEnv('SST_RESOURCE_App',JSON.stringify({name:'waka',stage:'production'}));
 const email=randomUUID()+'@example.test';expect((await send('/signup',email,'synthetic-password-123')).status).toBe(201);
 expect(await fixture.sql`SELECT e.profile_id FROM profile_embedding_indexes e JOIN profiles p ON p.id=e.profile_id JOIN accounts a ON a.id=p.account_id WHERE a.email=${email}`).toHaveLength(0);
 expect(await fixture.sql`SELECT id FROM embedding_index_attempts`).toHaveLength(0);
});
