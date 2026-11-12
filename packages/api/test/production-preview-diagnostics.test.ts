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

it('preserves actual child exit, operations and identities when diagnostic parsing itself throws',async()=>{
 const policy=await import(/* @vite-ignore */resolve(__dirname,'../../../scripts/production-preview-policy.mjs'));
 const source=readFileSync(resolve(__dirname,'../../../scripts/preview-production.mjs'),'utf8');
 const child:any=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};
 const writes=new Map<string,string>(),messages:string[]=[];
 const events=Object.keys(alarmLabels).map(code=>{
  const type='aws:cloudwatch/metricAlarm:MetricAlarm',urn=`urn:pulumi:production::waka::${type}::Monitor${code}`;
  return JSON.stringify({resourcePreEvent:{metadata:{op:'create',type,urn,new:{type,urn,inputs:{name:`waka-production-${code}`,private:'PRIVATE_CAPTURE_WORDS'}}}}});
 }).join('\n');
 const fakeProcess={env:{},umask:()=>{},exit:()=>{throw Error('Unexpected bootstrap refusal');},exitCode:0};
 const dependencies:any={
  'node:child_process':{spawn:()=>child,execFileSync:(_cmd:string,args:string[])=>{
   if(args[1]==='version')return 'sst 3.19.3';
   if(args.includes('/sst/bootstrap'))return JSON.stringify(JSON.stringify({version:5,state:'sst-state-veustfdskvrh'}));
   if(args.includes('/sst/passphrase/waka/production'))return JSON.stringify('SecureString');
   return JSON.stringify({ContentLength:100});
  }},
  './production-preview-policy.mjs':policy,
  './production-preview-diagnostics.mjs':{classifyPreviewFailure:()=>{throw Error('PRIVATE_CAPTURE_WORDS');}},
  'node:fs':{writeFileSync:(path:string,value:string)=>writes.set(path,value),rmSync:()=>{},readdirSync:()=>[{name:'preview',isDirectory:()=>true}],readFileSync:()=>events},
  'node:path':{join:(...parts:string[])=>parts.join('/')},
 };
 runInNewContext(transpileModule(source,{compilerOptions:{module:ModuleKind.CommonJS,target:ScriptTarget.ES2022}}).outputText,{
  require:(id:string)=>{if(!dependencies[id])throw Error('Unexpected dependency');return dependencies[id];},exports:{},process:fakeProcess,
  console:{log:(text:string)=>messages.push(text),error:(text:string)=>messages.push(text)},
 });
 child.stderr.emit('data','TypeError: '+canaries.join(' '));child.emit('close',1);
 expect([...writes.keys()]).toEqual(['production-preview.json']);
 const receipt=JSON.parse(writes.get('production-preview.json')!);
 expect(receipt.exitCode).toBe(1);expect(receipt.operations).toHaveLength(8);expect(receipt.monitorAlarmIdentity.passed).toBe(true);
 expect(receipt.diagnostics).toEqual({parsed:false,categories:['unknown'],sourceLocations:[]});
 expect(fakeProcess.exitCode).toBe(1);
 for(const secret of canaries)expect(messages.join('\n')+JSON.stringify(receipt)).not.toContain(secret);
});
