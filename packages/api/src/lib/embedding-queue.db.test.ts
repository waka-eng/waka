/** WHAT THIS MOCKS, AND WHY (gate G6): global `fetch` accepts only the
 * fixed OpenRouter embedding endpoint and returns synthetic vectors;
 * `ModelProvider` supplies grounded fixtures. Actual factory, dispatcher,
 * claim/60-start budget, progress, source fences and publications execute. */
import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {getDb} from './db.js';
import {postgresBackgroundJobStore,processBackgroundJob,drainBackgroundJobs,enqueueDeriveSignals} from './queue.js';
import {EMBEDDING_2_SPACE} from './embedding-2-space.js';
import {EMBEDDING_2_CANDIDATE_POLICY} from './embedding-policy.js';
import {setDefaultModelProviderForTests,type ModelProvider} from './model-provider.js';
import {createReviewSession} from './review-sessions.js';
import {Hono} from 'hono';
import type {AuthEnv} from './middleware.js';
import {createInspirationsRoutes} from '../routes/inspirations.js';
let t:TestDatabase;const originalUrl=process.env.DB_CONNECTION_URL!,wire=vi.fn<typeof fetch>();
const extract=vi.fn(async()=>({statements:[],category:null})),review=vi.fn(async(input:any)=>({assessments:[],statements:[{statement:'I leave room to reconsider plans.',quote:input.answer}]}));
beforeAll(async()=>{t=await createTestDatabase();const url=new URL(originalUrl);url.searchParams.set('options','-c search_path='+t.schemaName);process.env.DB_CONNECTION_URL=url.toString();});
beforeEach(async()=>{await t.truncateAll();vi.stubEnv('OPENROUTER_API_KEY','SYNTHETIC_EMBEDDING_TEST_CREDENTIAL');vi.stubEnv('WAKA_BACKGROUND_JOB_AUTODRAIN','0');vi.stubEnv('WAKA_DB_POOL_MAX','1');wire.mockReset();extract.mockClear();review.mockClear();wire.mockImplementation(async(url,init)=>{if(String(url)!=='https://openrouter.ai/api/v1/embeddings')throw Error('Unexpected synthetic network boundary');const body=JSON.parse(String(init?.body));expect(body.model).toBe(EMBEDDING_2_SPACE.wireModel);expect(body.input).toMatch(/^title: none \| text: /);expect(body).not.toHaveProperty('input_type');expect(body).not.toHaveProperty('task_type');expect(body.provider).toMatchObject({only:['google-ai-studio'],allow_fallbacks:false,require_parameters:true});return Response.json({model:'gemini-embedding-2',data:[{index:0,embedding:[1,...Array<number>(767).fill(0)]}],usage:{prompt_tokens:12,total_tokens:12,cost:0.0000024}});});vi.stubGlobal('fetch',wire);setDefaultModelProviderForTests({name:'synthetic',extractSignalCandidates:extract,deriveReviewAnswer:review,judgeSignalMatch:async()=>({relation:'same'})} as unknown as ModelProvider);});
afterAll(async()=>{setDefaultModelProviderForTests(null);await getDb().$client.end();vi.unstubAllGlobals();vi.unstubAllEnvs();process.env.DB_CONNECTION_URL=originalUrl;await t?.cleanup();});
async function owner(active=true){const[a]=await t.sql`INSERT INTO accounts(email) VALUES(${randomUUID()+'@example.test'}) RETURNING id`,[p]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${a.id},'human','Synthetic') RETURNING id`;if(active)await t.sql`INSERT INTO profile_embedding_indexes(profile_id,active_space,active_epoch,active_threshold_policy) VALUES(${p.id},${EMBEDDING_2_SPACE.id},1,${EMBEDDING_2_CANDIDATE_POLICY})`;return{accountId:a.id as string,profileId:p.id as string};}
async function claimOnly(type:string){await t.sql`UPDATE background_jobs SET run_after=CASE WHEN type::text=${type} THEN now()-interval '1 second' ELSE now()+interval '1 day' END WHERE status='pending'`;const job=await postgresBackgroundJobStore.claimNext(new Date());expect(job?.type).toBe(type);return job!;}
function humanApp(f:{accountId:string;profileId:string},keyScoped=false,access:'read_only'|'read_capture'='read_capture'){
 const app=new Hono<AuthEnv>();app.route('/api/inspirations',createInspirationsRoutes({getDatabase:()=>getDb(),authMiddleware:async(c,next)=>{c.set('session',{sessionId:randomUUID(),account:{id:f.accountId,email:'synthetic@example.test'},profile:{id:f.profileId,accountId:f.accountId,type:'human',name:'Synthetic',preferredLocale:'en-US'},...(keyScoped?{keyScoped:true,keeperAccess:access}:{})});await next();}}));return app;
}
it('renews a definite failed version once through authenticated human Retry and makes one ordinary metered replacement call',async()=>{
 const f=await owner(),[source]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${f.profileId},'Exact synthetic retained human words.') RETURNING id,text`;
 const derivation=await enqueueDeriveSignals(f.profileId,source.id,'created');await t.sql`UPDATE background_jobs SET status='failed' WHERE id=${derivation.jobId}`;
 wire.mockResolvedValueOnce(Response.json({error:{code:402,message:'PRIVATE_SYNTHETIC_HTTP_ERROR'}},{status:402}));
 const first=await claimOnly('index_embedding');await expect(processBackgroundJob(first)).rejects.toMatchObject({code:'provider_refused'});await postgresBackgroundJobStore.markFailedOrPending(first,Error('Closed provider refusal'),true,new Date());
 const [before]=await t.sql`SELECT requested_version FROM embedding_index_work WHERE source_id=${source.id}`;
 const app=humanApp(f),url='/api/inspirations/'+source.id+'/processing',post=()=>app.request(url+'/retry',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({receiptId:derivation.receipt.id})});
 expect(await (await app.request(url)).json()).toMatchObject({canRetry:true});
 const clicks=await Promise.all([post(),post()]);expect(clicks.map(r=>r.status)).toEqual([202,202]);
 const [renewed]=await t.sql`SELECT requested_version FROM embedding_index_work WHERE source_id=${source.id}`;expect(BigInt(renewed.requested_version)).toBeGreaterThan(BigInt(before.requested_version));
 expect((await post()).status).toBe(202);expect((await t.sql`SELECT requested_version FROM embedding_index_work WHERE source_id=${source.id}`)[0]).toEqual(renewed);
 const replacement=await claimOnly('index_embedding');await processBackgroundJob(replacement);await postgresBackgroundJobStore.markSucceeded(replacement,null);
 expect(wire).toHaveBeenCalledTimes(2);expect(await t.sql`SELECT id FROM background_job_runs WHERE account_id=${f.accountId}`).toHaveLength(2);
 expect((await t.sql`SELECT status FROM embedding_index_attempts WHERE profile_id=${f.profileId} ORDER BY started_at`).map(r=>r.status)).toEqual(['http_failed','committed']);expect((await t.sql`SELECT text FROM inspirations WHERE id=${source.id}`)[0].text).toBe(source.text);
});
it('keeps unknown work held across human Retry and denies foreign and key-scoped bypasses',async()=>{
 const f=await owner(),foreign=await owner(),[source]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${f.profileId},'Synthetic source held after lost response.') RETURNING id`;
 const derivation=await enqueueDeriveSignals(f.profileId,source.id,'created');await t.sql`UPDATE background_jobs SET status='failed' WHERE id=${derivation.jobId}`;
 wire.mockRejectedValueOnce(Error('PRIVATE_SYNTHETIC_LOST_RESPONSE'));const first=await claimOnly('index_embedding');await expect(processBackgroundJob(first)).rejects.toMatchObject({code:'outcome_unknown'});await postgresBackgroundJobStore.markFailedOrPending(first,Error('Closed uncertain outcome'),true,new Date());
 const before=await t.sql`SELECT requested_version FROM embedding_index_work WHERE source_id=${source.id}`,url='/api/inspirations/'+source.id+'/processing',body={method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({receiptId:derivation.receipt.id})};
 const app=humanApp(f);expect(await (await app.request(url)).json()).toMatchObject({canRetry:false});expect(await (await app.request(url+'/retry',body)).json()).toMatchObject({canRetry:false});
 expect((await humanApp(foreign).request(url+'/retry',body)).status).toBe(404);
 for(const access of ['read_only','read_capture'] as const)expect((await humanApp(f,true,access).request(url+'/retry',body)).status).toBe(403);
 expect(await t.sql`SELECT requested_version FROM embedding_index_work WHERE source_id=${source.id}`).toEqual(before);expect(wire).toHaveBeenCalledOnce();expect((await t.sql`SELECT status FROM embedding_index_attempts WHERE profile_id=${f.profileId}`)[0].status).toBe('unknown');
});
it('dispatches actual public-scope fallback one call per claim and completes both scoped cells with two truthful starts',async()=>{
 const f=await owner(),[item]=await t.sql`INSERT INTO inspirations(profile_id,text,visibility) VALUES(${f.profileId},'Exact public synthetic words.','public') RETURNING id`;
 const first=await claimOnly('index_embedding');await processBackgroundJob(first);expect(await postgresBackgroundJobStore.markSucceeded(first,null)).toBe(true);expect(wire).toHaveBeenCalledOnce();
 await t.sql`UPDATE background_jobs SET run_after=now() WHERE id=${first.id}`;const second=await claimOnly('index_embedding');await processBackgroundJob(second);await postgresBackgroundJobStore.markSucceeded(second,null);expect(wire).toHaveBeenCalledTimes(2);
 expect((await t.sql`SELECT input_scope,outcome,requested_version=completed_version AS done FROM embedding_index_work WHERE source_id=${item.id} ORDER BY input_scope`)).toEqual([{input_scope:'personal',outcome:'current',done:true},{input_scope:'public',outcome:'current',done:true}]);
 expect(await t.sql`SELECT id FROM background_job_runs WHERE account_id=${f.accountId}`).toHaveLength(2);
});
it('uses the real review dispatcher, current ledger and new signal progress, then replays without another embedding',async()=>{
 const f=await owner(),[source]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${f.profileId},'A little room for something unplanned.') RETURNING id`;
 const session=(await createReviewSession(t.db as never,f.profileId,{id:randomUUID(),inspirationIds:[source.id]}))!,answerId=randomUUID();
 await t.sql`INSERT INTO review_answers(id,profile_id,session_id,question_job_id,input_hash,context_hash,question,answer,source_count) VALUES(${answerId},${f.profileId},${session.id},${randomUUID()},'synthetic','synthetic','What stayed with you?','I leave room to change my plans.',1)`;
 await t.sql`INSERT INTO review_answer_sources(profile_id,session_id,answer_id,inspiration_id,source_revision,referenced) VALUES(${f.profileId},${session.id},${answerId},${source.id},1,true)`;
 const job=await claimOnly('derive_review_answer');await processBackgroundJob(job);expect(wire).toHaveBeenCalledOnce();expect(review).toHaveBeenCalledOnce();
 const [signal]=await t.sql`SELECT statement,locked_at,id FROM signals WHERE profile_id=${f.profileId}`;expect(signal.statement).toBe('I leave room to reconsider plans.');
 expect((await t.sql`SELECT source_kind,input_scope,status FROM embedding_index_attempts WHERE profile_id=${f.profileId}`)).toEqual([{source_kind:'review_answer',input_scope:'statement',status:'committed'}]);
 expect((await t.sql`SELECT outcome,completed_version=requested_version AS done FROM embedding_index_work WHERE source_id=${signal.id}`)[0]).toEqual({outcome:'current',done:true});
 await processBackgroundJob(job);expect(wire).toHaveBeenCalledOnce();expect(review).toHaveBeenCalledOnce();expect(await t.sql`SELECT id FROM signals WHERE profile_id=${f.profileId}`).toHaveLength(1);
});
it('reuses a completed fallback in the real capture derivation and publishes one candidate without re-embedding its new signal',async()=>{
 const f=await owner(),text='A little room for something unplanned.',[source]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${f.profileId},${text}) RETURNING id`;
 const fallback=await claimOnly('index_embedding');await processBackgroundJob(fallback);await postgresBackgroundJobStore.markSucceeded(fallback,null);expect(wire).toHaveBeenCalledOnce();
 extract.mockResolvedValueOnce({statements:[{statement:'I leave room to reconsider plans.',quote:text,reason:null,relatedEvidence:[]}],category:null} as never);
 await enqueueDeriveSignals(f.profileId,source.id,'created');const job=await claimOnly('derive_signals');await processBackgroundJob(job);expect(extract).toHaveBeenCalledOnce();expect(wire).toHaveBeenCalledTimes(2);
 expect((await t.sql`SELECT source_kind,status FROM embedding_index_attempts WHERE profile_id=${f.profileId} ORDER BY started_at`)).toEqual([{source_kind:'inspiration',status:'committed'},{source_kind:'inspiration',status:'committed'}]);
 const [signal]=await t.sql`SELECT id,statement FROM signals WHERE profile_id=${f.profileId}`;expect(signal.statement).toBe('I leave room to reconsider plans.');
 expect((await t.sql`SELECT outcome,requested_version=completed_version AS done FROM embedding_index_work WHERE source_id=${signal.id}`)[0]).toEqual({outcome:'current',done:true});
});
it('keeps queue kind fairness and existing 60-start accounting with a model2 backlog',async()=>{
 const f=await owner();await t.sql`INSERT INTO inspirations(profile_id,text) SELECT ${f.profileId},'Synthetic source '||n FROM generate_series(1,100)n`;
 await t.sql`UPDATE background_jobs SET created_at=now()-interval '10 minutes',run_after=now()-interval '10 minutes' WHERE profile_id=${f.profileId}`;
 const [chat]=await t.sql`INSERT INTO background_jobs(profile_id,type,payload) VALUES(${f.profileId},'generate_conversation_reply','{}'::jsonb) RETURNING id`;
 const seen:string[]=[];let delayMs=0;
 const run=await drainBackgroundJobs({limit:2,processor:async job=>{seen.push(job.type);if(job.type==='index_embedding'){const started=performance.now();await new Promise(r=>setTimeout(r,40));delayMs+=performance.now()-started;}}});
 expect(run.claimed).toBe(2);expect(seen).toEqual(['index_embedding','generate_conversation_reply']);expect(await t.sql`SELECT id FROM background_jobs WHERE id=${chat.id} AND status='succeeded'`).toHaveLength(1);expect(delayMs).toBeGreaterThanOrEqual(35);
 // Controlled delay is a per-job sensitivity sample, not a cloud forecast.
 console.info('[embedding-fairness-fixture]',JSON.stringify({indexBacklog:100,chatClaimPosition:2,precedingIndexSlots:1,controlledDelayMs:Math.round(delayMs)}));
 // Conversation/review jobs meter actual dispatch in their own durable
 // reservation, not this cheap synthetic processor. The source claim is1.
 expect((await postgresBackgroundJobStore.usageForAccount(f.accountId,new Date(Date.now()-3600000))).startedInWindow).toBe(1);
 await t.sql`INSERT INTO background_job_runs(account_id,job_id,attempt,started_at) SELECT ${f.accountId},gen_random_uuid(),1,now()-interval '1 second' FROM generate_series(1,59)`;
 const blocked=await drainBackgroundJobs({limit:1,processor:async()=>{throw Error('Budget must prevent work');}});expect(blocked.claimed).toBe(0);expect(blocked.deferred).toBeGreaterThan(0);expect(await t.sql`SELECT id FROM background_job_runs WHERE account_id=${f.accountId}`).toHaveLength(60);expect(wire).not.toHaveBeenCalled();
});
