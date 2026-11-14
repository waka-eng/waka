import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {classifyPreviewFailure} from './production-preview-diagnostics.mjs';
/** SST3.19.3 secret set reads stdin when value is omitted. Never put the key
 * in argv or inherit child output (which could contain a credential on error). */
export async function setDevelopmentOpenAiSecret({key,stage,launch=spawn}){
 if(!['development','dev'].includes(stage))throw new Error('OpenAI secret setter requires an explicit dev stage');
 if(typeof key!=='string'||!key.trim()||key!==key.trim()||/[\r\n\0]/.test(key))throw new Error('Development OpenAI key is missing or malformed');
 const env={...process.env};delete env.OPENAI_API_KEY;
 let child;
 try{child=launch('pnpm',['sst','secret','set','OpenAiApiKey','--stage',stage],{env,stdio:['pipe','pipe','pipe'],timeout:120000});}
 catch{throw new Error('Development OpenAI secret setup: child_start_failed');}
 // Bounded in-memory classification only. Never persist/print child text.
 let diagnostic='';const drain=chunk=>{if(diagnostic.length<65536)diagnostic+=String(chunk).slice(0,65536-diagnostic.length);};
 child.stdout?.on('data',drain);child.stderr?.on('data',drain);
 const ended=new Promise((accept,reject)=>{child.once('error',()=>reject(new Error('Development OpenAI secret setup: child_start_failed')));child.once('close',code=>{
  if(code===0){accept(undefined);return;}
  const classes=classifyPreviewFailure(diagnostic).categories;
  reject(new Error(`Development OpenAI secret setup: child_exit=${Number.isInteger(code)?code:'terminated'} categories=${classes.join(',')||'unknown'}. Check the dev stage, credential and SST access.`));
 });});
 child.stdin.on('error',()=>{});child.stdin.end(key);await ended;
 return {stage,secret:'OpenAiApiKey',passed:true,credentialInArgv:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(await setDevelopmentOpenAiSecret({key:process.env.OPENAI_API_KEY,stage:process.env.SST_STAGE})));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
