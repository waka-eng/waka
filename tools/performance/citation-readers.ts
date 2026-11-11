/** Real SQL, deterministic successful/missing/mixed proofs, one local connection.
 * Run before and after reader edits; no provider or owner data is involved. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createTestDatabase} from '../../packages/api/test/helpers/db.js';
import {readConversationContext,currentConversationReferenceGroups,conversationHash,type ConversationSource,type ConversationScope} from '../../packages/api/src/lib/conversation-context.js';
import type {ConversationReference} from '../../packages/api/src/db/index.js';
import {writeEvaluationSnapshot} from '../e2e/evaluation-journal.js';

const target=new URL(process.env.DB_CONNECTION_URL??'');
assert.ok(['127.0.0.1','localhost'].includes(target.hostname)&&/test|disposable/i.test(target.pathname));
assert.equal(target.searchParams.has('options'),false);assert.equal(process.env.WAKA_TEST_SCHEMA,undefined);
const label=process.argv.find(arg=>arg.startsWith('--label='))?.slice(8)??'baseline';assert.match(label,/^[a-z0-9-]+$/);
const samples=Number(process.env.WAKA_PERFORMANCE_SAMPLES??20);assert.ok(Number.isInteger(samples)&&samples>=5&&samples<=60);
process.env.NODE_ENV='test';process.env.WAKA_BACKGROUND_JOB_AUTODRAIN='0';
delete process.env.OPENROUTER_API_KEY;delete process.env.GEMINI_API_KEY;delete process.env.WAKA_BACKGROUND_WORKER_FUNCTION;
globalThis.fetch=async()=>{throw Error('Citation benchmark refuses network');};
const info=console.info;console.info=()=>{};
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ref=(s:ConversationSource):ConversationReference=>({kind:s.kind,id:s.id,hash:s.hash,quoteStart:0,quoteLength:Math.min(40,s.text.length)});
const groups=(rows:ConversationReference[])=>Array.from({length:30},(_,n)=>rows.slice(n*3,n*3+3));
const stats=(values:number[])=>{const s=[...values].sort((a,b)=>a-b);return {median:s[Math.floor(s.length/2)],p95:s[Math.ceil(s.length*.95)-1]};};
const fixture=await createTestDatabase();
const results:Array<Record<string,unknown>>=[];
let cleaned=false;
try{
  await fixture.sql`INSERT INTO accounts(id,email) VALUES(${id(1)},'citation-owner@example.test'),(${id(2)},'citation-foreign@example.test')`;
  await fixture.sql`INSERT INTO profiles(id,account_id,type,name) VALUES(${id(3)},${id(1)},'human','Synthetic'),(${id(4)},${id(1)},'agent','Retained'),(${id(5)},${id(2)},'human','Foreign')`;
  for(const [owner,base] of [[id(3),1000],[id(4),2000],[id(5),3000]] as const){
    for(let n=0;n<90;n++)await fixture.sql`INSERT INTO inspirations(id,profile_id,text,created_at,updated_at) VALUES(${id(base+n)},${owner},${'Locked source '+n+' '+ '가'.repeat(1800)},'2026-09-01T12:00:00Z','2026-09-01T12:00:00Z')`;
  }
  await fixture.sql`INSERT INTO top_of_minds(id,profile_id,version,status,created_at) VALUES(${id(6)},${id(3)},1,'live','2026-09-01T12:00:00Z')`;
  for(let n=0;n<30;n++){
    await fixture.sql`INSERT INTO principles(id,profile_id,statement,type,origin,rank,locked_at) VALUES(${id(4000+n)},${id(3)},${'My exact wording '+n+' '+ '나'.repeat(1800)},'maxim','declared',${n},'2026-09-01T12:00:00Z')`;
    await fixture.sql`INSERT INTO top_of_mind_entries(id,top_of_mind_id,type,body,locked_at,sort_order) VALUES(${id(5000+n)},${id(6)},'pattern',${'Reading '+n+' '+ '다'.repeat(1800)},'2026-09-01T12:00:00Z',${n})`;
  }
  async function sources(owner:string,kind:ConversationReference['kind'],base:number,count:number){
    const out:ConversationSource[]=[];
    for(let n=0;n<count;n+=3){const context=await readConversationContext(fixture.db as never,owner,'',Array.from({length:Math.min(3,count-n)},(_,k)=>({kind,id:id(base+n+k),hash:'setup'})));out.push(...context.principles,...context.reading,...context.inspirations);}
    assert.equal(out.length,count);return out;
  }
  const original=await sources(id(3),'inspiration',1000,90),retained=await sources(id(4),'inspiration',2000,90),foreign=await sources(id(5),'inspiration',3000,90);
  const p=await sources(id(3),'principle',4000,30),r=await sources(id(3),'top_of_mind_entry',5000,30);
  const kinds=p.flatMap((s,n)=>[ref(s),ref(r[n]),ref(original[n])]);
  const mixed=kinds.map((s,n)=>n%9===0?ref(foreign[n]):n%9===1?{...s,hash:'changed-proof'}:n%9===2?{...s,id:id(9000+n)}:s);
  // Keep the old original-text hash representation alongside enriched proofs.
  const [legacyRow]=await fixture.sql`SELECT id,text,created_at::text AS "recordedAt",updated_at::text AS revision FROM inspirations WHERE id=${id(1003)}`;
  mixed[11]={...ref(original[3]),hash:conversationHash(legacyRow)};
  const cases:Array<{name:string;scope:ConversationScope;refs:ConversationReference[];available:number}>=[
    {name:'successful',scope:id(3),refs:original.map(ref),available:90},
    {name:'missing',scope:id(3),refs:original.map((s,n)=>({...ref(s),id:id(10000+n)})),available:0},
    {name:'kinds',scope:id(3),refs:kinds,available:90},
    {name:'mixed',scope:id(3),refs:mixed,available:61},
    {name:'retained-both',scope:{perspective:'both',personId:id(3),agentId:id(4)},refs:Array.from({length:90},(_,n)=>ref(n%2?retained[n]:original[n])),available:90},
    {name:'repeated',scope:id(3),refs:Array.from({length:90},(_,n)=>ref(original[n%3])),available:90},
  ];
  let recording=false,selects=0,statements=0;
  (fixture.sql.options as unknown as {debug:unknown}).debug=(_c:unknown,query:string)=>{if(recording){statements++;if(/^select/i.test(query))selects++;}};
  for(const scenario of cases){
    const read=()=>fixture.db.transaction(tx=>currentConversationReferenceGroups(tx as never,scenario.scope,groups(scenario.refs)),{isolationLevel:'repeatable read',accessMode:'read only'});
    await read();const times:number[]=[],counts:number[]=[],total:number[]=[];let digest='';
    for(let sample=0;sample<samples;sample++){
      recording=true;selects=0;statements=0;const start=performance.now();const output=await read();times.push(performance.now()-start);recording=false;counts.push(selects);total.push(statements);
      assert.equal(output.flat().filter(Boolean).length,scenario.available,scenario.name);
      const current=conversationHash(output);if(digest)assert.equal(current,digest);digest=current;
    }
    results.push({case:scenario.name,identities:new Set(scenario.refs.map(s=>s.kind+':'+s.id)).size,available:scenario.available,selectStatements:stats(counts),allStatements:stats(total),actualDurationMs:stats(times),outputDigest:digest});
  }
}finally{await fixture.cleanup();cleaned=true;console.info=info;}
const path=`work/performance/citations-${label}.json`;
writeEvaluationSnapshot(path,{label,poolMax:1,samples,cleaned,providerCalls:0,remoteWrites:0,simulatedStatementDelayMs:0,
  sourceHash:createHash('sha256').update(readFileSync('packages/api/src/lib/conversation-context.ts')).digest('hex'),results});
console.log(JSON.stringify({path,results},null,2));
