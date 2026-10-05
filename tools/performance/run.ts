/** Disposable current-build performance probe. No remote DB or model calls.
 * Only synthetic fixtures are mutated; shutdown drops this exact test schema. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {gzipSync,brotliCompressSync} from 'node:zlib';
import {createTestDatabase} from '../../packages/api/test/helpers/db.js';
import {searchCases} from './search-cases.js';

const configured=new URL(process.env.DB_CONNECTION_URL??'');
assert.ok(['localhost','127.0.0.1'].includes(configured.hostname));assert.match(configured.pathname,/(?:^|[_/\-])(test|disposable)(?:$|[_\-])/i);assert.equal(configured.searchParams.has('options'),false);
const sizes=(process.env.WAKA_PERFORMANCE_SIZES??'25,250,2000,10000').split(',').map(Number);
const samples=Number(process.env.WAKA_PERFORMANCE_SAMPLES??30),port=Number(process.env.WAKA_PERFORMANCE_PORT??3017);
assert.ok(sizes.length<=4&&sizes.every(n=>Number.isInteger(n)&&n>=3&&n<=10000)&&new Set(sizes).size===sizes.length);
assert.ok(Number.isInteger(samples)&&samples>=5&&samples<=60);assert.ok(Number.isInteger(port)&&port>1024&&port<65536);
const outputDir=resolve(process.env.WAKA_PERFORMANCE_OUTPUT??'work/performance');await mkdir(outputDir,{recursive:true});
const searchCorpus=process.env.WAKA_PERFORMANCE_SEARCH_CORPUS==='1';
process.env.NODE_ENV='test';process.env.JWT_SECRET='disposable-performance-probe-only';
process.env.WAKA_BACKGROUND_JOB_AUTODRAIN='0';process.env.WAKA_CONVERSATION_REPLIES='0';
delete process.env.OPENROUTER_API_KEY;delete process.env.GEMINI_API_KEY;delete process.env.AWS_LAMBDA_FUNCTION_NAME;delete process.env.WAKA_BACKGROUND_WORKER_FUNCTION;
globalThis.fetch=async()=>{throw new Error('Performance fixture refuses provider network');};
const fixture=await createTestDatabase();configured.searchParams.set('options',`-c search_path=${fixture.schemaName}`);process.env.DB_CONNECTION_URL=configured.toString();
console.log(JSON.stringify({stage:'allocated',schema:fixture.schemaName}));
let server:ReturnType<typeof createServer>|null=null,closing=false,stopDatabase:(()=>Promise<unknown>)|null=null;
let workerStop=false,workerRun:Promise<void>|null=null,workerIterations=0,workerResult:unknown=null;
async function close(code=0){
  if(closing)return;closing=true;
  workerStop=true;await workerRun;
  if(server){server.closeAllConnections();await new Promise<void>(done=>server!.close(()=>done()));}
  await stopDatabase?.();await fixture.cleanup();process.exit(code);
}
process.once('SIGTERM',()=>void close());process.once('SIGINT',()=>void close());
process.once('uncaughtException',error=>{console.error(error.message);void close(1);});
const importStart=performance.now();const {app}=await import('../../packages/api/src/index.js');const apiImportMs=performance.now()-importStart;
const {signSessionToken,buildSessionCookie}=await import('../../packages/api/src/lib/auth.js');
const {createSessionRow}=await import('../../packages/api/src/lib/session.js');
const {getDb}=await import('../../packages/api/src/lib/db.js');
const {createGroupForProfile}=await import('../../packages/api/src/routes/groups-membership.js');
const {readConversationContext}=await import('../../packages/api/src/lib/conversation-context.js');
const {createReviewSession,completeReviewSession,readActiveReview}=await import('../../packages/api/src/lib/review-sessions.js');
const {drainBackgroundJobs}=await import('../../packages/api/src/lib/queue.js');
const {loadInspirationMaterial,assertMaterialCurrent}=await import('../../packages/api/src/lib/inspiration-material.js');
const db=getDb();const fixtures=new Map<number,{id:string;token:string;firstId:string;signalId:string;groups:string[];signals:number;principles:number}>();
stopDatabase=()=>db.$client.end();
for(const count of sizes){
  const [account]=await fixture.sql`INSERT INTO accounts(email,onboarding_completed_at) VALUES (${`performance-${count}@example.test`},now()) RETURNING id`;
  const [profile]=await fixture.sql`INSERT INTO profiles(account_id,type,name) VALUES (${account.id},'human',${`Synthetic ${count} inspirations`}) RETURNING id`;
  await fixture.sql`INSERT INTO inspirations(profile_id,text,created_at)
    SELECT ${profile.id},'Synthetic performance inspiration '||i||'. I want space for walking and thoughtful experiments. '||repeat('A calm morning gives me room to notice an idea before turning it into a task. ',4)
      ||CASE WHEN ${searchCorpus} AND i%7=0 THEN ' 여백 생각 느긋한 하루.' ELSE '' END
      ||CASE WHEN ${searchCorpus} AND i=${count} THEN ' marmalade 한낮의별빛 literal%_! anchor' ELSE '' END,
      now()-i*interval '1 hour' FROM generate_series(1,${count}::int) i`;
  await fixture.sql`INSERT INTO reflections(profile_id,inspiration_id,question,answer,skipped)
    SELECT ${profile.id},id,'Why did you keep this?',
      CASE WHEN ${searchCorpus} AND rn=4 THEN 'SKIPPED_SENTINEL'
        ELSE 'Synthetic reflection: space to think is important to me.'||CASE WHEN ${searchCorpus} AND rn=8 THEN ' rare reflection mark' ELSE '' END END,
      ${searchCorpus} AND rn=4
      FROM (SELECT id,row_number() OVER(ORDER BY created_at DESC) rn FROM inspirations WHERE profile_id=${profile.id}) x WHERE rn%4=0`;
  await fixture.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,name,title,enrichment_status,enrichment_kind,enrichment_text,transcript_correction)
    SELECT ${profile.id},id,
      (CASE WHEN ${searchCorpus} AND rn IN (5,10) THEN 'audio' WHEN ${searchCorpus} AND rn%25=0 THEN 'image' ELSE 'link' END)::attachment_type,
      CASE WHEN ${searchCorpus} AND (rn IN (5,10) OR rn%25=0) THEN 'https://storage.test/private-object/'||rn ELSE 'https://example.test/synthetic/'||rn END,
      CASE WHEN ${searchCorpus} AND rn%25=0 THEN 'synthetic-photo.jpg' ELSE NULL END,
      'Synthetic source',
      (CASE WHEN ${searchCorpus} AND rn IN (5,10) THEN 'failed' ELSE 'ready' END)::attachment_enrichment_status,
      (CASE WHEN ${searchCorpus} AND rn IN (5,10) THEN 'audio_transcription' WHEN ${searchCorpus} AND rn%25=0 THEN 'image_description' ELSE 'page_body' END)::attachment_enrichment_kind,
      CASE WHEN ${searchCorpus} AND rn IN (5,10) THEN 'Superseded machine text' WHEN ${searchCorpus} AND rn%25=0 THEN '사진 속 작은 정원' ELSE repeat('Synthetic article text. ',50) END,
      CASE WHEN ${searchCorpus} AND rn IN (5,10) THEN '고친 목소리 garden' ELSE NULL END
      FROM (SELECT id,row_number() OVER(ORDER BY created_at DESC) rn FROM inspirations WHERE profile_id=${profile.id}) x WHERE rn%5=0`;
  const signalCount=count===25?4:count===250?16:64;
  const signalRows=await fixture.sql`INSERT INTO signals(profile_id,statement,status,confidence,created_at,last_evidence_at)
    SELECT ${profile.id},'Synthetic pattern '||i||': I leave space to explore before committing.','emerging',85,now()-interval '30 days',now() FROM generate_series(1,${signalCount}::int) i RETURNING id`;
  await fixture.sql`INSERT INTO signal_evidence(profile_id,owner_profile_id,signal_id,inspiration_id,statement_revision,material_revision)
    SELECT ${profile.id},${profile.id},s.id,i.id,1,r.personal_revision FROM signals s
    CROSS JOIN (SELECT id FROM inspirations WHERE profile_id=${profile.id} ORDER BY created_at DESC LIMIT 3) i
    JOIN inspiration_revisions r ON r.inspiration_id=i.id AND r.profile_id=${profile.id} WHERE s.profile_id=${profile.id}`;
  await fixture.sql`UPDATE signals SET status='active' WHERE profile_id=${profile.id}`;
  const principleCount=count===25?3:count===250?6:12;
  const principleRows=await fixture.sql`INSERT INTO principles(profile_id,statement,type,origin,rank,locked_at)
    SELECT ${profile.id},'Synthetic principle '||i||': Try a small experiment before a large commitment.','maxim','declared',i-1,now() FROM generate_series(1,${principleCount}::int) i RETURNING id`;
  for(const p of principleRows)await fixture.sql`INSERT INTO principle_signals(profile_id,principle_id,signal_id,statement_revision,principle_statement_revision)
    SELECT ${profile.id},${p.id},id,1,1 FROM signals WHERE profile_id=${profile.id} ORDER BY id LIMIT 3`;
  const [reading]=await fixture.sql`INSERT INTO top_of_minds(profile_id) VALUES (${profile.id}) RETURNING id`;
  const [entry]=await fixture.sql`INSERT INTO top_of_mind_entries(top_of_mind_id,type,body,sort_order) VALUES (${reading.id},'pattern','Synthetic reading: leave space for thoughtful experiments.',0) RETURNING id`;
  await fixture.sql`INSERT INTO top_of_mind_entry_signals(entry_id,signal_id,statement_revision,entry_body_revision) VALUES (${entry.id},${signalRows[0].id},1,1)`;
  const groups:string[]=[];
  if(count===2000)for(let i=0;i<12;i++)groups.push((await createGroupForProfile(fixture.db as never,{profileId:profile.id,name:`Synthetic room ${i+1}`})).id);
  const token=await signSessionToken({profileId:profile.id,email:`performance-${count}@example.test`});await createSessionRow({profileId:profile.id,token});
  const [first]=await fixture.sql`SELECT id FROM inspirations WHERE profile_id=${profile.id} ORDER BY created_at DESC LIMIT 1`;
  fixtures.set(count,{id:profile.id,token,firstId:first.id,signalId:signalRows[0].id,groups,signals:signalCount,principles:principleCount});
}
await fixture.sql`ANALYZE`;
let recording=false;let queries:Array<{query:string;params:unknown[]}>=[];
(db.$client.options as unknown as {debug:unknown}).debug=(_connection:unknown,query:string,params:unknown[])=>{if(recording)queries.push({query,params});};
const round=(n:number)=>Math.round(n*100)/100;
const summary=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return {medianMs:round(sorted[Math.floor(sorted.length*.5)]!),p95Ms:round(sorted[Math.ceil(sorted.length*.95)-1]!),minMs:round(sorted[0]!),maxMs:round(sorted.at(-1)!)};};
const origin=`http://127.0.0.1:${port}`;
async function request(size:number,path:string){
  const token=fixtures.get(size)!.token;return app.fetch(new Request(origin+path,{headers:{Authorization:`Bearer ${token}`}}));
}
const measured:Array<Record<string,unknown>>=[];
let reviewQuery:{query:string;params:unknown[]}|undefined;
for(const [size,f] of fixtures){
  for(const [label,path] of [['health','/api/health'],['auth','/api/auth/me'],['archive_page','/api/inspirations?limit=200'],['search','/api/inspirations?limit=40&q=walking'],['inspiration_detail',`/api/inspirations/${f.firstId}`],['signals','/api/signals?limit=200'],['signal_detail',`/api/signals/${f.signalId}`],['principles','/api/principles'],['top_of_mind','/api/top-of-mind'],['review_active','/api/review-sessions/active'],['chat_list','/api/conversations']] as const){
    await (await request(size,path)).arrayBuffer();const times:number[]=[],counts:number[]=[];let bytes=0,status=0;
    for(let i=0;i<samples;i++){queries=[];recording=true;const started=performance.now();const response=await request(size,path);bytes=(await response.arrayBuffer()).byteLength;times.push(performance.now()-started);recording=false;counts.push(queries.length);status=response.status;assert.equal(status,200,`Unexpected ${label} status`);}
    measured.push({size,label,status,bytes,sqlQueries:counts.at(-1),...summary(times)});
  }
  const chatTimes:number[]=[],reviewTimes:number[]=[];let chatQueries=0,reviewQueries=0;
  for(let i=0;i<samples;i++){
    queries=[];recording=true;let start=performance.now();await readConversationContext(db,f.id,'How can I leave space for walking and experiments?');chatTimes.push(performance.now()-start);recording=false;chatQueries=queries.length;
    queries=[];recording=true;start=performance.now();const session=await createReviewSession(db,f.id,{id:crypto.randomUUID()});reviewTimes.push(performance.now()-start);recording=false;reviewQueries=queries.length;
    if(size===10000)reviewQuery=queries.find(q=>q.query.startsWith('select')&&q.query.includes('max(')&&q.query.includes('inspirations'));
    if(session)await completeReviewSession(db,f.id,session.id,session.revision);
  }
  measured.push({size,label:'chat_context_without_model',sqlQueries:chatQueries,...summary(chatTimes)});
  measured.push({size,label:'review_selection',sqlQueries:reviewQueries,...summary(reviewTimes)});
  const concurrency:number[]=[];
  for(let batch=0;batch<3;batch++)await Promise.all(Array.from({length:10},async()=>{const start=performance.now();const response=await request(size,'/api/inspirations?limit=200');await response.arrayBuffer();concurrency.push(performance.now()-start);}));
  measured.push({size,label:'archive_10_concurrent',...summary(concurrency)});
  if(searchCorpus&&size===10000){
    const identities=await fixture.sql`SELECT id FROM inspirations WHERE profile_id=${f.id} ORDER BY created_at DESC,id DESC`;
    const ordinal=new Map(identities.map((row,index)=>[row.id,index+1]));
    for(const entry of searchCases){
      const path='/api/inspirations?limit=40&q='+encodeURIComponent(entry.query),times:number[]=[];
      await(await request(size,path)).arrayBuffer();
      for(let i=0;i<samples;i++){
        const started=performance.now(),response=await request(size,path);assert.equal(response.status,200);
        await response.arrayBuffer();times.push(performance.now()-started);
      }
      const expected:number[]=Array.from({length:size},(_,index)=>index+1).filter(n=>entry.contains(n,size));
      const found:number[]=[],seenCursors=new Set<string>();let cursor:string|undefined;
      do{
        const response=await request(size,'/api/inspirations?limit=200&q='+encodeURIComponent(entry.query)+(cursor?'&cursor='+encodeURIComponent(cursor):''));
        assert.equal(response.status,200);
        const body=await response.json() as {inspirations:Array<{id:string}>;total?:number;nextCursor?:string};
        if(!cursor)assert.equal(body.total,expected.length,entry.label+' exact total');else assert.equal(body.total,undefined);
        for(const row of body.inspirations){assert.ok(ordinal.has(row.id),entry.label+' foreign identity');found.push(ordinal.get(row.id)!);}
        cursor=body.nextCursor;
        if(cursor){assert.equal(seenCursors.has(cursor),false,'Cursor loop');seenCursors.add(cursor);}
      }while(cursor);
      assert.deepEqual(found,expected,entry.label+' complete membership/order');
      const result={size,label:'search_'+entry.label,matchingOriginals:found.length,allIdsAndCursorsVerified:true,...summary(times)};
      measured.push(result);console.log(JSON.stringify({stage:'search_case',...result}));
    }
  }
}
let explain:unknown=null;
if(reviewQuery){const result=await db.$client.unsafe('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+reviewQuery.query,reviewQuery.params as never);explain=result[0]?.['QUERY PLAN'];}
const assets=[];
for(const name of await readdir(resolve('packages/web/dist/assets'))){const bytes=await readFile(resolve('packages/web/dist/assets',name));assets.push({name,raw:bytes.length,gzip:gzipSync(bytes).length,brotli:brotliCompressSync(bytes).length});}
const results={kind:'local synthetic production-build baseline',createdAt:new Date().toISOString(),apiImportMs:round(apiImportMs),database:'disposable loopback only',modelCalls:0,searchCorpus,fixtures:[...fixtures].map(([size,f])=>({size,signals:f.signals,principles:f.principles,rooms:f.groups.length})),measured,assets,reviewSelectionExplain:explain};
await writeFile(resolve(outputDir,'api.json'),JSON.stringify({...results,samples,poolMax:process.env.WAKA_DB_POOL_MAX??5},null,2));
console.log(JSON.stringify({origin,schema:fixture.schemaName,apiImportMs:round(apiImportMs),results:resolve(outputDir,'api.json')}));
let activeSize=sizes[0]!,delayMs=0,fault:string|null=null;
const httpRequests:Array<{path:string;method:string;size:number;start:number;durationMs?:number;status?:number;bytes?:number}>=[];
const probe=`<script>(()=>{let started=null,mode=null;document.addEventListener('click',e=>{const b=e.target.closest?.('button');if(!b)return;const text=(b.querySelector('.jar-activity-title')?.textContent||b.textContent).trim();if(/^(Review your inspirations|Resume review)$/.test(text)){started=performance.now();mode='review'}else if(text==='Capture inspiration'){started=performance.now();mode='capture'}else if(text==='Talk with WAKA'){started=performance.now();mode='chat'}else if(text==='← Back'&&location.pathname.startsWith('/chat/')){started=performance.now();mode='return'}} ,true);new MutationObserver(()=>{if(started===null)return;const ready=mode==='review'?document.querySelector('.jar-review-item-actions button:not(:disabled)'):mode==='capture'?document.querySelector('[aria-label="Capture inspiration"] textarea'):mode==='chat'?document.querySelector('[aria-label="Your message"]'):document.querySelector('.jar-home-activities button');if(ready){document.documentElement.dataset.wakaAction=JSON.stringify({mode,durationMs:performance.now()-started});started=null}}).observe(document.documentElement,{childList:true,subtree:true,attributes:true})})();(()=>{const tasks=[],frames=[];let ready=null,last=null,stopped=false,layoutShiftScore=0;try{new PerformanceObserver(list=>list.getEntries().forEach(e=>{if(!e.hadRecentInput)layoutShiftScore+=e.value})).observe({type:'layout-shift',buffered:true})}catch{};try{new PerformanceObserver(list=>list.getEntries().forEach(e=>tasks.push({start:e.startTime,duration:e.duration}))).observe({type:'longtask',buffered:true})}catch{};function sample(now){if(last!==null)frames.push(now-last);last=now;if(ready===null&&document.querySelector('.jar-home-activities button')&&document.querySelector('.jar-mouth-rest')){ready=now;document.documentElement.dataset.wakaReady=String(now);}if(!stopped)requestAnimationFrame(sample)}requestAnimationFrame(sample);setTimeout(()=>{stopped=true;frames.sort((a,b)=>a-b);document.documentElement.dataset.wakaPerf=JSON.stringify({readyMs:ready,layoutShiftScore,longTasks:tasks.length,longTaskTotalMs:tasks.reduce((n,e)=>n+e.duration,0),longestTaskMs:Math.max(0,...tasks.map(e=>e.duration)),frames:frames.length,frameMedianMs:frames[Math.floor(frames.length*.5)],frameP95Ms:frames[Math.floor(frames.length*.95)],framesOver32:frames.filter(n=>n>32).length})},8000)})();</script>`;
const dist=resolve('packages/web/dist');
const types:Record<string,string>={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml'};
server=createServer(async(req,res)=>{
  try{
    if(closing){res.writeHead(503);res.end();return;}
    const url=new URL(req.url??'/',origin);
    if(url.pathname==='/perf/scenario'){
      const size=Number(url.searchParams.get('size'));assert.ok(fixtures.has(size));activeSize=size;
      delayMs=Number(url.searchParams.get('delay')??0);assert.ok(delayMs>=0&&delayMs<=500);
      fault=url.searchParams.get('fault');assert.ok(fault===null||['archive-tail-once','review-read-once','capture-lost-once'].includes(fault));
      // Test-only setup: close the synthetic session without making a source
      // choice, so repeated browser samples can measure a genuinely new start.
      if(url.searchParams.get('review')==='fresh'){
        const active=await readActiveReview(db,fixtures.get(size)!.id);
        if(active)await completeReviewSession(db,active.profileId,active.id,active.revision);
      }
      httpRequests.length=0;res.writeHead(302,{Location:'/', 'Set-Cookie':buildSessionCookie(fixtures.get(size)!.token,{secure:false})});res.end();return;
    }
    if(url.pathname==='/perf/results'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({size:activeSize,delayMs,httpRequests}));return;}
    if(url.pathname==='/perf/fault'){
      const next=url.searchParams.get('name');assert.ok(next===null||['archive-tail-once','review-read-once','capture-lost-once'].includes(next));fault=next;
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({fault}));return;
    }
    if(url.pathname==='/perf/worker'){
      const action=url.searchParams.get('action');assert.ok(['start','stop','status'].includes(action??''));
      if(action==='stop')workerStop=true;
      if(action==='start'){
        assert.equal(workerRun,null,'One controlled worker at a time');workerStop=false;workerIterations=0;workerResult=null;
        const f=fixtures.get(10000)??fixtures.get(activeSize)!;
        // Keep the synthetic claim deterministic even after Capture/Review
        // tests have queued work for another fixture account. This only
        // defers rows in this disposable schema; no production queue policy.
        // Real claim/lease/completion and real material/context/validation SQL.
        // Only transport is replaced: one bounded synthetic processor, no
        // model, no source rewrite, no global connection/budget change.
        workerRun=(async()=>{
          try{
            // Reserve workerRun before setup awaits, so concurrent start
            // requests cannot create a second worker or race shutdown.
            await fixture.sql`UPDATE background_jobs SET run_after=GREATEST(run_after,now()+${'3 minutes'}::interval)
              WHERE profile_id<>${f.id} AND status='pending'`;
            if(workerStop)return;
            await fixture.sql`INSERT INTO background_jobs(profile_id,type,payload,max_attempts) VALUES (${f.id},'tend_signal_garden','{}'::jsonb,1)`;
            workerResult=await drainBackgroundJobs({limit:1,processor:async job=>{
            assert.equal(job.profileId,f.id);const until=Date.now()+120000;
            while(!workerStop&&Date.now()<until){
              const [lease]=await fixture.sql`SELECT id FROM background_jobs WHERE id=${job.id} AND profile_id=${job.profileId}
                AND status='running' AND locked_at=${job.lockedAt} AND attempts=${job.attempts}`;assert.ok(lease,'Controlled claim changed');
              await db.transaction(async tx=>{
                const material=await loadInspirationMaterial(tx,f.id,f.firstId,'personal');assert.ok(material);
                await readConversationContext(tx,f.id,'How can I leave space for walking and experiments?');
                await assertMaterialCurrent(tx,material,[]);
              });workerIterations++;
              await new Promise(done=>setTimeout(done,100));
            }
          }});}catch{workerResult={error:'Controlled worker failed'};}finally{workerRun=null;}
        })();
      }
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({active:workerRun!==null,iterations:workerIterations,result:workerResult,providerCalls:0,maxDurationMs:120000}));return;
    }
    if(url.pathname==='/perf/context'){
      const question=(url.searchParams.get('question')??'How can I leave space for walking and experiments?').slice(0,1000);
      const f=fixtures.get(activeSize)!;queries=[];recording=true;const started=performance.now();
      let context;
      try{context=await readConversationContext(db,f.id,question);}finally{recording=false;}
      const durationMs=performance.now()-started,sqlQueries=queries.length;
      // Stable synthetic labels/contents permit before/after comparison across
      // independently seeded schemas. IDs/date-sensitive hashes are checked
      // against the SQL oracle in DB tests, not normalized into authority here.
      const normalized=(rows:typeof context.inspirations)=>rows.map(({id,hash,recordedAt,...row})=>row);
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({durationMs,sqlQueries,
        context:{principles:normalized(context.principles),reading:normalized(context.reading),inspirations:normalized(context.inspirations)}}));return;
    }
    if(url.pathname==='/perf/finish-review'){
      const f=fixtures.get(activeSize)!;
      const active=await readActiveReview(db,f.id);if(active)await completeReviewSession(db,f.id,active.id,active.revision);
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({completed:Boolean(active)}));return;
    }
    if(url.pathname.startsWith('/api/')){
      const start=performance.now(),size=activeSize;
      const path=url.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi,'{id}')+(url.search?'?'+url.searchParams.toString().replace(/(?:profile|cursor)=[^&]+/g,'scope=…'):'');
      const receipt:{path:string;method:string;size:number;start:number;durationMs?:number;status?:number;bytes?:number}={path,method:req.method??'GET',size,start};httpRequests.push(receipt);
      const dataPromise=new Promise<Buffer>((done,reject)=>{const parts:Buffer[]=[];let size=0;req.on('data',c=>{size+=c.length;if(size>1024*1024)reject(new Error('Fixture body limit'));else parts.push(c);});req.on('end',()=>done(Buffer.concat(parts)));req.on('aborted',()=>reject(new Error('Fixture request aborted')));});
      const data=await dataPromise;if(delayMs)await new Promise(done=>setTimeout(done,delayMs));
      const rejected=fault==='archive-tail-once'&&req.method==='GET'&&url.pathname==='/api/inspirations'&&url.searchParams.has('cursor')
        ||fault==='review-read-once'&&req.method==='GET'&&url.pathname==='/api/review-sessions/active'&&url.searchParams.get('include')==='current';
      if(rejected){fault=null;const bytes=Buffer.from('{"error":"Synthetic one-off failure"}');Object.assign(receipt,{durationMs:round(performance.now()-start),status:500,bytes:bytes.length});res.writeHead(500,{'Content-Type':'application/json'});res.end(bytes);return;}
      const headers:Record<string,string>={};for(const [key,value] of Object.entries(req.headers))if(value!==undefined)headers[key]=Array.isArray(value)?value.join(','):value;
      const response=await app.fetch(new Request(url,{method:req.method,headers,...(data.length?{body:data}:{} )}));const bytes=Buffer.from(await response.arrayBuffer());
      Object.assign(receipt,{durationMs:round(performance.now()-start),status:response.status,bytes:bytes.length});
      if(fault==='capture-lost-once'&&req.method==='POST'&&url.pathname==='/api/inspirations'){
        fault=null;res.destroy();return;
      }
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(bytes);return;
    }
    const asset=url.pathname.startsWith('/assets/');const file=asset?resolve(dist,`.${url.pathname}`):resolve(dist,'index.html');assert.ok(file.startsWith(dist+'/'));let bytes=await readFile(file);
    if(!asset)bytes=Buffer.from(bytes.toString().replace('<head>','<head>'+probe));
    res.writeHead(200,{'Content-Type':types[extname(file)]??'application/octet-stream','Cache-Control':'no-store',...(!asset?{'Set-Cookie':buildSessionCookie(fixtures.get(activeSize)!.token,{secure:false})}:{})});res.end(bytes);
  }catch(error){console.error(error);if(!res.headersSent)res.writeHead(500);res.end('Synthetic performance fixture failed');}
});
await new Promise<void>(done=>server!.listen(port,'127.0.0.1',done));console.log('Performance fixture ready at '+origin);
