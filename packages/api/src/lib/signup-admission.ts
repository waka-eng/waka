/** Bounded new-account admission, shared by password and Google. No identity,
 * raw human proof or network address is stored. Existing sign-in never needs it. */
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {sql} from 'drizzle-orm';
import type {Context} from 'hono';
import {getCookie,setCookie} from 'hono/cookie';
import type {getDb} from './db.js';

type Db=ReturnType<typeof getDb>;
type Tx=Parameters<Parameters<Db['transaction']>[0]>[0];
export type SignupFlow='password'|'google';
type CreationLimits = { createHour: number; createDay: number };
type CreationConfig = { stage: string; limits: CreationLimits };
type HourlyCreationConfig = { stage: 'production'; limits: Pick<CreationLimits, 'createHour'> };
export type SignupConfig =
 | { mode: 'off'; creation?: HourlyCreationConfig }
 | { mode: 'closed' }
 | (CreationConfig & { mode: 'turnstile'; origin: string; hostname: string; siteKey: string; secret: string; signing: string; limits: CreationLimits & { verifyHour: number; verifyDay: number } });
const ENDPOINT='https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TTL=300,LOCK='waka.signup-admission.v1';
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export class SignupAdmissionError extends Error{
 constructor(public code:'signup_closed'|'signup_verify_required'|'signup_verify_failed'|'signup_verify_unknown'|'signup_admission_used'|'signup_admission_expired'|'signup_busy'|'signup_capacity'|'signup_origin_refused'|'signup_outcome_unknown',public status:403|429|503=403,public retryAfter?:number){super(code);}
}
export function signupConfiguration(env:Record<string,string|undefined>=process.env):SignupConfig{
 const mode=env.WAKA_SIGNUP_ADMISSION,stage=env.WAKA_STAGE;
 try{
  const app=env.SST_RESOURCE_App===undefined?undefined:JSON.parse(env.SST_RESOURCE_App);
  // Either production marker wins. Malformed/contradictory deployment metadata
  // must not silently select the local OFF path when the stage tag is missing.
  if(env.SST_RESOURCE_App!==undefined&&(!app||typeof app!=='object'||app.name!=='waka'||!['development','dev','production'].includes(app.stage)))return {mode:'closed'};
  if(app&&app.stage!==stage)return {mode:'closed'};
  if(stage!==undefined&&!['development','dev','production','local','test'].includes(stage))return {mode:'closed'};
  if(env.NODE_ENV==='production'&&!app&&!['development','dev','local','test'].includes(stage??''))return {mode:'closed'};
  if((mode===undefined||mode==='off')&&stage!=='production'&&app?.stage!=='production')return {mode:'off'};
  const read=(name:string,fallback:number,max:number)=>{const raw=env[name];if(raw===undefined)return fallback;if(!/^[1-9]\d*$/.test(raw))throw 0;const n=Number(raw);if(!Number.isSafeInteger(n)||n>max)throw 0;return n;};
  const creationLimits=()=>({createHour:read('WAKA_SIGNUP_CREATE_HOUR',10,50),createDay:read('WAKA_SIGNUP_CREATE_DAY',50,200)});
  if (mode === 'off' && stage === 'production') {
   if (app?.stage !== 'production' || env.PUBLIC_WEB_URL !== 'https://waka.im' ||
       ['WAKA_TURNSTILE_SECRET', 'WAKA_TURNSTILE_SITE_KEY', 'SST_RESOURCE_TurnstileSecret'].some(key => env[key] !== undefined)) {
    return { mode: 'closed' };
   }
   return { mode: 'off', creation: { stage, limits: { createHour: read('WAKA_SIGNUP_CREATE_HOUR',50,50) } } };
  }
  if(mode!=='turnstile')return {mode:'closed'};
  const origin={development:'https://dev.waka.im',dev:'https://dev.waka.im',production:'https://waka.im'}[stage??''];
  const url=new URL(env.PUBLIC_WEB_URL??'');
  if(!origin||app?.name!=='waka'||app?.stage!==stage||url.origin!==origin||url.pathname!=='/'||url.search||url.hash||url.username||url.password)return {mode:'closed'};
  const siteKey=env.WAKA_TURNSTILE_SITE_KEY??'',secret=env.WAKA_TURNSTILE_SECRET??'',signing=env.JWT_SECRET??env.AUTH_SECRET??'';
  if(!/^[\x21-\x7e]{10,256}$/.test(siteKey)||!/^[\x21-\x7e]{10,256}$/.test(secret)||!signing)return {mode:'closed'};
  // Official public testing keys are never an activation path in production.
  if(stage==='production'&&(/^[123]x0/.test(siteKey)||/^[123]x0/.test(secret)))return {mode:'closed'};
  const limits={verifyHour:read('WAKA_SIGNUP_VERIFY_HOUR',20,100),verifyDay:read('WAKA_SIGNUP_VERIFY_DAY',100,500),...creationLimits()};
  if(limits.verifyHour>limits.verifyDay||limits.createHour>limits.createDay)return {mode:'closed'};
  return {mode:'turnstile',stage:stage!,origin,hostname:url.hostname,siteKey,secret,signing,limits};
 }catch{return {mode:'closed'};}
}
type Ready=Extract<SignupConfig,{mode:'turnstile'}>;
type Proof={nonce:string;expires:number;oauth?:{state:string;pkce:string}};
const cookieName=(purpose:'nonce'|'grant',flow:SignupFlow)=>`waka_signup_${purpose}_${flow}`;
function mac(config:Ready,purpose:string,flow:SignupFlow,value:string){return createHmac('sha256',config.signing).update(`waka.signup.v1\0${purpose}\0${config.stage}\0${config.origin}\0${flow}\0${value}`).digest('base64url');}
function pack(config:Ready,purpose:'nonce'|'grant',flow:SignupFlow,proof:Proof){const value=Buffer.from(JSON.stringify(proof)).toString('base64url');return value+'.'+mac(config,purpose,flow,value);}
function unpack(config:Ready,purpose:'nonce'|'grant',flow:SignupFlow,value:string|undefined):Proof|null{
 try{
  if(!value||value.length>2048)return null;const [body,signature,...extra]=value.split('.');if(!body||!signature||extra.length)return null;
  const expected=mac(config,purpose,flow,body),a=Buffer.from(signature),b=Buffer.from(expected);if(a.length!==b.length||!timingSafeEqual(a,b))return null;
  const p=JSON.parse(Buffer.from(body,'base64url').toString());
  if(!p||Object.keys(p).some(k=>!['nonce','expires','oauth'].includes(k))||typeof p.nonce!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(p.nonce)||!Number.isSafeInteger(p.expires)||p.expires<=Date.now()/1000||p.expires>Date.now()/1000+TTL+30)return null;
  if(p.oauth&&(!p.oauth.state||!p.oauth.pkce||Object.keys(p.oauth).sort().join()!=='pkce,state'||!Object.values(p.oauth).every(v=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v))))return null;
  if(purpose==='nonce'&&p.oauth)return null;return p;
 }catch{return null;}
}
function writeCookie(c:Context,config:Ready,purpose:'nonce'|'grant',flow:SignupFlow,proof:Proof){setCookie(c,cookieName(purpose,flow),pack(config,purpose,flow,proof),{path:'/api/auth',httpOnly:true,secure:true,sameSite:'Lax',maxAge:Math.max(0,Math.floor(proof.expires-Date.now()/1000))});}
function requireReady(config:SignupConfig):Ready{if(config.mode!=='turnstile')throw new SignupAdmissionError('signup_closed',503);return config;}
export function requireSignupOrigin(c:Context,config:Ready){if(c.req.header('Origin')!==config.origin)throw new SignupAdmissionError('signup_origin_refused');}
export function signupPublicConfiguration(c:Context){
 const config=signupConfiguration();c.header('Cache-Control','no-store, private');
 return config.mode==='turnstile'?{mode:'turnstile' as const,siteKey:config.siteKey,action:'signup' as const}:{mode:config.mode};
}
/** Issuance is POST-only and Origin-checked: cross-site GET cannot overwrite
 * an in-progress nonce. This step writes a browser cookie, never a SQL row. */
export function issueSignupNonce(c:Context,flow:SignupFlow){
 const config=requireReady(signupConfiguration());requireSignupOrigin(c,config);
 const proof={nonce:randomBytes(32).toString('base64url'),expires:Math.floor(Date.now()/1000)+TTL};writeCookie(c,config,'nonce',flow,proof);
 return {nonce:proof.nonce};
}
async function fenced<T>(db:Db,body:(tx:Tx)=>Promise<T>){return db.transaction(async tx=>{
 await tx.execute(sql`SET LOCAL statement_timeout='2000ms'`);await tx.execute(sql`SET LOCAL lock_timeout='100ms'`);
 const [lock]=await tx.execute<{locked:boolean}>(sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${LOCK},0)) AS locked`);
 if(!lock?.locked)throw new SignupAdmissionError('signup_busy',429,1);return body(tx);
 },{isolationLevel:'read committed'});}
async function capacity(tx:Tx,config:CreationConfig,verification?:Ready['limits']){
 const [n]=await tx.execute<{hour:number;day:number}>(verification?sql`SELECT count(*) FILTER(WHERE created_at>clock_timestamp()-interval '1 hour')::int AS hour,count(*)::int AS day FROM signup_admissions WHERE stage=${config.stage} AND created_at>clock_timestamp()-interval '1 day' AND nonce_hash<>token_hash`:sql`SELECT count(*) FILTER(WHERE creation_started_at>clock_timestamp()-interval '1 hour')::int AS hour,count(*)::int AS day FROM signup_admissions WHERE stage=${config.stage} AND creation_started_at>clock_timestamp()-interval '1 day'`);
 const hour=verification?.verifyHour??config.limits.createHour;
 const day=verification?.verifyDay??config.limits.createDay;
 if(!n||n.hour>=hour||n.day>=day)throw new SignupAdmissionError('signup_capacity',429,n&&n.day>=day?86400:3600);
}
async function pruneAdmissions(tx:Tx){
 // Retain claims past proof expiry and the longest capacity window.
 await tx.execute(sql`DELETE FROM signup_admissions WHERE nonce_hash IN(SELECT nonce_hash FROM signup_admissions WHERE created_at<clock_timestamp()-interval '7 days' ORDER BY created_at LIMIT 500)`);
}
/** No provider retry, including uncertain HTTP. Full response shapes come from
 * fake transports in tests; vendor dummy responses cannot bypass field checks. */
export async function checkTurnstile(config:Ready,token:string,nonce:string,fetcher:typeof fetch=fetch):Promise<'verified'|'rejected'|'unknown'>{
 let timer:ReturnType<typeof setTimeout>|undefined;const controller=new AbortController();
 try{
  return await Promise.race([
   (async()=>{
    const response=await fetcher(ENDPOINT,{method:'POST',redirect:'error',signal:controller.signal,headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({secret:config.secret,response:token})});
    if(!response.ok)return 'unknown' as const;
    const reader=response.body?.getReader();if(!reader)return 'unknown' as const;
    let size=0;const chunks:Uint8Array[]=[];
    try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>8192){void reader.cancel();return 'unknown' as const;}chunks.push(r.value);}}finally{reader.releaseLock();}
    const value=JSON.parse(Buffer.concat(chunks).toString('utf8')),stamp=Date.parse(value.challenge_ts),age=Date.now()-stamp;
    return value.success===true&&value.hostname===config.hostname&&value.action==='signup'&&value.cdata===nonce&&Number.isFinite(stamp)&&age>=-30000&&age<=TTL*1000?'verified' as const:'rejected' as const;
   })(),
   new Promise<'unknown'>(resolve=>{timer=setTimeout(()=>{controller.abort();resolve('unknown');},8000);}),
  ]);
 }catch{return 'unknown';}finally{if(timer)clearTimeout(timer);controller.abort();}
}
export async function verifySignupAdmission(c:Context,db:Db,flow:SignupFlow,token:unknown,nonce:unknown,fetcher:typeof fetch=fetch){
 const config=requireReady(signupConfiguration());requireSignupOrigin(c,config);
 const proof=unpack(config,'nonce',flow,getCookie(c,cookieName('nonce',flow)));
 if(!proof||proof.nonce!==nonce||typeof token!=='string'||!token||token.length>2048)throw new SignupAdmissionError('signup_verify_required');
 const nonceHash=digest(proof.nonce),tokenHash=digest(token);
 await fenced(db,async tx=>{
  await pruneAdmissions(tx);
  await capacity(tx,config,config.limits);
  const rows=await tx.execute(sql`INSERT INTO signup_admissions(nonce_hash,token_hash,stage,flow,state,expires_at) VALUES(${nonceHash},${tokenHash},${config.stage},${flow},'reserved',to_timestamp(${proof.expires})) ON CONFLICT DO NOTHING RETURNING nonce_hash`);
  if(rows.length!==1)throw new SignupAdmissionError('signup_admission_used');
 });
 const outcome=await checkTurnstile(config,token,proof.nonce,fetcher);
 const updated=await db.execute(sql`UPDATE signup_admissions SET state=${outcome} WHERE nonce_hash=${nonceHash} AND state='reserved' AND expires_at>clock_timestamp() RETURNING nonce_hash`);
 if(updated.length!==1||outcome!=='verified')throw new SignupAdmissionError(outcome==='unknown'?'signup_verify_unknown':'signup_verify_failed',outcome==='unknown'?503:403);
 writeCookie(c,config,'grant',flow,proof);return {verified:true};
}
export type SignupGrant =
 | { kind: 'challenge'; config: Ready; proof: Proof; nonceHash: string }
 | { kind: 'server'; config: HourlyCreationConfig; nonceHash: string };
function serverGrant(config: HourlyCreationConfig | undefined): SignupGrant | null {
 return config ? { kind: 'server', config, nonceHash: randomBytes(32).toString('hex') } : null;
}
export function readSignupGrant(c:Context,flow:SignupFlow):SignupGrant|null{
 const config=signupConfiguration();if(config.mode==='off')return serverGrant(config.creation);
 const ready=requireReady(config);requireSignupOrigin(c,ready);
 const proof=unpack(ready,'grant',flow,getCookie(c,cookieName('grant',flow)));if(!proof)throw new SignupAdmissionError('signup_verify_required');
 return {kind:'challenge',config:ready,proof,nonceHash:digest(proof.nonce)};
}
/** Reserve before bcrypt. A failed/uncertain creation still uses this slot;
 * the grant cannot buy repeated hashing or recreate an ambiguous account. */
export async function beginSignupCreation(db:Db,grant:SignupGrant|null,flow:SignupFlow){if(!grant)return;
 await fenced(db,async tx=>{
  if (grant.kind === 'server') {
   const [current] = await tx.execute<{ starts: number }>(sql`
     SELECT count(*)::int AS starts FROM signup_admissions
     WHERE stage=${grant.config.stage} AND creation_started_at>clock_timestamp()-interval '1 hour'`);
   if (!current || current.starts >= grant.config.limits.createHour) {
    throw new SignupAdmissionError('signup_capacity',429,3600);
   }
   await pruneAdmissions(tx);
   // Equal digests mark a server reservation in the existing schema. These
   // rows share the creation ceiling but do not spend Turnstile verify slots.
   const rows = await tx.execute(sql`INSERT INTO signup_admissions(nonce_hash,token_hash,stage,flow,state,expires_at,creation_started_at)
     VALUES(${grant.nonceHash},${grant.nonceHash},${grant.config.stage},${flow},'creating',clock_timestamp()+interval '5 minutes',clock_timestamp())
     ON CONFLICT DO NOTHING RETURNING nonce_hash`);
   if (rows.length !== 1) throw new SignupAdmissionError('signup_admission_used');
   return;
  }
  await capacity(tx,grant.config);
  const rows=await tx.execute(sql`UPDATE signup_admissions SET state='creating',creation_started_at=clock_timestamp() WHERE nonce_hash=${grant.nonceHash} AND stage=${grant.config.stage} AND flow=${flow} AND state=${flow==='google'?'oauth_bound':'verified'} AND expires_at>clock_timestamp() AND (${flow}='password' OR (oauth_state_hash=${grant.proof.oauth?digest(grant.proof.oauth.state):null} AND oauth_pkce_hash=${grant.proof.oauth?digest(grant.proof.oauth.pkce):null})) RETURNING nonce_hash`);
  if(rows.length!==1)throw new SignupAdmissionError('signup_admission_used');
 });
}
/** OAuth initiation may bind a ready grant, but failure must never block an
 * ordinary returning sign-in. No challenge HTTP and no grant in the URL. */
export async function bindGoogleSignup(c:Context,getDatabase:()=>Db,state:string,pkce:string){
 const config=signupConfiguration();if(config.mode!=='turnstile')return;
 const proof=unpack(config,'grant','google',getCookie(c,cookieName('grant','google')));if(!proof||proof.oauth)return;
 const oauth={state:mac(config,'oauth-state','google',state),pkce:mac(config,'oauth-pkce','google',pkce)};
 try{
  await fenced(getDatabase(),async tx=>{
   const rows=await tx.execute(sql`UPDATE signup_admissions SET state='oauth_bound',oauth_state_hash=${digest(oauth.state)},oauth_pkce_hash=${digest(oauth.pkce)} WHERE nonce_hash=${digest(proof.nonce)} AND stage=${config.stage} AND flow='google' AND state='verified' AND expires_at>clock_timestamp() RETURNING nonce_hash`);
   if(rows.length!==1)throw new SignupAdmissionError('signup_admission_used');
  });writeCookie(c,config,'grant','google',{...proof,oauth});
 }catch{ /* Existing Google auth continues; a NEW callback cannot use an unbound grant. */ }
}
/** Called only on the NEW-account path after verified Google claims. No Origin
 * header exists on a provider redirect; state/PKCE + the signed flow grant are CSRF. */
export function readGoogleSignupGrant(c:Context,state:string,pkce:string):SignupGrant|null{
 const config=signupConfiguration();if(config.mode==='off')return serverGrant(config.creation);
 const ready=requireReady(config),proof=unpack(ready,'grant','google',getCookie(c,cookieName('grant','google')));
 if(!proof?.oauth||proof.oauth.state!==mac(ready,'oauth-state','google',state)||proof.oauth.pkce!==mac(ready,'oauth-pkce','google',pkce))throw new SignupAdmissionError('signup_verify_required');
 return {kind:'challenge',config:ready,proof,nonceHash:digest(proof.nonce)};
}
/** Global capacity lock precedes the admission row and new account/profile locks.
 * No HTTP; consume and identity INSERTs commit or roll back together. */
export async function consumeSignupAdmission(tx:Tx,grant:SignupGrant|null,flow:SignupFlow){if(!grant)return;
 await tx.execute(sql`SET LOCAL statement_timeout='2000ms'`);
 await tx.execute(sql`SET LOCAL lock_timeout='100ms'`);
 const [lock]=await tx.execute<{locked:boolean}>(sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${LOCK},0)) AS locked`);if(!lock?.locked)throw new SignupAdmissionError('signup_busy',429,1);
 const proof = grant.kind === 'server'
  ? sql`nonce_hash=token_hash`
  : sql`(${flow}='password' OR (oauth_state_hash=${grant.proof.oauth?digest(grant.proof.oauth.state):null} AND oauth_pkce_hash=${grant.proof.oauth?digest(grant.proof.oauth.pkce):null}))`;
 const rows=await tx.execute(sql`UPDATE signup_admissions SET state='consumed',consumed_at=clock_timestamp(),creation_started_at=coalesce(creation_started_at,clock_timestamp()) WHERE nonce_hash=${grant.nonceHash} AND stage=${grant.config.stage} AND flow=${flow} AND state='creating' AND expires_at>clock_timestamp()
 AND ${proof} RETURNING nonce_hash`);
 if(rows.length!==1)throw new SignupAdmissionError('signup_admission_used');
}
export function signupAdmissionResponse(c:Context,error:unknown){
 const e=error instanceof SignupAdmissionError?error:new SignupAdmissionError('signup_outcome_unknown',503);
 if(e.retryAfter)c.header('Retry-After',String(e.retryAfter));
 const config=signupConfiguration();
 // Older installed apps cannot acquire a web-cookie grant. Give them a safe
 // stage-bound route only when browser signup is actually configured.
 if(config.mode==='turnstile'&&['signup_origin_refused','signup_verify_required'].includes(e.code)){
  const signupUrl=config.origin+'/login?signup=1';
  return c.json({error:`Create your account in a browser at ${signupUrl}, then return to the app and sign in. Existing accounts can sign in now.`,code:e.code,signupUrl},e.status);
 }
 return c.json({error:'New account setup could not finish. Sign in to check an earlier attempt, or try verification again later.',code:e.code},e.status);
}
