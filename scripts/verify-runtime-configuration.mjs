import {readFileSync} from 'node:fs';
import {verifyRuntimeConfiguration} from './runtime-config-policy.mjs';
// The input may contain secret values; neither contents nor parse errors are echoed.
const stage=process.argv.find(arg=>arg.startsWith('--stage='))?.slice(8);
const file=process.argv.find(arg=>arg.startsWith('--config='))?.slice(9);
try{
  if(!file)throw new Error('Pass an explicit --config file with API and worker environment objects');
  let config;try{config=JSON.parse(readFileSync(file,'utf8'));}catch{throw new Error('Could not parse the supplied runtime configuration');}
  console.log(JSON.stringify(verifyRuntimeConfiguration(config,stage)));
}catch(error){console.error(error instanceof Error?error.message:'Runtime configuration verification failed');process.exitCode=1;}
