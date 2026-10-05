/** Synthetic positive/negative protocol controls. One bounded live request. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'dotenv';
import {createOpenRouterModelProvider} from '../../packages/api/src/lib/openrouter-model-provider.js';
import {OPENROUTER_GENERATION_MODEL} from '../../packages/api/src/lib/openrouter-http.js';
import {writeEvaluationSnapshot} from './evaluation-journal.js';
assert.ok(process.argv.includes('--live'));
process.env.OPENROUTER_API_KEY=parse(await readFile('/Users/agi/nextsteps/waka/.env.local','utf8')).OPENROUTER_API_KEY;
assert.ok(process.env.OPENROUTER_API_KEY);assert.equal(OPENROUTER_GENERATION_MODEL,'deepseek/deepseek-v4.1-flash');
const input={preferredLocale:'en-US' as const,signals:[
  {id:'tools',statement:'You keep choosing local tools with portable files.'},
  {id:'family',statement:'You have protected family evenings even when extra work was offered.'},
  {id:'promises',statement:'Across work and volunteering, you keep commitments small enough to honor.'},
  {id:'decline',statement:'When schedules fill, you decline new obligations before cancelling existing promises.'},
  {id:'export',statement:'Across document sharing and tool changes, you choose data you can export and keep.'},
  {id:'understand',statement:'Across services, you choose a smaller understandable tool when platforms become opaque.'},
  {id:'exit',statement:'You repeatedly choose an easy exit over features that trap files.'},
  {id:'article1',statement:'You saved several copies of one article discussing portable tools.'},
  {id:'article2',statement:'The same article contains claims about owning data.'},
  {id:'article3',statement:'The author recommends avoiding subscriptions; you have not endorsed it.'},
],candidates:[
  {id:'added-effort',statement:'Prefer options that keep your data and time under your control, even if they cost more effort.',citedSignalIds:['tools','family','promises','decline']},
  {id:'saved-not-endorsed',statement:'Avoid subscriptions and always own your tools.',citedSignalIds:['article1','article2','article3']},
  {id:'supported-choice',statement:'Prefer tools that keep data portable and your exit easy over those that trap your files.',citedSignalIds:['export','understand','exit']},
]};
const expected=[false,false,true],path=`work/principle-grounding-eval/run-${Date.now()}.json`;
let calls=0,costUsd=0,output:unknown=null;const network=globalThis.fetch;
const save=()=>writeEvaluationSnapshot(path,{input,expected,output,calls,costUsd,maxCostUsd:.05});save();
globalThis.fetch=async(request,init)=>{
  const url=new URL(typeof request==='string'?request:request instanceof URL?request.href:request.url);
  assert.equal(url.origin,'https://openrouter.ai');const body=JSON.parse(String(init?.body));
  assert.equal(body.model,OPENROUTER_GENERATION_MODEL);assert.equal(body.max_tokens,512);assert.equal(calls++,0);save();
  const response=await network(request,init),payload=await response.clone().json() as any;
  assert.ok(response.ok&&Number.isFinite(payload.usage?.cost)&&payload.usage.cost>=0);costUsd=payload.usage.cost;save();assert.ok(costUsd<=.05);return response;
};
try{output=await createOpenRouterModelProvider().assessPrincipleGrounding(input);save();assert.deepEqual((output as {assessments:Array<{supported:boolean}>}).assessments.map(row=>row.supported),expected);console.log(JSON.stringify({path,calls,costUsd,output,pass:true}));}
finally{globalThis.fetch=network;save();}
