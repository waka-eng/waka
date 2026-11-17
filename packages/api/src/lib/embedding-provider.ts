/** Transport and vector space are separate. The owned active policy selects
 * model2; a global provider flag never grants it native001 identity. Missing
 * policy remains native001. No activation or threshold calibration occurs here. */
import {
  GEMINI_EMBEDDING_DIMENSIONS,
  GEMINI_EMBEDDING_MODEL,
  GeminiEmbeddingHttpClient,
  type GeminiEmbeddingClient,
  hashEmbeddingInput,type EmbeddingTaskType,
} from './inspiration-embeddings.js';
import {cosineSimilarity} from '../scoring/vector.js';
import {EMBEDDING_2_SPACE,hashEmbedding2Input} from './embedding-2-space.js';
import {assertKnownEmbeddingPolicy,type EmbeddingIndexPolicy} from './embedding-policy.js';

export type EmbeddingSpace = {readonly model: string; readonly dimensions: number};
const nativeSpace = Object.freeze({model: GEMINI_EMBEDDING_MODEL, dimensions: GEMINI_EMBEDDING_DIMENSIONS});

export class EmbeddingProviderUnavailableError extends Error {
  constructor(readonly code: 'compatibility_held' | 'invalid_configuration') {
    super(`Embedding transport unavailable: ${code}`);
    this.name = 'EmbeddingProviderUnavailableError';
  }
}

/** Cached native memory remains readable even when a requested transport is held. */
export function readableEmbeddingSpace(policy?:EmbeddingIndexPolicy): EmbeddingSpace {
  if(!policy)return nativeSpace;try{assertKnownEmbeddingPolicy(policy);}catch{throw new EmbeddingProviderUnavailableError('invalid_configuration');}
  return policy.activeSpace===EMBEDDING_2_SPACE.id?{model:EMBEDDING_2_SPACE.id,dimensions:EMBEDDING_2_SPACE.dimensions}:nativeSpace;
}

export function embeddingInputHash(space:EmbeddingSpace|string,input:string,task:EmbeddingTaskType='RETRIEVAL_DOCUMENT'){
 const model=typeof space==='string'?space:space.model;return model===EMBEDDING_2_SPACE.id?hashEmbedding2Input(input,task):hashEmbeddingInput(input);
}

/** Explicit injected clients may advertise a synthetic test space. Runtime
 * selection grants only the native factory below; a model name is no OR proof. */
export function embeddingSpaceForClient(client: {readonly model: string; readonly dimensions?: number}): EmbeddingSpace {
  const dimensions = client.dimensions ?? nativeSpace.dimensions;
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 4096 ||
      (([nativeSpace.model,EMBEDDING_2_SPACE.id] as readonly string[]).includes(client.model) && dimensions !== nativeSpace.dimensions)) {
    throw new EmbeddingProviderUnavailableError('invalid_configuration');
  }
  return {model: client.model, dimensions};
}

export function requestedEmbeddingTransport(): 'gemini' | 'openrouter' {
  const value = process.env.WAKA_EMBEDDING_PROVIDER;
  if (value === undefined || value === '' || value === 'gemini') return 'gemini';
  if (value === 'openrouter') return 'openrouter';
  throw new EmbeddingProviderUnavailableError('invalid_configuration');
}

export function createEmbeddingClient(deadlines?: {timeoutMs: number; exchangeTimeoutMs: number;beforeDispatch?:()=>void},policy?:EmbeddingIndexPolicy,selection:'active'|'building'='active'): GeminiEmbeddingClient {
  if(selection==='building'&&policy?.buildingSpace!==EMBEDDING_2_SPACE.id)throw new EmbeddingProviderUnavailableError('invalid_configuration');
  if(selection==='building'||readableEmbeddingSpace(policy).model===EMBEDDING_2_SPACE.id)return {model:EMBEDDING_2_SPACE.id,dimensions:EMBEDDING_2_SPACE.dimensions,embed:async(input,task='RETRIEVAL_DOCUMENT')=>{const {OpenRouterEmbedding2Candidate}=await import('./openrouter-media.js');return new OpenRouterEmbedding2Candidate(deadlines).embed(input,task);}};
  if (requestedEmbeddingTransport() === 'openrouter') {
    throw new EmbeddingProviderUnavailableError('compatibility_held');
  }
  if(deadlines?.beforeDispatch)throw new EmbeddingProviderUnavailableError('invalid_configuration');
  return new GeminiEmbeddingHttpClient(nativeSpace.model, deadlines);
}

/** Preserve chat's optional lookup; a held transport spends no lookup slot. */
export function configuredEmbeddingClient(deadlines: {timeoutMs: number; exchangeTimeoutMs: number},policy?:EmbeddingIndexPolicy) {
  if(readableEmbeddingSpace(policy).model===EMBEDDING_2_SPACE.id){return !process.env.OPENROUTER_API_KEY?{client:null,availability:'not_configured' as const}:{client:createEmbeddingClient(deadlines,policy),availability:'ready' as const};}
  if (requestedEmbeddingTransport() === 'openrouter') {
    return {client: null, availability: 'compatibility_held' as const};
  }
  if (!process.env.GEMINI_API_KEY && !process.env.SST_RESOURCE_GeminiApiKey) {
    return {client: null, availability: 'not_configured' as const};
  }
  return {client: createEmbeddingClient(deadlines,policy), availability: 'ready' as const};
}

/** Metadata and actual finite nonzero geometry must agree. No rescaling. */
export function embeddingInSpace(values: unknown, dimensions: number, space: EmbeddingSpace): values is number[] {
  return dimensions === space.dimensions && Array.isArray(values) && values.length === space.dimensions &&
    values.every(value => typeof value === 'number' && Number.isFinite(value)) &&
    Number.isFinite(cosineSimilarity(values, values));
}
