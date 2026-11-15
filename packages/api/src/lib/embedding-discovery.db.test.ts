/** WHAT THIS MOCKS, AND WHY (gate G6): `StatementEmbeddingClient` returns
 * controlled synthetic vectors/failures. Actual PG17 review lineage, current
 * material, policy/generation, live job claim and durable reservation run. */
import {randomUUID} from 'node:crypto';
import postgres from 'postgres';import {drizzle} from 'drizzle-orm/postgres-js';
import {sql} from 'drizzle-orm';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import * as schema from '../db/index.js';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {embedDiscoveryCandidates,commitDiscoveryEmbeddings,type DiscoveryEmbeddingInput} from './embedding-discovery.js';
import {createReviewSession} from './review-sessions.js';
import {loadReviewAnswerMaterial,assertReviewAnswerMaterial} from './review-answer-material.js';
import {readGenerationRevision,assertGenerationRevision} from './generation-revision.js';
import {reserveEmbeddingIndexAttempt} from './embedding-index-coordination.js';
import {EMBEDDING_2_SPACE} from './embedding-2-space.js';
import {PROVISIONAL_EMBEDDING_2_POLICY} from './embedding-policy.js';
import {hashEmbeddingInput} from './inspiration-embeddings.js';
let t:TestDatabase;beforeAll(async()=>{t=await createTestDatabase();});afterAll(async()=>{await t?.cleanup();});
const vector=()=>[1,...Array<number>(767).fill(0)];
async function fixture(){
 const [a]=await t.sql`INSERT INTO accounts(email) VALUES(${randomUUID()+'@example.test'}) RETURNING id`,[p]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${a.id},'human','Synthetic') RETURNING id`;
 await t.sql`INSERT INTO profile_embedding_indexes(profile_id,active_space,active_epoch,active_threshold_policy) VALUES(${p.id},${EMBEDDING_2_SPACE.id},1,${PROVISIONAL_EMBEDDING_2_POLICY})`;
 const [source]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${p.id},'A little room for something unplanned.') RETURNING id`;
 const session=(await createReviewSession(t.db as never,p.id,{id:randomUUID(),inspirationIds:[source.id]}))!,answerId=randomUUID();
 await t.sql`INSERT INTO review_answers(id,profile_id,session_id,question_job_id,input_hash,context_hash,question,answer,source_count) VALUES(${answerId},${p.id},${session.id},${randomUUID()},'synthetic','synthetic','What stayed with you?','I leave room to change my plans.',1)`;
 await t.sql`INSERT INTO review_answer_sources(profile_id,session_id,answer_id,inspiration_id,source_revision,referenced) VALUES(${p.id},${session.id},${answerId},${source.id},1,true)`;
 // The real claim writes a JS Date (millisecond precision), not a database
 // microsecond clock value that cannot round-trip through the native DTO.
 const lease=new Date().toISOString();
 const [job]=await t.sql`UPDATE background_jobs SET status='running',attempts=1,locked_at=${lease} WHERE profile_id=${p.id} AND type='derive_review_answer' RETURNING id,request_version,locked_at`;
 const material=(await loadReviewAnswerMaterial(t.db as never,p.id,answerId))!,generation=(await readGenerationRevision(t.db as never,{profileId:p.id}))!;
 const input:DiscoveryEmbeddingInput={profileId:p.id,sourceKind:'review_answer',sourceId:answerId,materialHash:material.hash,request:{jobId:job.id,requestVersion:String(job.request_version)},policy:generation.embeddingPolicy!,statements:['I leave room to reconsider plans.'],
  prove:async tx=>{await assertReviewAnswerMaterial(tx as never,material);await assertGenerationRevision(tx as never,generation,true);},
  claim:async tx=>{const rows=await tx.execute(sql`SELECT id FROM background_jobs WHERE id=${job.id}::uuid AND profile_id=${p.id}::uuid AND type='derive_review_answer' AND status='running' AND request_version=${String(job.request_version)}::bigint AND locked_at=${new Date(job.locked_at).toISOString()}::timestamptz FOR UPDATE NOWAIT`);if(rows.length!==1)throw Error('Synthetic claim changed');}};
 return {input,job,accountId:a.id as string,sourceId:source.id as string,answerId,jobId:job.id as string};
}
it('requires review-specific current/claim proofs and refuses incomplete generic reservations before HTTP',async()=>{
 const f=await fixture();await expect(reserveEmbeddingIndexAttempt(t.db,{accountId:f.accountId,profileId:f.input.profileId,requestKey:'synthetic',family:'discovery',space:EMBEDDING_2_SPACE.id,activeEpoch:1n,kind:'review_answer',sourceId:f.answerId,scope:'statement',inputHash:hashEmbeddingInput('synthetic'),inputBytes:9})).rejects.toMatchObject({code:'identity'});
 expect(await t.sql`SELECT id FROM embedding_index_attempts WHERE profile_id=${f.input.profileId}`).toHaveLength(0);
});
it.each(['edit','delete','exclude','foreign','epoch','claim'] as const)('blocks %s before candidate dispatch and rolls back its reservation',async mode=>{
 const f=await fixture(),embed=vi.fn(async()=>vector());
 if(mode==='edit')await t.sql`UPDATE review_answers SET answer='My exact changed answer.' WHERE id=${f.answerId}`;
 if(mode==='delete')await t.sql`UPDATE review_answers SET answer=NULL,question=NULL,connection=NULL,deleted_at=now() WHERE id=${f.answerId}`;
 if(mode==='exclude')await t.sql`UPDATE inspirations SET memory_excluded_at=now() WHERE id=${f.sourceId}`;
 if(mode==='foreign'){const other=await fixture();f.input.sourceId=other.answerId;}
 if(mode==='epoch')await t.sql`UPDATE profile_embedding_indexes SET active_epoch=2 WHERE profile_id=${f.input.profileId}`;
 if(mode==='claim')await t.sql`UPDATE background_jobs SET status='pending',locked_at=NULL WHERE id=${f.jobId}`;
 await expect(embedDiscoveryCandidates(t.db,f.input,{model:EMBEDDING_2_SPACE.id,embed})).rejects.toBeDefined();expect(embed).not.toHaveBeenCalled();expect(await t.sql`SELECT id FROM embedding_index_attempts WHERE profile_id=${f.input.profileId}`).toHaveLength(0);
});
it('binds generated text and order to the original dispatch group even after an unknown HTTP',async()=>{
 const f=await fixture(),embed=vi.fn(async():Promise<number[]>=>{throw Error('Synthetic unknown dispatch');});
 await expect(embedDiscoveryCandidates(t.db,f.input,{model:EMBEDDING_2_SPACE.id,embed})).rejects.toMatchObject({code:'outcome_unknown'});
 await expect(embedDiscoveryCandidates(t.db,{...f.input,statements:['Freshly generated different wording.']},{model:EMBEDDING_2_SPACE.id,embed})).rejects.toMatchObject({code:'outcome_unknown'});
 await expect(embedDiscoveryCandidates(t.db,{...f.input,statements:['An inserted first member.',...f.input.statements]},{model:EMBEDDING_2_SPACE.id,embed})).rejects.toMatchObject({code:'outcome_unknown'});expect(embed).toHaveBeenCalledOnce();
 expect((await t.sql`SELECT source_kind,input_scope,status FROM embedding_index_attempts WHERE profile_id=${f.input.profileId}`)[0]).toEqual({source_kind:'review_answer',input_scope:'statement',status:'unknown'});
});
it('does not bypass an unknown discovery dispatch with both a new legitimate request and new wording',async()=>{
 const f=await fixture(),embed=vi.fn(async():Promise<number[]>=>{throw Error('Synthetic unknown dispatch');});
 await expect(embedDiscoveryCandidates(t.db,f.input,{model:EMBEDDING_2_SPACE.id,embed})).rejects.toMatchObject({code:'outcome_unknown'});
 const [renewed]=await t.sql`UPDATE background_jobs SET request_version=request_version+1 WHERE id=${f.jobId} RETURNING request_version`;
 f.job.request_version=renewed.request_version;f.input.request.requestVersion=String(renewed.request_version);
 await expect(embedDiscoveryCandidates(t.db,{...f.input,statements:['Different candidate words on a new request.']},{model:EMBEDDING_2_SPACE.id,embed})).rejects.toMatchObject({code:'outcome_unknown'});
 expect(embed).toHaveBeenCalledOnce();expect(await t.sql`SELECT id FROM embedding_index_attempts WHERE profile_id=${f.input.profileId}`).toHaveLength(1);
});
it('holds a second real client during HTTP and atomically records the current decision without another dispatch',async()=>{
 const f=await fixture(),url=new URL(process.env.DB_CONNECTION_URL!);url.searchParams.set('options','-c search_path='+t.schemaName);const peer=postgres(url.toString(),{max:1,prepare:false,onnotice:()=>{}}),db=drizzle(peer,{schema});
 let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>{entered=r;}),hold=new Promise<void>(r=>{release=r;});const embed=vi.fn(async()=>{entered();await hold;return vector();});const first=embedDiscoveryCandidates(t.db,f.input,{model:EMBEDDING_2_SPACE.id,embed});
 try{await Promise.race([ready,first.then(()=>{throw Error('Unexpected early completion');})]);await expect(embedDiscoveryCandidates(db,f.input,{model:EMBEDDING_2_SPACE.id,embed})).rejects.toMatchObject({name:'BackgroundJobHeldError'});release();const result=await first;
  expect((await t.sql`SELECT status FROM embedding_index_attempts WHERE profile_id=${f.input.profileId}`)[0].status).toBe('received');
  await t.db.transaction(async tx=>{await f.input.prove(tx);await f.input.claim(tx);await commitDiscoveryEmbeddings(tx,f.input.profileId,result.map(row=>row.attemptId));});
  await expect(embedDiscoveryCandidates(db,f.input,{model:EMBEDDING_2_SPACE.id,embed})).rejects.toMatchObject({code:'commit_unconfirmed'});expect(embed).toHaveBeenCalledOnce();expect((await t.sql`SELECT status FROM embedding_index_attempts WHERE profile_id=${f.input.profileId}`)[0].status).toBe('committed');
 }finally{release();await first.catch(()=>{});await peer.end();}
});
it('admits the next bounded member only while this invocation retains its earlier received result',async()=>{
 const f=await fixture(),embed=vi.fn(async()=>vector()),input={...f.input,statements:[...f.input.statements,'I value leaving space for a fresh idea.']};
 const results=await embedDiscoveryCandidates(t.db,input,{model:EMBEDDING_2_SPACE.id,embed});expect(results).toHaveLength(2);expect(embed).toHaveBeenCalledTimes(2);
 await expect(embedDiscoveryCandidates(t.db,{...input,request:{...input.request,requestVersion:'2'}},{model:EMBEDDING_2_SPACE.id,embed})).rejects.toMatchObject({name:'BackgroundJobHeldError'});expect(embed).toHaveBeenCalledTimes(2);
 await t.db.transaction(async tx=>{await input.prove(tx);await input.claim(tx);await commitDiscoveryEmbeddings(tx,input.profileId,results.map(row=>row.attemptId));});
 expect((await t.sql`SELECT dispatch_family,status FROM embedding_index_attempts WHERE profile_id=${input.profileId}`)).toEqual([{dispatch_family:'discovery',status:'committed'},{dispatch_family:'discovery',status:'committed'}]);
});
