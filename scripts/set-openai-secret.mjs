import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {classifyPreviewFailure} from './production-preview-diagnostics.mjs';
/** SST3.19.3 secret set reads stdin when value is omitted. Never put the key
 * in argv or inherit child output (which could contain a credential on error). */
async function setRuntimeSecret({key,stage,secret,launch=spawn}){
 const label=secret==='OpenAiApiKey'?'OpenAI':'Turnstile';
 if(!['development','dev','production'].includes(stage))throw new Error(`${label} secret setter requires an explicit development/dev/production stage`);
 if(typeof key!=='string'||!key.trim()||key.length>4096||key!==key.trim()||/[\r\n\0]/.test(key)||secret==='TurnstileSecret'&&(!/^[\x21-\x7e]{10,256}$/.test(key)||stage==='production'&&/^[123]x0/.test(key)))throw new Error(`${label} key is missing or malformed`);
 const env={...process.env};for(const name of ['OPENAI_API_KEY','OPENAI_API_KEY_DEVELOPMENT','OPENAI_API_KEY_PRODUCTION','SST_SECRET_OpenAiApiKey','WAKA_TURNSTILE_SECRET','TURNSTILE_SECRET_PRODUCTION','SST_SECRET_TurnstileSecret'])delete env[name];
 let child;
 try{child=launch('pnpm',['sst','secret','set',secret,'--stage',stage],{env,stdio:['pipe','pipe','pipe'],timeout:120000});}
 catch{throw new Error(`${label} secret setup: child_start_failed`);}
 // Bounded in-memory classification only. Never persist/print child text.
 let diagnostic='';const drain=chunk=>{if(diagnostic.length<65536)diagnostic+=String(chunk).slice(0,65536-diagnostic.length);};
 child.stdout?.on('data',drain);child.stderr?.on('data',drain);
 const ended=new Promise((accept,reject)=>{child.once('error',()=>reject(new Error(`${label} secret setup: child_start_failed`)));child.once('close',code=>{
  if(code===0){accept(undefined);return;}
  const classes=classifyPreviewFailure(diagnostic).categories;
  reject(new Error(`${label} secret setup: child_exit=${Number.isInteger(code)?code:'terminated'} categories=${classes.join(',')||'unknown'}. Check the explicit stage, credential and SST access.`));
 });});
 child.stdin.on('error',()=>{});child.stdin.end(key);await ended;
 return {stage,secret,passed:true,credentialInArgv:false};
}
export const setOpenAiSecret=input=>setRuntimeSecret({...input,secret:'OpenAiApiKey'});
export const setTurnstileSecret=input=>setRuntimeSecret({...input,secret:'TurnstileSecret'});
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2);if(args.length>1||args.length===1&&args[0]!=='--turnstile')throw new Error('Secret setup: unsupported operation');
  console.log(JSON.stringify(await (args.length?setTurnstileSecret({key:process.env.WAKA_TURNSTILE_SECRET,stage:process.env.SST_STAGE}):setOpenAiSecret({key:process.env.OPENAI_API_KEY,stage:process.env.SST_STAGE}))));
 }
 catch(error){console.error(error.message);process.exitCode=1;}
}
