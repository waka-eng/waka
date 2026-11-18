/** Embedding2 uses its own endpoint and exact response contract. */
import {fetchModelWithTimeout} from './gemini-http.js';
import {buildOpenRouterHeaders,getOpenRouterApiKey,openRouterPrivacyPreferences,OpenRouterHttpError,GOOGLE_AI_STUDIO_ROUTING} from './openrouter-http.js';
import {recordModelUsage} from './model-usage.js';
import {EMBEDDING_2_SPACE,formatEmbedding2Input} from './embedding-2-space.js';
import {parseEmbedding2Response} from './embedding-2-response.js';
import {EmbeddingDispatchExpired} from './embedding-dispatch.js';
import type {EmbeddingTaskType} from './inspiration-embeddings.js';
type Options={apiKey?:string;fetchFn?:typeof fetch;signal?:AbortSignal;timeoutMs?:number;exchangeTimeoutMs?:number;beforeDispatch?:()=>void};
async function requestEmbedding(body:Record<string,unknown>,options:Options){
  const key=options.apiKey??getOpenRouterApiKey();if(!key)throw new Error('OpenRouter media credential is missing');
  const label='embedding',started=performance.now();let raw:unknown=null,recorded=false;
  const record=(outcome:'received'|'http_error'|'unknown')=>{recordModelUsage('openrouter',label,raw,performance.now()-started,outcome);recorded=true;};
  try{
    const privacy=openRouterPrivacyPreferences();
    const transport:typeof fetch=(input,init)=>{options.beforeDispatch?.();return (options.fetchFn??fetch)(input,init);};
    const response=await fetchModelWithTimeout(transport,'https://openrouter.ai/api/v1/embeddings',{
      method:'POST',headers:buildOpenRouterHeaders(key),signal:options.signal,
      body:JSON.stringify({...body,provider:{...privacy,...GOOGLE_AI_STUDIO_ROUTING}}),
    },options.timeoutMs,options.exchangeTimeoutMs);
    if(!response.ok){record('http_error');throw new OpenRouterHttpError('OpenRouter media HTTP failure',response.status);}
    try{raw=await response.json();}catch{throw new Error('OpenRouter media response JSON was invalid');}
    record('received');return raw;
  }catch(error){if(!recorded&&!(error instanceof EmbeddingDispatchExpired))record('unknown');throw error;}
}
/** Uses the same formatted-input space for active and forward-build callers. */
export class OpenRouterEmbedding2Candidate {
  readonly model = EMBEDDING_2_SPACE.id;
  readonly dimensions = EMBEDDING_2_SPACE.dimensions;
  constructor(private readonly options: Options = {}) {}
  async embed(input: string, task: EmbeddingTaskType = 'RETRIEVAL_DOCUMENT') {
    const raw = await requestEmbedding({
      model: EMBEDDING_2_SPACE.wireModel,
      input: formatEmbedding2Input(input, task),
      dimensions: this.dimensions,
      encoding_format: 'float',
    }, {timeoutMs: 5000, exchangeTimeoutMs: 10000, ...this.options});
    // Exact acceptance remains strict; closed diagnostics identify its predicate.
    return parseEmbedding2Response(raw);
  }
}
