/** WHAT THIS MOCKS, AND WHY (gate G6): `GeminiEmbeddingClient` returns fixed
 * synthetic vectors or closed failures at the paid boundary. Actual PG17
 * migrations, source/work/policy/cache/attempt locks and commit code execute.
 * No shared database, provider HTTP, credential or owner content is used. */
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import postgres from 'postgres';import {drizzle} from 'drizzle-orm/postgres-js';
import {PgDialect} from 'drizzle-orm/pg-core';
import * as schema from '../db/index.js';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {indexEmbeddingSource,EmbeddingIndexNeedsRetry} from './embedding-indexer.js';
import {EMBEDDING_2_SPACE,hashEmbedding2Input} from './embedding-2-space.js';
import {EMBEDDING_2_CANDIDATE_POLICY} from './embedding-policy.js';
import {hashEmbeddingInput,GEMINI_EMBEDDING_MODEL} from './inspiration-embeddings.js';
import {OpenRouterHttpError} from './openrouter-http.js';
import {BackgroundJobHeldError} from './background-job-hold.js';
import {renewKnownFailedSignalEmbedding} from './embedding-index-recovery.js';
import {parseEmbedding2Response} from './embedding-2-response.js';
let t:TestDatabase;beforeAll(async()=>{t=await createTestDatabase();});afterAll(async()=>{await t?.cleanup();});
const values=()=>[2,1,...Array<number>(766).fill(0)];
const client=(embed=vi.fn(async(_input:string)=>values()))=>({model:EMBEDDING_2_SPACE.id,dimensions:768,embed});
async function owner(active=false){const[a]=await t.sql`INSERT INTO accounts(email) VALUES(${randomUUID()+'@example.test'}) RETURNING id`;const[p]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${a.id},'human','Synthetic') RETURNING id`;
 await t.sql`INSERT INTO profile_embedding_indexes(profile_id,building_space,building_threshold_policy) VALUES(${p.id},${EMBEDDING_2_SPACE.id},'embedding2.unvalidated')`;
 if(active)await t.sql`UPDATE profile_embedding_indexes SET active_space=${EMBEDDING_2_SPACE.id},active_epoch=1,active_threshold_policy=${EMBEDDING_2_CANDIDATE_POLICY} WHERE profile_id=${p.id}`;
 return {accountId:a.id as string,profileId:p.id as string};}
async function signal(profileId:string){const[s]=await t.sql`INSERT INTO signals(profile_id,statement,status,locked_at) VALUES(${profileId},'Exact owner-locked words.','emerging',now()) RETURNING id,statement,locked_at`;return s;}
const input=(profileId:string,id:string)=>({profileId,sourceKind:'signal' as const,sourceId:id,space:EMBEDDING_2_SPACE.id});
async function peer(){const u=new URL(process.env.DB_CONNECTION_URL!);u.searchParams.set('options','-c search_path='+t.schemaName);const c=postgres(u.toString(),{max:1,prepare:false,onnotice:()=>{}});return{client:c,db:drizzle(c,{schema})};}
it('keeps native active/default and old rows; building2 normal work makes no call',async()=>{
 const f=await owner(),s=await signal(f.profileId),c=client();await t.sql`INSERT INTO signal_embeddings(profile_id,signal_id,model,dimensions,input_hash,embedding) VALUES(${f.profileId},${s.id},${GEMINI_EMBEDDING_MODEL},768,${hashEmbeddingInput(s.statement)},${JSON.stringify(values())}::jsonb)`;
 expect((await indexEmbeddingSource(t.db,input(f.profileId,s.id),{client:c})).status).toBe('inactive');expect(c.embed).not.toHaveBeenCalled();expect((await t.sql`SELECT model FROM signal_embeddings WHERE signal_id=${s.id}`)[0]!.model).toBe(GEMINI_EMBEDDING_MODEL);
});
it('writes bounded shadow vectors without changing active generation/words and genuinely reconciles cache',async()=>{
 const f=await owner(),s=await signal(f.profileId),c=client(),migration={manifestHash:hashEmbeddingInput(randomUUID()),maxRequests:2,maxInputBytes:200};
 const[before]=await t.sql`SELECT revision FROM generation_revisions WHERE profile_id=${f.profileId}`;
 expect((await indexEmbeddingSource(t.db,input(f.profileId,s.id),{client:c,migration})).generated).toBe(true);
 expect((await indexEmbeddingSource(t.db,input(f.profileId,s.id),{client:c,migration})).status).toBe('unchanged');expect(c.embed).toHaveBeenCalledOnce();expect(c.embed.mock.calls[0]![0]).toBe(s.statement);
 const[e]=await t.sql`SELECT model,input_hash,embedding FROM signal_embeddings WHERE signal_id=${s.id}`;expect(e.model).toBe(EMBEDDING_2_SPACE.id);expect(e.input_hash).toBe(hashEmbedding2Input(s.statement,'RETRIEVAL_DOCUMENT'));expect(e.embedding).toEqual(values());
 expect((await t.sql`SELECT revision FROM generation_revisions WHERE profile_id=${f.profileId}`)[0]).toEqual(before);expect((await t.sql`SELECT statement,locked_at FROM signals WHERE id=${s.id}`)[0]).toEqual({statement:s.statement,locked_at:s.locked_at});
});
it('never uses completed progress or a paid receipt as proof of a corrupted vector',async()=>{
 const f=await owner(true),s=await signal(f.profileId),c=client();await indexEmbeddingSource(t.db,input(f.profileId,s.id),{client:c});
 await t.sql`UPDATE signal_embeddings SET dimensions=2,embedding='[1,2]'::jsonb WHERE signal_id=${s.id} AND model=${EMBEDDING_2_SPACE.id}`;
 await expect(indexEmbeddingSource(t.db,input(f.profileId,s.id),{client:c})).rejects.toBeInstanceOf(EmbeddingIndexNeedsRetry);expect(c.embed).toHaveBeenCalledOnce();
});
it('holds a concurrent fallback/derive rendezvous and makes exactly one fake provider call',async()=>{
 const f=await owner(true),s=await signal(f.profileId),connection=await peer();let entered!:()=>void,release!:()=>void;
 const ready=new Promise<void>(r=>{entered=r;}),hold=new Promise<void>(r=>{release=r;});const c=client(vi.fn(async(_input:string)=>{entered();await hold;return values();}));
 const first=indexEmbeddingSource(t.db,input(f.profileId,s.id),{client:c});
 try{await Promise.race([ready,first.then(()=>{throw Error('First indexer completed before the controlled provider boundary');})]);await expect(indexEmbeddingSource(connection.db,input(f.profileId,s.id),{client:c})).rejects.toBeInstanceOf(BackgroundJobHeldError);release();await first;expect((await indexEmbeddingSource(connection.db,input(f.profileId,s.id),{client:c})).status).toBe('unchanged');expect(c.embed).toHaveBeenCalledOnce();}
 finally{release();await first.catch(()=>{});await connection.client.end();}
});
it('keeps unknown dispatch reserved/charged and does not automatically retry the HTTP',async()=>{
 const f=await owner(true),s=await signal(f.profileId),c=client(vi.fn(async(_input:string):Promise<number[]>=>{throw Error('PRIVATE_PROVIDER_ERROR');}));
 await expect(indexEmbeddingSource(t.db,input(f.profileId,s.id),{client:c})).rejects.toMatchObject({code:'outcome_unknown'});
 await expect(indexEmbeddingSource(t.db,input(f.profileId,s.id),{client:c})).rejects.toMatchObject({code:'outcome_unknown'});expect(c.embed).toHaveBeenCalledOnce();
 expect((await t.sql`SELECT status FROM embedding_index_attempts WHERE profile_id=${f.profileId}`)[0]!.status).toBe('unknown');expect((await t.sql`SELECT requested_version>completed_version AS pending,failure_code FROM embedding_index_work WHERE profile_id=${f.profileId}`)[0]).toEqual({pending:true,failure_code:'outcome_unknown'});
});
it('does not bypass an unknown canonical dispatch after the source words and work version change',async()=>{
 const f=await owner(true),s=await signal(f.profileId),c=client(vi.fn(async(_input:string):Promise<number[]>=>{throw Error('Synthetic unknown dispatch');}));
 await expect(indexEmbeddingSource(t.db,input(f.profileId,s.id),{client:c})).rejects.toMatchObject({code:'outcome_unknown'});
 await t.sql`UPDATE signals SET statement='New exact source words.' WHERE id=${s.id}`;
 await expect(indexEmbeddingSource(t.db,input(f.profileId,s.id),{client:c})).rejects.toMatchObject({code:'outcome_unknown'});
 expect(c.embed).toHaveBeenCalledOnce();expect(await t.sql`SELECT id FROM embedding_index_attempts WHERE profile_id=${f.profileId}`).toHaveLength(1);
});
it('does not evade an unresolved same-source dispatch by changing migration manifest or switching to normal processing',async()=>{
 const f=await owner(true),s=await signal(f.profileId),c=client(vi.fn(async(_input:string):Promise<number[]>=>{throw Error('Synthetic unknown dispatch');}));
 const first={manifestHash:hashEmbeddingInput('First approved synthetic manifest'),maxRequests:2,maxInputBytes:1000};
 await expect(indexEmbeddingSource(t.db,input(f.profileId,s.id),{client:c,migration:first})).rejects.toMatchObject({code:'outcome_unknown'});
 await expect(indexEmbeddingSource(t.db,input(f.profileId,s.id),{client:c,migration:{...first,manifestHash:hashEmbeddingInput('Another synthetic manifest')}})).rejects.toMatchObject({code:'outcome_unknown'});
 await expect(indexEmbeddingSource(t.db,input(f.profileId,s.id),{client:c})).rejects.toMatchObject({code:'outcome_unknown'});expect(c.embed).toHaveBeenCalledOnce();
});
it('serializes two different manifests after both outer attempt reads saw empty, without a second HTTP',async()=>{
 const f=await owner(true),s=await signal(f.profileId),connection=await peer(),dialect=new PgDialect();
 let sawA!:()=>void,both!:()=>void,http!:()=>void,release!:()=>void;
 const aRead=new Promise<void>(r=>{sawA=r;}),bothRead=new Promise<void>(r=>{both=r;}),httpStarted=new Promise<void>(r=>{http=r;}),hold=new Promise<void>(r=>{release=r;});let reads=0,calls=0;
 const wrap=(db:typeof t.db,side:'a'|'b')=>new Proxy(db,{get(target,key,receiver){if(key==='execute')return async(query:any)=>{if(/^SELECT request_key,status,http_status/.test(dialect.sqlToQuery(query).sql)){
   if(side==='b')await aRead;const rows=await target.execute(query);expect(rows).toHaveLength(0);reads++;
   if(side==='a'){sawA();await bothRead;}else{both();await httpStarted;}return rows;
  }return target.execute(query);};return Reflect.get(target,key,receiver);}});
 const c=client(vi.fn(async(_input:string)=>{if(++calls===1){http();await hold;}return values();}));
 const m={manifestHash:hashEmbeddingInput('Race manifest A'),maxRequests:2,maxInputBytes:1000};
 const first=indexEmbeddingSource(wrap(t.db,'a'),input(f.profileId,s.id),{client:c,migration:m});
 const second=indexEmbeddingSource(wrap(connection.db,'b'),input(f.profileId,s.id),{client:c,migration:{...m,manifestHash:hashEmbeddingInput('Race manifest B')}});
 try{await expect(second).rejects.toBeInstanceOf(BackgroundJobHeldError);expect(reads).toBe(2);expect(calls).toBe(1);}
 finally{release();await first.catch(()=>{});await second.catch(()=>{});await connection.client.end();console.info('[embedding-manifest-race-fixture]',JSON.stringify({outerEmptyReads:reads,providerCalls:calls}));}
});
it('allows only bounded definite transient HTTP retry and records each reservation',async()=>{
 const f=await owner(true),s=await signal(f.profileId);let calls=0;const c=client(vi.fn(async(_input:string)=>{if(++calls===1)throw new OpenRouterHttpError('Closed synthetic failure',429);return values();}));
 await expect(indexEmbeddingSource(t.db,input(f.profileId,s.id),{client:c})).rejects.toThrow('transient');expect((await indexEmbeddingSource(t.db,input(f.profileId,s.id),{client:c})).generated).toBe(true);expect(c.embed).toHaveBeenCalledTimes(2);
 expect((await t.sql`SELECT status FROM embedding_index_attempts WHERE profile_id=${f.profileId} ORDER BY request_key`).map(r=>r.status)).toEqual(['http_failed','committed']);
});
it('permits exact privileged signal renewal only for a known failed version, retaining its ledger and lock wording',async()=>{
 const f=await owner(true),s=await signal(f.profileId),c=client(vi.fn(async()=>{throw new OpenRouterHttpError('Closed synthetic failure',402);}));
 await expect(indexEmbeddingSource(t.db,input(f.profileId,s.id),{client:c})).rejects.toMatchObject({code:'provider_refused'});
 const [work]=await t.sql`SELECT requested_version FROM embedding_index_work WHERE source_id=${s.id}`,request={accountId:f.accountId,profileId:f.profileId,signalId:s.id,expectedVersion:BigInt(work.requested_version),expectedEpoch:1n};
 await expect(renewKnownFailedSignalEmbedding(t.db,{...request,accountId:randomUUID()})).rejects.toMatchObject({code:'identity'});
 expect(await renewKnownFailedSignalEmbedding(t.db,request)).toEqual({renewed:1});await expect(renewKnownFailedSignalEmbedding(t.db,request)).rejects.toMatchObject({code:'stale'});
 expect((await t.sql`SELECT status FROM embedding_index_attempts WHERE profile_id=${f.profileId}`)[0].status).toBe('http_failed');expect((await t.sql`SELECT statement,locked_at FROM signals WHERE id=${s.id}`)[0]).toEqual({statement:s.statement,locked_at:s.locked_at});
 const next=client();await indexEmbeddingSource(t.db,input(f.profileId,s.id),{client:next});expect(next.embed).toHaveBeenCalledOnce();
});
it('does not renew unknown signal work even after a source edit',async()=>{
 const f=await owner(true),s=await signal(f.profileId),c=client(vi.fn(async():Promise<number[]>=>{throw Error('Synthetic unknown');}));
 await expect(indexEmbeddingSource(t.db,input(f.profileId,s.id),{client:c})).rejects.toMatchObject({code:'outcome_unknown'});await t.sql`UPDATE signals SET statement='New current exact words.' WHERE id=${s.id}`;
 const [before]=await t.sql`SELECT requested_version FROM embedding_index_work WHERE source_id=${s.id}`;
 await expect(renewKnownFailedSignalEmbedding(t.db,{accountId:f.accountId,profileId:f.profileId,signalId:s.id,expectedVersion:BigInt(before.requested_version),expectedEpoch:1n})).rejects.toMatchObject({code:'outcome_unknown'});
 expect((await t.sql`SELECT requested_version FROM embedding_index_work WHERE source_id=${s.id}`)[0]).toEqual(before);expect(c.embed).toHaveBeenCalledOnce();
});
it('retains a closed response predicate after parser refusal without raw model/body diagnostics or redispatch',async()=>{
 const f=await owner(true),s=await signal(f.profileId),c=client(vi.fn(async()=>parseEmbedding2Response({model:'PRIVATE_SYNTHETIC_UNKNOWN_MODEL',data:[{index:0,embedding:values()}]})));
 await expect(indexEmbeddingSource(t.db,input(f.profileId,s.id),{client:c})).rejects.toMatchObject({code:'provider_refused',responseFailure:'model_mismatch'});
 await expect(indexEmbeddingSource(t.db,input(f.profileId,s.id),{client:c})).rejects.toMatchObject({code:'outcome_unknown'});expect(c.embed).toHaveBeenCalledOnce();expect((await t.sql`SELECT failure_code FROM embedding_index_work WHERE source_id=${s.id}`)[0].failure_code).toBe('response_model_mismatch');
});
it('rejects a source edit during HTTP and leaves the new work version pending',async()=>{
 const f=await owner(true),s=await signal(f.profileId),connection=await peer();const c=client(vi.fn(async(_input:string)=>{await connection.client`UPDATE signals SET statement='New exact wording.' WHERE id=${s.id}`;return values();}));
 try{await expect(indexEmbeddingSource(t.db,input(f.profileId,s.id),{client:c})).rejects.toMatchObject({code:'stale'});expect(c.embed).toHaveBeenCalledOnce();expect(await t.sql`SELECT id FROM signal_embeddings WHERE signal_id=${s.id}`).toHaveLength(0);expect((await t.sql`SELECT requested_version>completed_version AS pending FROM embedding_index_work WHERE profile_id=${f.profileId}`)[0]!.pending).toBe(true);}
 finally{await connection.client.end();}
});
it('settles deleted-source tombstones without a model or unrelated row deletion',async()=>{
 const f=await owner(true),s=await signal(f.profileId),c=client();await indexEmbeddingSource(t.db,input(f.profileId,s.id),{client:c});await t.sql`DELETE FROM signals WHERE id=${s.id}`;
 expect((await indexEmbeddingSource(t.db,input(f.profileId,s.id),{client:c})).status).toBe('ineligible');expect(c.embed).toHaveBeenCalledOnce();expect((await t.sql`SELECT requested_version=completed_version AS done,outcome FROM embedding_index_work WHERE profile_id=${f.profileId}`)[0]).toEqual({done:true,outcome:'ineligible'});
});
it('reconciles a physical vector/progress commit with lost ACK using actual source/cache, not another HTTP',async()=>{
 const f=await owner(true),s=await signal(f.profileId),c=client(),original=t.db.transaction.bind(t.db);let writes=0;
 const uncertain=new Proxy(t.db,{get(target,key,receiver){if(key==='transaction')return async(callback:any,options:any)=>{const result=await original(callback,options);if(options?.accessMode!=='read only'&&++writes===2)throw Object.assign(Error('Synthetic post-commit ACK loss'),{code:'ECONNRESET'});return result;};return Reflect.get(target,key,receiver);}});
 expect((await indexEmbeddingSource(uncertain,input(f.profileId,s.id),{client:c})).status).toBe('updated');expect(c.embed).toHaveBeenCalledOnce();
 expect((await indexEmbeddingSource(t.db,input(f.profileId,s.id),{client:c})).status).toBe('unchanged');expect(c.embed).toHaveBeenCalledOnce();expect((await t.sql`SELECT status FROM embedding_index_attempts WHERE profile_id=${f.profileId}`)[0]!.status).toBe('committed');
});
it('retains the received provider result across actual work-lock contention and commits with DB-only retry',async()=>{
 const f=await owner(true),s=await signal(f.profileId),connection=await peer(),original=t.db.transaction.bind(t.db);let release!:()=>void,locked!:()=>void,holding:Promise<unknown>|undefined,conflicts=0;
 const held=new Promise<void>(r=>{release=r;}),ready=new Promise<void>(r=>{locked=r;});
 const c=client(vi.fn(async()=>{holding=connection.client.begin(async tx=>{await tx`SELECT id FROM embedding_index_work WHERE source_id=${s.id} FOR UPDATE`;locked();await held;});await ready;return values();}));
 const observed=new Proxy(t.db,{get(target,key,receiver){if(key==='transaction')return async(callback:any,options:any)=>{try{return await original(callback,options);}catch(error){let cause:any=error;while(cause&&cause.code!=='55P03')cause=cause.cause;if(cause?.code==='55P03'&&holding){conflicts++;release();await holding;}throw error;}};return Reflect.get(target,key,receiver);}});
 try{expect((await indexEmbeddingSource(observed,input(f.profileId,s.id),{client:c})).status).toBe('updated');expect(conflicts).toBe(1);expect(c.embed).toHaveBeenCalledOnce();expect((await t.sql`SELECT requested_version=completed_version AS done FROM embedding_index_work WHERE source_id=${s.id}`)[0].done).toBe(true);expect((await t.sql`SELECT status FROM embedding_index_attempts WHERE profile_id=${f.profileId}`)[0].status).toBe('committed');}
 finally{release();await holding;await connection.client.end();}
});
it('distinguishes an expired received result from an unknown dispatch without re-spending',async()=>{
 const f=await owner(true),s=await signal(f.profileId),c=client();await indexEmbeddingSource(t.db,input(f.profileId,s.id),{client:c});
 await t.sql`DELETE FROM signal_embeddings WHERE signal_id=${s.id} AND model=${EMBEDDING_2_SPACE.id}`;
 await t.sql`UPDATE embedding_index_attempts SET status='received',started_at=now()-interval '1 minute' WHERE profile_id=${f.profileId}`;
 await expect(indexEmbeddingSource(t.db,input(f.profileId,s.id),{client:c})).rejects.toMatchObject({code:'commit_unconfirmed'});expect(c.embed).toHaveBeenCalledOnce();
});
it('checks a deadline again after a slow reservation, records no dispatch and never calls the fake provider',async()=>{
 const f=await owner(true),s=await signal(f.profileId),c=client(),original=t.db.transaction.bind(t.db),deadline=Date.now()+1000;
 const slow=new Proxy(t.db,{get(target,key,receiver){if(key==='transaction')return async(callback:any,options:any)=>{const result=await original(callback,options);if((result as {reserved?:boolean}|undefined)?.reserved===true){vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(deadline+1);}return result;};return Reflect.get(target,key,receiver);}});
 try{await expect(indexEmbeddingSource(slow,input(f.profileId,s.id),{client:c,dispatchDeadline:{expiresAtMs:deadline,deadlineAtMs:deadline}})).rejects.toMatchObject({code:'budget'});expect(c.embed).not.toHaveBeenCalled();expect((await t.sql`SELECT status,http_status FROM embedding_index_attempts WHERE profile_id=${f.profileId}`)[0]).toEqual({status:'stale',http_status:null});}
 finally{vi.useRealTimers();}
});
it('refuses oversized canonical memory before any reservation or provider call, without truncating or rewriting it',async()=>{
 const f=await owner(true),[source]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${f.profileId},repeat('x',50001)) RETURNING id`,c=client();
 await expect(indexEmbeddingSource(t.db,{profileId:f.profileId,sourceKind:'inspiration',sourceId:source.id,space:EMBEDDING_2_SPACE.id},{client:c})).rejects.toMatchObject({code:'input_too_large'});expect(c.embed).not.toHaveBeenCalled();expect(await t.sql`SELECT id FROM embedding_index_attempts WHERE profile_id=${f.profileId}`).toHaveLength(0);expect((await t.sql`SELECT length(text)::int AS n FROM inspirations WHERE id=${source.id}`)[0].n).toBe(50001);
});
it('bounds child text on the database response before refusing an oversized source',async()=>{
 const f=await owner(true),[item]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${f.profileId},'Small exact source.') RETURNING id`,c=client();
 await t.sql`INSERT INTO reflections(profile_id,inspiration_id,question,answer) SELECT ${f.profileId},${item.id},'Why?',repeat('a',4000) FROM generate_series(1,65)`;
 let responseBytes=0,rowsSeen=0,allSuppressed=false;
 const bounded=new Proxy(t.db,{get(target,key,receiver){if(key==='execute')return async(query:any)=>{const rows=await target.execute(query);if(rows[0]&&'within_bounds' in rows[0]){responseBytes+=Buffer.byteLength(JSON.stringify(rows));rowsSeen+=rows.length;allSuppressed=rows.every(r=>r.question===null&&r.answer===null&&r.within_bounds===false);}return rows;};return Reflect.get(target,key,receiver);}});
 await expect(indexEmbeddingSource(bounded,{profileId:f.profileId,sourceKind:'inspiration',sourceId:item.id,space:EMBEDDING_2_SPACE.id},{client:c})).rejects.toMatchObject({code:'input_too_large'});
 expect(c.embed).not.toHaveBeenCalled();expect(rowsSeen).toBe(65);expect(allSuppressed).toBe(true);expect(responseBytes).toBeLessThan(20000);expect((await t.sql`SELECT sum(length(answer))::int AS n FROM reflections WHERE inspiration_id=${item.id}`)[0].n).toBe(260000);
 console.info('[embedding-source-read-bound-fixture]',JSON.stringify({childRows:rowsSeen,decodedMetadataBytes:responseBytes,rawAnswerBytesRetainedInDB:260000,providerCalls:0}));
});
it.each(['reflection','attachment'] as const)('uses the exact child timestamp/id ordering through the bounded model2 writer after a tied %s ID moves',async kind=>{
 const f=await owner(true),[item]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${f.profileId},'Stable source words.') RETURNING id`,at='2026-11-14T12:00:00Z',low='00000000-0000-4000-8000-000000000001',high='00000000-0000-4000-8000-000000000002',last='00000000-0000-4000-8000-000000000003';
 if(kind==='reflection')await t.sql`INSERT INTO reflections(id,profile_id,inspiration_id,question,answer,created_at) VALUES(${low},${f.profileId},${item.id},'First?','First exact answer.',${at}),(${high},${f.profileId},${item.id},'Second?','Second exact answer.',${at})`;
 else await t.sql`INSERT INTO attachments(id,profile_id,inspiration_id,type,url,enrichment_status,enrichment_kind,enrichment_text,created_at) VALUES(${low},${f.profileId},${item.id},'image','https://example.test/first','ready','image_description','First exact image.',${at}),(${high},${f.profileId},${item.id},'image','https://example.test/second','ready','image_description','Second exact image.',${at})`;
 const c=client(),request={profileId:f.profileId,sourceKind:'inspiration' as const,sourceId:item.id,space:EMBEDDING_2_SPACE.id};const first=await indexEmbeddingSource(t.db,request,{client:c});
 if(kind==='reflection')await t.sql`UPDATE reflections SET id=${last} WHERE id=${low} AND profile_id=${f.profileId}`;else await t.sql`UPDATE attachments SET id=${last} WHERE id=${low} AND profile_id=${f.profileId}`;
 const second=await indexEmbeddingSource(t.db,request,{client:c});expect(second.inputHash).not.toBe(first.inputHash);expect(c.embed).toHaveBeenCalledTimes(2);
 expect(c.embed.mock.calls[1]![0].indexOf('Second exact')).toBeLessThan(c.embed.mock.calls[1]![0].indexOf('First exact'));
 expect((await t.sql`SELECT outcome,requested_version=completed_version AS done FROM embedding_index_work WHERE source_id=${item.id}`)[0]).toEqual({outcome:'current',done:true});expect((await t.sql`SELECT text FROM inspirations WHERE id=${item.id}`)[0].text).toBe('Stable source words.');
});
