/** WHAT THIS MOCKS, AND WHY (gate G6): `authMiddleware` supplies fixture
 * sessions. Real routes, ownership, statement writers and erasure run on
 * disposable Postgres; no model provider is invoked. */
import {randomUUID} from 'node:crypto';
import {Hono} from 'hono';
import {afterAll,beforeAll,beforeEach,expect,it} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {createPrincipleRoutes} from './principles.js';
import type {AuthEnv} from '../lib/middleware.js';
import {assembleProfileExport} from '../lib/profile-export.js';
let t:TestDatabase,sequence=0;
beforeAll(async()=>{t=await createTestDatabase();});beforeEach(async()=>{await t.truncateAll();});afterAll(async()=>{await t?.cleanup();});
async function fixture(keyScoped=false){
  const [account]=await t.sql`INSERT INTO accounts(email) VALUES(${`statement-card-${++sequence}@example.test`}) RETURNING id`;
  const [profile]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${account.id},'human','Owner') RETURNING id`;
  const [principle]=await t.sql`INSERT INTO principles(profile_id,statement,type,origin,rank) VALUES(${profile.id},'Plan every hour of the day.','maxim','declared',0) RETURNING id`;
  const app=new Hono<AuthEnv>();app.route('/principles',createPrincipleRoutes({getDatabase:()=>t.db as never,authMiddleware:async(c,next)=>{
    c.set('session',{sessionId:randomUUID(),...(keyScoped?{keyScoped:true as const}:{}),account:{id:account.id,email:'owner@example.test'},profile:{id:profile.id,accountId:account.id,type:'human',name:'Owner',preferredLocale:'en-US'}});await next();
  }}));return {app,id:principle.id as string,profileId:profile.id as string};
}
it('does not invent older wording on read, then exposes the actual edit with its recorded dates',async()=>{
  const f=await fixture(),empty=await f.app.request(`/principles/${f.id}/statements`);
  expect(empty.status).toBe(200);expect(empty.headers.get('cache-control')).toContain('no-store');
  expect(await empty.json()).toMatchObject({profileId:f.profileId,principleId:f.id,currentStatementId:null,statements:[]});
  expect(await t.sql`SELECT id FROM principle_statements`).toHaveLength(0);
  const edit=await f.app.request(`/principles/${f.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({statement:'Leave room to reconsider the plan.'})});expect(edit.status).toBe(200);
  const response=await f.app.request(`/principles/${f.id}/statements`);
  const result=await response.json() as {currentStatementId:string;statements:Array<{id:string;statement:string;createdAt:string}>};
  expect(result.statements).toHaveLength(2);expect(result.statements.find(row=>row.id===result.currentStatementId)?.statement).toBe('Leave room to reconsider the plan.');
  expect(result.statements.some(row=>row.statement==='Plan every hour of the day.')).toBe(true);
  expect(result.statements.every(row=>Number.isFinite(Date.parse(row.createdAt)))).toBe(true);
  expect((await assembleProfileExport(t.db as never,f.profileId)).principleStatements).toHaveLength(2);
});
it('refuses another account and standing keys, and removes records with their principle',async()=>{
  const f=await fixture(),other=await fixture(),key=await fixture(true);
  expect((await other.app.request(`/principles/${f.id}/statements`)).status).toBe(404);
  expect((await other.app.request(`/principles/${f.id}/statements?profile=${f.profileId}`)).status).toBe(404);
  expect((await key.app.request(`/principles/${key.id}/statements`)).status).toBe(403);
  await f.app.request(`/principles/${f.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({statement:'A different current wording.'})});
  expect(await t.sql`SELECT id FROM principle_statements WHERE principle_id=${f.id}`).toHaveLength(2);
  expect((await f.app.request(`/principles/${f.id}`,{method:'DELETE'})).status).toBe(200);
  expect(await t.sql`SELECT id FROM principle_statements WHERE principle_id=${f.id}`).toHaveLength(0);
  expect((await f.app.request(`/principles/${f.id}/statements`)).status).toBe(404);
});
it('uses the stored predecessor link when multiple wordings have the same date',async()=>{
  const f=await fixture();
  for(const statement of ['Leave room to reconsider the plan.','Plan every hour of the day.'])await f.app.request(`/principles/${f.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({statement})});
  await t.sql`UPDATE principle_statements SET created_at='2026-10-03T12:00:00Z',superseded_at=CASE WHEN superseded_at IS NULL THEN NULL ELSE '2026-10-03T12:00:00Z'::timestamptz END WHERE principle_id=${f.id}`;
  const result=await (await f.app.request(`/principles/${f.id}/statements`)).json() as {previousStatementId:string;statements:Array<{id:string;statement:string}>};
  expect(result.statements.find(row=>row.id===result.previousStatementId)?.statement).toBe('Leave room to reconsider the plan.');
});
