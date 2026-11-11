/** Real legacy rows, auth, export and tenancy. Only the disposable DB connection is injected. */
import {randomUUID} from 'node:crypto';import {Hono} from 'hono';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import type {getDb} from '../lib/db.js';
const state=vi.hoisted(()=>({db:undefined as unknown as ReturnType<typeof getDb>}));
vi.mock('../lib/db.js',()=>({getDb:()=>state.db}));
import {profilesRoutes} from './profiles.js';import {createExportRoute} from './export.js';
import {inspirationsRoutes} from './inspirations.js';import {cliAuthRoutes} from './auth-cli.js';
import {signSessionToken} from '../lib/auth.js';import {createSessionRow} from '../lib/session.js';
import {assembleProfileExport} from '../lib/profile-export.js';
let t:TestDatabase;
beforeAll(async()=>{t=await createTestDatabase();state.db=t.db as ReturnType<typeof getDb>;});afterAll(async()=>{await t?.cleanup();});
it.each([0,1,3])('retains ownership, locked words, exports and isolated credentials with %i legacy stacks',async count=>{
 const email=randomUUID()+'@example.test';const [account]=await t.sql`INSERT INTO accounts(email) VALUES(${email}) RETURNING id`;
 const owners=[] as Array<{id:string;type:string;token:string}>;
 for(let i=0;i<=count;i++){
  const [p]=await t.sql<{id:string;type:string}[]>`INSERT INTO profiles(account_id,type,name) VALUES(${account.id},${i?'agent':'human'},${i?'Retained '+i:'Owner'}) RETURNING id,type`;
  await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${p.id},${'Original '+p.id})`;
  await t.sql`INSERT INTO signals(profile_id,statement,confidence,locked_at) VALUES(${p.id},${'My locked words '+p.id},0.5,now())`;
  const token=await signSessionToken({profileId:p.id,email});await createSessionRow({profileId:p.id,token,deviceLabel:'Existing device'});owners.push({...p,token});
 }
 const app=new Hono();app.route('/api/profiles',profilesRoutes);app.route('/api/export',createExportRoute());app.route('/api/inspirations',inspirationsRoutes);app.route('/api/auth/cli',cliAuthRoutes);
 const before=await t.sql`SELECT id,profile_id,statement,locked_at FROM signals WHERE profile_id IN (SELECT id FROM profiles WHERE account_id=${account.id}) ORDER BY id`;
 const snapshots=await Promise.all(owners.map(p=>assembleProfileExport(state.db,p.id)));
 const headers=(token:string)=>({authorization:`Bearer ${token}`,'content-type':'application/json'});
 expect((await app.request('/api/profiles',{method:'POST',headers:headers(owners[0]!.token),body:JSON.stringify({name:'Another'})})).status).toBe(410);
 expect(await t.sql`SELECT id FROM profiles WHERE account_id=${account.id}`).toHaveLength(count+1);
 for(let i=0;i<owners.length;i++){
  const owner=owners[i]!;
  const exported=await app.request(`/api/export?profile=${owner.id}`,{headers:headers(owners[0]!.token)});expect(exported.status).toBe(200);
  const data=await exported.json() as any;expect(data.export.inspirations.map((r:any)=>r.profileId)).toEqual([owner.id]);expect(data.export.signals[0].statement).toBe('My locked words '+owner.id);
  const after=await assembleProfileExport(state.db,owner.id);
  expect(after.inspirations).toEqual(snapshots[i]!.inspirations);expect(after.signals).toEqual(snapshots[i]!.signals);
  if(i){
   expect((await app.request(`/api/inspirations?profile=${owners[0]!.id}`,{headers:headers(owner.token)})).status).toBe(403);
   expect((await app.request(`/api/export?profile=${owners[0]!.id}`,{headers:headers(owner.token)})).status).toBe(403);
   expect((await app.request('/api/inspirations',{headers:headers(owner.token)})).status).toBe(200);
   expect((await app.request(`/api/auth/cli/start?${new URLSearchParams({profile:owner.id,state:'test',callback:'http://127.0.0.1:9191/callback'})}`,{headers:headers(owners[0]!.token)})).status).toBe(400);
  }
 }
 expect(await t.sql`SELECT id,profile_id,statement,locked_at FROM signals WHERE profile_id IN (SELECT id FROM profiles WHERE account_id=${account.id}) ORDER BY id`).toEqual(before);
});
