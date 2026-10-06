/** WHAT THIS MOCKS, AND WHY: only getDb is redirected to a disposable schema.
 * Real signup/login, bcrypt, sessions, cookies and SQL execute. All account
 * data is synthetic; no provider or deployed database is used. */
import {randomUUID} from 'node:crypto';
import bcrypt from 'bcryptjs';
import {Hono} from 'hono';
import {afterAll,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import type {getDb} from '../lib/db.js';
const state=vi.hoisted(()=>({db:undefined as unknown as ReturnType<typeof getDb>}));
vi.mock('../lib/db.js',()=>({getDb:()=>state.db}));
import {signupHandler,loginHandler} from './auth-password.js';
const app=new Hono().post('/signup',signupHandler).post('/login',loginHandler);
let fixture:TestDatabase;
beforeAll(async()=>{fixture=await createTestDatabase();state.db=fixture.db as unknown as ReturnType<typeof getDb>;});
beforeEach(async()=>{await fixture.truncateAll();});
afterAll(async()=>{await fixture?.cleanup();});
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
