/** WHAT THIS MOCKS, AND WHY (gate G6): no provider HTTP is invoked here.
 * Synthetic owned rows run the real PostgreSQL17 migration/triggers/constraints.
 * `EmbeddingClient` is a deterministic vector seam for ordered canonical
 * reader checks; no real provider HTTP or owner/shared database is used. */
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {sql} from 'drizzle-orm';
import postgres from 'postgres';
import {drizzle} from 'drizzle-orm/postgres-js';
import * as schema from '../db/index.js';
import {activateEmbeddingIndex,commitEmbeddingIndexResult,EmbeddingIndexError,hasPendingEmbeddingWork,readEmbeddingIndexPolicy,readEmbeddingIndexProgress,reserveEmbeddingIndexAttempt,settleEmbeddingIndexWork} from './embedding-index-coordination.js';
import {hashEmbedding2Input} from './embedding-2-space.js';
import {randomUUID} from 'node:crypto';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {EMBEDDING_2_SPACE} from './embedding-2-space.js';
import {GEMINI_EMBEDDING_MODEL,hashEmbeddingInput,ensureInspirationEmbedding} from './inspiration-embeddings.js';
let t:TestDatabase;
beforeAll(async()=>{t=await createTestDatabase();});
afterAll(async()=>{await t?.cleanup();});
async function owner(){const [a]=await t.sql`INSERT INTO accounts(email) VALUES(${randomUUID()+'@example.test'}) RETURNING id`;const [p]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${a.id},'human','Synthetic owner') RETURNING id`;return {accountId:a.id as string,profileId:p.id as string};}
async function building(profileId:string){await t.sql`INSERT INTO profile_embedding_indexes(profile_id,building_space,building_threshold_policy) VALUES(${profileId},${EMBEDDING_2_SPACE.id},'embedding2.unvalidated')`;}
const vector=()=>[2,...Array<number>(767).fill(0)];
it('leaves native001 absence-of-control writes and active-vector generation fencing unchanged',async()=>{
 const f=await owner();const [source]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${f.profileId},'Untouched native input.') RETURNING id`;
 const [signal]=await t.sql`INSERT INTO signals(profile_id,statement,status,locked_at) VALUES(${f.profileId},'Owner-locked wording.','emerging',now()) RETURNING id`;
 const [before]=await t.sql`SELECT revision FROM generation_revisions WHERE profile_id=${f.profileId}`;
 await t.sql`INSERT INTO signal_embeddings(profile_id,signal_id,model,dimensions,input_hash,embedding) VALUES(${f.profileId},${signal.id},${GEMINI_EMBEDDING_MODEL},768,${hashEmbeddingInput('Owner-locked wording.')},${JSON.stringify(vector())}::jsonb)`;
 const [after]=await t.sql`SELECT revision FROM generation_revisions WHERE profile_id=${f.profileId}`;expect(BigInt(after.revision)).toBe(BigInt(before.revision)+1n);
 expect(await t.sql`SELECT id FROM embedding_index_work WHERE profile_id=${f.profileId}`).toHaveLength(0);
 expect(await t.sql`SELECT id FROM background_jobs WHERE profile_id=${f.profileId} AND type='index_embedding'`).toHaveLength(0);
 expect((await t.sql`SELECT text FROM inspirations WHERE id=${source.id}`)[0]!.text).toBe('Untouched native input.');
});
it('records uncited capture, reflection and signal work while building, without queueing bulk shadow work',async()=>{
 const f=await owner();await building(f.profileId);
 const [source]=await t.sql`INSERT INTO inspirations(profile_id,text,visibility) VALUES(${f.profileId},'Current public words.','public') RETURNING id`;
 const before=await t.sql`SELECT input_scope,requested_version FROM embedding_index_work WHERE source_id=${source.id} ORDER BY input_scope`;expect(before).toHaveLength(2);
 await t.sql`INSERT INTO reflections(profile_id,inspiration_id,question,answer) VALUES(${f.profileId},${source.id},'Why?','A private answer.')`;
 const after=await t.sql`SELECT input_scope,requested_version FROM embedding_index_work WHERE source_id=${source.id} ORDER BY input_scope`;
 expect(BigInt(after[0]!.requested_version)).toBeGreaterThan(BigInt(before[0]!.requested_version));expect(after[1]).toEqual(before[1]);
 await t.sql`INSERT INTO signals(profile_id,statement,status,dismissed_at) VALUES(${f.profileId},'A dismissed anchor.','retired',now())`;
 expect(await t.sql`SELECT id FROM embedding_index_work WHERE profile_id=${f.profileId} AND source_kind='signal'`).toHaveLength(1);
 expect(await t.sql`SELECT id FROM background_jobs WHERE profile_id=${f.profileId} AND type='index_embedding'`).toHaveLength(0);
});
it('coalesces active2 fallback intents, keeps requested versions and words, and isolates inactive shadow generation effects',async()=>{
 const f=await owner();await building(f.profileId);
 const [signal]=await t.sql`INSERT INTO signals(profile_id,statement,status,locked_at) VALUES(${f.profileId},'Exact protected words.','emerging',now()) RETURNING id`;
 const [before]=await t.sql`SELECT revision FROM generation_revisions WHERE profile_id=${f.profileId}`;
 await t.sql`INSERT INTO signal_embeddings(profile_id,signal_id,model,dimensions,input_hash,embedding) VALUES(${f.profileId},${signal.id},${EMBEDDING_2_SPACE.id},768,${hashEmbeddingInput('Synthetic formatted input')},${JSON.stringify(vector())}::jsonb)`;
 expect((await t.sql`SELECT revision FROM generation_revisions WHERE profile_id=${f.profileId}`)[0]!.revision).toBe(before.revision);
 // Synthetic control state exercises triggers, not the unvalidated activation helper.
 await t.sql`UPDATE profile_embedding_indexes SET active_space=${EMBEDDING_2_SPACE.id},active_epoch=1,active_threshold_policy='synthetic-test-only' WHERE profile_id=${f.profileId}`;
 await t.sql`UPDATE signal_embeddings SET embedding=${JSON.stringify([3,...Array<number>(767).fill(0)])}::jsonb WHERE signal_id=${signal.id}`;
 expect(BigInt((await t.sql`SELECT revision FROM generation_revisions WHERE profile_id=${f.profileId}`)[0]!.revision)).toBe(BigInt(before.revision)+1n);
 const [source]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${f.profileId},'First exact words.') RETURNING id`;
 const first=(await t.sql`SELECT requested_version FROM embedding_index_work WHERE source_id=${source.id}`)[0]!.requested_version;
 await t.sql`UPDATE inspirations SET text='Current exact words.' WHERE id=${source.id}`;
 const works=await t.sql`SELECT * FROM embedding_index_work WHERE source_id=${source.id}`;expect(works).toHaveLength(1);expect(BigInt(works[0]!.requested_version)).toBeGreaterThan(BigInt(first));
 const jobs=await t.sql`SELECT payload,request_version FROM background_jobs WHERE profile_id=${f.profileId} AND type='index_embedding' AND payload->>'sourceId'=${source.id}`;
 expect(jobs).toHaveLength(1);expect(BigInt(jobs[0]!.request_version)).toBe(2n);expect(jobs[0]!.payload).toEqual({sourceKind:'inspiration',sourceId:source.id,space:EMBEDDING_2_SPACE.id});
 expect((await t.sql`SELECT statement FROM signals WHERE id=${signal.id}`)[0]!.statement).toBe('Exact protected words.');
});

async function source(profileId:string,text:string){const [row]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${profileId},${text}) RETURNING id,text`;return {id:row.id as string,text:row.text as string};}
async function snapshot(profileId:string,item:{id:string;text:string}){
 const [w]=await t.sql`SELECT id,requested_version FROM embedding_index_work WHERE profile_id=${profileId} AND source_id=${item.id} AND input_scope='personal'`;
 const policy=await readEmbeddingIndexPolicy(t.db as never,profileId);
 return {profileId,workId:w.id as string,version:BigInt(w.requested_version),space:EMBEDDING_2_SPACE.id,activeEpoch:policy.activeEpoch,inputHash:hashEmbedding2Input(item.text,'RETRIEVAL_DOCUMENT'),outcome:'current' as const};
}
function commitFor(input:Awaited<ReturnType<typeof snapshot>>,item:{id:string;text:string}){
 return {prove:async(tx:any)=>{
  const [current]=await tx.execute(sql`SELECT text FROM inspirations WHERE profile_id=${input.profileId}::uuid AND id=${item.id}::uuid FOR UPDATE NOWAIT`);
  if(!current||hashEmbedding2Input(current.text,'RETRIEVAL_DOCUMENT')!==input.inputHash)throw new EmbeddingIndexError('stale');
  await tx.execute(sql`SELECT profile_id FROM generation_revisions WHERE profile_id=${input.profileId}::uuid FOR UPDATE NOWAIT`);
 },write:async(tx:any)=>{await tx.execute(sql`INSERT INTO inspiration_embeddings(profile_id,inspiration_id,model,input_scope,dimensions,input_hash,embedding)
 VALUES(${input.profileId}::uuid,${item.id}::uuid,${input.space},'personal',768,${input.inputHash},${JSON.stringify(vector())}::jsonb)
 ON CONFLICT(inspiration_id,model,input_scope) DO UPDATE SET input_hash=excluded.input_hash,embedding=excluded.embedding,dimensions=excluded.dimensions`);}};
}
async function peer(){const url=new URL(process.env.DB_CONNECTION_URL!);url.searchParams.set('options','-c search_path='+t.schemaName);const client=postgres(url.toString(),{max:1,prepare:false,onnotice:()=>{}});return {sql:client,db:drizzle(client,{schema})};}
it('keeps native policy epoch0 defaults without control and recovers per-source progress without clearing another dirty source',async()=>{
 const f=await owner();expect(await readEmbeddingIndexPolicy(t.db as never,f.profileId)).toEqual({profileId:f.profileId,activeSpace:GEMINI_EMBEDDING_MODEL,activeEpoch:0n,activeThresholdPolicy:'gemini-embedding-001.thresholds.v1',buildingSpace:null});await building(f.profileId);
 const a=await source(f.profileId,'A exact words.'),b=await source(f.profileId,'B exact words.');const sa=await snapshot(f.profileId,a),sb=await snapshot(f.profileId,b);
 await t.db.transaction(tx=>settleEmbeddingIndexWork(tx as never,sa,commitFor(sa,a)));
 expect((await readEmbeddingIndexProgress(t.db as never,f.profileId,EMBEDDING_2_SPACE.id)).pending).toBe(true);
 expect(await hasPendingEmbeddingWork(t.db as never,{profileId:f.profileId,space:EMBEDDING_2_SPACE.id,kind:'signal',scope:'statement'})).toBe(false);
 await t.sql`UPDATE inspirations SET text='A changed words.' WHERE id=${a.id}`;
 await t.db.transaction(tx=>settleEmbeddingIndexWork(tx as never,sb,commitFor(sb,b)));
 expect((await readEmbeddingIndexProgress(t.db as never,f.profileId,EMBEDDING_2_SPACE.id)).coveredVersion).toBeNull();
 await expect(t.db.transaction(tx=>settleEmbeddingIndexWork(tx as never,sa,commitFor(sa,a)))).rejects.toMatchObject({code:'stale'});
 await t.sql`UPDATE inspirations SET text=${a.text} WHERE id=${a.id}`;
 const fresh=await snapshot(f.profileId,a),cache=commitFor(fresh,a);cache.write=vi.fn(async()=>{}); // existing exact-input vector is re-proven; no HTTP/write
 await t.db.transaction(tx=>settleEmbeddingIndexWork(tx as never,fresh,cache));expect(cache.write).toHaveBeenCalledOnce();
 const progress=await readEmbeddingIndexProgress(t.db as never,f.profileId,EMBEDDING_2_SPACE.id);expect(progress.pending).toBe(false);expect(progress.coveredVersion).toBe(progress.latestVersion);
 expect((await t.sql`SELECT text FROM inspirations WHERE id=${a.id}`)[0]!.text).toBe(a.text);
});
it('keeps the one provider result across a NOWAIT conflict and retries only SQL commit',async()=>{
 const f=await owner();await building(f.profileId);const item=await source(f.profileId,'A current source.'),input=await snapshot(f.profileId,item),connection=await peer();
 let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>{entered=r;}),hold=new Promise<void>(r=>{release=r;});
 const locked=connection.sql.begin(async tx=>{await tx`SELECT id FROM embedding_index_work WHERE id=${input.workId} FOR UPDATE`;entered();await hold;});
 const provider=vi.fn(async()=>vector());const result=await provider();expect(result).toEqual(vector());await ready;
 try{const commit=commitFor(input,item),retry=vi.fn(async()=>{release();await locked;});
  expect(await commitEmbeddingIndexResult(t.db as never,input,commit,{onRetry:retry,reconcile:async()=>false})).toEqual({status:'settled'});
  expect(retry).toHaveBeenCalledOnce();expect(provider).toHaveBeenCalledOnce();expect((await readEmbeddingIndexProgress(t.db as never,f.profileId,input.space)).pending).toBe(false);
 }finally{release();await locked;await connection.sql.end();}
});
it('reconciles a physical commit followed by lost acknowledgement without repeating writes or HTTP',async()=>{
 const f=await owner();await building(f.profileId);const item=await source(f.profileId,'Durable exact source.'),input=await snapshot(f.profileId,item);const commit=commitFor(input,item);const write=vi.fn(commit.write);commit.write=write;
 const original=t.db.transaction.bind(t.db);let transactions=0;
 const uncertain=new Proxy(t.db,{get(target,key,receiver){if(key==='transaction')return async(fn:any)=>{transactions++;await original(fn);throw Object.assign(Error('synthetic dropped ACK'),{code:'ECONNRESET'});};return Reflect.get(target,key,receiver);}});
 const provider=vi.fn(async()=>vector());await provider();
 const result=await commitEmbeddingIndexResult(uncertain as never,input,commit,{reconcile:async()=>{
  const [row]=await t.sql`SELECT w.completed_version,e.input_hash FROM embedding_index_work w JOIN inspiration_embeddings e ON e.profile_id=w.profile_id AND e.inspiration_id=w.source_id AND e.model=w.space AND e.input_scope=w.input_scope WHERE w.id=${input.workId}`;
  return BigInt(row?.completed_version??0)===input.version&&row?.input_hash===input.inputHash;
 }});expect(result).toEqual({status:'reconciled'});expect(transactions).toBe(1);expect(write).toHaveBeenCalledOnce();expect(provider).toHaveBeenCalledOnce();
});
it('reserves exactly one request under a concurrent cap, refuses foreign ownership and never refunds an unknown dispatch',async()=>{
 const f=await owner();await building(f.profileId);const item=await source(f.profileId,'Budgeted source.'),other=await owner(),connection=await peer();
 const current=await snapshot(f.profileId,item);
 const base={accountId:f.accountId,profileId:f.profileId,family:'index' as const,space:EMBEDDING_2_SPACE.id,activeEpoch:current.activeEpoch,workId:current.workId,workVersion:current.version,kind:'inspiration' as const,sourceId:item.id,scope:'personal' as const,inputHash:hashEmbedding2Input(item.text,'RETRIEVAL_DOCUMENT'),inputBytes:80,manifestHash:hashEmbeddingInput('bounded synthetic manifest'),maxRequests:1,maxInputBytes:100};
 // Two distinct source cells compete for the single manifest slot. A waiter
 // for the SAME source now correctly joins its existing reservation instead.
 const secondItem=await source(f.profileId,'Another budgeted source.'),second=await snapshot(f.profileId,secondItem);
 const requests=[{...base,requestKey:randomUUID()},{...base,sourceId:secondItem.id,workId:second.workId,workVersion:second.version,inputHash:second.inputHash,requestKey:randomUUID()}];
 try{const results=await Promise.allSettled([reserveEmbeddingIndexAttempt(t.db as never,requests[0]!),reserveEmbeddingIndexAttempt(connection.db as never,requests[1]!)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((results.find(r=>r.status==='rejected') as PromiseRejectedResult).reason).toMatchObject({code:'budget'});
  await expect(reserveEmbeddingIndexAttempt(t.db as never,{...base,profileId:other.profileId,requestKey:randomUUID()})).rejects.toMatchObject({code:'identity'});
  const [row]=await t.sql`SELECT id,request_key FROM embedding_index_attempts WHERE manifest_hash=${base.manifestHash}`;await t.sql`UPDATE embedding_index_attempts SET status='unknown' WHERE id=${row.id}`;
  const winner=requests[results.findIndex(r=>r.status==='fulfilled')]!;
  expect(await reserveEmbeddingIndexAttempt(t.db as never,{...winner,requestKey:row.request_key})).toMatchObject({reserved:false,status:'unknown'});
  expect((await t.sql`SELECT count(*)::int AS n FROM embedding_index_attempts WHERE manifest_hash=${base.manifestHash}`)[0]!.n).toBe(1);
 }finally{await connection.sql.end();}
});
it('uses explicit READ COMMITTED statement snapshots even when the connection default is repeatable read',async()=>{
 const f=await owner();await building(f.profileId);const item=await source(f.profileId,'Isolation source.'),current=await snapshot(f.profileId,item),connection=await peer(),original=connection.db.transaction.bind(connection.db);let isolation:string|undefined;
 await connection.sql`SET SESSION default_transaction_isolation TO 'repeatable read'`;
 const checked=new Proxy(connection.db,{get(target,key,receiver){if(key==='transaction')return async(callback:any,options:any)=>{expect(options?.isolationLevel).toBe('read committed');return original(async tx=>{const [row]=await tx.execute(sql`SHOW transaction_isolation`);isolation=String(row.transaction_isolation);return callback(tx);},options);};return Reflect.get(target,key,receiver);}});
 try{expect(await reserveEmbeddingIndexAttempt(checked,{accountId:f.accountId,profileId:f.profileId,family:'index' as const,requestKey:randomUUID(),space:EMBEDDING_2_SPACE.id,activeEpoch:0n,kind:'inspiration',sourceId:item.id,scope:'personal',workId:current.workId,workVersion:current.version,inputHash:current.inputHash,inputBytes:80,manifestHash:hashEmbeddingInput('Isolation manifest'),maxRequests:1,maxInputBytes:100})).toMatchObject({reserved:true});expect(isolation).toBe('read committed');}
 finally{await connection.sql.end();}
});
it('blocks unvalidated activation, rejects a busy writer and atomically changes epoch and generation only after complete proof',async()=>{
 const f=await owner();await building(f.profileId);const item=await source(f.profileId,'Cutover current source.'),input=await snapshot(f.profileId,item);
 await t.db.transaction(tx=>settleEmbeddingIndexWork(tx as never,input,commitFor(input,item)));
 const request={profiles:[{id:f.profileId,epoch:0n}],space:EMBEDDING_2_SPACE.id,thresholdPolicy:'synthetic-test-only'};
 const coverage=async(tx:any)=>{const p=await readEmbeddingIndexProgress(tx,f.profileId,input.space);return {complete:!p.pending,maxVersion:p.latestVersion};};
 await expect(activateEmbeddingIndex(t.db as never,request,{coverage})).rejects.toMatchObject({code:'calibration_held'});
 const connection=await peer();let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>{entered=r;}),hold=new Promise<void>(r=>{release=r;});
 const writer=connection.sql.begin(async tx=>{await tx`UPDATE inspirations SET text='A concurrent new source.' WHERE id=${item.id}`;entered();await hold;});await ready;
 try{await expect(activateEmbeddingIndex(t.db as never,request,{coverage,assertThresholdPolicy:()=>{}})).rejects.toMatchObject({code:'busy'});}finally{release();await writer;await connection.sql.end();}
 expect((await readEmbeddingIndexPolicy(t.db as never,f.profileId)).activeEpoch).toBe(0n);
 const changed={...item,text:'A concurrent new source.'},fresh=await snapshot(f.profileId,changed);await t.db.transaction(tx=>settleEmbeddingIndexWork(tx as never,fresh,commitFor(fresh,changed)));
 const [before]=await t.sql`SELECT revision FROM generation_revisions WHERE profile_id=${f.profileId}`;
 expect(await activateEmbeddingIndex(t.db as never,request,{coverage,assertThresholdPolicy:()=>{}})).toEqual({activated:true,profiles:1});
 expect(await readEmbeddingIndexPolicy(t.db as never,f.profileId)).toMatchObject({activeSpace:EMBEDDING_2_SPACE.id,activeEpoch:1n});
 expect(BigInt((await t.sql`SELECT revision FROM generation_revisions WHERE profile_id=${f.profileId}`)[0]!.revision)).toBe(BigInt(before.revision)+1n);
 await expect(t.db.transaction(tx=>settleEmbeddingIndexWork(tx as never,fresh,commitFor(fresh,changed)))).rejects.toMatchObject({code:'stale'});
});

it('settles delete/ineligibility without leaving sticky indexing or inventing a vector',async()=>{
 const f=await owner();await building(f.profileId);const item=await source(f.profileId,'Deleted fixture words.'),input=await snapshot(f.profileId,item);
 await t.db.transaction(tx=>settleEmbeddingIndexWork(tx as never,input,commitFor(input,item)));
 await t.sql`DELETE FROM inspirations WHERE id=${item.id}`;
 const next=await snapshot(f.profileId,item);expect(next.version).toBeGreaterThan(input.version);
 await t.db.transaction(tx=>settleEmbeddingIndexWork(tx as never,{...next,inputHash:null,outcome:'ineligible'},{prove:async tx=>{const rows=await tx.execute(sql`SELECT id FROM inspirations WHERE id=${item.id}::uuid AND profile_id=${f.profileId}::uuid`);expect(rows).toHaveLength(0);},write:async()=>{}}));
 expect((await readEmbeddingIndexProgress(t.db as never,f.profileId,input.space)).pending).toBe(false);
 expect(await t.sql`SELECT id FROM inspiration_embeddings WHERE inspiration_id=${item.id}`).toHaveLength(0);
});
it('aborts a pre-registration repeatable-read writer instead of silently losing its invalidation',async()=>{
 const f=await owner(),connection=await peer();let entered!:()=>void,release!:()=>void;
 const ready=new Promise<void>(r=>{entered=r;}),hold=new Promise<void>(r=>{release=r;});
 const writer=connection.sql.begin('isolation level repeatable read',async tx=>{
  await tx`SELECT id FROM profiles WHERE id=${f.profileId}`;entered();await hold;
  await tx`INSERT INTO inspirations(profile_id,text) VALUES(${f.profileId},'Must not silently escape the policy snapshot.')`;
 });await ready;await building(f.profileId);release();
 try{await expect(writer).rejects.toMatchObject({code:'40001'});expect(await t.sql`SELECT id FROM inspirations WHERE profile_id=${f.profileId}`).toHaveLength(0);}finally{release();await writer.catch(()=>{});await connection.sql.end();}
});
it('lets fallback and derivation rendezvous on one actual reservation and no duplicate provider request',async()=>{
 const f=await owner();await building(f.profileId);await t.sql`UPDATE profile_embedding_indexes SET active_space=${EMBEDDING_2_SPACE.id},active_epoch=1,active_threshold_policy='synthetic-test-only' WHERE profile_id=${f.profileId}`;
 const item=await source(f.profileId,'One current source.'),current=await snapshot(f.profileId,item),connection=await peer();
 const input={accountId:f.accountId,profileId:f.profileId,family:'index' as const,requestKey:'same-intent:'+current.workId+':'+current.version,space:current.space,activeEpoch:current.activeEpoch,workId:current.workId,workVersion:current.version,kind:'inspiration' as const,sourceId:item.id,scope:'personal' as const,inputHash:current.inputHash,inputBytes:80};
 try{const reservations=await Promise.all([reserveEmbeddingIndexAttempt(t.db as never,input),reserveEmbeddingIndexAttempt(connection.db as never,input)]);expect(reservations.filter(r=>r.reserved)).toHaveLength(1);
  const provider=vi.fn(async()=>vector());for(const r of reservations)if(r.reserved)await provider();
  await t.db.transaction(tx=>settleEmbeddingIndexWork(tx as never,current,commitFor(current,item)));
  expect(await t.db.transaction(tx=>settleEmbeddingIndexWork(tx as never,current,commitFor(current,item)))).toEqual({status:'already_current'});
  expect(provider).toHaveBeenCalledOnce();expect((await readEmbeddingIndexProgress(t.db as never,f.profileId,current.space)).pending).toBe(false);
 }finally{await connection.sql.end();}
});
it('keeps paid reservations on profile deletion while cascading memory/progress and erases them with the account',async()=>{
 const f=await owner();await building(f.profileId);const item=await source(f.profileId,'Disposable deleted profile words.'),current=await snapshot(f.profileId,item);
 const attempt=await reserveEmbeddingIndexAttempt(t.db as never,{accountId:f.accountId,profileId:f.profileId,family:'index' as const,requestKey:randomUUID(),space:current.space,activeEpoch:current.activeEpoch,workId:current.workId,workVersion:current.version,kind:'inspiration',sourceId:item.id,scope:'personal',inputHash:current.inputHash,inputBytes:80,manifestHash:hashEmbeddingInput('erasure fixture manifest'),maxRequests:1,maxInputBytes:100});
 await t.sql`DELETE FROM profiles WHERE id=${f.profileId}`;
 expect(await t.sql`SELECT id FROM embedding_index_work WHERE profile_id=${f.profileId}`).toHaveLength(0);
 expect(await t.sql`SELECT profile_id FROM profile_embedding_indexes WHERE profile_id=${f.profileId}`).toHaveLength(0);
 expect(await t.sql`SELECT id FROM embedding_index_attempts WHERE id=${attempt.id}`).toHaveLength(1);
 await t.sql`DELETE FROM accounts WHERE id=${f.accountId}`;expect(await t.sql`SELECT id FROM embedding_index_attempts WHERE id=${attempt.id}`).toHaveLength(0);
});
it('rolls back an entire cohort when another owner lacks complete coverage',async()=>{
 const a=await owner(),b=await owner();await building(a.profileId);await building(b.profileId);
 const item=await source(a.profileId,'First cohort words.'),input=await snapshot(a.profileId,item);await t.db.transaction(tx=>settleEmbeddingIndexWork(tx as never,input,commitFor(input,item)));
 await source(b.profileId,'Second cohort words.');
 await expect(activateEmbeddingIndex(t.db as never,{profiles:[{id:a.profileId,epoch:0n},{id:b.profileId,epoch:0n}],space:EMBEDDING_2_SPACE.id,thresholdPolicy:'synthetic-test-only'},{assertThresholdPolicy:()=>{},coverage:async(tx,id)=>{const p=await readEmbeddingIndexProgress(tx as never,id,EMBEDDING_2_SPACE.id);return {complete:!p.pending,maxVersion:p.latestVersion};}})).rejects.toMatchObject({code:'stale'});
 expect((await readEmbeddingIndexPolicy(t.db as never,a.profileId)).activeEpoch).toBe(0n);expect((await readEmbeddingIndexPolicy(t.db as never,b.profileId)).activeEpoch).toBe(0n);
});
it('holds an unclear unconfirmed commit without re-dispatching HTTP or retrying an ambiguous write',async()=>{
 const f=await owner();await building(f.profileId);const item=await source(f.profileId,'Uncertain fixture.'),input=await snapshot(f.profileId,item),commit=commitFor(input,item);const write=vi.fn(commit.write);commit.write=write;
 let transactions=0;const unknown=new Proxy(t.db,{get(target,key,receiver){if(key==='transaction')return async()=>{transactions++;throw Object.assign(Error('synthetic uncertain transport'),{code:'ECONNRESET'});};return Reflect.get(target,key,receiver);}});
 const provider=vi.fn(async()=>vector());await provider();const reconcile=vi.fn(async()=>false);
 await expect(commitEmbeddingIndexResult(unknown as never,input,commit,{reconcile})).rejects.toMatchObject({code:'outcome_unknown'});
 expect(provider).toHaveBeenCalledOnce();expect(transactions).toBe(1);expect(write).not.toHaveBeenCalled();expect(reconcile).toHaveBeenCalledOnce();
 expect((await readEmbeddingIndexProgress(t.db as never,f.profileId,input.space)).pending).toBe(true);
});
it('enforces completion and threshold metadata constraints without changing either embedding space',async()=>{
 const f=await owner();await building(f.profileId);const item=await source(f.profileId,'Constraint source.'),current=await snapshot(f.profileId,item);
 await expect(t.sql`UPDATE embedding_index_work SET completed_version=requested_version WHERE id=${current.workId}`).rejects.toMatchObject({code:'23514'});
 await expect(t.sql`UPDATE embedding_index_work SET completed_version=requested_version,outcome='current' WHERE id=${current.workId}`).rejects.toMatchObject({code:'23514'});
 await expect(t.sql`UPDATE embedding_index_work SET completed_version=requested_version,outcome='ineligible',completed_input_hash=${current.inputHash} WHERE id=${current.workId}`).rejects.toMatchObject({code:'23514'});
 await expect(t.sql`UPDATE profile_embedding_indexes SET active_threshold_policy='wrong-native-policy' WHERE profile_id=${f.profileId}`).rejects.toMatchObject({code:'23514'});
 await expect(t.sql`UPDATE profile_embedding_indexes SET active_space=${EMBEDDING_2_SPACE.id},active_threshold_policy='embedding2.unvalidated' WHERE profile_id=${f.profileId}`).rejects.toMatchObject({code:'23514'});
 expect((await readEmbeddingIndexPolicy(t.db as never,f.profileId)).activeEpoch).toBe(0n);
});
it('rolls back source words, generation, progress and queue intent in the same aborted transaction',async()=>{
 const f=await owner();await building(f.profileId);await t.sql`UPDATE profile_embedding_indexes SET active_space=${EMBEDDING_2_SPACE.id},active_epoch=1,active_threshold_policy='synthetic-test-only' WHERE profile_id=${f.profileId}`;
 const before=await t.sql`SELECT revision FROM generation_revisions WHERE profile_id=${f.profileId}`;
 await expect(t.sql.begin(async tx=>{await tx`INSERT INTO inspirations(profile_id,text) VALUES(${f.profileId},'These words must roll back.')`;await tx`INSERT INTO signals(profile_id,statement,status) VALUES(${f.profileId},'This statement must roll back.','emerging')`;throw Error('synthetic intentional rollback');})).rejects.toThrow('synthetic intentional rollback');
 expect(await t.sql`SELECT id FROM inspirations WHERE profile_id=${f.profileId}`).toHaveLength(0);
 expect(await t.sql`SELECT id FROM signals WHERE profile_id=${f.profileId}`).toHaveLength(0);
 expect(await t.sql`SELECT id FROM embedding_index_work WHERE profile_id=${f.profileId}`).toHaveLength(0);
 expect(await t.sql`SELECT id FROM background_jobs WHERE profile_id=${f.profileId}`).toHaveLength(0);
 expect(await t.sql`SELECT revision FROM generation_revisions WHERE profile_id=${f.profileId}`).toEqual(before);
});
it('dirties both parents on an owned child move and refuses foreign children without leaving progress',async()=>{
 const f=await owner(),foreign=await owner();await building(f.profileId);const a=await source(f.profileId,'First parent.'),b=await source(f.profileId,'Second parent.');
 await t.sql`UPDATE inspirations SET visibility='public' WHERE id=${a.id}`;
 const[attachment]=await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,enrichment_status,enrichment_text) VALUES(${f.profileId},${a.id},'link','https://example.test/synthetic','ready','Synthetic page words.') RETURNING id`;
 const before=await t.sql`SELECT source_id,input_scope,requested_version FROM embedding_index_work WHERE profile_id=${f.profileId} ORDER BY source_id,input_scope`;
 await t.sql`UPDATE attachments SET inspiration_id=${b.id} WHERE id=${attachment.id}`;
 const after=await t.sql`SELECT source_id,input_scope,requested_version FROM embedding_index_work WHERE profile_id=${f.profileId} ORDER BY source_id,input_scope`;
 for(const prior of before){const current=after.find(row=>row.source_id===prior.source_id&&row.input_scope===prior.input_scope);expect(BigInt(current!.requested_version)).toBeGreaterThan(BigInt(prior.requested_version));}
 await expect(t.sql`INSERT INTO reflections(profile_id,inspiration_id,question,answer) VALUES(${foreign.profileId},${a.id},'Foreign question','Must be refused')`).rejects.toMatchObject({code:'23503'});
 expect(await t.sql`SELECT id FROM embedding_index_work WHERE profile_id=${foreign.profileId}`).toHaveLength(0);
 expect((await t.sql`SELECT enrichment_text FROM attachments WHERE id=${attachment.id}`)[0]!.enrichment_text).toBe('Synthetic page words.');
});
it('orders the coverage frontier numerically across decimal digit boundaries',async()=>{
 const f=await owner();await building(f.profileId);const a=await source(f.profileId,'Ninety-nine.'),b=await source(f.profileId,'One hundred.');
 await t.sql`UPDATE embedding_index_work SET requested_version=99 WHERE profile_id=${f.profileId} AND source_id=${a.id}`;
 await t.sql`UPDATE embedding_index_work SET requested_version=100 WHERE profile_id=${f.profileId} AND source_id=${b.id}`;
 expect((await readEmbeddingIndexProgress(t.db as never,f.profileId,EMBEDDING_2_SPACE.id)).latestVersion).toBe(100n);
});
it.each(['reflection','attachment'] as const)('invalidates one parent per affected scope when a tied %s child ID changes canonical order',async kind=>{
 const f=await owner();await building(f.profileId);
 await t.sql`UPDATE profile_embedding_indexes SET active_space=${EMBEDDING_2_SPACE.id},active_epoch=1,active_threshold_policy='synthetic-test-only' WHERE profile_id=${f.profileId}`;
 const[parent]=await t.sql`INSERT INTO inspirations(profile_id,text,visibility) VALUES(${f.profileId},'Exact parent wording.','public') RETURNING id`;
 const first='00000000-0000-4000-8000-000000000001',second='00000000-0000-4000-8000-000000000002',last='00000000-0000-4000-8000-000000000003';
 const at='2026-01-01T00:00:00.000Z';
 if(kind==='reflection')await t.sql`INSERT INTO reflections(id,profile_id,inspiration_id,question,answer,created_at) VALUES
  (${first},${f.profileId},${parent.id},'First exact question?','First exact reflection words.',${at}),
  (${second},${f.profileId},${parent.id},'Second exact question?','Second exact reflection words.',${at})`;
 else await t.sql`INSERT INTO attachments(id,profile_id,inspiration_id,type,url,enrichment_status,enrichment_text,created_at) VALUES
  (${first},${f.profileId},${parent.id},'link','https://example.test/first','ready','First exact attachment words.',${at}),
  (${second},${f.profileId},${parent.id},'link','https://example.test/second','ready','Second exact attachment words.',${at})`;
 const words=async()=>kind==='reflection'
  ?await t.sql`SELECT question,answer,skipped,created_at FROM reflections WHERE profile_id=${f.profileId} AND inspiration_id=${parent.id}`
  :await t.sql`SELECT type,url,enrichment_status,enrichment_text,transcript_correction,created_at FROM attachments WHERE profile_id=${f.profileId} AND inspiration_id=${parent.id}`;
 const wordBag=(rows:unknown[])=>rows.map(row=>JSON.stringify(row)).sort();const priorWords=wordBag(await words());
 const embed=vi.fn(async(_input:string)=>vector());const client={model:GEMINI_EMBEDDING_MODEL,dimensions:768,embed};
 const before=await ensureInspirationEmbedding({db:t.db as never,profileId:f.profileId,inspirationId:parent.id,inputScope:'personal',client});
 expect(embed).toHaveBeenCalledOnce();const inputBefore=embed.mock.calls[0]![0];const hashBefore=hashEmbedding2Input(inputBefore,'RETRIEVAL_DOCUMENT');
 await t.sql`INSERT INTO inspiration_embeddings(profile_id,inspiration_id,model,input_scope,dimensions,input_hash,embedding) VALUES(${f.profileId},${parent.id},${EMBEDDING_2_SPACE.id},'personal',768,${hashBefore},${JSON.stringify(vector())}::jsonb)`;
 await t.sql`UPDATE embedding_index_work SET completed_version=requested_version,completed_input_hash=${hashBefore},outcome='current' WHERE profile_id=${f.profileId} AND source_id=${parent.id} AND input_scope='personal'`;
 const priorWork=await t.sql`SELECT input_scope,requested_version,completed_version FROM embedding_index_work WHERE profile_id=${f.profileId} AND source_id=${parent.id} ORDER BY input_scope`;
 const[jobBefore]=await t.sql`SELECT request_version FROM background_jobs WHERE profile_id=${f.profileId} AND type='index_embedding' AND payload->>'sourceId'=${parent.id}`;
 const changed=kind==='reflection'
  ?await t.sql`UPDATE reflections SET id=${last} WHERE profile_id=${f.profileId} AND id=${first} RETURNING id`
  :await t.sql`UPDATE attachments SET id=${last} WHERE profile_id=${f.profileId} AND id=${first} RETURNING id`;
 expect(changed).toHaveLength(1);expect(changed[0]!.id).toBe(last);expect(wordBag(await words())).toEqual(priorWords);
 const after=await ensureInspirationEmbedding({db:t.db as never,profileId:f.profileId,inspirationId:parent.id,inputScope:'personal',client});
 expect(embed).toHaveBeenCalledTimes(2);const inputAfter=embed.mock.calls[1]![0];const hashAfter=hashEmbedding2Input(inputAfter,'RETRIEVAL_DOCUMENT');
 expect(hashBefore).not.toBe(hashAfter);expect(before.inputHash).not.toBe(after.inputHash);
 expect(inputBefore.indexOf('First exact')).toBeLessThan(inputBefore.indexOf('Second exact'));
 expect(inputAfter.indexOf('Second exact')).toBeLessThan(inputAfter.indexOf('First exact'));
 const workAfter=await t.sql`SELECT input_scope,requested_version,completed_version,completed_input_hash FROM embedding_index_work WHERE profile_id=${f.profileId} AND source_id=${parent.id} ORDER BY input_scope`;
 const[jobAfter]=await t.sql`SELECT request_version FROM background_jobs WHERE profile_id=${f.profileId} AND type='index_embedding' AND payload->>'sourceId'=${parent.id}`;
 const[oldVector]=await t.sql`SELECT input_hash FROM inspiration_embeddings WHERE profile_id=${f.profileId} AND inspiration_id=${parent.id} AND model=${EMBEDDING_2_SPACE.id} AND input_scope='personal'`;
 expect(oldVector!.input_hash).toBe(hashBefore);expect(oldVector!.input_hash).not.toBe(hashAfter);
 if(process.env.WAKA_EMBEDDING_INDEX_PROOF==='1')console.info(JSON.stringify({fixture:'tied-child-primary-key-order',kind,childIdUpdateAccepted:true,wordsUnchanged:true,beforeNativeHash:before.inputHash,afterNativeHash:after.inputHash,beforeSpace2Hash:hashBefore,afterSpace2Hash:hashAfter,priorVectorRemainsStale:true,priorWork:priorWork.map(w=>({scope:w.input_scope,requested:String(w.requested_version),completed:String(w.completed_version)})),afterWork:workAfter.map(w=>({scope:w.input_scope,requested:String(w.requested_version),completed:String(w.completed_version)})),jobRequestDelta:String(BigInt(jobAfter!.request_version)-BigInt(jobBefore!.request_version)),fakeEmbeddingCalls:embed.mock.calls.length,realProviderCalls:0}));
 expect(workAfter).toHaveLength(priorWork.length);
 for(const prior of priorWork){const current=workAfter.find(w=>w.input_scope===prior.input_scope)!;if(kind==='reflection'&&prior.input_scope==='public')expect(current.requested_version).toBe(prior.requested_version);else expect(BigInt(current.requested_version)).toBeGreaterThan(BigInt(prior.requested_version));}
 const personal=workAfter.find(w=>w.input_scope==='personal')!;expect(BigInt(personal.requested_version)).toBeGreaterThan(BigInt(personal.completed_version));expect(personal.completed_input_hash).toBe(hashBefore);
 // One request per affected scope: reflections stay personal; attachment order affects both scopes.
 expect(BigInt(jobAfter!.request_version)-BigInt(jobBefore!.request_version)).toBe(kind==='reflection'?1n:2n);
});
