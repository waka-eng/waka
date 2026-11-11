/** SST preview, using the existing Actions principal. Keep raw provider/state
 * diagnostics private to the ephemeral runner; publish only operation + typed
 * resource identifiers. Never upload raw output/state as an artifact. */
import {spawn,execFileSync} from 'node:child_process';
import {verifyExistingProductionBootstrap} from './production-preview-policy.mjs';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
let bootstrap;
try {
 const version=execFileSync('pnpm',['sst','version'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 if(!/sst 3\.19\.3\b/.test(version))throw Error('Unexpected CLI');
 bootstrap=verifyExistingProductionBootstrap(args=>{
  const value=JSON.parse(execFileSync('aws',[...args,'--region','us-west-2','--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  return typeof value==='string'?{value}:value;
 });
 console.log(JSON.stringify({productionPreviewPreflight:bootstrap}));
} catch {console.error('Production preview refused before SST initialization: current bootstrap/state/passphrase attestation missing.');process.exit(1);}
const dir=mkdtempSync(join(tmpdir(),'waka-production-preview-'));
const child=spawn('pnpm',['sst','diff','--stage','production'],{env:{...process.env,NO_COLOR:'1',SST_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{output+=data;if(output.length>20_000_000)child.kill('SIGTERM');});
child.on('error',()=>{console.error('Could not start production preview');process.exitCode=1;});
child.on('close',code=>{
 writeFileSync(join(dir,'raw.log'),output,{mode:0o600});
 const clean=output.replace(/\x1b\[[0-9;]*[A-Za-z]/g,'');
 const operations=[];
 for(const line of clean.split('\n')){
  // SST normal diff prints `| Create LogicalName type (duration)`.
  const m=line.match(/(?:^|\|)\s*(Create|Update|Delete|Replace|Same|Retain|Import)\s+([A-Za-z][A-Za-z0-9_.:-]*)(?:\s+([A-Za-z][A-Za-z0-9_:./-]*))?/i);
  if(m)operations.push({operation:m[1],resource:m[2],...(m[3]?{type:m[3]}:{})});
 }
 const errorCodes=[...new Set(clean.match(/\b(?:AccessDenied(?:Exception)?|UnauthorizedOperation|SecretMissingError|InvalidArgument|NoSuchBucket|ConflictException|ENOTFOUND|ETIMEDOUT)\b/g)??[])];
 console.log(JSON.stringify({stage:'production',exitCode:code,operations,errorCodes,rawOutputPublished:false}));
 if(code!==0||!operations.length){console.error('Preview needs review: no successful resource operation receipt. Raw diagnostics withheld.');process.exitCode=1;}
 rmSync(dir,{recursive:true,force:true});
});
