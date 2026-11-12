/** SST preview, using the existing Actions principal. Keep raw provider/state
 * diagnostics private to the ephemeral runner; publish only operation + typed
 * resource identifiers. Never upload raw output/state as an artifact. */
import {spawn,execFileSync} from 'node:child_process';
import {verifyExistingProductionBootstrap,summarizePreviewEvents,verifyMonitorAlarmIdentities} from './production-preview-policy.mjs';
import {classifyPreviewFailure,explainPreviewFailure} from './production-preview-diagnostics.mjs';
import {AuditDiagnosticError,readAuditAwsJson,auditFailure,explainAuditFailure} from './audit-diagnostics.mjs';
import {writeFileSync,rmSync,readdirSync,readFileSync,openSync,fstatSync,readSync,closeSync,constants} from 'node:fs';
import {join} from 'node:path';
const preflightEnv={...process.env};delete preflightEnv.SST_PRINT_LOGS;
let bootstrap;
const refuse=(phase,error)=>{
 const receipt=auditFailure(phase,error,{exitCode:null,operations:[],monitorAlarmIdentity:verifyMonitorAlarmIdentities(''),rawOutputPublished:false});
 try{writeFileSync('production-preview.json',JSON.stringify(receipt)+'\n',{mode:0o600});console.error(explainAuditFailure(receipt,'production-preview.json'));}
 catch{console.error(`Production preview failed: ${phase} artifact_write_failed. Next: verify the safe artifact destination is writable.`);console.error(JSON.stringify(receipt));}
 process.exit(1);
};
try {
 let version;
 try{version=execFileSync('pnpm',['sst','version'],{env:preflightEnv,encoding:'utf8',stdio:['ignore','pipe','pipe']});}catch{throw new AuditDiagnosticError('cli_version_failed');}
 if(!/sst 3\.19\.3\b/.test(version))throw new AuditDiagnosticError('cli_version_mismatch');
 bootstrap=verifyExistingProductionBootstrap(args=>{
  const value=readAuditAwsJson(args,execFileSync,{env:preflightEnv});
  return typeof value==='string'?{value}:value;
 });
 console.log(JSON.stringify({productionPreviewPreflight:bootstrap}));
} catch(error) {refuse('preview_preflight',error);}
process.umask(0o077);
const sstLog='.sst/log/sst.log';
try {rmSync(sstLog,{force:true});}
catch {refuse('preview_log_reset',new AuditDiagnosticError('private_log_reset_failed'));}
const startedAt=Date.now();
const channels={childPrintLogs:true,stdoutBytes:0,stderrBytes:0,capturedOutputBytes:0,outputTruncated:false,freshLogReset:true,freshLogPresent:false,freshLogBytesConsumed:0,freshLogTruncated:false,freshLogRejected:false,logReadFailed:false,logDeleted:false};
const child=spawn('pnpm',['sst','diff','--stage','production'],{env:{...process.env,NO_COLOR:'1',SST_TELEMETRY_DISABLED:'1',SST_NO_CLEANUP:'1',SST_PRINT_LOGS:'1'},stdio:['ignore','pipe','pipe']});
let output='';for(const [name,stream] of [['stdoutBytes',child.stdout],['stderrBytes',child.stderr]])stream.on('data',data=>{
 channels[name]+=Buffer.byteLength(data);
 const text=data.toString(),room=Math.max(0,20_000_000-output.length);output+=text.slice(0,room);
 if(text.length>room){channels.outputTruncated=true;child.kill('SIGTERM');}
});
child.on('error',()=>{console.error('Production preview child could not start; await the safe production-preview.json exit receipt.');process.exitCode=1;});
child.on('close',code=>{
 channels.capturedOutputBytes=Buffer.byteLength(output);
 let log='';
 if(code!==0){
  let fd;
  try {
   fd=openSync(sstLog,constants.O_RDONLY|constants.O_NOFOLLOW);
   const stat=fstatSync(fd);channels.freshLogPresent=true;
   if(!stat.isFile()||stat.mtimeMs<startedAt)channels.freshLogRejected=true;
   else {
    const limit=2*1024*1024,buffer=Buffer.alloc(Math.min(stat.size,limit));
    const size=readSync(fd,buffer,0,buffer.length,Math.max(0,stat.size-limit));
    channels.freshLogBytesConsumed=size;channels.freshLogTruncated=stat.size>limit;
    log=buffer.subarray(0,size).toString('utf8');
   }
  } catch(error) {if(error?.code!=='ENOENT')channels.logReadFailed=true;}
  finally {if(fd!==undefined)try{closeSync(fd);}catch{channels.logReadFailed=true;}}
 }
 const clean=output.replace(/\x1b\[[0-9;]*[A-Za-z]/g,'');
 let operations=[],monitorAlarmIdentity=verifyMonitorAlarmIdentities('');
 try {
  const dirs=readdirSync('.sst/pulumi',{withFileTypes:true}).filter(d=>d.isDirectory());
  if(dirs.length!==1)throw Error('Expected one fresh preview directory');
  const events=readFileSync(join('.sst/pulumi',dirs[0].name,'eventlog.json'),'utf8');
  monitorAlarmIdentity=verifyMonitorAlarmIdentities(events);
  operations=summarizePreviewEvents(events);
 } catch { /* Missing/invalid event receipt fails below; raw output stays private. */ }
 const errorCodes=[...new Set(clean.match(/\b(?:AccessDenied(?:Exception)?|UnauthorizedOperation|SecretMissingError|InvalidArgument|NoSuchBucket|ConflictException|ENOTFOUND|ETIMEDOUT)\b/g)??[])];
 let diagnostics={parsed:true,categories:[],sourceLocations:[]};
 try {if(code!==0)diagnostics=classifyPreviewFailure(output+'\n'+log);}
 catch {diagnostics={parsed:false,categories:['unknown'],sourceLocations:[]};}
 const receipt={stage:'production',exitCode:code,bootstrap,operations,monitorAlarmIdentity,errorCodes,diagnostics,diagnosticChannels:channels,rawOutputPublished:false};
 writeFileSync('production-preview.json',JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
 try {rmSync(sstLog,{force:true});channels.logDeleted=true;}
 catch {console.error('Production preview failed: private_log_cleanup; privateLogDeleted=false. Next: inspect runner file permissions; retain production-preview.json.');process.exitCode=1;}
 writeFileSync('production-preview.json',JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify(receipt));
 if(code!==0||!operations.length||!monitorAlarmIdentity.passed||!channels.logDeleted){console.error(explainPreviewFailure(receipt));process.exitCode=1;}
 rmSync('.sst/pulumi',{recursive:true,force:true});
});
