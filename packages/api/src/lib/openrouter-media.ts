/** Endpoint-specific media contracts. No retry or cross-provider fallback. */
import {fetchModelWithTimeout} from './gemini-http.js';
import {buildOpenRouterHeaders,getOpenRouterApiKey,openRouterPrivacyPreferences,OpenRouterHttpError} from './openrouter-http.js';
import {recordModelUsage} from './model-usage.js';
import {GEMINI_EMBEDDING_DIMENSIONS,validateEmbeddingVector,type EmbeddingTaskType} from './inspiration-embeddings.js';
export const OPENROUTER_AUDIO_MODEL='google/gemini-3.5-transcribe';
const OR_EMBEDDING_MODEL='google/gemini-embedding-001';
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
type Options={apiKey?:string;fetchFn?:typeof fetch;signal?:AbortSignal;timeoutMs?:number;exchangeTimeoutMs?:number};
async function request(kind:'audio/transcriptions'|'embeddings',body:Record<string,unknown>,options:Options){
  const key=options.apiKey??getOpenRouterApiKey();if(!key)throw new Error('OpenRouter media credential is missing');
  const label=kind==='embeddings'?'embedding':'audio transcription',started=performance.now();let raw:unknown=null,recorded=false;
  const record=(outcome:'received'|'http_error'|'unknown')=>{recordModelUsage('openrouter',label,raw,performance.now()-started,outcome);recorded=true;};
  try{
    const privacy=openRouterPrivacyPreferences();
    const response=await fetchModelWithTimeout(options.fetchFn??fetch,'https://openrouter.ai/api/v1/'+kind,{
      method:'POST',headers:buildOpenRouterHeaders(key),signal:options.signal,
      body:JSON.stringify({...body,provider:{...privacy,require_parameters:true}}),
    },options.timeoutMs,options.exchangeTimeoutMs);
    if(!response.ok){record('http_error');throw new OpenRouterHttpError('OpenRouter media HTTP failure',response.status);}
    try{raw=await response.json();}catch{throw new Error('OpenRouter media response JSON was invalid');}
    record('received');return raw;
  }catch(error){if(!recorded)record('unknown');throw error;}
}
export async function requestAudioTranscript(bytes:Uint8Array,mimeType:string,options:Options={}){
  const formats:Record<string,string>={'audio/wav':'wav','audio/mpeg':'mp3','audio/mp4':'m4a','audio/ogg':'ogg','audio/webm':'webm'};
  const format=formats[mimeType];if(!format)throw new Error('Unsupported OpenRouter audio format');
  const raw=await request('audio/transcriptions',{model:OPENROUTER_AUDIO_MODEL,
    input_audio:{data:Buffer.from(bytes).toString('base64'),format}},options);
  if(!object(raw)||typeof raw.text!=='string'||raw.text.length>16000)throw new Error('OpenRouter transcript response was invalid');
  return {model:OPENROUTER_AUDIO_MODEL,transcript:raw.text.trim()};
}
/** OFFLINE/PARITY CANDIDATE ONLY. Never selected by runtime factories. Its
 * deliberately distinct namespace cannot masquerade as calibrated stored vectors.
 * A later reviewed activation needs direct/OR parity + compatible-reader proof. */
export class OpenRouterEmbeddingCandidate {
  readonly model='openrouter:google/gemini-embedding-001:unverified';
  constructor(private readonly options:Options={}){}
  async embed(input:string,taskType:EmbeddingTaskType='RETRIEVAL_DOCUMENT'){
    const raw=await request('embeddings',{model:OR_EMBEDDING_MODEL,input,dimensions:GEMINI_EMBEDDING_DIMENSIONS,
      encoding_format:'float',input_type:taskType==='RETRIEVAL_QUERY'?'search_query':'search_document'},this.options);
    if(!object(raw)||raw.model!==OR_EMBEDDING_MODEL||!Array.isArray(raw.data)||raw.data.length!==1)throw new Error('OpenRouter embedding response was invalid');
    const row=raw.data[0];if(!object(row)||row.index!==0||!Array.isArray(row.embedding)||!row.embedding.every(v=>typeof v==='number'))throw new Error('OpenRouter embedding vector was invalid');
    return validateEmbeddingVector(row.embedding);
  }
}
