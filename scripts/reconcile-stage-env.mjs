import {readFileSync,writeFileSync,copyFileSync,mkdirSync,chmodSync,lstatSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {stageEnvAdditions,redactedStageInventory,validateStageOptions} from './stage-env-policy.mjs';
const require=createRequire(resolve('packages/api/package.json'));
const {parse}=require('dotenv');
try {
  const stage=process.argv.find(x=>x.startsWith('--stage='))?.slice(8);
  if(!['production','development'].includes(stage))throw Error('Choose an explicit stage');
  const file=resolve(`.env.${stage}`);if(!lstatSync(file).isFile()||lstatSync(file).isSymbolicLink())throw Error('Stage file must be a regular existing file');
  execFileSync('git',['check-ignore','-q',file],{stdio:'ignore'});
  // Read immediately before writing; never reuse earlier credential snapshots.
  const original=readFileSync(file,'utf8'),current=parse(original),additions=stageEnvAdditions(stage,current);
  validateStageOptions({...current,...additions});
  if(process.argv.includes('--write')) {
    const backup=resolve(`../waka-sync-backups/stage-env-${Date.now()}-${stage}`);mkdirSync(backup,{recursive:true,mode:0o700});chmodSync(backup,0o700);
    copyFileSync(file,resolve(backup,`.env.${stage}`));chmodSync(resolve(backup,`.env.${stage}`),0o600);
    const lines=Object.entries(additions).map(([key,value])=>`${value?'# Established default / same-stage mapping':'# MISSING/UNDECIDED: no value inferred; resource bindings require attestation'}\n${key}=${JSON.stringify(value)}`);
    const text=original.replace(/\s*$/,'\n')+'\n# PROD-RELEASE-ENV-001: existing values above are preserved.\n'+lines.join('\n')+'\n';
    // Refuse to overwrite a concurrent credential update.
    if(readFileSync(file,'utf8')!==original)throw Error('Stage file changed during reconciliation; retry from fresh values');
    writeFileSync(file,text,{mode:0o600});chmodSync(file,0o600);
    console.log(JSON.stringify({stage,privateBackup:backup,addedKeys:Object.keys(additions)}));
  }
  console.log(JSON.stringify({stage,inventory:redactedStageInventory(stage,current,additions)}));
} catch { console.error('Stage reconciliation refused; inspect stage, ignore rules, permissions and option names. No secret values are printed.');process.exitCode=1; }
