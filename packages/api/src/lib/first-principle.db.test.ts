/** WHAT THIS MOCKS: deterministic model decisions and embedding HTTP only.
 * Hono, migrations, worker claims and owned writes use the application. */
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import { acceptPrincipleGroundingForFixture } from '../../test/helpers/principle-grounding.js';
import { app } from '../index.js';
import { getDb } from './db.js';
import { EMBEDDING_2_SPACE } from './embedding-2-space.js';
import { loadPrincipleMaterial, reconcilePrinciplesAfterSignalLoss, refreshPrinciplesForProfile } from './principle-generation.js';
import { setDefaultModelProviderForTests, type ModelProvider } from './model-provider.js';
import { runBackgroundJobWorker } from './queue.js';
import { BackgroundJobHeldError } from './background-job-hold.js';
import { buildPrincipleDistillRequest, buildPrincipleGroundingRequest, parseDistilledPrinciples, principleDistillInstruction, PRINCIPLE_DISTILL_SYSTEM_INSTRUCTION } from '../queue/gemini.js';
import { loadPrincipleStatus } from './principle-status.js';
import { loadPrincipleViews } from '../routes/principles.js';
import { createOpenAiModelProvider } from './openai-model-provider.js';
import { principleMaterialKey } from './principle-material-key.js';
import { loadFirstPrincipleExcerpts } from './first-principle-evidence.js';

let t:TestDatabase;
const url=process.env.DB_CONNECTION_URL!;
beforeAll(async()=>{
  t=await createTestDatabase();
  const local=new URL(url);
  local.searchParams.set('options','-c search_path='+t.schemaName);
  process.env.DB_CONNECTION_URL=local.toString();
  vi.stubEnv('WAKA_BACKGROUND_JOB_AUTODRAIN','0');
  vi.stubEnv('WAKA_STAGE','development');
  vi.stubEnv('SST_RESOURCE_App','{"name":"waka","stage":"development"}');
  vi.stubEnv('WAKA_SIGNUP_ADMISSION','off');
  vi.stubEnv('PUBLIC_WEB_URL','https://dev.waka.im');
  vi.stubEnv('WAKA_ENROLL_NEW_EMPTY_HUMAN_EMBEDDING_2','1');
  vi.stubEnv('OPENROUTER_API_KEY','synthetic-first-principle-no-network');
});
afterAll(async()=>{
  setDefaultModelProviderForTests(null);vi.unstubAllGlobals();vi.unstubAllEnvs();
  if(t){await getDb().$client.end();await t.cleanup();}
  process.env.DB_CONNECTION_URL=url;
});

const choices=[
  'I rode the evening bus for a week before giving up monthly parking.',
  'I tried one reusable crate at a market before deciding to buy forty.',
];
const statements=['Try temporary transport before changing a recurring commitment.','Trial a single tool before buying supplies in bulk.'];
const directive='Try a reversible pilot before making a lasting commitment.';
function candidate(ids:string[],statement=directive) {return {statement,type:'maxim' as const,citedSignalIds:ids};}
const independent:ModelProvider['judgePrincipleRelation']=async input=>({
  relations:input.existingPrinciples.map(row=>({principleId:row.id,relation:'independent'})),
});
function model(distill:ModelProvider['distillPrinciples'],ground:ModelProvider['assessPrincipleGrounding']=acceptPrincipleGroundingForFixture){
  return {name:'first-principle-fixture',distillPrinciples:distill,assessPrincipleGrounding:ground,judgePrincipleRelation:independent} as ModelProvider;
}
async function json<T>(response:Response):Promise<T>{ return await response.json() as T; }
async function actor(){
  const response=await app.request('/api/auth/signup',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      email:randomUUID()+'@example.test',password:'synthetic-password',name:'Fixture',preferredLocale:'en-US',
    }),
  });
  expect(response.status).toBe(201);
  const signup=await json<{profile:{id:string};token:string}>(response);
  return {id:signup.profile.id,token:signup.token};
}
type Actor=Awaited<ReturnType<typeof actor>>;
const request=(a:Actor,path:string,method='GET',body?:unknown)=>app.request(path,{method,
  headers:{Authorization:'Bearer '+a.token,'Content-Type':'application/json',...(method==='POST'?{'Idempotency-Key':randomUUID()}: {})},
  ...(body===undefined?{}:{body:JSON.stringify(body)})});

it.each([
  { label:'same-domain preference', publish:true, forceProposal:false, saves:[
    'For future commute changes, I prefer taking a trial bus trip before changing my regular route.',
    'If I switch to cycling to work, I want to test it on one weekday before committing to it.',
  ] },
  { label:'saved outside advice', publish:false, forceProposal:false, saves:[
    'Bookmark from a bus guide: “Take a trial trip before changing your route.”',
    'Quote from a cycling guide: “Test the route on a weekday before committing.”',
  ] },
  { label:'one-off to-dos', publish:false, forceProposal:false, saves:[
    'Take the bus next Tuesday while my car is in the shop.',
    'Pick up my bicycle from the repair shop on Friday.',
  ] },
  { label:'an unsupported candidate from saved outside advice', publish:false, forceProposal:true, saves:[
    'Bookmark from a bus guide: “Take a trial trip before changing your route.”',
    'Quote from a cycling guide: “Test the route on a weekday before committing.”',
  ] },
])('applies the first-review bar to $label through routed saves and the worker', async ({publish,forceProposal,saves}) => {
  const a=await actor();
  const summaries=['A bus route came up as a commuting option.','Cycling came up as a commuting option.'];
  const defaultRule='When changing the commute, try the new option on one regular trip before committing.';
  let distills=0,groundings=0;
  const supportsDefault=(texts:string[])=>texts.every(text=>/I (prefer|want to)/.test(text))
    && texts.every(text=>text.includes('before'));
  setDefaultModelProviderForTests({
    ...model(async input=>{
      distills++;
      const wire=buildPrincipleDistillRequest(input);
      const instructions=wire.systemInstruction!.parts[0]!.text;
      const excerpts=input.firstSaveExcerpts!.map(row=>row.text);
      expect(excerpts.slice().sort()).toEqual(saves.slice().sort());
      expect(excerpts.every(text=>wire.contents[0]!.parts[0]!.text.includes(text))).toBe(true);
      const firstPolicy=instructions.includes('An explicitly endorsed preference') && instructions.includes('same domain');
      return {candidates:firstPolicy&&(forceProposal||supportsDefault(excerpts))?[candidate(input.signals.map(row=>row.id),defaultRule)]:[]};
    },async input=>{
      groundings++;
      const instructions=buildPrincipleGroundingRequest(input).systemInstruction!.parts[0]!.text;
      const originals=input.originals?.flatMap(row=>row.inspirationText?[row.inspirationText]:[])??[];
      return {assessments:input.candidates.map(row=>({candidateId:row.id,
        supported:row.firstPrinciple===true&&instructions.includes('An explicitly endorsed preference')&&supportsDefault(originals),
      }))};
    }),
    extractSignalCandidates:async input=>{
      const index=saves.indexOf(input.inspiration.text);
      expect(index).toBeGreaterThanOrEqual(0);
      return {category:null,statements:[{statement:summaries[index]!,quote:input.inspiration.text}]};
    },
    judgeSignalMatch:async()=>({relation:'independent'}),
  } as ModelProvider);
  vi.stubGlobal('fetch',async (input:Parameters<typeof fetch>[0],init?:RequestInit)=>{
    expect(String(input)).toBe('https://openrouter.ai/api/v1/embeddings');
    const body=JSON.parse(String(init?.body));
    const index=body.input.includes(saves[0])||body.input.includes(summaries[0])?0:1;
    return Response.json({model:EMBEDDING_2_SPACE.wireModel,data:[{index:0,embedding:Array.from({length:768},(_,i)=>Number(i===index))}]});
  });
  try {
    for(const text of saves){
      expect((await request(a,'/api/inspirations','POST',{kind:'note',text})).status).toBe(201);
      const run=await runBackgroundJobWorker({limit:50,now:new Date(Date.now()+1000),onClaimed:async job=>{
        if(job.profileId!==a.id||job.type==='refresh_top_of_mind')
          throw new BackgroundJobHeldError(new Date(Date.now()+60_000),'isolated fixture unrelated work');
      }});
      expect(run.failed).toBe(0);
    }
    expect([distills,groundings]).toEqual([1,publish||forceProposal?1:0]);
    const view=(await json<{principles:Awaited<ReturnType<typeof loadPrincipleViews>>}>(await request(a,'/api/principles'))).principles;
    if(publish){
      expect(view).toHaveLength(1);
      expect(view[0]).toMatchObject({statement:defaultRule,supportChanged:false});
      expect(view[0]!.citedSignals).toHaveLength(2);
    }else expect(view).toEqual([]);
    expect(await t.sql`SELECT id FROM top_of_minds WHERE profile_id=${a.id}`).toHaveLength(0);
  } finally {
    setDefaultModelProviderForTests(null);
    vi.unstubAllGlobals();
  }
});

it('publishes a readable Principle from two ordinary saves before the reading can run',async()=>{
  const a=await actor();
  const summaries = ['Evening buses appear in commuting experiments.', 'Reusable crates feature in market logistics.'];
  let distills=0,groundings=0;
  const modelSteps: string[] = [];
  const provider={...model(async input=>{
    distills++;
    modelSteps.push('distill');
    expect(input.firstPrinciple).toBe(true);
    expect(input.ordinaryAvailable).toBeUndefined();
    expect(input.signals.map(row=>row.statement).sort()).toEqual(summaries.slice().sort());
    const prompt = buildPrincipleDistillRequest(input).contents[0]!.parts[0]!.text;
    // The labels don't say what happened before the decision. The fixture
    // abstains unless the actual choices reach candidate generation.
    if (!choices.every(text => prompt.includes(text))) return {candidates:[]};
    for (const [index, text] of choices.entries()) {
      const signalId = input.signals.find(row => row.statement === summaries[index])!.id;
      expect(input.firstSaveExcerpts).toContainEqual({signalIds:[signalId],text,partial:false});
    }
    return {candidates:[candidate(input.signals.map(row=>row.id))]};
  },async input=>{
    groundings++;
    modelSteps.push('ground');
    expect(new Set(input.originals?.map(row=>row.inspirationText))).toEqual(new Set(choices));
    expect(input.originals?.every(row=>row.signalIds.length===1)).toBe(true);
    return acceptPrincipleGroundingForFixture(input);
  }),extractSignalCandidates:async (input:Parameters<ModelProvider['extractSignalCandidates']>[0])=>{
    const index=choices.indexOf(input.inspiration.text);
    expect(index).toBeGreaterThanOrEqual(0);
    return {category:null,statements:[{statement:summaries[index]!,quote:input.inspiration.text}]};
  },judgeSignalMatch:async()=>({relation:'independent'})} as ModelProvider;
  setDefaultModelProviderForTests(provider);
  vi.stubGlobal('fetch',async(input:Parameters<typeof fetch>[0],init?:RequestInit)=>{
    expect(String(input)).toBe('https://openrouter.ai/api/v1/embeddings');
    const body=JSON.parse(String(init?.body));
    expect(body.model).toBe(EMBEDDING_2_SPACE.wireModel);
    expect(body.dimensions).toBe(768);
    const index=body.input.includes(choices[0])||body.input.includes(summaries[0])?0:1;
    return Response.json({model:EMBEDDING_2_SPACE.wireModel,data:[{index:0,embedding:Array.from({length:768},(_,i)=>Number(i===index))}]});
  });
  const drain=()=>runBackgroundJobWorker({limit:25,now:new Date(Date.now()+1000),onClaimed:async job=>{
    // Hold the real reading job so this demonstrates independence from its result.
    if(job.type==='refresh_top_of_mind')throw new BackgroundJobHeldError(new Date(Date.now()+60_000),'isolated fixture reading held');
  }});
  try {
    const first=await request(a,'/api/inspirations','POST',{kind:'note',text:choices[0]});
    expect(first.status).toBe(201);
    const source=(await json<{inspiration:{id:string}}>(first)).inspiration.id;
    expect((await drain()).failed).toBe(0);
    expect((await json<{status:Awaited<ReturnType<typeof loadPrincipleStatus>>}>(await request(a,'/api/principles/status'))).status.eligible).toBe(false);
    expect((await request(a,'/api/inspirations','POST',{kind:'note',text:choices[1]})).status).toBe(201);
    expect((await drain()).failed).toBe(0);
    expect(await t.sql`SELECT id FROM top_of_minds WHERE profile_id=${a.id}`).toHaveLength(0);
    expect([...new Set((await t.sql`SELECT status FROM signals WHERE profile_id=${a.id}`).map(row=>row.status))]).toEqual(['emerging']);
    expect([distills,groundings]).toEqual([1,1]);
    expect(modelSteps).toEqual(['distill','ground']);
    const view=(await json<{principles:Awaited<ReturnType<typeof loadPrincipleViews>>}>(await request(a,'/api/principles'))).principles;
    expect(view).toHaveLength(1);
    expect(view[0]).toMatchObject({statement:directive,origin:'minted',state:'held',supportChanged:false});
    expect(view[0]!.citedSignals).toHaveLength(2);
    expect(new Set(view[0]!.citedSignals.flatMap(row=>row.examples?.map(example=>example.text)??[]))).toEqual(new Set(choices));
    expect((await json<{status:Awaited<ReturnType<typeof loadPrincipleStatus>>}>(await request(a,'/api/principles/status'))).status).toMatchObject({phase:'ready',eligible:true,signalCount:2,topOfMindCount:0});
    expect(await (await request(a,'/api/principles.md')).text()).toContain(directive);
    const conversationId=randomUUID();
    const opened=await request(a,'/api/conversations','POST',{id:conversationId,principleId:view[0]!.id});
    expect(opened.status).toBe(200);
    expect((await json<{conversation:unknown}>(opened)).conversation).toMatchObject({id:conversationId,initialPrincipleId:view[0]!.id});
    const context=await request(a,'/api/conversations/'+conversationId+'/context');
    expect((await json<{principles:unknown[]}>(context)).principles).toEqual(expect.arrayContaining([expect.objectContaining({id:view[0]!.id,text:directive})]));
    const foreign=await actor();
    expect((await request(foreign,'/api/principles?profile='+a.id)).status).toBe(404);

    expect((await request(a,'/api/inspirations/'+source,'DELETE')).status).toBe(200);
    expect((await json<{principles:Awaited<ReturnType<typeof loadPrincipleViews>>}>(await request(a,'/api/principles'))).principles).toEqual([]);
    await reconcilePrinciplesAfterSignalLoss(getDb(),{profileId:a.id,signalIds:[],principleIds:[view[0]!.id]});
    expect(await t.sql`SELECT id FROM principles WHERE id=${view[0]!.id}`).toHaveLength(0);
    expect((await t.sql`SELECT first_principle_id FROM profile_principle_history WHERE profile_id=${a.id}`)[0]?.first_principle_id).toBe(view[0]!.id);
  } finally {
    setDefaultModelProviderForTests(null);
    vi.unstubAllGlobals();
  }
});

async function seed(profileId:string,statement:string,text:string,source:'app'|'agent'='app',existing?:string){
  const [inspiration]=existing?[{id:existing}]:await t.sql`INSERT INTO inspirations(profile_id,text,source) VALUES(${profileId},${text},${source}) RETURNING id`;
  const [signal]=await t.sql`INSERT INTO signals(profile_id,statement,status) VALUES(${profileId},${statement},'emerging') RETURNING id`;
  await t.sql`INSERT INTO signal_evidence(profile_id,owner_profile_id,signal_id,inspiration_id) VALUES(${profileId},${profileId},${signal.id},${inspiration.id})`;
  return {signal:signal.id as string,inspiration:inspiration.id as string};
}

it('serves waiting until the current Principle review has a live claim', async () => {
  const a = await actor();
  await seed(a.id, statements[0]!, choices[0]!);
  await seed(a.id, statements[1]!, choices[1]!);
  const status = async () => {
    const response = await request(a, '/api/principles/status');
    expect(response.status).toBe(200);
    return (await json<{ status: Awaited<ReturnType<typeof loadPrincipleStatus>> }>(response)).status;
  };

  expect(await status()).toMatchObject({ phase: 'pending', eligible: true });
  const refresh = await request(a, '/api/principles/refresh', 'POST', {});
  expect(refresh.status).toBe(202);
  expect(await refresh.json()).toMatchObject({ status: { phase: 'pending', eligible: true } });
  const [job] = await t.sql`SELECT id, status FROM background_jobs
    WHERE profile_id=${a.id} AND type='refresh_principles'`;
  expect(job?.status).toBe('pending');
  expect(await status()).toMatchObject({ phase: 'pending', eligible: true });

  await t.sql`UPDATE background_jobs SET status='running', locked_at=now(), attempts=1 WHERE id=${job!.id}`;
  expect(await status()).toMatchObject({ phase: 'processing', eligible: true, supportActive: false });
  await t.sql`UPDATE background_jobs SET locked_at=now() - interval '1 hour' WHERE id=${job!.id}`;
  expect(await status()).toMatchObject({ phase: 'pending', eligible: true });
});

it('distinguishes checking support from reviewing for a Principle', async () => {
  const a = await actor();
  const { inspiration } = await seed(a.id, statements[0]!, choices[0]!);
  const [job] = await t.sql`INSERT INTO background_jobs(profile_id, type, payload)
    VALUES(${a.id}, 'review_signal_support', ${JSON.stringify({ inspirationId: inspiration })}::jsonb) RETURNING id`;
  const status = async () => {
    const response = await request(a, '/api/principles/status');
    expect(response.status).toBe(200);
    return (await json<{ status: Awaited<ReturnType<typeof loadPrincipleStatus>> }>(response)).status;
  };
  expect(await status()).toMatchObject({ phase: 'pending', eligible: false, supportPending: true, supportActive: true });
  await t.sql`UPDATE background_jobs SET status='running', locked_at=now(), attempts=1 WHERE id=${job!.id}`;
  expect(await status()).toMatchObject({ phase: 'processing', eligible: false, supportPending: true, supportActive: true });
  await t.sql`UPDATE background_jobs SET locked_at=now() - interval '1 hour' WHERE id=${job!.id}`;
  expect(await status()).toMatchObject({ phase: 'pending', supportActive: true });
});

it.each(['same source','NFKC duplicate','same wording','agent-authored'] as const)('refuses first generation for %s before any model call',async mode=>{
  const a=await actor();
  const first=await seed(a.id,'작은 실험을 먼저 고른다','ＡＢＣ — 먼저 연습!');
  await seed(a.id,mode==='same wording'?'작은 실험을 먼저 고른다!':'부담을 줄이고 먼저 해 본다',mode==='NFKC duplicate'?'abc 먼저 연습':'다른 선택을 먼저 시험했다.',
    mode==='agent-authored'?'agent':'app',mode==='same source'?first.inspiration:undefined);
  const distill=vi.fn(async()=>({candidates:[]}));
  expect((await refreshPrinciplesForProfile({profileId:a.id},{db:getDb(),modelProvider:model(distill)})).status).toBe('below_bar');
  expect(distill).not.toHaveBeenCalled();
});

it('admits distinct Korean origins, and withholds indistinguishable clipped excerpts',async()=>{
  const a=await actor();
  const korean=await seed(a.id,'소비를 줄이고 먼저 시험한다','연습 때만 작은 붓을 써 보고 큰 세트를 샀다.');
  await seed(a.id,'작은 결과를 본 다음 결정한다','무료 수업을 한 번 듣고 나서 장기 등록을 했다.');
  expect((await loadPrincipleMaterial(getDb(),a.id)).mode).toBe('first');
  await t.sql`UPDATE inspirations SET text='내용을 고친 뒤에는 새 검증이 필요하다' WHERE id=${korean.inspiration}`;
  expect((await loadPrincipleMaterial(getDb(),a.id)).mode).toBeNull();

  const b=await actor(),prefix='Common synthetic context '.repeat(25);
  await seed(b.id,'One decision exists.',prefix+'First distinct ending.');
  await seed(b.id,'Another decision exists.',prefix+'Second distinct ending.');
  const ground=vi.fn(acceptPrincipleGroundingForFixture);
  const result=await refreshPrinciplesForProfile({profileId:b.id},{db:getDb(),
    modelProvider:model(async input=>{
      expect(input.firstSaveExcerpts).toEqual([expect.objectContaining({ partial:true, signalIds:[expect.any(String)] })]);
      expect(input.firstSaveExcerpts![0]!.text).toHaveLength(280);
      return {candidates:[candidate(input.signals.map(row=>row.id))]};
    },ground)});
  expect(result).toMatchObject({minted:0,dropped:1});
  expect(ground).not.toHaveBeenCalled();
});

it('keeps ordinary prompt bytes and limits only the first-mode parser',()=>{
  expect(createHash('sha256').update(PRINCIPLE_DISTILL_SYSTEM_INSTRUCTION).digest('hex')).toBe('6d9168fea0ccee010278a0f74842015bea0fac32d7d619b1eabb49633d235309');
  expect(principleDistillInstruction({firstPrinciple:true})).toContain('A Top of Mind reading is not required');
  expect(principleDistillInstruction({firstPrinciple:true,ordinaryAvailable:true})).toContain('Prefer an ordinary candidate');
  const ordinary=candidate(['a','b','c']),pair=candidate(['a','b']);
  expect(parseDistilledPrinciples({candidates:[ordinary,pair,pair]},{firstPrinciple:true}).candidates).toEqual([pair]);
  expect(parseDistilledPrinciples({candidates:[ordinary,pair]},{firstPrinciple:true,ordinaryAvailable:true}).candidates).toEqual([ordinary,pair]);
});

async function ordinaryEvidence(profileId:string) {
  const ids:string[]=[];
  const [reading]=await t.sql`INSERT INTO top_of_minds(profile_id) VALUES(${profileId}) RETURNING id`;
  const [entry]=await t.sql`INSERT INTO top_of_mind_entries(top_of_mind_id,type,body) VALUES(${reading.id},'pattern','Current focus.') RETURNING id`;
  for(let i=0;i<3;i++){
    const first=await seed(profileId,'A distinct active observation '+i,'A distinct firsthand choice '+i+' at the start.');
    ids.push(first.signal);
    for(let n=0;n<2;n++){
      const [extra]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${profileId},${'Another distinct choice for '+i+' number '+n}) RETURNING id`;
      await t.sql`INSERT INTO signal_evidence(profile_id,owner_profile_id,signal_id,inspiration_id)
        VALUES(${profileId},${profileId},${first.signal},${extra.id})`;
    }
    await t.sql`UPDATE signals SET status='active' WHERE id=${first.signal}`;
    await t.sql`INSERT INTO top_of_mind_entry_signals(entry_id,signal_id) VALUES(${entry.id},${first.signal})`;
  }
  return ids;
}

it.each([true,false])('chooses the ordinary candidate when supported=%s from one combined evaluation',async ordinarySupported=>{
  const a=await actor(),ids=await ordinaryEvidence(a.id);
  const ordinary='Keep time in reserve before promising more work.';
  let proposed=0,checked=0;
  const provider=model(async input=>{
    proposed++;
    expect([input.firstPrinciple,input.ordinaryAvailable]).toEqual([true,true]);
    return {candidates:[candidate(ids,ordinary),candidate(ids.slice(0,2))]};
  },async input=>{
    checked++;
    expect(input.candidates).toHaveLength(2);
    expect(input.candidates.find(row=>row.statement===ordinary)?.firstPrinciple).toBeUndefined();
    expect(input.candidates.find(row=>row.statement===directive)?.firstPrinciple).toBe(true);
    return {assessments:input.candidates.map(row=>({candidateId:row.id,supported:row.statement===directive||ordinarySupported}))};
  });
  const result=await refreshPrinciplesForProfile({profileId:a.id},{db:getDb(),modelProvider:provider});
  expect(result.minted).toBe(1);
  expect([proposed,checked]).toEqual([1,1]);
  const [view]=await loadPrincipleViews(getDb(),a.id);
  expect(view?.statement).toBe(ordinarySupported?ordinary:directive);
  expect(view?.citedSignals).toHaveLength(ordinarySupported?3:2);
  const [history]=await t.sql`SELECT first_principle_id FROM profile_principle_history WHERE profile_id=${a.id}`;
  expect(history?.first_principle_id).toBe(ordinarySupported?null:view?.id);
});

it('keeps one waived mint across concurrent work and deletion, then requires ordinary evidence for the next',async()=>{
  const a=await actor();
  await seed(a.id,statements[0]!,choices[0]!);
  await seed(a.id,statements[1]!,choices[1]!);
  const provider=model(async input=>({candidates:[candidate(input.signals.map(row=>row.id))]}));
  const refresh=()=>refreshPrinciplesForProfile({profileId:a.id},{db:getDb(),modelProvider:provider});
  const results=await Promise.allSettled([refresh(),refresh()]);
  expect(results.filter(row=>row.status==='fulfilled'&&row.value.minted===1)).toHaveLength(1);
  const [first]=await loadPrincipleViews(getDb(),a.id);
  expect(first?.state).toBe('held');
  expect((await request(a,'/api/principles/'+first!.id,'DELETE')).status).toBe(200);
  expect((await refresh()).status).toBe('below_bar');
  expect((await t.sql`SELECT first_principle_id FROM profile_principle_history WHERE profile_id=${a.id}`)[0]?.first_principle_id).toBe(first!.id);

  const ids=await ordinaryEvidence(a.id);
  const ordinary=await refreshPrinciplesForProfile({profileId:a.id},{db:getDb(),modelProvider:model(async input=>{
    expect(input.firstPrinciple).toBeUndefined();
    expect(input.firstSaveExcerpts).toBeUndefined();
    return {candidates:[candidate(ids,'Make room before choosing additional work.')]};
  },async input=>{
    expect(input.candidates.every(row=>row.firstPrinciple===undefined)).toBe(true);
    return acceptPrincipleGroundingForFixture(input);
  })});
  expect(ordinary.minted).toBe(1);
  const [next]=await loadPrincipleViews(getDb(),a.id);
  expect(next?.citedSignals).toHaveLength(3);
  expect(next?.id).not.toBe(first!.id);
});

it('respects declared and human-edited history after deletion or lost support',async()=>{
  const a=await actor();
  const [declared]=await t.sql`INSERT INTO principles(profile_id,statement,rank,state,origin,locked_at)
    VALUES(${a.id},'My exact declaration.',1,'aspirational','declared',now()) RETURNING id`;
  await t.sql`DELETE FROM principles WHERE id=${declared.id}`;
  await seed(a.id,statements[0]!,choices[0]!);
  await seed(a.id,statements[1]!,choices[1]!);
  expect((await loadPrincipleMaterial(getDb(),a.id)).mode).toBeNull();

  const b=await actor();
  const evidence=await seed(b.id,statements[0]!,choices[0]!);
  await seed(b.id,statements[1]!,choices[1]!);
  const run=await refreshPrinciplesForProfile({profileId:b.id},{db:getDb(),
    modelProvider:model(async input=>({candidates:[candidate(input.signals.map(row=>row.id))]}))});
  expect(run.minted).toBe(1);
  const [first]=await loadPrincipleViews(getDb(),b.id);
  await t.sql`UPDATE principles SET statement='My exact saved wording.',locked_at=now() WHERE id=${first!.id}`;
  await t.sql`DELETE FROM inspirations WHERE id=${evidence.inspiration}`;
  const checked=await reconcilePrinciplesAfterSignalLoss(getDb(),{profileId:b.id,signalIds:[],principleIds:[first!.id]});
  expect(checked.demoted).toEqual([first!.id]);
  const [edited]=await loadPrincipleViews(getDb(),b.id);
  expect(edited).toMatchObject({statement:'My exact saved wording.',locked:true,state:'aspirational',unsupported:true,supportChanged:true});
});

it('sends seven distinct short saves across nine linked signals in the native provider request', async () => {
  const a = await actor();
  const signalByText = new Map<string, { source: string; signals: string[] }>();
  for (let i = 0; i < 9; i++) {
    const text = `I tried choice ${i % 7} on a small scale before committing time.`;
    const prior = signalByText.get(text);
    const row = await seed(a.id, `Summary of synthetic situation ${i}.`, text, 'app', prior?.source);
    if (prior) prior.signals.push(row.signal);
    else signalByText.set(text, { source: row.inspiration, signals: [row.signal] });
  }
  const [first] = signalByText.values();
  const attach = async (signalId: string, text: string, source = 'app', owner = a.id) => {
    const [row] = await t.sql`INSERT INTO inspirations(profile_id, text, source)
      VALUES(${owner}, ${text}, ${source}::inspiration_source) RETURNING id`;
    await t.sql`INSERT INTO signal_evidence(profile_id, owner_profile_id, signal_id, inspiration_id)
      VALUES(${a.id}, ${owner}, ${signalId}, ${row!.id})`;
    return row!.id as string;
  };
  await attach(first!.signals[0]!, [...signalByText.keys()][0]!.toUpperCase());
  await seed(a.id, 'A separate synthetic statement.', 'AGENT_SYNTHETIC_CANARY', 'agent');
  const foreign = await actor();
  const foreignLink = await seed(a.id, 'A mixed-owner statement.', 'MIXED_OWNER_SYNTHETIC_CANARY');
  await attach(foreignLink.signal, 'FOREIGN_SYNTHETIC_CANARY', 'app', foreign.id);

  const calls = vi.fn(async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    expect(String(url)).toBe('https://api.openai.com/v1/responses');
    const body = JSON.parse(String(init?.body));
    const schema=body.text.format.schema.properties.candidates;
    expect(schema.maxItems).toBe(1);
    expect(schema.minItems ?? 0).toBe(0);
    expect(schema.items.properties.citedSignalIds).toMatchObject({type:'array',minItems:2,maxItems:2});
    const prompt = body.input.find((row: { role: string }) => row.role === 'user').content[0].text as string;
    expect(prompt.length).toBeLessThanOrEqual(16_000);
    expect(prompt).not.toContain('SYNTHETIC_CANARY');
    const excerpts = [...prompt.matchAll(/<<<source excerpt>>>\n(.+)\n<<<end source excerpt>>>/g)]
      .map(([, row]) => JSON.parse(row!));
    expect(excerpts).toHaveLength(7);
    expect(excerpts).toEqual(expect.arrayContaining([...signalByText].map(([text, { signals }]) => ({
      text, signalIds: signals.slice().sort(), partial: false,
    }))));
    return Response.json({ status: 'completed', model: body.model, output: [{ type: 'message', role: 'assistant',
      content: [{ type: 'output_text', text: '{"candidates":[]}' }] }] });
  });
  vi.stubEnv('OPENAI_API_KEY', 'synthetic-no-network');
  vi.stubGlobal('fetch', calls);
  try {
    expect(await refreshPrinciplesForProfile({ profileId: a.id }, {
      db: getDb(), modelProvider: createOpenAiModelProvider(),
    })).toMatchObject({ status: 'no_candidates', minted: 0 });
    expect(calls).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
    vi.stubEnv('OPENAI_API_KEY', '');
  }
});

it('rechecks source ownership, edit revisions, deletion and memory exclusion at excerpt read', async () => {
  const a = await actor();
  const own = await seed(a.id, 'A current statement.', 'A current synthetic source.');
  const edited = await seed(a.id, 'A statement to edit.', 'A synthetic source to edit.');
  const excluded = await seed(a.id, 'A statement to exclude.', 'A synthetic source to exclude.');
  const deleted = await seed(a.id, 'A statement to delete.', 'A synthetic source to delete.');
  const { firstSignals } = await loadPrincipleMaterial(getDb(), a.id);
  const ids = firstSignals.map(row => row.id);
  const byId = new Map(firstSignals.map(row => [row.id, row]));
  expect(await loadFirstPrincipleExcerpts(getDb(), a.id, ids, byId)).toHaveLength(4);

  await t.sql`UPDATE inspirations SET text='Changed after selection.' WHERE id=${edited.inspiration}`;
  await t.sql`UPDATE inspirations SET memory_excluded_at=now() WHERE id=${excluded.inspiration}`;
  await t.sql`DELETE FROM inspirations WHERE id=${deleted.inspiration}`;
  expect(await loadFirstPrincipleExcerpts(getDb(), a.id, ids, byId)).toEqual([
    { signalIds:[own.signal], text:'A current synthetic source.', partial:false },
  ]);
  const foreign = await actor();
  expect(await loadFirstPrincipleExcerpts(getDb(), foreign.id, ids, byId)).toEqual([]);
});

it('lets an old empty first review be reconsidered once through ordinary request and worker deduplication', async () => {
  const a = await actor();
  await seed(a.id, statements[0]!, choices[0]!);
  await seed(a.id, statements[1]!, choices[1]!);
  const material = await loadPrincipleMaterial(getDb(), a.id);
  const v2 = createHash('sha256').update(JSON.stringify({
    policy: 'first-principle-v2', locale: material.preferredLocale, ordinary: null,
    signals: material.firstSignals.map(({id,statement,origins})=>({id,statement,origins})).sort((x,y)=>x.id.localeCompare(y.id)),
  })).digest('hex');
  const v3 = principleMaterialKey(material);
  expect(v3).not.toBe(v2);
  const [prior] = await t.sql`INSERT INTO background_jobs(profile_id, type, payload, status, idempotency_key)
    VALUES(${a.id}, 'refresh_principles', ${JSON.stringify({profileId:a.id})}::jsonb, 'succeeded', ${`refresh_principles:${a.id}:${v2}`})
    RETURNING id`;
  await t.sql`INSERT INTO principle_generation_steps(profile_id, billing_profile_id, job_id, input_hash, step_key, kind, status, response)
    VALUES(${a.id}, ${a.id}, ${prior!.id}, ${v2}, 'publication', 'publication', 'ready',
      '{"status":"no_candidates","minted":0,"attached":0,"conflicts":0,"redeemed":0,"dropped":0}'::jsonb)`;
  const distill = vi.fn(async () => ({ candidates: [] }));
  const refresh = async () => expect((await request(a, '/api/principles/refresh', 'POST', {})).status).toBe(202);
  setDefaultModelProviderForTests(model(distill));
  try {
    await refresh();
    await refresh();
    const holdUntil = new Date(Date.now() + 60_000);
    const drain = () => runBackgroundJobWorker({ limit: 80, onClaimed: async job => {
      if (job.profileId !== a.id || job.type !== 'refresh_principles') throw new BackgroundJobHeldError(holdUntil, 'unrelated isolated fixture work');
    } });
    expect((await drain()).failed).toBe(0);
    await refresh();
    expect((await drain()).failed).toBe(0);
    expect(distill).toHaveBeenCalledTimes(1);
    const jobs = await t.sql`SELECT status, idempotency_key AS key FROM background_jobs WHERE profile_id=${a.id} AND type='refresh_principles'`;
    expect(jobs).toHaveLength(2);
    expect(jobs).toEqual(expect.arrayContaining([v2, v3].map(key => ({status:'succeeded',key:`refresh_principles:${a.id}:${key}`}))));
  } finally {
    setDefaultModelProviderForTests(null);
  }
});
