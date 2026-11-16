/** WHAT THIS MOCKS, AND WHY (gate G6): only `GeminiEmbeddingClient.embed`
 * returns deterministic synthetic vectors. Actual migrated PG17/core/C1 and
 * wire disconnect run. Explicit local proof entry (not CI16 test discovery).
 * CI16 refusal is embedding-index-cutover.db.test.ts; no conditional skips. */
import {writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer,connect,type Socket} from 'node:net';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import postgres from 'postgres';
import {drizzle} from 'drizzle-orm/postgres-js';
import * as schema from '../../src/db/index.js';
import {PgDialect} from 'drizzle-orm/pg-core';
import type {SQL} from 'drizzle-orm';
import {createTestDatabase,type TestDatabase} from '../helpers/index.js';
import {activateEmbeddingIndex,reconcileEmbeddingCutover,embeddingCutoverIntentHash,type EmbeddingCutoverManifest} from '../../src/lib/embedding-index-cutover.js';
import {prepareEmbeddingShadowBuild,runEmbeddingShadowBatch,embeddingShadowManifestHash,type EmbeddingShadowManifest} from '../../src/lib/embedding-index-operator.js';
import {EMBEDDING_2_SPACE} from '../../src/lib/embedding-2-space.js';
import {EMBEDDING_2_CANDIDATE_POLICY} from '../../src/lib/embedding-policy.js';
import {insertHumanProfile} from '../../src/lib/new-human-profile.js';
let t:TestDatabase;
beforeAll(async()=>{
 const u=new URL(process.env.DB_CONNECTION_URL!);expect(['localhost','127.0.0.1']).toContain(u.hostname);
 expect(process.env.WAKA_C1_LOCAL_DISPOSABLE_DIR).toBeTruthy();t=await createTestDatabase();
 const[r]=await t.sql`SELECT current_setting('server_version_num') AS version,current_setting('data_directory') AS directory`;
 expect(Math.floor(Number(r.version)/10000)).toBe(17);expect(r.directory).toBe(process.env.WAKA_C1_LOCAL_DISPOSABLE_DIR);
});afterAll(async()=>t?.cleanup());
const vec=()=>[1,...Array<number>(767).fill(0)];
async function fixture(empty=false,accountId?:string){
 const a=accountId?{id:accountId}:(await t.sql`INSERT INTO accounts(email) VALUES(${randomUUID()+'@example.test'}) RETURNING id`)[0];
 const[p]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${a.id},${accountId?'agent':'human'},'Synthetic C1 profile') RETURNING id,type`;
 let sourceId:string|undefined;
 if(!empty){[sourceId]=(await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${p.id},'Exact synthetic words.') RETURNING id`).map(r=>r.id);}
 const m:EmbeddingShadowManifest={version:'embedding2-shadow-v1',accountId:a.id,profiles:[{id:p.id,epoch:'0'}],targetSpace:EMBEDDING_2_SPACE.id,approvedDbSha256:'a'.repeat(64),expiresAt:new Date(Date.now()+3600000).toISOString(),maxInventoryCells:1000,maxCellsPerInvocation:100,maxRequests:1000,maxFormattedInputBytes:48000000,maxDurationMs:60000,operationalAllowanceUsd:1};
 const client={model:EMBEDDING_2_SPACE.id,dimensions:768,embed:vi.fn(async()=>vec())};
 if(!empty){await prepareEmbeddingShadowBuild(t.db,m,embeddingShadowManifestHash(m));await runEmbeddingShadowBatch(t.db,m,embeddingShadowManifestHash(m),{client});}
 return {accountId:a.id as string,profileId:p.id as string,type:p.type as 'human'|'agent',sourceId:sourceId!,client};
}
async function manifest(f:Awaited<ReturnType<typeof fixture>>):Promise<EmbeddingCutoverManifest>{
 const[r]=await t.sql`SELECT g.revision::text AS generation,e.profile_id IS NOT NULL AS present,coalesce(e.active_epoch,0)::text AS epoch,e.building_space,e.building_threshold_policy,e.cutover_covered_version::text AS covered,coalesce((SELECT max(requested_version) FROM embedding_index_work WHERE profile_id=${f.profileId} AND space=${EMBEDDING_2_SPACE.id}),0)::text AS frontier FROM generation_revisions g LEFT JOIN profile_embedding_indexes e ON e.profile_id=g.profile_id WHERE g.profile_id=${f.profileId}`;
 return {version:'embedding-cutover-v1',mode:f.sourceId?'covered':'empty',accountId:f.accountId,profiles:[{id:f.profileId,profileType:f.type,epoch:r.epoch,generation:r.generation,frontier:r.frontier,controlPresent:r.present,coveredVersion:r.covered,buildingSpace:r.building_space,buildingPolicy:r.building_threshold_policy}],targetSpace:EMBEDDING_2_SPACE.id,thresholdPolicy:EMBEDDING_2_CANDIDATE_POLICY,approvedDbSha256:'a'.repeat(64),expiresAt:new Date(Date.now()+3600000).toISOString(),maxCells:1000,maxBytes:8388608,maxStatements:4096,maxDurationMs:5000,maxLedgerAttempts:1000};
}
function readOperation(m:EmbeddingCutoverManifest){return {version:'embedding-cutover-read-v1',intent:m,intentSha256:embeddingCutoverIntentHash(m),approvedDbSha256:m.approvedDbSha256,expiresAt:new Date(Date.now()+3600000).toISOString(),maxDurationMs:5000};}
async function peer(port?:number){const u=new URL(process.env.DB_CONNECTION_URL!);u.searchParams.set('options','-c search_path='+t.schemaName);if(port)u.port=String(port);const raw=postgres(u.toString(),{max:1,prepare:false,onnotice:()=>{}});return {raw,db:drizzle(raw,{schema})};}
function gate(){let entered!:()=>void,release!:()=>void;return {ready:new Promise<void>(r=>{entered=r;}),hold:new Promise<void>(r=>{release=r;}),entered:()=>entered(),release:()=>release()};}
const dialect=new PgDialect();
function hook(db:typeof t.db,run:(query:string,rows:unknown)=>Promise<void>){const original=db.transaction.bind(db);return new Proxy(db,{get(target,key,receiver){if(key==='transaction')return (fn:any,options:any)=>original(async tx=>{
 expect(options.isolationLevel).toBe('read committed');return fn(new Proxy(tx,{get(target,key,receiver){if(key==='execute')return async(q:SQL)=>{const r=await tx.execute(q);await run(dialect.sqlToQuery(q).sql,r);return r;};return Reflect.get(target,key,receiver);}}));
 },options);return Reflect.get(target,key,receiver);}});}
it('runs actual coverage atomically, changes epoch/generation and preserves raw words and native rows',async()=>{
 const f=await fixture();await t.sql`INSERT INTO inspiration_embeddings(profile_id,inspiration_id,model,input_scope,dimensions,input_hash,embedding) VALUES(${f.profileId},${f.sourceId},'gemini-embedding-001','personal',768,${'d'.repeat(64)},${JSON.stringify(vec())}::jsonb)`;
 const native=await t.sql`SELECT * FROM inspiration_embeddings WHERE inspiration_id=${f.sourceId} AND model='gemini-embedding-001'`;const m=await manifest(f),calls=f.client.embed.mock.calls.length;
 const result=await activateEmbeddingIndex(t.db,m);expect(result).toMatchObject({activated:true,profiles:1,providerCalls:0,coverage:{complete:true}});
 expect(await reconcileEmbeddingCutover(t.db,readOperation(m))).toMatchObject({state:'after',activationReplayAuthorized:false,currentCoverageProven:false});
 expect(await t.sql`SELECT * FROM inspiration_embeddings WHERE inspiration_id=${f.sourceId} AND model='gemini-embedding-001'`).toEqual(native);
 expect((await t.sql`SELECT text FROM inspirations WHERE id=${f.sourceId}`)[0].text).toBe('Exact synthetic words.');expect(f.client.embed).toHaveBeenCalledTimes(calls);
 await expect(activateEmbeddingIndex(t.db,m)).rejects.toMatchObject({code:'stale'});
});
it('refuses foreign/type/epoch/generation/frontier/policy mismatches without changing any target',async()=>{
 const f=await fixture(),other=await fixture(),m=await manifest(f);
 for(const changed of [{...m,accountId:other.accountId},{...m,profiles:m.profiles.map(p=>({...p,profileType:'agent'}))},{...m,profiles:m.profiles.map(p=>({...p,generation:'0'}))},{...m,profiles:m.profiles.map(p=>({...p,frontier:'0'}))},{...m,thresholdPolicy:'accepted'}])await expect(activateEmbeddingIndex(t.db,changed)).rejects.toBeDefined();
 expect((await t.sql`SELECT active_space FROM profile_embedding_indexes WHERE profile_id=${f.profileId}`)[0].active_space).toBe('gemini-embedding-001');
});
it('sees an inactive-vector edit after the initial read on a server defaultRR; does not accept the stale snapshot',async()=>{
 const f=await fixture(),m=await manifest(f),p=await peer();let changed=false;
 await p.raw`SET SESSION default_transaction_isolation='repeatable read'`;
 const wrapped=hook(p.db as typeof t.db,async q=>{if(!changed&&q.includes('coalesce(e.active_epoch')){changed=true;await t.sql`UPDATE inspiration_embeddings SET input_hash=${'f'.repeat(64)} WHERE inspiration_id=${f.sourceId} AND model=${EMBEDDING_2_SPACE.id}`;}});
 try{await expect(activateEmbeddingIndex(wrapped,m)).rejects.toMatchObject({code:'coverage'});expect(changed).toBe(true);}
 finally{await p.raw.end();}
});
it('does not equate pending0/current vector with a global unresolved attempt, including deleted-source attempts in another manifest',async()=>{
 const f=await fixture(),m=await manifest(f);
 await t.sql`INSERT INTO embedding_index_attempts(account_id,profile_id,request_key,dispatch_family,purpose,manifest_hash,space,source_kind,source_id,input_scope,input_hash,input_bytes,status) VALUES(${f.accountId},${f.profileId},${randomUUID()},'index','migration',${'b'.repeat(64)},${EMBEDDING_2_SPACE.id},'inspiration',${randomUUID()},'personal',${'c'.repeat(64)},20,'unknown')`;
 await expect(activateEmbeddingIndex(t.db,m)).rejects.toMatchObject({code:'coverage'});
 expect((await t.sql`SELECT status FROM embedding_index_attempts WHERE profile_id=${f.profileId} AND status='unknown'`)[0].status).toBe('unknown');
});
it('rolls back all owned profiles when a later cohort member has bad geometry',async()=>{
 const a=await fixture(),b=await fixture(false,a.accountId),m=await manifest(a),mb=await manifest(b);m.profiles.push(...mb.profiles);m.profiles.sort((a,b)=>a.id.localeCompare(b.id));
 await t.sql`UPDATE inspiration_embeddings SET embedding=${JSON.stringify(Array(768).fill(0))}::jsonb WHERE inspiration_id=${b.sourceId} AND model=${EMBEDDING_2_SPACE.id}`;
 await expect(activateEmbeddingIndex(t.db,m)).rejects.toMatchObject({code:'coverage'});
 for(const id of [a.profileId,b.profileId])expect((await t.sql`SELECT active_epoch::text AS epoch FROM profile_embedding_indexes WHERE profile_id=${id}`)[0].epoch).toBe('0');
});
it('refuses busy source writers; after C1 barriers a new write waits then creates active2 work',async()=>{
 const f=await fixture(),m=await manifest(f),p=await peer(),g=gate();
 const writer=p.raw.begin(async tx=>{await tx`UPDATE inspirations SET text='New exact words.' WHERE id=${f.sourceId}`;g.entered();await g.hold;});await g.ready;
 try{await expect(activateEmbeddingIndex(t.db,m)).rejects.toMatchObject({code:'busy'});}finally{g.release();await writer;await p.raw.end();}
 const e=await fixture(),em=await manifest(e),p2=await peer(),g2=gate();let stopped=false;
 const wrapped=hook(t.db,async q=>{if(!stopped&&q.includes('FROM profile_embedding_indexes')&&q.includes('FOR UPDATE')){stopped=true;g2.entered();await g2.hold;}});
 const cutover=activateEmbeddingIndex(wrapped,em);await g2.ready;let done=false;
 const newWriter=p2.raw`UPDATE inspirations SET text='After cutover exact words.' WHERE id=${e.sourceId}`.then(()=>{done=true;});
 await new Promise(r=>setTimeout(r,30));expect(done).toBe(false);g2.release();await cutover;await newWriter;await p2.raw.end();
 expect((await t.sql`SELECT requested_version>completed_version AS pending FROM embedding_index_work WHERE profile_id=${e.profileId} AND space=${EMBEDDING_2_SPACE.id}`)[0].pending).toBe(true);
});
it('does not infer rollback from all-before while the original is still running',async()=>{
 const f=await fixture(),m=await manifest(f),p=await peer(),g=gate();let paused=false;
 const wrapped=hook(t.db,async q=>{if(!paused&&q.includes('coalesce(e.active_epoch')){paused=true;g.entered();await g.hold;}});
 const original=activateEmbeddingIndex(wrapped,m);await g.ready;
 try{expect(await reconcileEmbeddingCutover(p.db as typeof t.db,readOperation(m))).toMatchObject({state:'before_or_in_flight',activationReplayAuthorized:false});}
 finally{g.release();await original;await p.raw.end();}
 expect(await reconcileEmbeddingCutover(t.db,readOperation(m))).toMatchObject({state:'after'});
});
it('proves existing empty domain under fences; minCells1 never embeds and new nonempty data refuses',async()=>{
 const f=await fixture(true),m=await manifest(f);expect(await activateEmbeddingIndex(t.db,m)).toMatchObject({activated:true,providerCalls:0});expect(f.client.embed).not.toHaveBeenCalled();
 const n=await fixture(true),nm=await manifest(n);await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${n.profileId},'New words before empty enrollment.')`;
 await expect(activateEmbeddingIndex(t.db,nm)).rejects.toMatchObject({code:'stale'});
 const e=await fixture(true),em=await manifest(e);await t.sql`DELETE FROM generation_revisions WHERE profile_id=${e.profileId}`;em.profiles[0].generation=null;
 expect(await activateEmbeddingIndex(t.db,em)).toMatchObject({activated:true,coverage:{complete:true}});
});
it('enrolls only a fresh human in its creation transaction when the closed dev flag is enabled; rollback erases the whole new profile',async()=>{
 const env={...process.env};try{
  process.env.WAKA_DEV_ENROLL_NEW_EMPTY_HUMAN_EMBEDDING_2='1';process.env.WAKA_STAGE='development';process.env.SST_RESOURCE_App=JSON.stringify({name:'waka',stage:'development'});
  const[a]=await t.sql`INSERT INTO accounts(email) VALUES(${randomUUID()+'@example.test'}) RETURNING id`;
  const p=await t.db.transaction(tx=>insertHumanProfile(tx,{accountId:a.id,name:'New exact human'}));
  expect((await t.sql`SELECT active_space,active_epoch::text AS epoch FROM profile_embedding_indexes WHERE profile_id=${p.id}`)[0]).toMatchObject({active_space:EMBEDDING_2_SPACE.id,epoch:'1'});
  let aborted='';const[b]=await t.sql`INSERT INTO accounts(email) VALUES(${randomUUID()+'@example.test'}) RETURNING id`;
  await expect(t.db.transaction(async tx=>{aborted=(await insertHumanProfile(tx,{accountId:b.id,name:'Abort'})).id;throw Error('intentional rollback');})).rejects.toThrow('intentional');
  expect(await t.sql`SELECT id FROM profiles WHERE id=${aborted}`).toHaveLength(0);
 }finally{for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}
});
async function commitDropProxy(){
 const peers=new Set<Socket>();let dropped=0,commits=0;
 const server=createServer(client=>{
  const upstream=connect({host:'127.0.0.1',port:Number(new URL(process.env.DB_CONNECTION_URL!).port)});peers.add(client);peers.add(upstream);
  let startup=true,front=Buffer.alloc(0),back=Buffer.alloc(0),pending=false;
  client.on('data',b=>{front=Buffer.concat([front,b]);let offset=0;
   if(startup){if(front.length<4||front.length<front.readInt32BE(0)){upstream.write(b);return;}offset=front.readInt32BE(0);startup=false;}
   while(front.length-offset>=5){const n=front.readInt32BE(offset+1);if(front.length-offset<n+1)break;const typ=String.fromCharCode(front[offset]),body=front.subarray(offset+5,offset+1+n);let q='';if(typ==='Q')q=body.toString();if(typ==='P'){const z=body.indexOf(0);q=body.subarray(z+1).toString().split('\0')[0];}if(/^commit\b/i.test(q.trim())){pending=true;commits++;}offset+=n+1;}
   front=front.subarray(offset);upstream.write(b);
  });
  upstream.on('data',b=>{back=Buffer.concat([back,b]);while(back.length>=5){const n=back.readInt32BE(1);if(back.length<n+1)return;const frame=back.subarray(0,n+1);back=back.subarray(n+1);
   if(pending&&frame[0]===67&&frame.subarray(5).toString().startsWith('COMMIT')){dropped++;client.destroy();upstream.destroy();return;}client.write(frame);
  }});
  for(const s of [client,upstream]){s.on('error',()=>{});s.on('close',()=>{peers.delete(s);client.destroy();upstream.destroy();});}
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 return {port:(server.address() as {port:number}).port,counts:()=>({dropped,commits}),close:async()=>{for(const s of peers)s.destroy();await new Promise<void>(r=>server.close(()=>r()));}};
}
it('loses the real COMMIT wire acknowledgment after durable commit and reconciles without re-execution',async()=>{
 const f=await fixture(),m=await manifest(f),relay=await commitDropProxy(),p=await peer(relay.port);
 try{await expect(activateEmbeddingIndex(p.db as typeof t.db,m)).rejects.toBeDefined();expect(relay.counts()).toEqual({dropped:1,commits:1});expect(await reconcileEmbeddingCutover(t.db,readOperation(m))).toMatchObject({state:'after',activationReplayAuthorized:false});}
 finally{await p.raw.end({timeout:1});await relay.close();}
});

it.each(['stall','query'] as const)('server deadline releases actual C1 locks with isolated fatal child: %s',async(mode)=>{
 const f=await fixture(),m=await manifest(f),req=createRequire(new URL('../../package.json',import.meta.url));
 const library=join(process.env.WAKA_C1_LOCAL_DISPOSABLE_DIR!,'..','c1-actor-'+randomUUID()+'.mjs');
 const {build}=req('esbuild');await build({stdin:{contents:`export {activateEmbeddingIndex} from ${JSON.stringify(fileURLToPath(new URL('../../src/lib/embedding-index-cutover.ts',import.meta.url)))};export {sql} from 'drizzle-orm';`,resolveDir:fileURLToPath(new URL('../../',import.meta.url))},bundle:true,platform:'node',format:'esm',target:'node20',outfile:library,banner:{js:"import{createRequire}from'node:module';const require=createRequire(import.meta.url);"}});
 const uri=new URL(process.env.DB_CONNECTION_URL!);uri.searchParams.set('options','-c search_path='+t.schemaName);
 const script=`import fs from 'node:fs';import postgres from ${JSON.stringify(pathToFileURL(req.resolve('postgres')).href)};import{drizzle}from ${JSON.stringify(pathToFileURL(req.resolve('drizzle-orm/postgres-js')).href)};import{activateEmbeddingIndex,sql}from ${JSON.stringify(pathToFileURL(library).href)};
 const input=JSON.parse(fs.readFileSync(0,'utf8'));let stalled=false,hang=false;const raw=postgres(input.url,{max:1,prepare:false,onnotice:()=>{},debug:(_id,q)=>{if(!stalled&&q.includes('FROM profile_embedding_indexes')&&q.includes('FOR UPDATE')){stalled=true;if(input.mode==='stall'){process.stdout.write(JSON.stringify({phase:'locked'})+'\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,6500);}else hang=true;}}});
 const db=drizzle(raw),original=db.transaction.bind(db);const wrapped=new Proxy(db,{get(t,k,r){if(k==='transaction')return(fn,opts)=>original(async tx=>fn(new Proxy(tx,{get(t,k,r){if(k==='execute')return async q=>{const rows=await tx.execute(q);if(hang){hang=false;await tx.execute(sql.raw('SET LOCAL statement_timeout=0'));process.stdout.write(JSON.stringify({phase:'locked'})+'\\n');await tx.execute(sql.raw('SELECT pg_sleep(8)'));}return rows;};return Reflect.get(t,k,r);}})),opts);return Reflect.get(t,k,r);}});
 try{await activateEmbeddingIndex(wrapped,input.manifest);process.stdout.write(JSON.stringify({phase:'unexpected_commit'})+'\\n');}catch(e){let found=false;for(let c=e,i=0;c&&i<5;c=c.cause,i++)if(c.code==='25P04')found=true;process.stdout.write(JSON.stringify({phase:'terminal',rejected:true,transactionTimeout:found})+'\\n');}finally{await raw.end({timeout:1});}`;
 const actor=spawn(process.execPath,['--input-type=module','-e',script],{stdio:['pipe','pipe','pipe']});actor.stdin.end(JSON.stringify({url:uri.href,manifest:m,mode}));
 let stdout='',stderr='';actor.stdout.on('data',b=>{stdout+=b;});actor.stderr.on('data',b=>{stderr+=b;});
 const exited=new Promise<{code:number|null;signal:NodeJS.Signals|null}>(r=>actor.on('exit',(code,signal)=>r({code,signal})));
 const childDeadline=setTimeout(()=>actor.kill('SIGKILL'),6000);
 await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Actor readiness timeout')),3000);const inspect=()=>{if(stdout.includes('locked')){clearTimeout(timer);actor.stdout.off('data',inspect);resolve();}};actor.stdout.on('data',inspect);inspect();});
 const start=performance.now();await t.sql`UPDATE inspirations SET text='Words after server termination.' WHERE id=${f.sourceId}`;const waited=performance.now()-start;
 expect(waited).toBeGreaterThan(3000);expect(waited).toBeLessThan(6000);const exit=await exited;clearTimeout(childDeadline);
 // The pinned driver may fail during fatal cleanup. Isolate it, preserve its
 // actual exit, and classify the OPERATOR as unknown, never success/rollback.
 if(mode==='stall'){expect(exit.signal).toBe('SIGKILL');expect(stdout).not.toContain('terminal');expect(stderr).toBe('');}else{expect([0,1]).toContain(exit.code);if(exit.code===1)expect(stderr).toMatch(/nextWrite|reading 'write'/);else{expect(stderr).toBe('');expect(stdout).toContain('"rejected":true');}}
 expect(stdout).not.toContain('unexpected_commit');
 const [tuple]=await t.sql`SELECT active_epoch::text AS epoch FROM profile_embedding_indexes WHERE profile_id=${f.profileId}`;expect(tuple.epoch).toBe('0');
 await writeFile(join(process.env.WAKA_C1_LOCAL_DISPOSABLE_DIR!,'..',`deadline-${mode}-${randomUUID()}.json`),JSON.stringify({expectedFault:true,mode,actualChildExit:exit,childTypedTimeoutObserved:stdout.includes('"transactionTimeout":true'),pinnedDriverCleanupFault:/nextWrite|reading 'write'/.test(stderr),actualWriterWaitMs:waited,observedActiveEpoch:tuple.epoch,operatorSucceeded:false,operatorOutcome:'unknown',replayAuthorized:false,serverReleaseIndependentOfJs:true})+'\n',{mode:0o600,flag:'wx'});

},12000);

it('refuses an expired mutation but accepts its unchanged historical tuple only under fresh read authority',async()=>{
 const f=await fixture(),m=await manifest(f);m.expiresAt='2020-01-01T00:00:00.000Z';const original=JSON.stringify(m);
 await expect(activateEmbeddingIndex(t.db,m)).rejects.toMatchObject({code:'deadline'});
 const op=readOperation(m);expect(await reconcileEmbeddingCutover(t.db,op)).toMatchObject({state:'before_or_in_flight',activationReplayAuthorized:false});
 expect(JSON.stringify(m)).toBe(original);
 await expect(reconcileEmbeddingCutover(t.db,{...op,expiresAt:'2020-01-01T00:00:00.000Z'})).rejects.toMatchObject({code:'deadline'});
 await expect(reconcileEmbeddingCutover(t.db,{...op,intentSha256:'f'.repeat(64)})).rejects.toMatchObject({code:'identity'});
});

it('rolls back a real first metadata update when a later SQL operation fails',async()=>{
 const f=await fixture(),other=await fixture(false,f.accountId),m=await manifest(f),n=await manifest(other);m.profiles.push(...n.profiles);m.profiles.sort((a,b)=>a.id.localeCompare(b.id));let wrote=false;
 const wrapped=hook(t.db,async q=>{if(!wrote&&q.startsWith('UPDATE profile_embedding_indexes SET active_space')){wrote=true;throw Error('synthetic after first actual update');}});
 await expect(activateEmbeddingIndex(wrapped,m)).rejects.toThrow('synthetic after first actual update');expect(wrote).toBe(true);
 for(const p of m.profiles){const[r]=await t.sql`SELECT active_epoch::text AS epoch FROM profile_embedding_indexes WHERE profile_id=${p.id}`;expect(r.epoch).toBe('0');const[g]=await t.sql`SELECT revision::text AS generation FROM generation_revisions WHERE profile_id=${p.id}`;expect(g.generation).toBe(p.generation);}
});
it('avoids reverse-order delete/type row waits with NOWAIT and never changes a foreign cohort',async()=>{
 for(const mode of ['delete','type'] as const){
  const f=await fixture(),m=await manifest(f),p=await peer(),g=gate();let paused=false;
  const wrapped=hook(t.db,async q=>{if(!paused&&q.includes('pg_try_advisory_xact_lock')){paused=true;g.entered();await g.hold;}});
  const attempt=activateEmbeddingIndex(wrapped,m);await g.ready;
  const change=mode==='delete'?p.raw`DELETE FROM profiles WHERE id=${f.profileId}`:p.raw`UPDATE profiles SET type='agent' WHERE id=${f.profileId}`;
  const running=change.execute();await new Promise(r=>setTimeout(r,30));g.release();
  await expect(attempt).rejects.toBeDefined();await running;await p.raw.end();
  if(mode==='type')expect((await t.sql`SELECT active_epoch::text AS epoch FROM profile_embedding_indexes WHERE profile_id=${f.profileId}`)[0].epoch).toBe('0');
 }
});
