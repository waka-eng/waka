/** Opt-in synthetic R05 quality checks using real review persistence, queue
 * claims and the configured provider. Never reads a user's account material. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {parse} from 'dotenv';
import {createTestDatabase} from '../../packages/api/test/helpers/db.js';

assert.ok(process.argv.includes('--live'),'Pass --live for up to five paid requests.');
const databaseUrl=new URL(process.env.DB_CONNECTION_URL??'');
assert.ok(['127.0.0.1','localhost'].includes(databaseUrl.hostname));assert.match(databaseUrl.pathname,/test|disposable/i);
assert.equal(databaseUrl.searchParams.has('options'),false);
const configured=parse(await readFile('.env.local'));
for(const key of ['OPENROUTER_API_KEY','GEMINI_API_KEY'])if(!process.env[key]&&configured[key])process.env[key]=configured[key];
assert.ok(process.env.OPENROUTER_API_KEY||process.env.GEMINI_API_KEY,'A configured model key is required');
process.env.NODE_ENV='test';process.env.WAKA_BACKGROUND_JOB_AUTODRAIN='0';
delete process.env.WAKA_BACKGROUND_WORKER_FUNCTION;delete process.env.AWS_LAMBDA_FUNCTION_NAME;
const fixture=await createTestDatabase();
databaseUrl.searchParams.set('options',`-c search_path=${fixture.schemaName}`);process.env.DB_CONNECTION_URL=databaseUrl.toString();
const {getDb}=await import('../../packages/api/src/lib/db.js');
const {createReviewSession,chooseReviewItem}=await import('../../packages/api/src/lib/review-sessions.js');
const {requestReviewQuestion,readReviewDialogue,saveReviewAnswer}=await import('../../packages/api/src/lib/review-dialogue.js');
const {loadReviewQuestionContext}=await import('../../packages/api/src/lib/review-dialogue-context.js');
const {processBackgroundJob,postgresBackgroundJobStore}=await import('../../packages/api/src/lib/queue.js');
const {getDefaultModelProvider}=await import('../../packages/api/src/lib/model-provider.js');
const {buildReviewQuestionRequest}=await import('../../packages/api/src/queue/gemini.js');
const selectedCase=process.argv.find(value=>value.startsWith('--case='))?.slice(7);
const maxCalls=selectedCase?1:5,network=globalThis.fetch;
let calls=0,reportedCostUsd=0,costReported=false;
const requests:unknown[]=[],results:unknown[]=[],failed:string[]=[];
globalThis.fetch=async(input,init)=>{
  const target=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  assert.ok(['https://openrouter.ai','https://generativelanguage.googleapis.com'].includes(target.origin));
  assert.ok(calls<maxCalls&&reportedCostUsd<.1,'Live request/cost cap reached');calls+=1;
  const started=performance.now();
  const response=await network(input,init);
  const data=await response.clone().json() as {usage?:{cost?:number};usageMetadata?:unknown;model?:string;modelVersion?:string;
    candidates?:Array<{content?:{parts?:Array<{text?:string;thought?:boolean}>}}>;
    choices?:Array<{message?:{content?:string}}>};
  if(typeof data.usage?.cost==='number'){reportedCostUsd+=data.usage.cost;costReported=true;}
  requests.push({host:target.hostname,status:response.status,model:data.model??data.modelVersion??null,durationMs:Math.round(performance.now()-started),
    usage:data.usage??data.usageMetadata??null,
    output:data.candidates?.flatMap(row=>row.content?.parts?.filter(part=>!part.thought).map(part=>part.text??'')??[])??data.choices?.map(row=>row.message?.content??'')??null});
  return response;
};
type Source={text:string;attachment?:{type:'image'|'audio';kind:'audio_transcription'|null;status:'ready'|'pending';text:string;correction?:string};reflection?:string};
const connected:Source[]=[{text:'I left a corner of the garden unfinished so my daughter could decide what to plant.'},{text:'An unscheduled Sunday gave my daughter and me room to make up our own game.'}];
const cases:Array<{name:string;locale:'en-US'|'ko-KR';sources:Source[];expectation:string}>=[
  {name:'connected',locale:'en-US',sources:connected,expectation:'One tentative concrete connection citing both experiences; one personal open question without claiming a principle.'},
  {name:'disagreement',locale:'en-US',sources:connected,expectation:'Follow the latest rejection: the daughter being included and heard matters, not an insistence on leaving things unplanned.'},
  {name:'unrelated',locale:'en-US',sources:[{text:'An eclipse occurs when Earth passes between the Sun and the Moon.'},{text:'For this curry recipe the cumin-to-coriander ratio is one to two.'}],
    expectation:'Do not manufacture a personal common thread from unrelated saved facts. Focus on one source with connection=null.'},
  {name:'Korean correction',locale:'ko-KR',sources:[{text:'',attachment:{type:'audio',kind:'audio_transcription',status:'ready',text:'매일 야근을 더 하고 싶다.',correction:'저녁에는 일을 멈추고 가족과 시간을 보내고 싶다.'},reflection:'가족과 시간을 보내고 싶은데 일을 멈추면 뒤처질까 봐 걱정돼요.'},{text:'휴대폰을 두고 가족과 저녁을 먹은 날이 기억에 남는다.'}],
    expectation:'Ask in Korean about family time and the expressed concern, never use the superseded desire for overtime as current evidence.'},
  {name:'pending image',locale:'en-US',sources:[{text:'',attachment:{type:'image',kind:null,status:'pending',text:'UNREAD_SENTINEL: a dramatic mountain summit'}}],
    expectation:'Use connection=null and one citation; ask what caught the person’s attention without inventing image contents.'},
];
let priorReady:Awaited<ReturnType<typeof readReviewDialogue>>|null=null;
let priorSession:{id:string;profileId:string}|null=null;
try{
  const selected=selectedCase?cases.filter(item=>item.name===selectedCase):cases;assert.ok(selected.length,'Unknown case');
  assert.ok(!selectedCase||selectedCase!=='disagreement','Disagreement needs the real initial question; run the complete sequence.');
  for(const item of selected){
    let session:{id:string;profileId:string},afterAnswerId:string|null=null;
    if(item.name==='disagreement'){
      if(!priorSession||priorReady?.question.phase!=='ready'){results.push({name:item.name,skipped:'No accepted initial question'});failed.push(item.name);continue;}session=priorSession;
      const answer='I do not see the connection as leaving things unplanned. I had planned both days carefully. What mattered was that my daughter could change my plan and I actually listened.';
      afterAnswerId=randomUUID();
      await saveReviewAnswer(getDb(),session.profileId,session.id,{id:afterAnswerId,questionJobId:priorReady.question.jobId,contextHash:priorReady.question.contextHash,answer});
    }else{
      await fixture.truncateAll();
      const [account]=await fixture.sql`INSERT INTO accounts(email) VALUES ('review-quality@example.test') RETURNING id`;
      const [profile]=await fixture.sql`INSERT INTO profiles(account_id,type,name,preferred_locale) VALUES (${account.id},'human','Synthetic review',${item.locale}) RETURNING id`;
      const ids:string[]=[];
      for(const material of item.sources){
        const [source]=await fixture.sql`INSERT INTO inspirations(profile_id,text) VALUES (${profile.id},${material.text}) RETURNING id`;ids.push(source.id);
        if(material.attachment){const a=material.attachment;await fixture.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,enrichment_status,enrichment_kind,enrichment_text,transcript_correction)
          VALUES (${profile.id},${source.id},${a.type},'https://example.test/synthetic',${a.status},${a.kind},${a.text},${a.correction??null})`;}
        if(material.reflection)await fixture.sql`INSERT INTO reflections(profile_id,inspiration_id,question,answer) VALUES (${profile.id},${source.id},'무엇이 마음에 남았나요?',${material.reflection})`;
      }
      let started=(await createReviewSession(getDb(),profile.id,{id:randomUUID(),inspirationIds:ids}))!;
      for(const source of started.items)started=(await chooseReviewItem(getDb(),profile.id,started.id,{revision:started.revision,inspirationId:source.inspirationId,sourceRevision:source.currentRevision,choice:'keep'}))!;
      session={id:started.id,profileId:profile.id};
    }
    const before=await loadReviewQuestionContext(getDb(),session.profileId,session.id);
    assert.ok(before);assert.ok(!JSON.stringify(before.input).includes('UNREAD_SENTINEL'));
    if(item.name==='Korean correction')assert.ok(!JSON.stringify(before.input).includes('매일 야근을 더 하고 싶다.'));
    const requested=await requestReviewQuestion(getDb(),session.profileId,session.id,afterAnswerId);assert.equal(requested.question.phase,'processing');
    const job=await postgresBackgroundJobStore.claimNext(new Date(Date.now()+1000));assert.equal(job?.type,'generate_review_question');
    const start=performance.now();let error:string|null=null;
    try{await processBackgroundJob(job!);assert.equal(await postgresBackgroundJobStore.markSucceeded(job!,null),true);}
    catch(reason){error=reason instanceof Error?reason.message:String(reason);await postgresBackgroundJobStore.markFailedOrPending(job!,reason,job!.attempts>=job!.maxAttempts,new Date());}
    const state=await readReviewDialogue(getDb(),session.profileId,session.id);
    results.push({name:item.name,expectation:item.expectation,input:before.input,
      promptHash:createHash('sha256').update(JSON.stringify(buildReviewQuestionRequest(before.input))).digest('hex'),
      question:state.question,error,durationMs:Math.round(performance.now()-start)});
    if(state.question.phase!=='ready')failed.push(item.name);
    priorReady=state;priorSession=session;
    assert.equal((await fixture.sql`SELECT count(*)::int AS count FROM signals`)[0].count,0);
  }
  assert.equal(failed.length,0,`Review question gate failed: ${failed.join(', ')}`);assert.equal(calls,selected.length);
}finally{
  const report={at:new Date().toISOString(),provider:(await getDefaultModelProvider()).name,calls,maxCalls,reportedCostUsd:costReported?reportedCostUsd:null,requests,results,
    limitations:['Synthetic material only; no actual account data','Small qualitative evaluation; semantic verdict must be recorded separately','No raw image/audio extraction or physical-device validation']};
  await mkdir('work/review-eval',{recursive:true});
  const output=`work/review-eval/${selectedCase?selectedCase.replaceAll(' ','-'):'results'}-${Date.now()}.json`;
  await writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify({output,...report}));
  globalThis.fetch=network;await fixture.cleanup();await getDb().$client.end();
}
