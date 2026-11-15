/** Prepared privileged operator. No dotenv, automatic execution or activation.
 * Run only after Main/owner approve the exact bundle, target and operation. */
import {readFile,open} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import postgres from 'postgres';
import {drizzle} from 'drizzle-orm/postgres-js';
import {z} from 'zod';
import * as schema from '../../packages/api/src/db/index.js';
import {requiredTlsMode} from '../../packages/api/src/lib/db.js';
import {embeddingShadowManifest,embeddingShadowManifestHash,readEmbeddingShadowInventory,prepareEmbeddingShadowBuild,runEmbeddingShadowBatch,renewEmbeddingSignalFromManifest} from '../../packages/api/src/lib/embedding-index-operator.js';
import {EmbeddingIndexError} from '../../packages/api/src/lib/embedding-index-coordination.js';
import {EmbeddingIndexNeedsRetry} from '../../packages/api/src/lib/embedding-indexer.js';
import {createEmbeddingOperatorUsage} from '../../packages/api/src/lib/embedding-operator-usage.js';
const hash=(v:Uint8Array|string)=>createHash('sha256').update(v).digest('hex');
const ACCOUNT='182498323408',ARN='arn:aws:lambda:us-west-2:182498323408:function:waka-development-BackgroundWorkerFunction-xxbrbmcx';
const inputSchema=z.object({mode:z.enum(['D0','D1_prepare','D1','R1_signal']),invocationId:z.string().uuid(),manifest:embeddingShadowManifest,manifestSha256:z.string().regex(/^[a-f0-9]{64}$/),dbUrl:z.string().min(1).max(4096),apiKey:z.string().min(8).max(1000).optional(),privacy:z.object({dataCollection:z.enum(['deny']).nullable(),requireZdr:z.enum(['0','1']).nullable()}).strict(),attestation:z.object({accountId:z.literal(ACCOUNT),stage:z.literal('development'),workerArn:z.literal(ARN),appName:z.literal('waka'),appStage:z.literal('development')}).strict()}).strict();
const write=process.stdout.write.bind(process.stdout),output=(value:unknown)=>write(JSON.stringify(value)+'\n'),usage=createEmbeddingOperatorUsage();
let phase='approval',sqlStarted=false,raw:ReturnType<typeof postgres>|undefined;
try{
 const args=process.argv.slice(2),self=fileURLToPath(import.meta.url);
 if(args.length!==3||args[0]!=='--execute'||args[1]!=='--approved-sha'||!/^[a-f0-9]{64}$/.test(args[2]??'')||hash(await readFile(self))!==args[2])throw new EmbeddingIndexError('identity');
 phase='input';let text='';for await(const chunk of process.stdin){text+=chunk;if(Buffer.byteLength(text)>131072)throw new EmbeddingIndexError('identity');}
 const input=inputSchema.parse(JSON.parse(text));text='';
 if(embeddingShadowManifestHash(input.manifest)!==input.manifestSha256||Date.parse(input.manifest.expiresAt)<=Date.now())throw new EmbeddingIndexError('identity');
 // Independent fingerprint comes from the reviewed manifest, not from this
 // runtime URL. The companion operator attests the actual dev function first.
 phase='target';const uri=new URL(input.dbUrl);
 if(!['postgres:','postgresql:'].includes(uri.protocol)||!uri.username||!uri.password||!uri.hostname.endsWith('.neon.tech')||!uri.hostname.includes('us-east-1')||!uri.hostname.includes('-pooler')||hash(input.dbUrl)!==input.manifest.approvedDbSha256||requiredTlsMode(input.dbUrl)===false)throw new EmbeddingIndexError('identity');
 if(input.mode==='D1'?!input.apiKey:input.apiKey!==undefined)throw new EmbeddingIndexError('identity');
 phase='once';const marker=await open('/tmp/waka-embedding-shadow-'+input.manifestSha256+'-'+input.invocationId+'.once','wx',0o600);await marker.writeFile(JSON.stringify({mode:input.mode,manifestSha256:input.manifestSha256,startedAt:new Date().toISOString()}));await marker.close();
 // Only the explicitly attested same-stage key/privacy may reach transport.
 delete process.env.OPENROUTER_API_KEY;delete process.env.GEMINI_API_KEY;delete process.env.SST_RESOURCE_GeminiApiKey;
 delete process.env.WAKA_OPENROUTER_DATA_COLLECTION;delete process.env.WAKA_OPENROUTER_REQUIRE_ZDR;
 if(input.mode==='D1')process.env.OPENROUTER_API_KEY=input.apiKey!;
 if(input.privacy.dataCollection)process.env.WAKA_OPENROUTER_DATA_COLLECTION=input.privacy.dataCollection;
 if(input.privacy.requireZdr)process.env.WAKA_OPENROUTER_REQUIRE_ZDR=input.privacy.requireZdr;
 // Existing model/SQL logging is not an operator output channel. Never save
 // raw bodies/errors, SQL text, params, sources, vectors or credential values.
 console.info=console.log=console.warn=console.error=()=>{};
 process.stdout.write=((chunk:unknown,encodingOrCallback?:unknown,callback?:()=>void)=>{usage.observe(typeof chunk==='string'?chunk:Buffer.isBuffer(chunk)?chunk.toString('utf8'):null);const done=typeof encodingOrCallback==='function'?encodingOrCallback:callback;if(typeof done==='function')done();return true;}) as typeof process.stdout.write;
 phase='database';raw=postgres(input.dbUrl,{max:1,prepare:false,ssl:requiredTlsMode(input.dbUrl),connect_timeout:5,idle_timeout:5,connection:{statement_timeout:10000,lock_timeout:1000,application_name:'waka-embedding-shadow-operator'},onnotice:()=>{}});sqlStarted=true;const db=drizzle(raw,{schema});
 phase=input.mode;const receipt=input.mode==='D0'?await readEmbeddingShadowInventory(db,input.manifest,input.manifestSha256):input.mode==='D1_prepare'?await prepareEmbeddingShadowBuild(db,input.manifest,input.manifestSha256):input.mode==='R1_signal'?await renewEmbeddingSignalFromManifest(db,input.manifest,input.manifestSha256):await runEmbeddingShadowBatch(db,input.manifest,input.manifestSha256);
 await raw.end({timeout:2});raw=undefined;delete process.env.OPENROUTER_API_KEY;input.apiKey=undefined;input.dbUrl='';
 output({passed:true,mode:input.mode,manifestSha256:input.manifestSha256,receipt,usage:usage.snapshot(),activation:false,invoiceOrFullCoverageClaim:false});
}catch(error){
 if(raw)try{await raw.end({timeout:1});}catch{/* termination does not prove rollback */}
 delete process.env.OPENROUTER_API_KEY;
 const code=error instanceof EmbeddingIndexError||error instanceof EmbeddingIndexNeedsRetry?error.code:'operator_refused';
 output({passed:false,phase,code,...(error instanceof EmbeddingIndexNeedsRetry&&error.responseFailure?{responseFailure:error.responseFailure}:{}),usage:usage.snapshot(),sqlMayHaveStarted:sqlStarted,writeOutcomeMayNeedReconciliation:sqlStarted&&phase!=='D0',automaticRetryAuthorized:false});process.exitCode=1;
}
