import {verifyModelKeyLimit} from './model-key-policy.mjs';
// No env-file loading and no model request. Caller supplies one verified stage key.
const amount=Number(process.argv.find(arg=>arg.startsWith('--limit-usd='))?.slice(12));
const reset=process.argv.find(arg=>arg.startsWith('--reset='))?.slice(8);
try{
  // Validate policy before any request, never invent a recurring budget.
  verifyModelKeyLimit({limit:amount,limit_reset:reset,include_byok_in_limit:true},amount,reset);
  const key=process.env.OPENROUTER_API_KEY;if(!key)throw new Error('An explicit stage OpenRouter key is required');
  const response=await fetch('https://openrouter.ai/api/v1/key',{headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('Provider key policy lookup failed');
  let body;try{body=await response.json();}catch{throw new Error('Provider key policy response is invalid');}
  console.log(JSON.stringify(verifyModelKeyLimit(body?.data,amount,reset)));
}catch(error){
  // HTTP failure bodies and network exception messages can carry credentials.
  const allowed=new Set(['An explicit positive approved USD limit is required','An explicit approved reset period is required',
    'An explicit stage OpenRouter key is required','Provider key policy lookup failed','Provider key policy response is invalid',
    'Provider key has no qualifying enforced spending limit','Provider key reset period does not match the approved policy','Provider key limit must include BYOK usage']);
  const safe=error instanceof Error&&allowed.has(error.message)?error.message:'Provider key verification failed';
  console.error(safe);process.exitCode=1;
}
