/** Explicit live gate against development, with raw synthetic captures and
 * production qualification bars. Never seed signals, declare a Principle,
 * change fixture overrides, or print credentials. Account cleanup is mandatory. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {signUp,me,deleteAccount,redact,statusOf,type Session} from './organic';
import {launchChromium} from './browser';

const arg=(name:string)=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
assert.ok(process.argv.includes('--live'),'Pass --live explicitly for the paid development gate');
const origin=arg('base-url');assert.equal(origin,'https://dev.waka.im','Only the development origin is supported');
const prior=Number(arg('prior-used-usd')),reserve=Number(arg('reserve-usd'));
assert.ok(Number.isFinite(prior)&&prior>=0&&Number.isFinite(reserve)&&reserve>0&&reserve<=.2&&prior+reserve<=5,'An explicit reconciled reservation within the USD 5 allowance is required');
const output=arg('output')??'work/dev-generation';await mkdir(output,{recursive:true});
const corpus=[
  'I booked one pottery lesson before joining a year-long studio membership. I prefer trying a short class before making an expensive learning commitment.',
  'I tried one language lesson before paying for a long course. I prefer trying a short class before making an expensive learning commitment.',
  'I took one bicycle-repair workshop before enrolling in a full program. I prefer trying a short class before making an expensive learning commitment.',
  'For freelance writing, I chose plain-text notes I can export instead of a locked platform. I choose tools that let me export and keep my data.',
  'For our family photos, I chose a service that lets us download the originals. I choose tools that let me export and keep my data.',
  'For my personal budget, I kept a spreadsheet I can move between tools. I choose tools that let me export and keep my data.',
  'At work, I declined an extra task until I could finish an existing promise. I keep commitments small enough to honor existing promises.',
  'While volunteering, I offered one hour rather than a whole weekend so I could keep plans already made. I keep commitments small enough to honor existing promises.',
  'For a family project, I accepted one manageable part rather than promising the whole job. I keep commitments small enough to honor existing promises.',
];
const supplemental='I tried one introductory woodworking session before buying a long course. I prefer trying a short class before making an expensive learning commitment.';
const report:any={origin,observedAt:new Date().toISOString(),synthetic:true,qualificationOverrides:false,declarationCalls:0,
  corpusDigest:createHash('sha256').update(JSON.stringify(corpus)).digest('hex'),
  evaluation:{allowanceUsd:5,priorUsedOrHeldUsd:prior,reservedUsd:reserve,newUsedOrHeldUsd:prior+reserve,actualDeployedCostUsd:null},
  requests:[],captures:[],checkpoints:[],signals:[],reading:null,principles:[],failure:null,cleanup:false};
const persist=()=>writeFile(`${output}/receipt.json`,JSON.stringify(report,null,2)+'\n');await persist();
let session:Session|undefined;
const deadline=Date.now()+18*60*1000;
async function api(path:string,method='GET',body?:unknown,idempotency?:string){
  assert.ok(Date.now()<deadline,'Live gate time ceiling reached');assert.ok(session);
  const start=performance.now();const response=await fetch(origin+path,{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${session.token}`,
    ...(body===undefined?{}:{'Content-Type':'application/json'}),...(idempotency?{'Idempotency-Key':idempotency}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  report.requests.push({path:path.split('?')[0].replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/g,':id'),method,status:response.status,durationMs:Math.round(performance.now()-start)});
  if(!response.ok)throw Error(`${method} ${path} returned ${response.status}`);
  const data=await response.json();await persist();return data;
}
async function poll(label:string,work:()=>Promise<boolean>,limitMs=240000){
  const until=Math.min(deadline,Date.now()+limitMs);let attempts=0;
  while(Date.now()<until){attempts++;if(await work()){report.checkpoints.push({label,attempts,at:new Date().toISOString()});await persist();console.log(JSON.stringify({step:label,attempts}));return;}
    await new Promise(done=>setTimeout(done,3000));}
  throw Error(`Timed out waiting for ${label}`);
}
async function add(text:string){
  const body=await api('/api/inspirations','POST',{text,visibility:'private'},crypto.randomUUID());
  assert.equal(body.inspiration.profileId,session!.profileId);assert.equal(body.inspiration.text,text);
  report.captures.push({id:body.inspiration.id,text,processing:body.processing??null});await persist();
}
async function derived(){
  let complete=true;
  for(const row of report.captures){
    if(row.derived)continue;
    const state=await api(`/api/inspirations/${row.id}/processing`);
    assert.equal(state.profileId,session!.profileId);assert.equal(state.inspirationId,row.id);
    row.latestState=state;
    if(['failed','unknown'].includes(state.phase))throw Error(`Capture ${report.captures.indexOf(row)+1} ${state.stage??'processing'} is ${state.phase}`);
    row.derived=Boolean(state.currentMaterialRevision&&BigInt(state.latestDerivedRevision)>=BigInt(state.currentMaterialRevision));
    if(!row.derived)complete=false;
  }
  await persist();return complete;
}
async function reread(label:string){
  const receipt=await api('/api/top-of-mind/refresh','POST',{});assert.ok(receipt.jobId&&receipt.requestVersion);
  await poll(label,async()=>{const state=await api(`/api/top-of-mind/refresh/${receipt.jobId}?requestVersion=${receipt.requestVersion}`);
    report.readingState=state;if(state.status==='failed')throw Error('Top of Mind refresh failed');return state.status==='succeeded'&&Boolean(state.result);});
  report.reading=(await api('/api/top-of-mind')).topOfMind;assert.ok(report.reading?.entries?.length,'The positive archive must produce a reading');
}
async function guides(label:string){
  const initial=(await api('/api/principles/status')).status;report.principleState=initial;
  assert.equal(initial.eligible,true,'The archive did not meet the unmodified Principle evidence gate');
  if(initial.phase!=='ready')await api('/api/principles/refresh','POST',{});
  await poll(label,async()=>{const state=(await api('/api/principles/status')).status;report.principleState=state;
    if(state.phase==='failed')throw Error('Principle generation failed');return state.phase==='ready';});
  report.principles=(await api('/api/principles')).principles;assert.ok(report.principles.length,'Eligible material completed without a Principle');
}
try{
  const health=await fetch(origin+'/api/health',{redirect:'error'});assert.equal(health.status,200);assert.equal((await health.json()).service,'waka');
  session=await signUp({baseUrl:origin,name:'Synthetic full memory verification'});
  const identity=await me(session);assert.equal(identity.account.id,session.accountId);assert.equal(identity.profile.id,session.profileId);assert.equal(identity.account.email,session.email);assert.match(session.email,/@example\.test$/);
  report.profileId=session.profileId;report.startedAt=new Date().toISOString();await persist();
  await add(corpus[0]!);await poll('first inspiration derived',derived);
  const firstPrinciples=(await api('/api/principles')).principles;assert.equal(firstPrinciples.length,0,'A single source must not mint a Principle');
  report.singleSourceControl={principles:0};
  for(const text of corpus.slice(1))await add(text);
  await poll('all nine inspirations derived',derived,360000);
  report.signals=(await api('/api/signals?include=inspirations')).signals;
  const owned=new Set(report.signals.map((row:any)=>row.id));
  await reread('current reading completed');await guides('eligible Principle completed');
  for(const entry of report.reading.entries)for(const cited of entry.citedSignals??[])assert.ok(owned.has(cited.id),'Reading citation outside this profile');
  for(const row of report.principles){assert.equal(row.origin,'minted');assert.ok(row.citedSignals.length>=3);assert.ok(row.citedSignals.every((signal:any)=>owned.has(signal.id)));}
  report.generatedPrinciples=structuredClone(report.principles);
  const original=report.principles[0],edited='Start with choices I can test or leave, while honoring commitments I have already made.';
  const changed=(await api(`/api/principles/${original.id}`,'PATCH',{statement:edited,expectedStatementRevision:original.statementRevision})).principle;
  assert.equal(changed.statement,edited);assert.equal(changed.locked,true);report.humanEdit={id:original.id,statement:edited,locked:true};
  await add(supplemental);await poll('additional evidence derived',derived);await reread('reading after additional evidence completed');await guides('Principles after additional evidence completed');
  const preserved=report.principles.find((row:any)=>row.id===original.id);assert.equal(preserved?.statement,edited);assert.equal(preserved?.locked,true);report.humanEdit.regenerationPreserved=true;
  const raw=(await api('/api/inspirations')).inspirations;assert.equal(raw.length,10);assert.ok(report.captures.every((row:any)=>raw.some((saved:any)=>saved.id===row.id&&saved.textPreview===row.text)),'Raw words changed');report.rawWordsPreserved=true;
  const history=await api(`/api/principles/${original.id}/statements`);assert.ok(history.statements.some((row:any)=>row.statement===original.statement));assert.ok(history.statements.some((row:any)=>row.statement===edited));report.wordingHistoryPreserved=true;
  const browser=await launchChromium({headless:true});
  try{const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
    await context.addCookies([{name:'waka_session',value:session.token,url:origin,httpOnly:true,secure:true,sameSite:'Lax'}]);
    const page=await context.newPage();await page.goto(origin+'/?view=sky');const words=page.getByRole('button',{name:edited,exact:true});await words.waitFor({state:'visible',timeout:20000});
    await words.click();await page.getByRole('button',{name:'Edit wording',exact:true}).waitFor({state:'visible'});await page.screenshot({path:`${output}/principle-390.png`});report.deployedPrincipleVisible=true;
  }finally{await browser.close();}
}catch(error){report.failure=redact(error instanceof Error?error.message:String(error));process.exitCode=1;}
finally{
  if(session)try{const identity=await me(session);assert.equal(identity.account.id,session.accountId);assert.equal(identity.account.email,session.email);assert.match(session.email,/@example\.test$/);await deleteAccount(session);assert.equal(await statusOf({baseUrl:origin,path:'/api/auth/me',token:session.token}),401);report.cleanup=true;}
  catch(error){report.cleanupFailure=redact(error instanceof Error?error.message:String(error));process.exitCode=1;}
  report.finishedAt=new Date().toISOString();await persist();console.log(JSON.stringify({output,startedAt:report.startedAt,finishedAt:report.finishedAt,captures:report.captures.length,signals:report.signals.length,generatedPrinciples:report.generatedPrinciples?.length??0,humanEdit:report.humanEdit,failure:report.failure,cleanup:report.cleanup}));
}
