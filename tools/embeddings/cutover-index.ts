/** Dedicated keyless C1 child. Any abnormal exit/missing receipt is UNKNOWN,
 * including pinned-driver fatal-session cleanup. Never a replay instruction. */
import {readFile,open,lstat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import postgres from 'postgres';
import {drizzle} from 'drizzle-orm/postgres-js';
import {activateEmbeddingIndex,reconcileEmbeddingCutover,embeddingCutoverManifest,embeddingCutoverReadOperation,embeddingCutoverIntentHash,EmbeddingCutoverRefused} from '../../packages/api/src/lib/embedding-index-cutover.js';
import {EmbeddingCoverageRefused} from '../../packages/api/src/lib/embedding-index-coverage.js';
import {publishCoverageMetadata} from './coverage-private-report.js';
const hash=(v:Uint8Array|string)=>createHash('sha256').update(v).digest('hex');
const DB_SHA='6fabf56590aab323e5eacfd976ce05566cde21553297c2edaa3f08d7ea6bebda';
const ARN='arn:aws:lambda:us-west-2:182498323408:function:waka-development-BackgroundWorkerFunction-xxbrbmcx';
const output=process.stdout.write.bind(process.stdout);
let raw:ReturnType<typeof postgres>|undefined,phase='approval',sqlMayHaveStarted=false,mode:'C1'|'C1_reconcile'|null=null,operationSha256:string|null=null;
try{
 const args=process.argv.slice(2);
 if(args.length!==3||!['--execute-reviewed','--validate-operation'].includes(args[0])||args[1]!=='--approved-sha'||!/^[a-f0-9]{64}$/.test(args[2])||hash(await readFile(fileURLToPath(import.meta.url)))!==args[2])throw new EmbeddingCutoverRefused('identity');
 phase='input';let body='',n=0;for await(const chunk of process.stdin){n+=chunk.length;if(n>65536)throw new EmbeddingCutoverRefused('identity');body+=chunk;}
 const input=JSON.parse(body);body='';
 if(args[0]==='--validate-operation'){
  if(!input||Object.keys(input).join()!=='operation')throw new EmbeddingCutoverRefused('identity');
  const operation=input.operation?.version==='embedding-cutover-v1'?embeddingCutoverManifest.parse(input.operation):embeddingCutoverReadOperation.parse(input.operation);
  const intent=operation.version==='embedding-cutover-v1'?operation:operation.intent;
  if(operation.approvedDbSha256!==DB_SHA||intent.approvedDbSha256!==DB_SHA||Date.parse(operation.expiresAt)<=Date.now()||Date.parse(operation.expiresAt)-Date.now()>7200000||operation.version==='embedding-cutover-read-v1'&&operation.intentSha256!==embeddingCutoverIntentHash(intent))throw new EmbeddingCutoverRefused('identity');
  output(JSON.stringify({passed:true,mode:'preflight',operationSha256:hash(JSON.stringify(operation)),intentSha256:embeddingCutoverIntentHash(intent),operationKind:operation.version==='embedding-cutover-v1'?'C1':'C1_reconcile'})+'\n');process.exit(0);
 }

 if(!input||Object.keys(input).sort().join()!==['attestation','dbUrl','invocationId','operation','operationSha256'].sort().join())throw new EmbeddingCutoverRefused('identity');
 const operation=input.operation?.version==='embedding-cutover-v1'?embeddingCutoverManifest.parse(input.operation):embeddingCutoverReadOperation.parse(input.operation);
 mode=operation.version==='embedding-cutover-v1'?'C1':'C1_reconcile';operationSha256=hash(JSON.stringify(operation));
 const intent=operation.version==='embedding-cutover-v1'?operation:operation.intent,intentHash=embeddingCutoverIntentHash(intent);
 if(operationSha256!==input.operationSha256||operation.approvedDbSha256!==DB_SHA||intent.approvedDbSha256!==DB_SHA||operation.version==='embedding-cutover-read-v1'&&operation.intentSha256!==intentHash||Date.parse(operation.expiresAt)<=Date.now()||Date.parse(operation.expiresAt)-Date.now()>7200000||!Number.isFinite(Date.parse(operation.expiresAt)))throw new EmbeddingCutoverRefused('identity');
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.invocationId))throw new EmbeddingCutoverRefused('identity');
 phase='target';const expected={accountId:'182498323408',stage:'development',workerArn:ARN,appName:'waka',appStage:'development',executionRegion:'us-east-1',runtimeConfigurationRegion:'us-west-2'};
 if(!input.attestation||Object.keys(input.attestation).sort().join()!==Object.keys(expected).sort().join()||Object.entries(expected).some(([k,v])=>input.attestation[k]!==v)||process.env.AWS_REGION!=='us-east-1'||process.env.AWS_DEFAULT_REGION!=='us-east-1')throw new EmbeddingCutoverRefused('identity');
 if(typeof input.dbUrl!=='string'||hash(input.dbUrl)!==DB_SHA)throw new EmbeddingCutoverRefused('identity');
 const uri=new URL(input.dbUrl),tls=uri.searchParams.get('sslmode')??uri.searchParams.get('ssl');
 if(!['postgres:','postgresql:'].includes(uri.protocol)||!uri.username||!uri.password||!uri.hostname.endsWith('.neon.tech')||!uri.hostname.includes('us-east-1')||!uri.hostname.includes('-pooler')||['disable','false'].includes(tls??''))throw new EmbeddingCutoverRefused('identity');
 // Mutation identity is the entire immutable intent, regardless of invocation
 // UUID. A read envelope gets a distinct operation hash and once namespace.
 const base='/tmp/waka-embedding-cutover-'+(mode==='C1'?'intent-':'read-')+operationSha256;
 for(const suffix of ['.once','.pending','.private.json']){let exists=false;try{await lstat(base+suffix);exists=true;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}if(exists)throw new EmbeddingCutoverRefused('identity');}
 phase='once';const marker=await open(base+'.once','wx',0o600);try{await marker.writeFile(JSON.stringify({mode,operationSha256,intentSha256:intentHash,invocationId:input.invocationId}));await marker.sync();}finally{await marker.close();}
 console.log=console.info=console.warn=console.error=()=>{};
 process.stdout.write=((_chunk:unknown,encodingOrCallback?:unknown,callback?:()=>void)=>{const done=typeof encodingOrCallback==='function'?encodingOrCallback:callback;if(typeof done==='function')done();return true;}) as typeof process.stdout.write;
 phase='sql';raw=postgres(input.dbUrl,{max:1,prepare:false,ssl:tls==='verify-full'?'verify-full':'require',connect_timeout:2,idle_timeout:1,onnotice:()=>{},connection:{application_name:'waka-embedding-cutover',statement_timeout:1000,lock_timeout:500,idle_in_transaction_session_timeout:6000,...(mode==='C1_reconcile'?{default_transaction_read_only:true}:{})}});
 input.dbUrl='';sqlMayHaveStarted=true;
 const db=drizzle(raw),result=mode==='C1'?await activateEmbeddingIndex(db as never,operation):await reconcileEmbeddingCutover(db as never,operation);
 await raw.end({timeout:1});raw=undefined;
 const tuples='after' in result.privateMetadata?result.privateMetadata.after:result.privateMetadata.tuples;
 const columns=['id','profile_type','generation','control_present','epoch','active_space','active_policy','building_space','building_policy','covered','frontier'] as const;
 const privateBody=JSON.stringify({mode,operationSha256,intentSha256:intentHash,columns,tuples:tuples.map(row=>columns.map(k=>row[k]))})+'\n';
 phase='private_report';await publishCoverageMetadata(base,privateBody);
 const outcome='activated' in result?'activated':result.state;
 output(JSON.stringify({passed:true,mode,executionRegion:'us-east-1',runtimeConfigurationRegion:'us-west-2',bundleSha256:args[2],operationSha256,intentSha256:intentHash,profiles:result.profiles,outcome,providerCalls:0,memoryTextMutations:0,currentCoverageProven:false,billingProven:false,activationReplayAuthorized:false,privateMetadataSha256:hash(privateBody),privateMetadataBytes:Buffer.byteLength(privateBody),privateMetadataMode:'0600'})+'\n');
}catch(e){
 if(raw)try{await raw.end({timeout:1});}catch{}
 let transactionTimeoutObserved=false;let cause:unknown=e;for(let i=0;i<5&&cause&&typeof cause==='object';i++){if((cause as {code?:unknown}).code==='25P04')transactionTimeoutObserved=true;cause=(cause as {cause?:unknown}).cause;}
 const code=e instanceof EmbeddingCutoverRefused||e instanceof EmbeddingCoverageRefused?e.code:'operation_refused';
 output(JSON.stringify({passed:false,mode,phase,code,operationSha256,sqlMayHaveStarted,transactionTimeoutObserved,outcome:sqlMayHaveStarted?'unknown':'not_started',providerCalls:0,memoryTextMutations:0,activationReplayAuthorized:false})+'\n');process.exitCode=1;
}
