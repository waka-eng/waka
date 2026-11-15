/** Keyless C0 entry. No activation, provider, queue, dotenv or repair path. */
import {readFile,open,lstat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import postgres from 'postgres';
import {drizzle} from 'drizzle-orm/postgres-js';
import {embeddingCoverageManifest,readEmbeddingCoverage,EmbeddingCoverageRefused} from '../../packages/api/src/lib/embedding-index-coverage.js';
import {publishCoverageMetadata} from './coverage-private-report.js';
const hash=(v:Uint8Array|string)=>createHash('sha256').update(v).digest('hex');
const EXPECTED_DB_SHA='6fabf56590aab323e5eacfd976ce05566cde21553297c2edaa3f08d7ea6bebda';
const ARN='arn:aws:lambda:us-west-2:182498323408:function:waka-development-BackgroundWorkerFunction-xxbrbmcx';
const output=process.stdout.write.bind(process.stdout);
let raw:ReturnType<typeof postgres>|undefined,phase='approval',sqlMayHaveStarted=false,timer:ReturnType<typeof setTimeout>|undefined,executionRegion:string|null=null,runtimeConfigurationRegion:string|null=null;
try{
 const args=process.argv.slice(2);
 if(args.length!==3||args[0]!=='--execute-reviewed'||args[1]!=='--approved-sha'||!/^[a-f0-9]{64}$/.test(args[2]??'')||hash(await readFile(fileURLToPath(import.meta.url)))!==args[2])throw new EmbeddingCoverageRefused('identity');
 phase='input';let text='',bytes=0;for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>32768)throw new EmbeddingCoverageRefused('identity');text+=chunk;}
 const input=JSON.parse(text);text='';
 if(!input||Object.keys(input).sort().join()!==['attestation','dbUrl','invocationId','manifest','manifestSha256'].sort().join())throw new EmbeddingCoverageRefused('identity');
 const m=embeddingCoverageManifest.parse(input.manifest);
 if(hash(JSON.stringify(m))!==input.manifestSha256||!/^[a-f0-9]{64}$/.test(input.manifestSha256)||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.invocationId)||Date.parse(m.expiresAt)<=Date.now()||Date.parse(m.expiresAt)>Date.now()+86400000)throw new EmbeddingCoverageRefused('identity');
 phase='target';const a=input.attestation;
 if(!a||Object.keys(a).sort().join()!==['accountId','stage','workerArn','appName','appStage','executionRegion','runtimeConfigurationRegion'].sort().join()||a.accountId!=='182498323408'||a.stage!=='development'||a.workerArn!==ARN||a.appName!=='waka'||a.appStage!=='development'||a.executionRegion!=='us-east-1'||a.runtimeConfigurationRegion!=='us-west-2'||process.env.AWS_REGION!=='us-east-1'||process.env.AWS_DEFAULT_REGION!=='us-east-1')throw new EmbeddingCoverageRefused('identity');
 executionRegion='us-east-1';runtimeConfigurationRegion='us-west-2';
 if(m.approvedDbSha256!==EXPECTED_DB_SHA||typeof input.dbUrl!=='string'||Buffer.byteLength(input.dbUrl)>4096||hash(input.dbUrl)!==EXPECTED_DB_SHA)throw new EmbeddingCoverageRefused('identity');
 const url=new URL(input.dbUrl),mode=url.searchParams.get('sslmode')??url.searchParams.get('ssl');
 if(!['postgres:','postgresql:'].includes(url.protocol)||!url.username||!url.password||!url.hostname.endsWith('.neon.tech')||!url.hostname.includes('-pooler')||!url.hostname.includes('us-east-1')||mode==='disable'||mode==='false')throw new EmbeddingCoverageRefused('identity');
 const base='/tmp/waka-embedding-coverage-'+input.manifestSha256+'-'+input.invocationId;
 for(const suffix of ['.private.json','.pending']){let exists=false;try{await lstat(base+suffix);exists=true;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}if(exists)throw new EmbeddingCoverageRefused('identity');}
 phase='once';const marker=await open(base+'.once','wx',0o600);try{await marker.writeFile(JSON.stringify({mode:'C0',manifestSha256:input.manifestSha256}));}finally{await marker.close();}
 // Library output is never a report channel. Preserve the original writer only
 // for the single closed receipt. No new EMF records/custom metric dimensions.
 console.log=console.info=console.warn=console.error=()=>{};
 process.stdout.write=((_chunk:unknown,encodingOrCallback?:unknown,callback?:()=>void)=>{const done=typeof encodingOrCallback==='function'?encodingOrCallback:callback;if(typeof done==='function')done();return true;}) as typeof process.stdout.write;
 phase='C0';raw=postgres(input.dbUrl,{max:1,prepare:false,ssl:mode==='verify-full'?'verify-full':'require',connect_timeout:5,idle_timeout:2,
  connection:{application_name:'waka-embedding-coverage',default_transaction_read_only:true,statement_timeout:5000,lock_timeout:1000,idle_in_transaction_session_timeout:10000},onnotice:()=>{}});
 input.dbUrl='';sqlMayHaveStarted=true;
 const result=await Promise.race([readEmbeddingCoverage(drizzle(raw) as Parameters<typeof readEmbeddingCoverage>[0],m),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new EmbeddingCoverageRefused('deadline')),Math.min(m.maxDurationMs,Date.parse(m.expiresAt)-Date.now()));})]);
 clearTimeout(timer);
 await raw.end({timeout:2});raw=undefined;
 const body=JSON.stringify({mode:'C0',manifestSha256:input.manifestSha256,snapshotAt:result.report.snapshotAt,...result.privateMetadata,activationCertificate:false})+'\n';
 if(Buffer.byteLength(body)>16384)throw new EmbeddingCoverageRefused('read_bound');
 phase='private_report';await publishCoverageMetadata(base,body);
 output(JSON.stringify({passed:true,mode:'C0',executionRegion,runtimeConfigurationRegion,bundleSha256:args[2],manifestSha256:input.manifestSha256,report:result.report,privateMetadataSha256:hash(body),privateMetadataBytes:Buffer.byteLength(body),privateMetadataMode:'0600',automaticRetryAuthorized:false})+'\n');
}catch(error){
 clearTimeout(timer);
 if(raw)try{await raw.end({timeout:1});}catch{}
 let code:string=error instanceof EmbeddingCoverageRefused?error.code:'read_refused',cause:unknown=error;
 if(code==='read_refused')for(let i=0;i<4&&cause&&typeof cause==='object';i++){
  const sqlCode=String((cause as {code?:unknown}).code??'');
  const closed:Record<string,string>={'57014':'statement_timeout','55P03':'lock_timeout','25006':'readonly_violation','42P01':'schema_mismatch','42703':'schema_mismatch','EEXIST':'already_attempted'};
  if(closed[sqlCode]){code=closed[sqlCode];break;}cause=(cause as {cause?:unknown}).cause;
 }
 output(JSON.stringify({passed:false,mode:'C0',executionRegion,runtimeConfigurationRegion,phase,code,sqlMayHaveStarted,memoryMutations:0,providerCalls:0,automaticRetryAuthorized:false})+'\n');process.exitCode=1;
}
