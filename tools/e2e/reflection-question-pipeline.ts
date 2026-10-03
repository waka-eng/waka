/** Four explicitly synthetic, paid reflection checks through the real queue.
 * Run only with --live and a disposable loopback database. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parse } from 'dotenv';
import { createTestDatabase } from '../../packages/api/test/helpers/db.js';

assert.ok(process.argv.includes('--live'), 'Pass --live for up to four paid calls.');
const url = new URL(process.env.DB_CONNECTION_URL ?? '');
assert.ok(['127.0.0.1','localhost'].includes(url.hostname)); assert.match(url.pathname,/test|disposable/i);
assert.equal(url.searchParams.has('options'),false);
const configured = parse(await readFile('.env.local'));
for (const key of ['GEMINI_API_KEY','OPENROUTER_API_KEY']) if (!process.env[key] && configured[key]) process.env[key] = configured[key];
assert.ok(process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY, 'A configured model key is required');
process.env.NODE_ENV='test'; process.env.WAKA_BACKGROUND_JOB_AUTODRAIN='0';
delete process.env.WAKA_BACKGROUND_WORKER_FUNCTION; delete process.env.AWS_LAMBDA_FUNCTION_NAME;
const fixture = await createTestDatabase();
url.searchParams.set('options',`-c search_path=${fixture.schemaName}`); process.env.DB_CONNECTION_URL=url.toString();
const {getDb} = await import('../../packages/api/src/lib/db.js');
const {enqueueReflectionQuestion,drainBackgroundJobs} = await import('../../packages/api/src/lib/queue.js');
const network=globalThis.fetch;
let calls=0,reportedCostUsd=0,costReported=false;
const selectedCase = process.argv.find(value=>value.startsWith('--case='))?.slice(7);
const usage:unknown[]=[];
const outputs:unknown[]=[];
globalThis.fetch=async(input,init)=>{
  const target=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  assert.ok(['https://openrouter.ai','https://generativelanguage.googleapis.com'].includes(target.origin));
  assert.ok(calls<(selectedCase?1:4) && reportedCostUsd<.1,'Live request/cost limit reached'); calls+=1;
  const response=await network(input,init);
  const data=await response.clone().json() as {usage?:{cost?:number};usageMetadata?:unknown;candidates?:unknown;choices?:unknown};
  if (typeof data.usage?.cost==='number') {reportedCostUsd+=data.usage.cost;costReported=true;}
  usage.push(data.usage??data.usageMetadata??null);
  // Keep only the generated text for semantic review, not opaque provider
  // signatures, hidden reasoning or unrelated response metadata.
  const candidates=data.candidates as Array<{content?:{parts?:Array<{text?:string;thought?:boolean}>}}> | undefined;
  const choices=data.choices as Array<{message?:{content?:string}}> | undefined;
  outputs.push(candidates?.flatMap(row=>row.content?.parts?.filter(part=>!part.thought).map(part=>part.text??'')??[])??choices?.map(row=>row.message?.content??'')??null);
  return response;
};
const cases=[
  {name:'link disagreement',type:'link',kind:'page_body',status:'ready',text:'This article argues that every free hour should be productive.',correction:null,
    answer:'I disagree with optimizing every minute. I want unstructured weekends, even if I achieve nothing.'},
  {name:'image interpretation',type:'image',kind:'image_description',status:'ready',text:'A small vegetable garden with one empty corner and a narrow path.',correction:null,
    answer:'The empty corner feels inviting. I like leaving room for something I have not planned yet.'},
  {name:'corrected Korean recording',type:'audio',kind:'audio_transcription',status:'ready',text:'I want to work longer every evening.',correction:'저녁에는 일을 멈추고 가족과 시간을 보내고 싶다.',
    answer:'저녁을 비워 두고 싶은데 일을 멈추면 뒤처질까 봐 걱정돼요.'},
  {name:'pending attachment',type:'image',kind:null,status:'pending',text:'UNREAD_SENTINEL: a dramatic mountain summit',correction:null,
    answer:'I cannot quite explain it yet. I just wanted to pause and notice what caught my attention.'},
];
const results:unknown[]=[];
try {
  const selected = selectedCase ? cases.filter(item=>item.name===selectedCase) : cases;
  assert.ok(selected.length,'Unknown case');
  for(const item of selected){
    await fixture.truncateAll();
    const [account]=await fixture.sql`INSERT INTO accounts(email) VALUES ('reflection-eval@example.test') RETURNING id`;
    const [profile]=await fixture.sql`INSERT INTO profiles(account_id,type,name,preferred_locale) VALUES (${account.id},'human','Synthetic reflection',${item.name.includes('Korean')?'ko-KR':'en-US'}) RETURNING id`;
    const [source]=await fixture.sql`INSERT INTO inspirations(profile_id,text) VALUES (${profile.id},'') RETURNING id`;
    await fixture.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,enrichment_status,enrichment_kind,enrichment_text,transcript_correction)
      VALUES (${profile.id},${source.id},${item.type},'https://example.test/synthetic',${item.status},${item.kind},${item.text},${item.correction})`;
    const [answer]=await fixture.sql`INSERT INTO reflections(profile_id,inspiration_id,question,answer)
      VALUES (${profile.id},${source.id},'What made you want to keep this?',${item.answer}) RETURNING id`;
    const queued=await enqueueReflectionQuestion(profile.id,source.id,answer.id);
    const start=performance.now(),drained=await drainBackgroundJobs({limit:1});
    const [job]=await fixture.sql`SELECT payload,last_error FROM background_jobs WHERE id=${queued.jobId}`;
    results.push({name:item.name,answer:item.answer,question:job.payload.question??null,error:job.last_error,durationMs:Math.round(performance.now()-start),drained});
    assert.equal(drained.succeeded,1,JSON.stringify({drained,error:job.last_error}));
    assert.equal(typeof job.payload.contextHash,'string'); assert.match(job.payload.question,/[?？]$/);
    assert.equal((await fixture.sql`SELECT answer FROM reflections WHERE id=${answer.id}`)[0].answer,item.answer);
    assert.equal((await fixture.sql`SELECT text FROM inspirations WHERE id=${source.id}`)[0].text,'');
  }
  assert.equal(calls,selected.length);
} finally {
  const report={at:new Date().toISOString(),calls,maxCalls:selectedCase?1:4,reportedCostUsd:costReported?reportedCostUsd:null,usage,outputs,results,
    limitations:['Synthetic passages, not raw image/audio extraction','Human semantic review required; no automated model-quality score','No physical-device coverage']};
  await mkdir('work/reflection-eval',{recursive:true});
  await writeFile(`work/reflection-eval/${selectedCase?selectedCase.replaceAll(' ','-'):'results'}.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report)); globalThis.fetch=network;
  await fixture.cleanup(); await getDb().$client.end();
}
