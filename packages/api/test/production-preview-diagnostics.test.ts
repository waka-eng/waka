import {expect,it} from 'vitest';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {EventEmitter} from 'node:events';
import {runInNewContext} from 'node:vm';
import {transpileModule,ModuleKind,ScriptTarget} from 'typescript';
import {alarmLabels} from '../src/monitoring/protocol';
const load=()=>import(/* @vite-ignore */resolve(__dirname,'../../../scripts/production-preview-diagnostics.mjs'));
const canaries=['PRIVATE_CAPTURE_WORDS','person@example.test','https://private.example/chat?token=PRIVATE_QUERY','PRIVATE_WEBHOOK_TOKEN','PRIVATE_ACCOUNT_ID'];

// Synthetic diagnostics, not recovered runner logs. SST templates below are
// from v3.19.3 secret.ts, aws/cron.ts and aws/helpers/function-builder.ts;
// Node/Pulumi/provider cases exercise representative error signatures only.
it.each([
 ['config_top_level_import','time=2026-11-12T01:00:00Z level=ERROR msg="exited with error" err=ErrTopLevelImport'],
 ['secret_missing','Set a value for DiscordWebhookUrl with `sst secret set DiscordWebhookUrl <value>`'],
 ['secret_missing','SecretMissingError: PRIVATE_CAPTURE_WORDS'],
 ['sdk_visible_error','Cannot access the created function because it is referenced as an ARN.'],
 ['sdk_visible_error','No function created for the "PRIVATE_ACCOUNT_ID" cron job.'],
 ['sdk_visible_error','VisibleError: PRIVATE_CAPTURE_WORDS'],
 ['config_import','Error [ERR_MODULE_NOT_FOUND]: Cannot find module PRIVATE_CAPTURE_WORDS'],
 ['config_import','Could not resolve "PRIVATE_CAPTURE_WORDS"'],
 ['config_build','Transform failed with 1 error: PRIVATE_CAPTURE_WORDS'],
 ['config_type',"TypeError: Cannot read properties of undefined (reading 'PRIVATE_ACCOUNT_ID')"],
 ['config_type','ReferenceError: PRIVATE_CAPTURE_WORDS is not defined'],
 ['config_type','Invalid function definition for the "PRIVATE_ACCOUNT_ID" Function'],
 ['provider_diagnostic','rpc error: code = Unknown desc = Missing required argument: PRIVATE_CAPTURE_WORDS'],
 ['cli_argument','unknown command: PRIVATE_CAPTURE_WORDS'],
 ['permission','AccessDeniedException: not authorized to perform PRIVATE_CAPTURE_WORDS'],
 ['permission','CredentialsProviderError: PRIVATE_CAPTURE_WORDS'],
 ['stage_locked','ConcurrentUpdateError: the stack is currently locked PRIVATE_ACCOUNT_ID'],
 ['stage_locked','There is an ongoing update in progress PRIVATE_ACCOUNT_ID'],
 ['network','request failed: ETIMEDOUT PRIVATE_CAPTURE_WORDS'],
 ['unknown','The child stopped: PRIVATE_CAPTURE_WORDS'],
])('classifies %s without forwarding message content',async(category,message)=>{
 const {classifyPreviewFailure}=await load();
 const result=classifyPreviewFailure('\u001b[31m'+message+'\u001b[0m\n'+canaries.join('\n'));
 expect(result.parsed).toBe(true);expect(result.categories).toContain(category);
 expect(result.sourceLocations).toEqual([]);
 for(const secret of canaries)expect(JSON.stringify(result)).not.toContain(secret);
});

it('projects exact public source identities and bounded positions, discarding private path prefixes',async()=>{
 const {classifyPreviewFailure}=await load();
 const raw=[
  'TypeError: PRIVATE_CAPTURE_WORDS',
  '    at f (/home/PRIVATE_ACCOUNT_ID/repo/sst.config.ts:579:17)',
  '    at f (file:///home/PRIVATE_ACCOUNT_ID/repo/.sst/platform/src/components/aws/helpers/function-builder.ts:34:13)',
  '    at f (/home/PRIVATE_ACCOUNT_ID/repo/.sst/platform/node_modules/@pulumi/pulumi/output.js:260:14)',
  '    at f (/home/PRIVATE_ACCOUNT_ID/repo/sst.config.ts:579:17)',
  'PRIVATE_CAPTURE_WORDS.ts:12:1',
  '/private/PRIVATE_ACCOUNT_ID/secret.ts:14:5',
  'https://private.example/sst.config.ts:9:1',
  '/repo/sst.config.ts:0:1','/repo/sst.config.ts:100001:1','/repo/sst.config.ts:1:10001',
  '/repo/sst.config.ts:12:4?PRIVATE_QUERY',
 ].join('\n');
 const result=classifyPreviewFailure(raw);
 expect(result.sourceLocations).toEqual([
  {source:'sst.config.ts',line:579,column:17},
  {source:'sst@3.19.3/platform/src/components/aws/helpers/function-builder.ts',line:34,column:13},
  {source:'@pulumi/pulumi@3.210.0/output.js',line:260,column:14},
 ]);
 expect(JSON.stringify(result)).not.toContain('PRIVATE_');expect(JSON.stringify(result)).not.toContain('/home/');
});

it('bounds locations and keeps unrecognized or malformed input explicitly unknown',async()=>{
 const {classifyPreviewFailure}=await load();
 const result=classifyPreviewFailure(Array.from({length:20},(_,i)=>`/private/sst.config.ts:${i+1}:1`).join('\n'));
 expect(result.sourceLocations).toHaveLength(8);expect(result.categories).toEqual(['unknown']);
 expect(classifyPreviewFailure(null)).toEqual({parsed:false,categories:['unknown'],sourceLocations:[]});
 expect(classifyPreviewFailure('')).toEqual({parsed:true,categories:['unknown'],sourceLocations:[]});
});

async function runDriver(options:{stdout?:string;stderr?:string;freshLog?:string;staleLog?:string;oldTimestamp?:boolean;notRegular?:boolean;readError?:boolean;parserThrows?:boolean;parentPrintLogs?:string}={}){
 const policy=await import(/* @vite-ignore */resolve(__dirname,'../../../scripts/production-preview-policy.mjs'));
 const diagnostic=await load();
 const source=readFileSync(resolve(__dirname,'../../../scripts/preview-production.mjs'),'utf8');
 const child:any=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};
 const writes=new Map<string,string>(),messages:string[]=[],order:string[]=[],files=new Map<string,string>(),preflights:any[]=[];
 const logPath='.sst/log/sst.log';let spawnOptions:any;
 if(options.staleLog!==undefined)files.set(logPath,options.staleLog);
 const events=Object.keys(alarmLabels).map(code=>{
  const type='aws:cloudwatch/metricAlarm:MetricAlarm',urn=`urn:pulumi:production::waka::${type}::Monitor${code}`;
  return JSON.stringify({resourcePreEvent:{metadata:{op:'create',type,urn,new:{type,urn,inputs:{name:`waka-production-${code}`,private:'PRIVATE_CAPTURE_WORDS'}}}}});
 }).join('\n');
 const fakeProcess={env:options.parentPrintLogs===undefined?{}:{SST_PRINT_LOGS:options.parentPrintLogs},umask:()=>{},exit:()=>{throw Error('Unexpected bootstrap refusal');},exitCode:0};
 const dependencies:any={
  'node:child_process':{spawn:(_cmd:string,_args:string[],opts:any)=>{
   spawnOptions=opts;order.push('spawn');if(options.freshLog!==undefined)files.set(logPath,options.freshLog);return child;
  },execFileSync:(_cmd:string,args:string[],opts:any)=>{
   preflights.push(opts);
   if(args[1]==='version')return 'sst 3.19.3';
   if(args.includes('/sst/bootstrap'))return JSON.stringify(JSON.stringify({version:5,state:'sst-state-veustfdskvrh'}));
   if(args.includes('/sst/passphrase/waka/production'))return JSON.stringify('SecureString');
   return JSON.stringify({ContentLength:100});
  }},
  './production-preview-policy.mjs':policy,
  './production-preview-diagnostics.mjs':options.parserThrows?{classifyPreviewFailure:()=>{throw Error('PRIVATE_CAPTURE_WORDS');}}:diagnostic,
  'node:fs':{
   writeFileSync:(path:string,value:string)=>{writes.set(path,value);order.push('write:'+path);},
   rmSync:(path:string)=>{files.delete(path);order.push('remove:'+path);},
   readdirSync:()=>[{name:'preview',isDirectory:()=>true}],readFileSync:()=>events,
   constants:{O_RDONLY:0,O_NOFOLLOW:2},
   openSync:(path:string,flags:number)=>{expect(flags&2).toBe(2);if(!files.has(path))throw Object.assign(Error('PRIVATE_CAPTURE_WORDS'),{code:'ENOENT'});return 1;},
   fstatSync:()=>({size:Buffer.byteLength(files.get(logPath)!),mtimeMs:options.oldTimestamp?0:Date.now()+100,isFile:()=>!options.notRegular}),
   readSync:(_fd:number,buffer:Buffer,offset:number,length:number,position:number)=>{if(options.readError)throw Error('PRIVATE_CAPTURE_WORDS');return Buffer.from(files.get(logPath)!).copy(buffer,offset,position,position+length);},
   closeSync:()=>{},
  },
  'node:path':{join:(...parts:string[])=>parts.join('/')},
 };
 runInNewContext(transpileModule(source,{compilerOptions:{module:ModuleKind.CommonJS,target:ScriptTarget.ES2022}}).outputText,{
  require:(id:string)=>{if(!dependencies[id])throw Error('Unexpected dependency');return dependencies[id];},exports:{},process:fakeProcess,Buffer,
  console:{log:(text:string)=>messages.push(text),error:(text:string)=>messages.push(text)},
 });
 if(options.stdout)child.stdout.emit('data',options.stdout);
 if(options.stderr)child.stderr.emit('data',options.stderr);
 child.emit('close',1);
 expect([...writes.keys()]).toEqual(['production-preview.json']);
 const receipt=JSON.parse(writes.get('production-preview.json')!);
 expect(receipt.exitCode).toBe(1);expect(receipt.operations).toHaveLength(8);expect(receipt.monitorAlarmIdentity.passed).toBe(true);
 expect(fakeProcess.exitCode).toBe(1);
 for(const secret of canaries)expect(messages.join('\n')+JSON.stringify(receipt)).not.toContain(secret);
 expect(spawnOptions.env.SST_PRINT_LOGS).toBe('1');expect(spawnOptions.stdio).toEqual(['ignore','pipe','pipe']);
 expect(preflights.every(opts=>!Object.hasOwn(opts.env,'SST_PRINT_LOGS'))).toBe(true);
 expect(fakeProcess.env).toEqual(options.parentPrintLogs===undefined?{}:{SST_PRINT_LOGS:options.parentPrintLogs});
 expect(files.has(logPath)).toBe(false);expect(receipt.diagnosticChannels.logDeleted).toBe(true);
 expect(order.indexOf('remove:'+logPath)).toBeLessThan(order.indexOf('spawn'));
 expect(order.lastIndexOf('remove:'+logPath)).toBeGreaterThan(order.indexOf('write:production-preview.json'));
 return {receipt,order};
}

it('preserves actual child exit, operations and identities when diagnostic parsing itself throws',async()=>{
 const {receipt}=await runDriver({stderr:'TypeError: '+canaries.join(' '),parserThrows:true});
 expect(receipt.diagnostics).toEqual({parsed:false,categories:['unknown'],sourceLocations:[]});
});

// SST 3.19.3 cmd/sst/main.go prints this generic wrapper while slog records
// the underlying error. --print-logs/SST_PRINT_LOGS adds that channel to stderr.
const generic='Unexpected error occurred. Please run with --print-logs or check .sst/log/sst.log if available.';
const underlying='time=2026-11-12T01:00:00Z level=ERROR msg="exited with error" err="TypeError: PRIVATE_CAPTURE_WORDS"\n    at f (/home/PRIVATE_ACCOUNT_ID/repo/sst.config.ts:599:17)';
it('captures the pinned generic wrapper plus underlying stderr log without exposing either body',async()=>{
 const {receipt}=await runDriver({stdout:generic,stderr:underlying+'\n'+canaries.join(' '),parentPrintLogs:'1'});
 expect(receipt.diagnostics.categories).toEqual(['config_type']);
 expect(receipt.diagnostics.sourceLocations).toEqual([{source:'sst.config.ts',line:599,column:17}]);
 expect(receipt.diagnosticChannels).toMatchObject({stdoutBytes:Buffer.byteLength(generic),stderrBytes:Buffer.byteLength(underlying+'\n'+canaries.join(' ')),freshLogPresent:false,freshLogBytesConsumed:0});
});

it('reads the bounded fresh log in memory when the default wrapper carries no cause',async()=>{
 const {receipt}=await runDriver({stdout:generic,freshLog:underlying+'\n'+canaries.join(' ')});
 expect(receipt.diagnostics.categories).toEqual(['config_type']);
 expect(receipt.diagnosticChannels).toMatchObject({freshLogReset:true,freshLogPresent:true,freshLogRejected:false,freshLogBytesConsumed:Buffer.byteLength(underlying+'\n'+canaries.join(' ')),freshLogTruncated:false,logReadFailed:false});
});

it('does not reuse an old log or accept a recreated stale timestamp/non-file',async()=>{
 const stale='AccessDeniedException: '+canaries.join(' ');
 const old=await runDriver({stdout:generic,staleLog:stale});
 expect(old.receipt.diagnostics.categories).toEqual(['unknown']);expect(old.receipt.diagnosticChannels.freshLogPresent).toBe(false);
 for(const flag of ['oldTimestamp','notRegular'] as const){
  const {receipt}=await runDriver({stdout:generic,freshLog:stale,[flag]:true});
  expect(receipt.diagnostics.categories).toEqual(['unknown']);expect(receipt.diagnosticChannels).toMatchObject({freshLogPresent:true,freshLogRejected:true,freshLogBytesConsumed:0});
 }
});

it('bounds the fresh log tail and handles unreadable/malformed diagnostic content honestly',async()=>{
 const {receipt}=await runDriver({stdout:generic,freshLog:'x'.repeat(2*1024*1024)+'\n'+underlying});
 expect(receipt.diagnostics.categories).toEqual(['config_type']);
 expect(receipt.diagnosticChannels).toMatchObject({freshLogBytesConsumed:2*1024*1024,freshLogTruncated:true});
 const failed=await runDriver({stdout:generic,freshLog:underlying,readError:true});
 expect(failed.receipt.diagnostics.categories).toEqual(['unknown']);expect(failed.receipt.diagnosticChannels.logReadFailed).toBe(true);
 const malformed=await runDriver({stdout:generic,freshLog:'{not-a-diagnostic '+canaries.join(' ')});
 expect(malformed.receipt.diagnostics.categories).toEqual(['unknown']);
});
