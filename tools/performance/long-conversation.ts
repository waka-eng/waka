/** Manual, model-free projection benchmark on an owned disposable schema.
 * Repeated and varied sources include legacy, changed and foreign proofs. */
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createTestDatabase} from '../../packages/api/test/helpers/db.js';
import {conversationMessages,conversationReplyRequests,conversations,type ConversationReference} from '../../packages/api/src/db/index.js';
import {readConversationContext,conversationHash,type ConversationSource} from '../../packages/api/src/lib/conversation-context.js';
import {projectConversationMessages} from '../../packages/api/src/lib/conversation-replies.js';
import {createConversationRoutes} from '../../packages/api/src/routes/conversations.js';
import {writeEvaluationSnapshot} from '../e2e/evaluation-journal.js';

const target=new URL(process.env.DB_CONNECTION_URL??'');
assert.ok(['127.0.0.1','localhost'].includes(target.hostname)&&/test|disposable/i.test(target.pathname));
assert.equal(target.searchParams.has('options'),false);assert.equal(process.env.WAKA_TEST_SCHEMA,undefined);
const samples=Number(process.env.WAKA_PERFORMANCE_SAMPLES??20);
assert.ok(Number.isInteger(samples)&&samples>=5&&samples<=60);
const label=process.argv.find(arg=>arg.startsWith('--label='))?.slice(8)??'baseline';assert.match(label,/^[a-z0-9-]+$/);
const largeMessages=process.argv.includes('--large-messages');
process.env.NODE_ENV='test';process.env.WAKA_BACKGROUND_JOB_AUTODRAIN='0';
delete process.env.OPENROUTER_API_KEY;delete process.env.GEMINI_API_KEY;delete process.env.WAKA_BACKGROUND_WORKER_FUNCTION;
globalThis.fetch=async()=>{throw new Error('Long-thread benchmark refuses provider network');};
const info=console.info;console.info=()=>{}; // Timing logs are not timed I/O.
let interrupted=false;process.once('SIGINT',()=>{interrupted=true;});process.once('SIGTERM',()=>{interrupted=true;});
const path=`work/performance/long-conversation-${label}-${Date.now()}.json`;
const sourceHashes=Object.fromEntries(['packages/api/src/lib/conversation-replies.ts','packages/api/src/lib/conversation-context.ts'].map(file=>[file,createHash('sha256').update(readFileSync(file)).digest('hex')]));
const results:Array<Record<string,unknown>>=[];
let cleaned=false;
const save=(complete=false)=>writeEvaluationSnapshot(path,{label,largeMessages,complete,cleaned,samples,poolMax:1,providerCalls:0,remoteWrites:0,sourceHashes,
  scope:'Real message selection/projection in one read-only transaction, no HTTP/auth or cloud latency',results});
save();const fixture=await createTestDatabase();
const ref=(source:ConversationSource):ConversationReference=>({kind:source.kind,id:source.id,hash:source.hash,quoteStart:0,quoteLength:Math.min(source.text.length,40),...(source.kind==='top_of_mind_entry'?{historical:source.historical===true}:{})});
const stats=(values:number[])=>{const ordered=[...values].sort((a,b)=>a-b);return {median:ordered[Math.floor(ordered.length/2)],p95:ordered[Math.ceil(ordered.length*.95)-1],max:ordered.at(-1)};};
try{
  const [account]=await fixture.sql`INSERT INTO accounts(email) VALUES(${randomUUID()+'@example.test'}) RETURNING id`;
  const [owner]=await fixture.sql`INSERT INTO profiles(account_id,type,name) VALUES(${account.id},'human','Synthetic long thread') RETURNING id`;
  const routes=createConversationRoutes({getDatabase:()=>fixture.db as never,authMiddleware:async(c,next)=>{
    c.set('session',{sessionId:randomUUID(),account:{id:account.id,email:'synthetic@example.test'},profile:{id:owner.id,accountId:account.id,type:'human',name:'Synthetic',preferredLocale:'en-US'}});await next();
  }});
  const [other]=await fixture.sql`INSERT INTO profiles(account_id,type,name) VALUES(${account.id},'agent','Other stack') RETURNING id`;
  const principleRows=await fixture.sql`INSERT INTO principles(profile_id,statement,type,origin,rank,locked_at)
    SELECT ${owner.id},'Synthetic guide '||i||': leave room for a small experiment.','maxim','declared',i,now() FROM generate_series(1,12) i RETURNING id`;
  await fixture.sql`INSERT INTO principles(profile_id,statement,type,origin,rank,locked_at) VALUES(${other.id},'Other-stack guide.','maxim','declared',0,now())`;
  await fixture.sql`INSERT INTO inspirations(profile_id,text,created_at) VALUES(${owner.id},'Synthetic source: I tried a small experiment.','2026-09-01T12:00:00Z')`;
  const [past]=await fixture.sql`INSERT INTO top_of_minds(profile_id,version,status,created_at) VALUES(${owner.id},1,'superseded','2026-09-01T12:00:00Z') RETURNING id`;
  const [current]=await fixture.sql`INSERT INTO top_of_minds(profile_id,version,status,created_at) VALUES(${owner.id},2,'live','2026-10-01T12:00:00Z') RETURNING id`;
  await fixture.sql`INSERT INTO top_of_mind_entries(top_of_mind_id,type,body,locked_at) VALUES(${past.id},'pattern','I prefer planning before starting.',now()),(${current.id},'pattern','I prefer a small experiment first.',now())`;
  const context=await readConversationContext(fixture.db as never,owner.id,'Compare my earlier reading with now. synthetic');
  const common=[ref(context.principles[0]),ref(context.reading.find(source=>source.historical)!),ref(context.inspirations[0])];
  const foreign=ref((await readConversationContext(fixture.db as never,other.id,'A choice.')).principles[0]);
  const [original]=await fixture.sql`SELECT id,text,created_at::text AS "recordedAt",updated_at::text AS revision FROM inspirations WHERE profile_id=${owner.id}`;
  const legacy={...common[2],hash:conversationHash(original)};
  const varied:ConversationReference[]=[];
  for(let offset=0;offset<principleRows.length;offset+=3){
    const sources=await readConversationContext(fixture.db as never,owner.id,'',principleRows.slice(offset,offset+3).map(row=>({kind:'principle',id:row.id,hash:'setup'})));
    varied.push(...sources.principles.map(ref));
  }
  assert.equal(varied.length,12);
  let recording=false,statements=0;
  let diagnosing=false;
  const diagnosticQueries:Array<{query:string;params:unknown[]}>=[];
  (fixture.sql.options as unknown as {debug:unknown}).debug=(_connection:unknown,query:string,params:unknown[])=>{
    if(recording)statements++;if(diagnosing&&query.startsWith('select'))diagnosticQueries.push({query,params});
  };
  for(const mode of ['repeated','varied'] as const)for(const length of [20,100,200]){
    if(interrupted)throw new Error('Benchmark interrupted');
    const id=randomUUID(),messages:Array<typeof conversationMessages.$inferInsert>=[],requests:Array<typeof conversationReplyRequests.$inferInsert>=[];
    const expectedAvailable:boolean[][]=[];
    for(let turn=0;turn<length/2;turn++){
      const user=randomUUID(),assistant=randomUUID();
      messages.push({id:user,profileId:owner.id,conversationId:id,position:turn*2+1,role:'user',content:largeMessages?'가'.repeat(4000):`Synthetic question ${turn+1}.`},
        {id:assistant,profileId:owner.id,conversationId:id,position:turn*2+2,role:'assistant',content:largeMessages?'나'.repeat(3000):`Synthetic answer ${turn+1}.`});
      const references=mode==='repeated'?common.map(row=>({...row})):Array.from({length:3},(_,i)=>({...varied[(turn*3+i)%varied.length]}));
      if(mode==='repeated'&&turn%3===0)references[2]={...legacy};
      const available=[true,true,true];
      if(turn%10===0){references[0]={...foreign};available[0]=false;}
      if(turn%10===1){references[1]={...references[1],hash:'changed-proof'};available[1]=false;}
      expectedAvailable.push(available);
      requests.push({id:randomUUID(),profileId:owner.id,conversationId:id,userMessageId:user,assistantMessageId:assistant,
        conversationRevision:turn*2+1,contextHash:'synthetic-long-thread',status:'ready',references,contextSources:references,finishedAt:new Date()});
    }
    await fixture.db.insert(conversations).values({id,profileId:owner.id,revision:length});
    await fixture.db.insert(conversationMessages).values(messages);await fixture.db.insert(conversationReplyRequests).values(requests);
    const read=()=>fixture.db.transaction(async tx=>{
      const rows=await tx.query.conversationMessages.findMany({where:(table,{and,eq})=>and(eq(table.profileId,owner.id),eq(table.conversationId,id)),orderBy:(table,{asc})=>asc(table.position)});
      return projectConversationMessages(tx as never,owner.id,id,rows);
    },{isolationLevel:'repeatable read',accessMode:'read only'});
    diagnosing=process.argv.includes('--diagnose')&&mode==='varied'&&length===20;
    await read();diagnosing=false;
    if(diagnosticQueries.length){
      const plans=[];
      for(const {query,params} of diagnosticQueries.splice(0)){
        const [result]=await fixture.sql.unsafe('EXPLAIN (ANALYZE,FORMAT JSON,TIMING OFF) '+query,params as never);
        const plan=result['QUERY PLAN'][0];
        plans.push({operation:query.includes('from "principles"')?'principles':query.includes('top_of_mind_entries')?'readings':'conversation',
          parameters:params.length,rows:plan.Plan['Actual Rows'],cost:plan.Plan['Total Cost'],planningMs:plan['Planning Time'],executionMs:plan['Execution Time'],jitMs:plan.JIT?.Timing?.Total??null});
      }
      console.log(JSON.stringify({diagnosticPlans:plans}));
    }
    const durations:number[]=[],queries:number[]=[],serialization:number[]=[];let digest='',jsonBytes=0;
    for(let sample=0;sample<samples;sample++){
      if(interrupted)throw new Error('Benchmark interrupted');
      recording=true;statements=0;const start=performance.now(),rows=await read();durations.push(Math.round((performance.now()-start)*100)/100);recording=false;queries.push(statements);
      assert.equal(rows.length,length);
      assert.deepEqual(rows.filter(row=>row.role==='assistant').map(row=>row.citations.map(citation=>citation.available)),expectedAvailable);
      assert.deepEqual(rows.filter(row=>row.role==='assistant').map(row=>row.memoryChanged),expectedAvailable.map(row=>row.some(value=>!value)));
      const normalized=rows.map(row=>({position:row.position,role:row.role,content:row.content,memoryChanged:row.memoryChanged,
        citations:row.citations.map(({index,kind,available,preview,historical,recordedAt})=>({index,kind,available,preview,historical,recordedAt}))}));
      const currentDigest=conversationHash(normalized);if(digest)assert.equal(currentDigest,digest);digest=currentDigest;
      const serializeStart=performance.now(),json=JSON.stringify(rows);jsonBytes=Buffer.byteLength(json);serialization.push(Math.round((performance.now()-serializeStart)*100)/100);
    }
    const response=await routes.request(`/${id}?limit=30`),page=await response.text();assert.equal(response.status,200);
    const dto=JSON.parse(page).conversation;assert.equal(dto.messages.length,Math.min(30,length));assert.equal(dto.messageWindowStart,Math.max(1,length-29));
    results.push({mode,messages:length,durationMs:stats(durations),sqlStatements:stats(queries),serializationMs:stats(serialization),jsonBytes,boundedApiBytes:Buffer.byteLength(page),boundedApiMessages:dto.messages.length,projectionDigest:digest,
      foreignAndChangedProofsRefused:true,legacyAndHistoricalProofsPreserved:mode==='repeated'?true:null});save();
  }
}finally{await fixture.cleanup();cleaned=true;console.info=info;save(results.length===6&&!interrupted);}
console.log(JSON.stringify({path,results,cleaned,providerCalls:0},null,2));
