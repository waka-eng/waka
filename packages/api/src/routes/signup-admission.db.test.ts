/** WHAT THIS MOCKS, AND WHY: only DB selection and external Siteverify/Google
 * token transport. Real routes/cookies/HMAC/account/profile transactions run on
 * attested disposable SQL. A second physical client proves shared admission. */
import {randomUUID} from 'node:crypto';
import {realpathSync} from 'node:fs';
import {sql} from 'drizzle-orm';
import {Hono} from 'hono';
import postgres from 'postgres';
import {drizzle} from 'drizzle-orm/postgres-js';
import {afterAll,afterEach,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import type {getDb} from '../lib/db.js';
import {verifySignupAdmission,signupAdmissionResponse,readSignupGrant,beginSignupCreation,consumeSignupAdmission} from '../lib/signup-admission.js';
const state=vi.hoisted(()=>({db:undefined as unknown as ReturnType<typeof getDb>}));
vi.mock('../lib/db.js',()=>({getDb:()=>state.db}));
import {insertHumanProfile} from '../lib/new-human-profile.js';
import {authRoutes} from './auth.js';
const app=new Hono().route('/api/auth',authRoutes),origin='https://waka.im';
let t:TestDatabase,other:ReturnType<typeof postgres>,secondDb:ReturnType<typeof getDb>;
let claims:{email:string;sub:string},tokens:Map<string,string>,verifyCalls:number,provider:(nonce:string)=>Promise<Response>;
const complete=(nonce:string)=>new Response(JSON.stringify({success:true,hostname:'waka.im',action:'signup',cdata:nonce,challenge_ts:new Date().toISOString()}));
beforeAll(async()=>{
 const url=new URL(process.env.DB_CONNECTION_URL!);if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!url.pathname.includes('test'))throw Error('Disposable loopback required');
 const probe=postgres(url.toString(),{max:1,prepare:false});
 try{const [p]=await probe`SELECT current_setting('server_version_num')::int/10000 AS major,current_setting('data_directory') AS dir,inet_server_port() AS port,current_database() AS db`;
  if(![16,17].includes(p.major))throw Error('Supported disposable PG16/17 required');
  if(Object.hasOwn(process.env,'WAKA_SIGNUP_LOCAL_DISPOSABLE_DIR')){
   const dir=process.env.WAKA_SIGNUP_LOCAL_DISPOSABLE_DIR;if(!dir||p.major!==17||realpathSync(dir)!==realpathSync(p.dir)||p.port!==55441||p.db!=='waka_test_signup_admission')throw Error('Strict local PG17 identity refused');
  }
 }finally{await probe.end();}
 t=await createTestDatabase();state.db=t.db as ReturnType<typeof getDb>;
 other=postgres(url.toString(),{max:1,prepare:false,connection:{search_path:t.schemaName+',public'},onnotice:()=>{}});secondDb=drizzle(other) as ReturnType<typeof getDb>;
});
beforeEach(async()=>{
 await t.truncateAll();state.db=t.db as ReturnType<typeof getDb>;tokens=new Map();verifyCalls=0;provider=async nonce=>complete(nonce);claims={email:randomUUID()+'@example.test',sub:'google-'+randomUUID()};
 for(const [key,value] of Object.entries({WAKA_STAGE:'production',PUBLIC_WEB_URL:origin,PUBLIC_API_URL:origin,SST_RESOURCE_App:JSON.stringify({name:'waka',stage:'production'}),WAKA_SIGNUP_ADMISSION:'turnstile',WAKA_TURNSTILE_SITE_KEY:'synthetic-site-key',WAKA_TURNSTILE_SECRET:'synthetic-secret-key',JWT_SECRET:'synthetic-auth-secret',AUTH_GOOGLE_ID:'synthetic-client',AUTH_GOOGLE_SECRET:'synthetic-client-secret',WAKA_ENROLL_NEW_EMPTY_HUMAN_EMBEDDING_2:'0',WAKA_BACKGROUND_JOB_AUTODRAIN:'0'}))vi.stubEnv(key,value);
 vi.stubGlobal('fetch',vi.fn(async(url:unknown,init?:RequestInit)=>{
  if(String(url)==='https://challenges.cloudflare.com/turnstile/v0/siteverify'){verifyCalls++;const body=new URLSearchParams(init?.body as URLSearchParams);return provider(tokens.get(body.get('response')!)??'wrong');}
  if(String(url)==='https://oauth2.googleapis.com/token'){
   const enc=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url');return new Response(JSON.stringify({id_token:`${enc({alg:'RS256'})}.${enc({iss:'https://accounts.google.com',aud:'synthetic-client',exp:Math.floor(Date.now()/1000)+60,email_verified:true,...claims})}.synthetic-signature`}));
  }throw Error('Unexpected external endpoint refused');
 }));
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
afterAll(async()=>{await other?.end();await t?.cleanup();});
function jar(response:Response,prior=''){
 const map=new Map(prior.split('; ').filter(Boolean).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)];}));
 for(const value of response.headers.getSetCookie()){const pair=value.split(';')[0]!,i=pair.indexOf('=');map.set(pair.slice(0,i),pair.slice(i+1));}return [...map].map(([k,v])=>k+'='+v).join('; ');
}
const request=(path:string,cookie='',body?:unknown,headers:Record<string,string>={})=>app.request(origin+'/api/auth/'+path,{method:body?'POST':'GET',headers:{Cookie:cookie,...(body?{'Content-Type':'application/json',Origin:origin}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
async function nonce(flow:'password'|'google'){
 const ready=await request('signup-admission?flow='+flow);expect(ready.status).toBe(200);expect(ready.headers.getSetCookie()).toHaveLength(0);
 const r=await request('signup-admission/nonce','',{flow});expect(r.status).toBe(200);const c=await r.json() as {nonce:string};return {nonce:c.nonce,cookie:jar(r)};
}
async function verify(flow:'password'|'google',n:Awaited<ReturnType<typeof nonce>>,token='synthetic-'+randomUUID()){
 if(!tokens.has(token))tokens.set(token,n.nonce);
 const r=await request('signup-admission',n.cookie,{flow,nonce:n.nonce,token});return {response:r,cookie:jar(r,n.cookie),token};
}
async function grant(flow:'password'|'google'){
 const n=await nonce(flow),v=await verify(flow,n);expect(v.response.status).toBe(200);return {cookie:v.cookie,n,token:v.token};
}
const signup=(cookie:string,email=randomUUID()+'@example.test')=>request('signup',cookie,{email,password:'synthetic-password-123',name:'Synthetic human'});
async function googleStart(cookie='',mobile=false){
 const r=await request('google/login'+(mobile?'?mobile=1':''),cookie);expect(r.status).toBe(302);return {cookie:jar(r,cookie),state:new URL(r.headers.get('location')!).searchParams.get('state')!};
}
const callback=(s:Awaited<ReturnType<typeof googleStart>>)=>request('callback/google?code=synthetic-code&state='+encodeURIComponent(s.state),s.cookie);

function productionSignupWithoutChallenge() {
 vi.stubEnv('WAKA_SIGNUP_ADMISSION','off');
 vi.stubEnv('WAKA_TURNSTILE_SITE_KEY',undefined);
 vi.stubEnv('WAKA_TURNSTILE_SECRET',undefined);
}

it('shares the rolling production limit of 50 creation starts across password and Google',async()=>{
 productionSignupWithoutChallenge();
 vi.stubEnv('WAKA_SIGNUP_CREATE_HOUR',undefined);
 vi.stubEnv('WAKA_SIGNUP_CREATE_DAY',undefined);
 for (const flow of ['password','google']) {
  expect(await (await request('signup-admission?flow='+flow)).json()).toEqual({mode:'off'});
 }
 // The first 50 rows fill the former daily cap but fall outside this hour.
 // The next 48 are recent starts across both flows, including unfinished ones.
 await t.sql`
  WITH starts AS (
   SELECT lpad(i::text,64,'0') AS hash, CASE WHEN i%2=0 THEN 'password' ELSE 'google' END AS flow,
    clock_timestamp()-CASE WHEN i<=50 THEN interval '2 hours' ELSE interval '10 minutes' END AS started
   FROM generate_series(1,98) AS i
  )
  INSERT INTO signup_admissions(nonce_hash,token_hash,stage,flow,state,created_at,expires_at,creation_started_at)
  SELECT hash,hash,'production',flow,'creating',started,started+interval '5 minutes',started FROM starts`;
 const passwordEmail=randomUUID()+'@example.test';
 expect((await signup('',passwordEmail)).status).toBe(201);
 // Known duplicate email responses must leave the final slot for a new identity.
 expect((await signup('',passwordEmail)).status).toBe(409);
 expect((await signup('',passwordEmail)).status).toBe(409);
 expect(new URL((await callback(await googleStart())).headers.get('location')!).pathname).toBe('/');
 expect(await t.sql`SELECT id FROM accounts`).toHaveLength(2);
 expect(await t.sql`SELECT id FROM profiles WHERE type='human'`).toHaveLength(2);
 expect(await t.sql`SELECT flow,state,nonce_hash=token_hash AS server_reservation FROM signup_admissions WHERE state='consumed' ORDER BY flow`).toEqual([
  {flow:'google',state:'consumed',server_reservation:true},
  {flow:'password',state:'consumed',server_reservation:true},
 ]);
 // Returning sign-in still works when the 51st creation attempt is blocked.
 expect((await request('login','',{email:passwordEmail,password:'synthetic-password-123'})).status).toBe(200);
 expect(new URL((await callback(await googleStart())).headers.get('location')!).pathname).toBe('/');
 const blocked=await signup('');
 expect(blocked.status).toBe(429);
 expect(await blocked.json()).toMatchObject({code:'signup_capacity',error:expect.stringContaining('Existing accounts can still sign in')});
 expect(blocked.headers.get('retry-after')).toBe('3600');
 claims={email:randomUUID()+'@example.test',sub:'google-'+randomUUID()};
 expect(new URL((await callback(await googleStart())).headers.get('location')!).searchParams.get('error')).toBe('signup_capacity');
 expect(await t.sql`SELECT id FROM accounts`).toHaveLength(2);
 expect((await t.sql`SELECT count(*)::int AS starts FROM signup_admissions`)[0]?.starts).toBe(100);
 expect(verifyCalls).toBe(0);
});

it('keeps creation capacity across a Turnstile rollback without charging server reservations as verifications',async()=>{
 productionSignupWithoutChallenge();
 vi.stubEnv('WAKA_SIGNUP_CREATE_HOUR','1');
 expect((await signup('')).status).toBe(201);
 vi.stubEnv('WAKA_SIGNUP_ADMISSION','turnstile');
 vi.stubEnv('WAKA_TURNSTILE_SITE_KEY','synthetic-site-key');
 vi.stubEnv('WAKA_TURNSTILE_SECRET','synthetic-secret-key');
 vi.stubEnv('WAKA_SIGNUP_VERIFY_HOUR','1');
 const proof=await grant('password');
 expect(verifyCalls).toBe(1);
 expect((await signup(proof.cookie)).status).toBe(429);
 expect(await t.sql`SELECT id FROM accounts`).toHaveLength(1);
});

it('consumes a password proof once with a native-empty human, preserving count after deletion',async()=>{
 const g=await grant('password'),email=randomUUID()+'@example.test';expect((await signup(g.cookie,email)).status).toBe(201);
 expect((await t.sql`SELECT state,creation_started_at IS NOT NULL AS reserved FROM signup_admissions`)[0]).toMatchObject({state:'consumed',reserved:true});expect(await t.sql`SELECT * FROM profile_embedding_indexes`).toHaveLength(0);
 expect((await signup(g.cookie)).status).toBe(403);expect(await t.sql`SELECT id FROM accounts`).toHaveLength(1);
 await t.sql`DELETE FROM accounts WHERE email=${email}`;expect(await t.sql`SELECT state FROM signup_admissions`).toEqual([{state:'consumed'}]);
});
it('claims the same nonce/token across TWO clients before HTTP; concurrent provider acceptance cannot double verify',async()=>{
 const n=await nonce('password'),token='same-token';tokens.set(token,n.nonce);let entered!:()=>void,finish!:(r:Response)=>void;const atHttp=new Promise<void>(r=>{entered=r;});provider=()=>new Promise(r=>{finish=r;entered();});
 const first=request('signup-admission',n.cookie,{flow:'password',nonce:n.nonce,token});await atHttp;
 const second=new Hono().post('/verify',async c=>{try{return c.json(await verifySignupAdmission(c,secondDb,'password',token,n.nonce));}catch(e){return signupAdmissionResponse(c,e);}});
 const duplicate=await second.request(origin+'/verify',{method:'POST',headers:{Cookie:n.cookie,Origin:origin}});expect(duplicate.status).toBe(403);expect(verifyCalls).toBe(1);
 finish(complete(n.nonce));expect((await first).status).toBe(200);expect(await t.sql`SELECT nonce_hash FROM signup_admissions`).toHaveLength(1);
});
it('rejects token reuse across password and Google flows before another provider dispatch',async()=>{
 const p=await nonce('password');expect((await verify('password',p,'shared-token')).response.status).toBe(200);
 const g=await nonce('google');expect((await verify('google',g,'shared-token')).response.status).toBe(403);expect(verifyCalls).toBe(1);
});
it('refuses wrong Origin, wrong flow/cookie purpose and tampered cookie without HTTP/rows',async()=>{
 const n=await nonce('password');tokens.set('t',n.nonce);
 expect((await request('signup-admission',n.cookie,{flow:'password',nonce:n.nonce,token:'t'},{Origin:'https://evil.example'})).status).toBe(403);
 expect((await verify('google',n)).response.status).toBe(403);
 expect((await request('signup-admission',n.cookie+'x',{flow:'password',nonce:n.nonce,token:'t'})).status).toBe(403);
 expect(verifyCalls).toBe(0);expect(await t.sql`SELECT * FROM signup_admissions`).toHaveLength(0);
});
it('retains unknown verification and refuses replay without another HTTP',async()=>{
 provider=async()=>{throw Error('PRIVATE_UNKNOWN_PROVIDER');};const n=await nonce('password'),first=await verify('password',n,'unknown-token');expect(first.response.status).toBe(503);expect((await first.response.text())).not.toContain('PRIVATE_UNKNOWN');
 expect((await verify('password',n,'unknown-token')).response.status).toBe(403);expect(verifyCalls).toBe(1);expect(await t.sql`SELECT state FROM signup_admissions`).toEqual([{state:'unknown'}]);
});
it('rechecks grant expiration using DB time and cannot swap its stage or purpose',async()=>{
 const g=await grant('password');await t.sql`UPDATE signup_admissions SET created_at=clock_timestamp()-interval '10 minutes',expires_at=clock_timestamp()-interval '1 second'`;
 expect((await signup(g.cookie)).status).toBe(403);expect(await t.sql`SELECT id FROM accounts`).toHaveLength(0);
 const fresh=await grant('password');vi.stubEnv('WAKA_STAGE','development');vi.stubEnv('PUBLIC_WEB_URL','https://dev.waka.im');vi.stubEnv('SST_RESOURCE_App',JSON.stringify({name:'waka',stage:'development'}));
 expect((await request('signup',fresh.cookie,{email:'other@example.test',password:'synthetic-password-123'},{Origin:'https://dev.waka.im'})).status).toBe(403);
});
it('bounds verification and creation reservations globally, including rejected/unknown outcomes',async()=>{
 vi.stubEnv('WAKA_SIGNUP_VERIFY_HOUR','1');provider=async()=>new Response(JSON.stringify({success:false}));const n=await nonce('password');expect((await verify('password',n)).response.status).toBe(403);
 expect((await verify('password',await nonce('password'))).response.status).toBe(429);expect(verifyCalls).toBe(1);
});
it('keeps creation capacity spent after account deletion and emits a conservative Retry-After',async()=>{
 vi.stubEnv('WAKA_SIGNUP_CREATE_HOUR','1');vi.stubEnv('WAKA_SIGNUP_CREATE_DAY','1');const g=await grant('password');expect((await signup(g.cookie)).status).toBe(201);await t.sql`DELETE FROM accounts`;
 const next=await grant('password'),r=await signup(next.cookie);expect(r.status).toBe(429);expect(r.headers.get('retry-after')).toBe('86400');expect(await t.sql`SELECT id FROM accounts`).toHaveLength(0);
});
it('rolls account/profile/consume back together, while retaining the one-use creation reservation',async()=>{
 const g=await grant('password');await t.sql`CREATE FUNCTION refuse_signup_profile() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic profile failure'; END $$`;await t.sql`CREATE TRIGGER refuse_signup_profile BEFORE INSERT ON profiles FOR EACH ROW EXECUTE FUNCTION refuse_signup_profile()`;
 try{expect((await signup(g.cookie)).status).toBe(503);expect(await t.sql`SELECT id FROM accounts`).toHaveLength(0);expect(await t.sql`SELECT id FROM profiles`).toHaveLength(0);expect(await t.sql`SELECT state FROM signup_admissions`).toEqual([{state:'creating'}]);expect((await signup(g.cookie)).status).toBe(403);}
 finally{await t.sql`DROP TRIGGER refuse_signup_profile ON profiles`;await t.sql`DROP FUNCTION refuse_signup_profile()`;}
});
it('holds lost COMMIT ACK and lets ordinary password login recover without recreating the account',async()=>{
 const g=await grant('password'),email=randomUUID()+'@example.test';let transactions=0;const real=state.db;
 state.db=new Proxy(real,{get(target,key,receiver){if(key==='transaction')return async(...args:Parameters<typeof real.transaction>)=>{const value=await real.transaction(...args);if(++transactions===2)throw Error('synthetic commit ACK lost');return value;};return Reflect.get(target,key,receiver);}});
 const r=await signup(g.cookie,email);expect(r.status).toBe(503);expect(await r.json()).toMatchObject({code:'signup_outcome_unknown'});state.db=real;
 expect(await t.sql`SELECT id FROM accounts WHERE email=${email}`).toHaveLength(1);expect((await signup(g.cookie,email)).status).toBe(409);
 expect((await request('login','',{email,password:'synthetic-password-123'})).status).toBe(200);
});
it('requires a second bound OAuth round for NEW Google identity but no challenge for returning sign-in',async()=>{
 const first=await callback(await googleStart());expect(new URL(first.headers.get('location')!).searchParams.get('error')).toBe('signup_verification_required');expect(await t.sql`SELECT id FROM accounts`).toHaveLength(0);expect(verifyCalls).toBe(0);
 const g=await grant('google'),start=await googleStart(g.cookie),created=await callback(start);expect(new URL(created.headers.get('location')!).pathname).toBe('/');expect(await t.sql`SELECT id FROM accounts`).toHaveLength(1);expect(await t.sql`SELECT state FROM signup_admissions`).toEqual([{state:'consumed'}]);
 vi.stubEnv('WAKA_SIGNUP_ADMISSION','closed');expect(new URL((await callback(await googleStart())).headers.get('location')!).pathname).toBe('/');expect(verifyCalls).toBe(1);
});
it('does not accept a Google grant without initiation binding or with changed PKCE',async()=>{
 const g=await grant('google'),unbound=await googleStart();unbound.cookie=jar(new Response(null,{headers:{'Set-Cookie':g.cookie.split('; ').find(x=>x.startsWith('waka_signup_grant_google='))!}}),unbound.cookie);
 expect(new URL((await callback(unbound)).headers.get('location')!).searchParams.get('error')).toBe('signup_verification_required');
 const bound=await googleStart(g.cookie);bound.cookie=bound.cookie.replace(/waka_oauth_pkce=[^;]+/,'waka_oauth_pkce=changed');expect(new URL((await callback(bound)).headers.get('location')!).searchParams.get('error')).toBe('signup_verification_required');expect(await t.sql`SELECT id FROM accounts`).toHaveLength(0);
});
it('preserves verified-email Google recovery/missing-human repair while challenge config is unavailable',async()=>{
 await t.sql`INSERT INTO accounts(email,password_hash) VALUES(${claims.email},'unverified-hash')`;vi.stubEnv('WAKA_SIGNUP_ADMISSION','closed');vi.stubEnv('WAKA_TURNSTILE_SECRET','');
 const r=await callback(await googleStart());expect(new URL(r.headers.get('location')!).pathname).toBe('/');expect((await t.sql`SELECT password_hash FROM accounts WHERE email=${claims.email}`)[0].password_hash).toBeNull();expect(await t.sql`SELECT id FROM profiles`).toHaveLength(1);expect(verifyCalls).toBe(0);
});

it('reserves creation capacity across clients even before the first identity commits',async()=>{
 vi.stubEnv('WAKA_SIGNUP_CREATE_HOUR','1');const a=await grant('password'),b=await grant('password');let entered!:()=>void,finish!:()=>void;const paused=new Promise<void>(r=>{entered=r;}),release=new Promise<void>(r=>{finish=r;});
 const first=new Hono().post('/create',async c=>{const g=readSignupGrant(c,'password');await beginSignupCreation(state.db,g,'password');entered();await release;await state.db.transaction(async tx=>{await consumeSignupAdmission(tx,g,'password');const [account]=await tx.execute<{id:string}>(sql`INSERT INTO accounts(email) VALUES('first@example.test') RETURNING id`);await insertHumanProfile(tx,{accountId:account!.id,name:'Synthetic first'});});return c.json({created:true});});
 const second=new Hono().post('/create',async c=>{try{const g=readSignupGrant(c,'password');await beginSignupCreation(secondDb,g,'password');return c.json({unexpected:true});}catch(e){return signupAdmissionResponse(c,e);}});
 const running=first.request(origin+'/create',{method:'POST',headers:{Cookie:a.cookie,Origin:origin}});await paused;
 const held=await second.request(origin+'/create',{method:'POST',headers:{Cookie:b.cookie,Origin:origin}});expect(held.status).toBe(429);expect(await t.sql`SELECT id FROM accounts`).toHaveLength(0);finish();expect((await running).status).toBe(200);expect(await t.sql`SELECT id FROM accounts`).toHaveLength(1);
});
it('does not replay a failed new Google creation even if a fake provider accepts the old code again',async()=>{
 const g=await grant('google'),start=await googleStart(g.cookie);await t.sql`CREATE FUNCTION refuse_google_profile() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic rollback'; END $$`;await t.sql`CREATE TRIGGER refuse_google_profile BEFORE INSERT ON profiles FOR EACH ROW EXECUTE FUNCTION refuse_google_profile()`;
 try{const failed=await callback(start);expect(new URL(failed.headers.get('location')!).searchParams.get('error')).toBe('signup_outcome_unknown');expect(await t.sql`SELECT id FROM accounts`).toHaveLength(0);expect(await t.sql`SELECT state FROM signup_admissions`).toEqual([{state:'creating'}]);}
 finally{await t.sql`DROP TRIGGER refuse_google_profile ON profiles`;await t.sql`DROP FUNCTION refuse_google_profile()`;}
 const replay=await callback(start);expect(new URL(replay.headers.get('location')!).searchParams.get('error')).toBe('signup_admission_used');expect(await t.sql`SELECT id FROM accounts`).toHaveLength(0);
});
it('continues a NEW native Google signup on the web while retaining only its signed mobile binding',async()=>{
 const state='s'.repeat(43),challenge='c'.repeat(43);const begin=await request(`mobile/google?appId=im.waka.app&state=${state}&challenge=${challenge}`),mobileCookie=jar(begin);
 const firstStart=await googleStart(mobileCookie,true),first=await callback(firstStart),location=new URL(first.headers.get('location')!);expect(location.origin).toBe(origin);expect(location.searchParams.get('mobile')).toBe('1');expect(location.searchParams.get('error')).toBe('signup_verification_required');expect(await t.sql`SELECT id FROM accounts`).toHaveLength(0);
 const g=await grant('google'),second=await callback(await googleStart(g.cookie+'; '+mobileCookie,true));expect(second.headers.get('location')).toMatch(/^im\.waka\.app:\/\/auth\/callback/);expect(await t.sql`SELECT id FROM mobile_login_codes`).toHaveLength(1);expect(await t.sql`SELECT id FROM accounts`).toHaveLength(1);
});
it('rejects malformed durable admission rows rather than relying only on TypeScript',async()=>{
 for(const change of ['pair','expires','consumed'])await expect(t.sql`INSERT INTO signup_admissions(nonce_hash,token_hash,stage,flow,state,expires_at,oauth_state_hash) VALUES(${randomUUID().replaceAll('-','').repeat(2)},${randomUUID().replaceAll('-','').repeat(2)},'production','password',${change==='consumed'?'consumed':'reserved'},clock_timestamp()+${change==='expires'?-1:300}*interval '1 second',${change==='pair'?'a'.repeat(64):null})`).rejects.toMatchObject({code:'23514'});
});

it('keeps GET read-only and refuses nonce-CSRF or cookie-purpose substitution before writes',async()=>{
 const get=await request('signup-admission?flow=password');expect(get.headers.getSetCookie()).toHaveLength(0);expect(Object.keys(await get.json() as Record<string,unknown>).sort()).toEqual(['action','mode','siteKey']);
 const bad=await request('signup-admission/nonce','',{flow:'password'},{Origin:'https://evil.example'});expect(bad.status).toBe(403);expect(bad.headers.getSetCookie()).toHaveLength(0);
 const n=await nonce('password');expect((await signup(n.cookie.replace('waka_signup_nonce_password','waka_signup_grant_password'))).status).toBe(403);expect(verifyCalls).toBe(0);expect(await t.sql`SELECT * FROM signup_admissions`).toHaveLength(0);expect(await t.sql`SELECT id FROM accounts`).toHaveLength(0);
});
it('gives legacy cookie-less native signup a stage-checked browser path only when configured',async()=>{
 const r=await request('signup','',{email:'native@example.test',password:'synthetic-password-123'},{Origin:'capacitor://localhost'});
 expect(r.status).toBe(403);expect(await r.json()).toMatchObject({code:'signup_origin_refused',signupUrl:'https://waka.im/login?signup=1',error:expect.stringContaining('return to the app and sign in')});
 vi.stubEnv('WAKA_SIGNUP_ADMISSION','closed');const closed=await request('signup','',{email:'native@example.test',password:'synthetic-password-123'},{Origin:'capacitor://localhost'});
 expect(closed.status).toBe(503);const body=await closed.json() as Record<string,unknown>;expect(body).not.toHaveProperty('signupUrl');expect(body.code).toBe('signup_closed');expect(verifyCalls).toBe(0);expect(await t.sql`SELECT id FROM accounts`).toHaveLength(0);expect(await t.sql`SELECT * FROM signup_admissions`).toHaveLength(0);
});
