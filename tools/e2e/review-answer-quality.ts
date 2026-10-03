/** Opt-in R08 semantic checks. Only synthetic words leave this process.
 * No database is opened; production prompt builders, adapters and parsers run.
 * Structural persistence/counting is covered by the review SQL suites. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {parse} from 'dotenv';
import type {ReviewAnswerDerivationInput,ReviewAnswerDerivationResult} from '../../packages/api/src/lib/model-provider.js';

assert.ok(process.argv.includes('--live'),'Pass --live for at most ten paid requests.');
const configured=parse(await readFile('.env.local'));
for(const key of ['OPENROUTER_API_KEY','GEMINI_API_KEY'])if(!process.env[key]&&configured[key])process.env[key]=configured[key];
assert.ok(process.env.OPENROUTER_API_KEY||process.env.GEMINI_API_KEY,'A model key is required');
delete process.env.DB_CONNECTION_URL;
const {getDefaultModelProvider}=await import('../../packages/api/src/lib/model-provider.js');
const {buildReviewAnswerDerivationRequest}=await import('../../packages/api/src/queue/gemini.js');
const {classifyMatch}=await import('../../packages/api/src/lib/signal-derivation-thresholds.js');
const provider=await getDefaultModelProvider(),network=globalThis.fetch,maxCalls=10,maxCostUsd=.10;
let calls=0,costUsd=0;
const requests:unknown[]=[],results:unknown[]=[],failures:string[]=[];
globalThis.fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  assert.ok(['https://openrouter.ai','https://generativelanguage.googleapis.com'].includes(url.origin));
  assert.ok(calls<maxCalls&&costUsd<maxCostUsd,'Evaluation call/cost limit reached');calls++;
  const began=performance.now(),response=await network(input,init);
  const body=await response.clone().json() as {model?:string;modelVersion?:string;usage?:{cost?:number};
    usageMetadata?:{promptTokenCount?:number;candidatesTokenCount?:number;thoughtsTokenCount?:number};
    candidates?:Array<{content?:{parts?:Array<{text?:string;thought?:boolean}>}}>;
    choices?:Array<{message?:{content?:string}}>};
  const usage=body.usageMetadata;
  // Standard text rates checked against Google's pricing page on 2026-10-03;
  // bill cached input at the full rate so this estimate is conservative.
  const estimated=response.ok&&provider.name==='gemini'&&body.modelVersion?.startsWith('gemini-3.1-flash-lite')&&usage
    ?((usage.promptTokenCount??0)*.25+((usage.candidatesTokenCount??0)+(usage.thoughtsTokenCount??0))*1.5)/1e6:null;
  const cost=typeof body.usage?.cost==='number'?body.usage.cost:estimated;
  requests.push({status:response.status,host:url.hostname,model:body.model??body.modelVersion??null,
    durationMs:Math.round(performance.now()-began),usage:body.usage??usage??null,costUsd:cost,
    costBasis:typeof body.usage?.cost==='number'?'reported':estimated!==null?'estimated_standard_text':null,
    output:body.candidates?.flatMap(row=>row.content?.parts?.filter(part=>!part.thought).map(part=>part.text??'')??[])??body.choices?.map(row=>row.message?.content??'')??null});
  if(cost!==null)costUsd+=cost;
  assert.ok(!response.ok||cost!==null,'Unpriced response; stop before spending more');
  assert.ok(costUsd<=maxCostUsd,'Evaluation cost limit exceeded');
  return response;
};
const claimId='11111111-1111-4111-8111-111111111111';
const source=(text:string):ReviewAnswerDerivationInput['sources'][number]=>({text,reflections:[],attachments:[]});
type Case={name:string;answer:string;question:string;locale?:'en-US'|'ko-KR';sources:ReviewAnswerDerivationInput['sources'];claim?:string;expected:'positive'|'temporary'|'rejection'|'changed'|'none'|'korean';expectation:string};
const cases:Case[]=[
  {name:'one-origin-repeated',expected:'positive',answer:'I want to protect one quiet morning each week so I can finish one piece of work without switching tasks.',
    question:'What did the recording and reflection help you notice?',sources:[{text:'One quiet morning helped me finish my drawing.',
      reflections:[{question:'What mattered?',answer:'One quiet morning helped me finish my drawing.'}],
      attachments:[{type:'audio',status:'ready',kind:'audio_transcription',text:'One quiet morning helped me finish my drawing.'}]}],
    expectation:'Read the stated wish for a quiet morning and focused work. Do not invent several independent experiences from the repeated original.'},
  {name:'quoted-but-rejected',expected:'rejection',answer:'The article says "work must always come before family." I disagree. I stop working at six because I want to be present at dinner with my children.',
    question:'Does the article describe your priorities?',sources:[source('Article: work must always come before family.')],claim:'I put work ahead of family.',
    expectation:'Withdraw the work-first claim. New statements must preserve the rejection and the stated family-time preference.'},
  {name:'temporary-interest',expected:'temporary',answer:'I am trying pottery this October because a friend invited me. I do not know if I will keep doing it; this is a short experiment, not a guiding principle for my life.',
    question:'What would you like to explore?',sources:[source('A beginner pottery workshop next Saturday.')],
    expectation:'At most a current, explicitly time-limited interest in trying pottery. Do not turn this into an enduring preference for creativity or hands-on living.'},
  {name:'changed-experience',expected:'changed',answer:'I used to plan every hour of my weekends. After an unplanned walk last Sunday, I no longer want such a strict schedule. For now I want to leave Sunday mornings open.',
    question:'What changed for you?',sources:[source('Last year I planned every hour of my weekends.'),source('Last Sunday I enjoyed a walk with no route.')],claim:'I want to plan every hour of my weekends.',
    expectation:'Withdraw the current strict-schedule claim. New wording must keep the change and the present Sunday-morning scope, without erasing the past.'},
  {name:'ai-suggestion-only',expected:'none',answer:'I am not sure. That is your suggestion; I have not said that it describes me.',
    question:'Maybe deep down you value community above everything else?',sources:[source('A photograph of people in a public square.')],
    expectation:'No new personal statement. The AI suggestion and saved photograph do not establish the person’s values.'},
  {name:'korean-correction',expected:'korean',locale:'ko-KR',answer:'예전에는 야근을 많이 하는 게 성실함이라고 생각했어요. 지금은 아니에요. 이번 달부터 저녁 여섯 시에는 일을 멈추고 가족과 밥을 먹고 싶어요.',
    question:'지금은 무엇을 다르게 해보고 싶나요?',sources:[source('예전 메모: 야근을 많이 해야 성실한 사람이다.')],claim:'나는 야근을 많이 하는 것을 성실함의 기준으로 삼는다.',
    expectation:'Withdraw the current overtime-as-diligence claim. New Korean wording should preserve the change, family dinner and intended six-o’clock boundary.'},
];

async function derive(item:Case,discover:boolean){
  const input:ReviewAnswerDerivationInput={preferredLocale:item.locale??'en-US',answer:item.answer,question:item.question,
    contextChanged:false,sources:item.sources,claims:discover||!item.claim?[]:[{signalId:claimId,statement:item.claim}],discover};
  let output:ReviewAnswerDerivationResult|null=null,error:string|null=null;
  try{
    output=await provider.deriveReviewAnswer(input);
    if(!discover)assert.equal(output.assessments[0]?.verdict,'unsupported');
    else if(item.expected==='none')assert.equal(output.statements.length,0);
    else if(item.expected==='positive'||item.expected==='rejection'||item.expected==='changed'||item.expected==='korean')assert.ok(output.statements.length>0,'Expected grounded human wording');
  }catch(reason){error=reason instanceof Error?reason.message:String(reason);failures.push(`${item.name}:${discover?'discovery':'support'}`);}
  const row={name:item.name,stage:discover?'discovery':'support',expectation:item.expectation,input,
    promptHash:createHash('sha256').update(JSON.stringify(buildReviewAnswerDerivationRequest(input))).digest('hex'),output,error,semanticReview:'pending'};
  results.push(row);console.log(JSON.stringify(row));
}
try{
  for(const item of cases){if(item.claim)await derive(item,false);await derive(item,true);}
  const input={preferredLocale:'en-US' as const,candidateStatement:'I am trying pottery this October as a short experiment.',existingStatement:'Creativity is the guiding principle behind my decisions.'};
  let relation:unknown=null,error:string|null=null;
  try{relation=await provider.judgeSignalMatch(input);assert.equal((relation as {relation:string}).relation,'independent');}
  catch(reason){error=reason instanceof Error?reason.message:String(reason);failures.push('temporary-versus-durable-judge');}
  results.push({name:'temporary-versus-durable-judge',input,output:relation,error,
    expectation:'A short trial does not establish the enduring choice criterion. These statements must remain independent.',
    fixedHighSimilarityControl:{cosine:.99,rawDecision:classifyMatch(.99)},semanticReview:'pending'});
  assert.equal(failures.length,0,`Structural evaluation failures: ${failures.join(', ')}`);
}finally{
  globalThis.fetch=network;
  const report={at:new Date().toISOString(),provider:provider.name,calls,maxCalls,costUsd,maxCostUsd,failures,requests,results,
    pricingSource:'https://ai.google.dev/gemini-api/docs/pricing#gemini-3.1-flash-lite',
    limitations:['Synthetic text only; no database or account data','Qualitative semantic review is required in addition to parser/assertion success','No live embedding, audio transcription or image interpretation in this run']};
  await mkdir('work/review-eval',{recursive:true});const path=`work/review-eval/review-answer-${Date.now()}.json`;
  await writeFile(path,JSON.stringify(report,null,2));console.log(JSON.stringify({path,provider:report.provider,calls,costUsd,failures}));
}
