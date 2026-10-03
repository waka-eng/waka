/** WHAT THIS MOCKS, AND WHY (gate G6): `authMiddleware` supplies fixture
 * principals and `askReviewQuestion` returns a scripted model response.
 * Real queue claims, context fences, answer transactions, redaction triggers,
 * ownership, export and budgets run on disposable Postgres. No paid calls. */
import {randomUUID} from 'node:crypto';
import {Hono} from 'hono';
import {afterAll,beforeAll,beforeEach,expect,it} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {createReviewSessionRoutes} from './review-sessions.js';
import type {AuthEnv} from '../lib/middleware.js';
import {createReviewSession,chooseReviewItem,completeReviewSession} from '../lib/review-sessions.js';
import {loadReviewQuestionContext} from '../lib/review-dialogue-context.js';
import {readReviewDialogue} from '../lib/review-dialogue.js';
import {setDefaultModelProviderForTests,type ModelProvider,type ReviewQuestionInput} from '../lib/model-provider.js';
import {postgresBackgroundJobStore,processBackgroundJob} from '../lib/queue.js';
import {assembleProfileExport} from '../lib/profile-export.js';
import {getDb} from '../lib/db.js';
let t:TestDatabase,sequence=0,calls=0,focus=[1,2],during:(()=>Promise<void>)|null=null;
let inputs:ReviewQuestionInput[]=[],questionText='What would making room for the unplanned allow you to notice?';
const connectionString=process.env.DB_CONNECTION_URL!;
beforeAll(async()=>{t=await createTestDatabase();const url=new URL(connectionString);url.searchParams.set('options',`-c search_path=${t.schemaName}`);process.env.DB_CONNECTION_URL=url.toString();});
beforeEach(async()=>{await t.truncateAll();calls=0;focus=[1,2];during=null;inputs=[];questionText='What would making room for the unplanned allow you to notice?';
  setDefaultModelProviderForTests({name:'review-fixture',askReviewQuestion:async(input:ReviewQuestionInput)=>{calls+=1;inputs.push(input);await during?.();return {connection:focus.length>1?'Both leave room for something unplanned.':null,question:questionText,sourceNumbers:focus};}} as ModelProvider);});
afterAll(async()=>{setDefaultModelProviderForTests(null);await getDb().$client.end();await t?.cleanup();process.env.DB_CONNECTION_URL=connectionString;});
async function fixture(keep=2){
  const [account]=await t.sql`INSERT INTO accounts(email) VALUES (${`review-dialogue-${++sequence}@example.test`}) RETURNING id`;
  const [profile]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${account.id},'human','Reviewer') RETURNING id`;
  const ids:string[]=[];for(let i=0;i<2;i++){const [row]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES (${profile.id},${`Source ${i+1}: leave some room for the unplanned.`}) RETURNING id`;ids.push(row.id);}
  let session=(await createReviewSession(t.db as never,profile.id,{id:randomUUID(),inspirationIds:ids}))!;
  for(const sourceId of ids.slice(0,keep)) session=(await chooseReviewItem(t.db as never,profile.id,session.id,{revision:session.revision,inspirationId:sourceId,sourceRevision:'1',choice:'keep'}))!;
  const app=new Hono<AuthEnv>();app.route('/reviews',createReviewSessionRoutes({getDatabase:()=>t.db as never,authMiddleware:async(c,next)=>{c.set('session',{sessionId:randomUUID(),account:{id:account.id,email:'reviewer@example.test'},
    profile:{id:profile.id,accountId:account.id,type:'human',name:'Reviewer',preferredLocale:'en-US'}});await next();}}));
  return {app,accountId:account.id as string,profileId:profile.id as string,id:session.id,ids};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
type State=Awaited<ReturnType<typeof readReviewDialogue>>;
const body=async(response:Response)=>await response.json() as State;
const request=(f:Fixture,path:string,value:unknown,method='POST')=>f.app.request(`/reviews/${f.id}${path}`,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
const read=(f:Fixture)=>f.app.request(`/reviews/${f.id}/dialogue`);
async function generate(f:Fixture,afterAnswerId:string|null=null){
  const started=await request(f,'/question',{afterAnswerId});expect(started.status).toBe(202);
  const job=await postgresBackgroundJobStore.claimNext(new Date(Date.now()+1000));expect(job?.type).toBe('generate_review_question');
  await processBackgroundJob(job!);expect(await postgresBackgroundJobStore.markSucceeded(job!,null)).toBe(true);
  const state=await body(await read(f));expect(state.question.phase).toBe('ready');
  if(state.question.phase!=='ready')throw new Error('No ready question');return {state,question:state.question,job:job!};
}
async function answer(f:Fixture,q:Awaited<ReturnType<typeof generate>>['question'],words='My one authored thought',id=randomUUID()){
  const input={id,questionJobId:q.jobId,contextHash:q.contextHash,answer:words};
  const response=await request(f,'/answers',input);expect(response.status).toBe(200);return {id,input,state:await body(response)};
}
it('reads without generating, coalesces duplicate asks and exposes only current questions',async()=>{
  const f=await fixture();expect((await body(await read(f))).question.phase).toBe('idle');expect(calls).toBe(0);
  expect((await request(f,'/question',{afterAnswerId:null})).status).toBe(202);
  expect((await request(f,'/question',{afterAnswerId:null})).status).toBe(202);
  expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(1);expect(calls).toBe(0);
  await generate(f);
  expect((await request(f,'/question',{afterAnswerId:null,retry:true})).status).toBe(200);
  expect(calls).toBe(1);expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(1);
});
it('uses the same version fingerprint for lightweight status and full worker inputs',async()=>{
  const f=await fixture();
  async function fingerprint(){
    const full=await loadReviewQuestionContext(t.db as never,f.profileId,f.id),status=await loadReviewQuestionContext(t.db as never,f.profileId,f.id,{includeMaterial:false});
    expect(full?.input.sources).toHaveLength(2);expect(status?.input.sources).toEqual([]);expect(status?.hash).toBe(full?.hash);
    return full?.hash;
  }
  const initial=await fingerprint(),q=await generate(f),saved=await answer(f,q.question);
  const withAnswer=await fingerprint();expect(withAnswer).not.toBe(initial);
  expect((await request(f,`/answers/${saved.id}`,{revision:1,answer:'A changed view.'},'PATCH')).status).toBe(200);
  const edited=await fingerprint();expect(edited).not.toBe(withAnswer);
  await t.sql`UPDATE inspirations SET text='Current material' WHERE id=${f.ids[0]}`;
  expect(await fingerprint()).not.toBe(edited);
});
it('does not discard a ready question when a non-selected item changes between skipped and unselected',async()=>{
  const f=await fixture(1);focus=[1];const ready=await generate(f);
  let [session]=await t.sql`SELECT revision FROM review_sessions WHERE id=${f.id}`;
  await chooseReviewItem(t.db as never,f.profileId,f.id,{revision:session.revision,inspirationId:f.ids[1],sourceRevision:'1',choice:'skip'});
  [session]=await t.sql`SELECT revision FROM review_sessions WHERE id=${f.id}`;
  await chooseReviewItem(t.db as never,f.profileId,f.id,{revision:session.revision,inspirationId:f.ids[1],sourceRevision:'1',choice:null});
  expect((await body(await read(f))).question).toMatchObject({phase:'ready',jobId:ready.job.id});expect(calls).toBe(1);
});
it('stores a cross-source answer exactly once, replays it and rejects a different body or second answer to the same question',async()=>{
  const f=await fixture(),q=await generate(f),saved=await answer(f,q.question);
  expect(saved.state.answers).toHaveLength(1);expect(saved.state.answers[0].sources.filter(row=>row.referenced)).toHaveLength(2);
  expect((await request(f,'/answers',saved.input)).status).toBe(200);
  expect((await request(f,'/answers',{...saved.input,answer:'Different words'})).status).toBe(409);
  expect((await request(f,'/answers',{...saved.input,id:randomUUID()})).status).toBe(409);
  expect(await t.sql`SELECT id FROM review_answers`).toHaveLength(1);expect(await t.sql`SELECT answer_id FROM review_answer_sources`).toHaveLength(2);
  expect(await t.sql`SELECT id FROM inspirations`).toHaveLength(2);expect(await t.sql`SELECT id FROM reflections UNION ALL SELECT id FROM feedback UNION ALL SELECT id FROM signals`).toHaveLength(0);
  expect((await postgresBackgroundJobStore.usageForAccount(f.accountId,new Date(Date.now()-3600000))).startedInWindow).toBe(1);
});
it('follows the saved answer once and distinguishes focused from context-only sources',async()=>{
  const f=await fixture(),first=await generate(f),saved=await answer(f,first.question,'I disagree with the proposed connection.');
  focus=[1];questionText='What about the first inspiration would you rather explore?';
  const next=await generate(f,saved.id);expect(inputs[1].history).toEqual([{question:first.question.question,connection:first.question.connection,answer:'I disagree with the proposed connection.'}]);
  const second=await answer(f,next.question,'A thought about just that one.');
  expect(second.state.answers[1].sources).toHaveLength(2);expect(second.state.answers[1].sources.filter(row=>row.referenced)).toHaveLength(1);
});
it('redacts AI context after even an uncited source changes, preserving human words and the budget record',async()=>{
  const f=await fixture();focus=[1];questionText='What does PRIVATE_CONTEXT_SENTINEL make possible for you?';
  const q=await generate(f),saved=await answer(f,q.question,'Keep my human words.');
  await t.sql`UPDATE inspirations SET text='A replacement source' WHERE id=${f.ids[1]}`;
  const state=await body(await read(f));expect(state.answers[0]).toMatchObject({id:saved.id,question:null,connection:null,answer:'Keep my human words.',contextValid:false});
  const exported=await assembleProfileExport(t.db as never,f.profileId);expect(JSON.stringify(exported)).not.toContain('PRIVATE_CONTEXT_SENTINEL');
  expect((await t.sql`SELECT payload FROM background_jobs WHERE id=${q.job.id}`)[0].payload).toEqual({reviewContextInvalidated:true});
  expect((await postgresBackgroundJobStore.usageForAccount(f.accountId,new Date(Date.now()-3600000))).startedInWindow).toBe(1);
});
it('does not revive an older affirmation after the newer answer loses its source context',async()=>{
  const f=await fixture(1);focus=[1];const q=await generate(f),older=await answer(f,q.question,'An older affirmation.');
  const [session]=await t.sql`SELECT revision FROM review_sessions WHERE id=${f.id}`;
  await chooseReviewItem(t.db as never,f.profileId,f.id,{revision:session.revision,inspirationId:f.ids[1],sourceRevision:'1',choice:'keep'});
  focus=[1,2];const next=await generate(f,older.id);await answer(f,next.question,'A newer disagreement.');
  await t.sql`DELETE FROM inspirations WHERE id=${f.ids[1]}`;
  const context=await loadReviewQuestionContext(t.db as never,f.profileId,f.id);
  expect(context?.input.history).toEqual([]);expect(context?.historyChanged).toBe(true);
  const state=await body(await read(f));expect(state.answers.map(row=>row.answer)).toEqual(['An older affirmation.','A newer disagreement.']);
});
it('does not commit a late question after material changes during generation',async()=>{
  const f=await fixture();await request(f,'/question',{afterAnswerId:null});const job=await postgresBackgroundJobStore.claimNext(new Date(Date.now()+1000));
  during=async()=>{await t.sql`UPDATE inspirations SET text='Changed during model call' WHERE id=${f.ids[0]}`;};
  await expect(processBackgroundJob(job!)).rejects.toThrow(/inputs changed|ownership changed/);
  expect((await t.sql`SELECT payload,status FROM background_jobs WHERE id=${job!.id}`)[0]).toEqual({payload:{reviewContextInvalidated:true},status:'succeeded'});
});
it.each(['answer edit','selection change','completion'] as const)('rejects a late follow-up after %s',async change=>{
  const f=await fixture(),first=await generate(f),saved=await answer(f,first.question);
  await request(f,'/question',{afterAnswerId:saved.id});
  const job=await postgresBackgroundJobStore.claimNext(new Date(Date.now()+1000));expect(job).not.toBeNull();
  during=async()=>{
    if(change==='answer edit'){
      expect((await request(f,`/answers/${saved.id}`,{revision:1,answer:'My changed thought.'},'PATCH')).status).toBe(200);
      return;
    }
    const [session]=await t.sql`SELECT revision FROM review_sessions WHERE id=${f.id}`;
    if(change==='completion')await completeReviewSession(t.db as never,f.profileId,f.id,session.revision);
    else await chooseReviewItem(t.db as never,f.profileId,f.id,{revision:session.revision,inspirationId:f.ids[1],sourceRevision:'1',choice:'skip'});
  };
  await expect(processBackgroundJob(job!)).rejects.toThrow(/inputs changed|ownership changed/);
  const state=await body(await read(f));expect(state.question.phase).not.toBe('ready');expect(state.answers).toHaveLength(1);
  expect((await postgresBackgroundJobStore.usageForAccount(f.accountId,new Date(Date.now()-3600000))).startedInWindow).toBe(2);
});
it('does not queue questions without selected sources or after completion',async()=>{
  const f=await fixture(0);
  expect((await body(await request(f,'/question',{afterAnswerId:null}))).question.phase).toBe('empty');
  const [session]=await t.sql`SELECT revision FROM review_sessions WHERE id=${f.id}`;
  await completeReviewSession(t.db as never,f.profileId,f.id,session.revision);
  expect((await body(await request(f,'/question',{afterAnswerId:null}))).question.phase).toBe('closed');
  expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);expect(calls).toBe(0);
});
it('edits with revision fences and never resurrects a removed answer on create replay',async()=>{
  const f=await fixture(),q=await generate(f),saved=await answer(f,q.question);
  expect((await request(f,`/answers/${saved.id}`,{revision:1,answer:'Reworded thought'},'PATCH')).status).toBe(200);
  expect((await request(f,`/answers/${saved.id}`,{revision:1,answer:'Reworded thought'},'PATCH')).status).toBe(200);
  expect((await request(f,`/answers/${saved.id}`,{revision:1,answer:'Stale thought'},'PATCH')).status).toBe(409);
  expect((await body(await request(f,'/answers',saved.input))).answers[0].answer).toBe('Reworded thought');
  expect((await request(f,`/answers/${saved.id}`,{revision:2},'DELETE')).status).toBe(200);
  expect((await request(f,'/answers',saved.input)).status).toBe(410);expect((await body(await read(f))).answers).toHaveLength(0);
  expect((await request(f,`/answers/${saved.id}`,{revision:2},'DELETE')).status).toBe(200);
  expect((await t.sql`SELECT answer,question,connection,input_hash FROM review_answers WHERE id=${saved.id}`)[0]).toEqual({answer:null,question:null,connection:null,input_hash:''});
  expect((await assembleProfileExport(t.db as never,f.profileId)).reviewAnswers).toHaveLength(0);
});
it('withdraws later AI premises after an earlier answer is edited while preserving later human words',async()=>{
  const f=await fixture(),q=await generate(f),first=await answer(f,q.question,'PRIVATE_OLD_ANSWER');
  questionText='What would PRIVATE_OLD_ANSWER change in your day?';
  const follow=await generate(f,first.id),second=await answer(f,follow.question,'My later words stay.');
  expect((await request(f,`/answers/${first.id}`,{revision:1,answer:'My corrected current thought.'},'PATCH')).status).toBe(200);
  const state=await body(await read(f));expect(state.answers.find(row=>row.id===second.id)).toMatchObject({question:null,connection:null,answer:'My later words stay.',contextValid:false});
  expect(JSON.stringify(await assembleProfileExport(t.db as never,f.profileId))).not.toContain('PRIVATE_OLD_ANSWER');
  const context=await loadReviewQuestionContext(t.db as never,f.profileId,f.id);expect(context?.latestAnswerId).toBe(first.id);
  expect(context?.input.history.map(row=>row.answer)).toEqual(['My corrected current thought.']);
});
it('bounds explicit question retries and keeps each attempt as a distinct budget ledger row',async()=>{
  const f=await fixture();
  for(let attempt=0;attempt<3;attempt++){
    expect((await request(f,'/question',{afterAnswerId:null,retry:true})).status).toBe(202);
    await t.sql`UPDATE background_jobs SET status='failed',started_at=date_trunc('milliseconds',now()) WHERE type='generate_review_question'`;
  }
  expect((await request(f,'/question',{afterAnswerId:null,retry:true})).status).toBe(429);
  expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(3);
  expect((await postgresBackgroundJobStore.usageForAccount(f.accountId,new Date(Date.now()-3600000))).startedInWindow).toBe(3);
  await t.sql`UPDATE background_jobs SET created_at=now()-interval '2 hours'`;
  expect((await request(f,'/question',{afterAnswerId:null,retry:true})).status).toBe(202);expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(4);
});
it('rejects another account and exports/erases only the owner’s answers and links',async()=>{
  const f=await fixture(),q=await generate(f),saved=await answer(f,q.question),other=await fixture();
  expect((await other.app.request(`/reviews/${f.id}/dialogue`)).status).toBe(404);
  expect((await other.app.request(`/reviews/${f.id}/answers`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(saved.input)})).status).toBe(404);
  expect((await assembleProfileExport(t.db as never,other.profileId)).reviewAnswers).toHaveLength(0);
  expect((await assembleProfileExport(t.db as never,f.profileId)).reviewAnswerSources).toHaveLength(2);
  await expect(t.sql`INSERT INTO review_answer_sources(profile_id,session_id,answer_id,inspiration_id,source_revision,referenced)
    VALUES (${f.profileId},${f.id},${saved.id},${other.ids[0]},1,true)`).rejects.toMatchObject({code:'23503'});
  await expect(t.sql`INSERT INTO review_answer_sources(profile_id,session_id,answer_id,inspiration_id,source_revision,referenced)
    VALUES (${other.profileId},${other.id},${saved.id},${other.ids[0]},1,true)`).rejects.toMatchObject({code:'23503'});
  await t.sql`DELETE FROM accounts WHERE id=${f.accountId}`;
  expect(await t.sql`SELECT id FROM review_answers`).toHaveLength(0);expect(await t.sql`SELECT answer_id FROM review_answer_sources`).toHaveLength(0);
});
