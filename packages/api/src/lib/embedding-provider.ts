import {
  GEMINI_EMBEDDING_MODEL,
  type GeminiEmbeddingClient,
  hashEmbeddingInput,type EmbeddingTaskType,
} from './inspiration-embeddings.js';
import {cosineSimilarity} from '../scoring/vector.js';
import {EMBEDDING_2_SPACE,hashEmbedding2Input} from './embedding-2-space.js';
import {embeddingPolicyValidated,type EmbeddingIndexPolicy} from './embedding-policy.js';

export type EmbeddingSpace = {readonly model: string; readonly dimensions: number};
const model2Space = Object.freeze({model: EMBEDDING_2_SPACE.id, dimensions: EMBEDDING_2_SPACE.dimensions});

export class EmbeddingProviderUnavailableError extends Error {
  constructor(readonly code: 'compatibility_held' | 'invalid_configuration') {
    super(`Embedding transport unavailable: ${code}`);
    this.name = 'EmbeddingProviderUnavailableError';
  }
}

/** A historical or unprepared policy grants no semantic access. */
export function readableEmbeddingSpace(policy?:EmbeddingIndexPolicy): EmbeddingSpace|null {
  return policy && embeddingPolicyValidated(policy.activeSpace,policy.activeThresholdPolicy) ? model2Space : null;
}

export function embeddingInputHash(space:EmbeddingSpace|string,input:string,task:EmbeddingTaskType='RETRIEVAL_DOCUMENT'){
 const model=typeof space==='string'?space:space.model;return model===EMBEDDING_2_SPACE.id?hashEmbedding2Input(input,task):hashEmbeddingInput(input);
}

/** Explicit injected clients may advertise a synthetic test space. Runtime
 * deployment uses the policy-bound factory below. */
export function embeddingSpaceForClient(client: {readonly model: string; readonly dimensions?: number}): EmbeddingSpace {
  const dimensions = client.dimensions ?? model2Space.dimensions;
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 4096 ||
      client.model === GEMINI_EMBEDDING_MODEL || (client.model === model2Space.model && dimensions !== model2Space.dimensions)) {
    throw new EmbeddingProviderUnavailableError('invalid_configuration');
  }
  return {model: client.model, dimensions};
}

export function createEmbeddingClient(
  deadlines?: {timeoutMs: number; exchangeTimeoutMs: number; beforeDispatch?:()=>void},
  policy?:EmbeddingIndexPolicy,
  selection:'active'|'building'='active',
): GeminiEmbeddingClient {
  if (selection === 'building') {
    if (policy?.buildingSpace !== model2Space.model) throw new EmbeddingProviderUnavailableError('invalid_configuration');
  } else if (!readableEmbeddingSpace(policy)) {
    throw new EmbeddingProviderUnavailableError('compatibility_held');
  }
  return {
    ...model2Space,
    embed: async (input,task='RETRIEVAL_DOCUMENT') => {
      const {OpenRouterEmbedding2Candidate}=await import('./openrouter-media.js');
      return new OpenRouterEmbedding2Candidate(deadlines).embed(input,task);
    },
  };
}

/** A missing or held transport spends no lookup slot. */
export function configuredEmbeddingClient(deadlines: {timeoutMs: number; exchangeTimeoutMs: number},policy?:EmbeddingIndexPolicy) {
  if (!readableEmbeddingSpace(policy)) return {client:null,availability:'compatibility_held' as const};
  if (!process.env.OPENROUTER_API_KEY?.trim()) return {client:null,availability:'not_configured' as const};
  return {client:createEmbeddingClient(deadlines,policy),availability:'ready' as const};
}

/** Metadata and actual finite nonzero geometry must agree. No rescaling. */
export function embeddingInSpace(values: unknown, dimensions: number, space: EmbeddingSpace): values is number[] {
  return dimensions === space.dimensions && Array.isArray(values) && values.length === space.dimensions &&
    values.every(value => typeof value === 'number' && Number.isFinite(value)) &&
    Number.isFinite(cosineSimilarity(values, values));
}
