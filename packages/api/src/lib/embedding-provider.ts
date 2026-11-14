/** HTTP transport and vector space are separate contracts. Only the existing
 * native space is accepted. OpenRouter stays held until task/provider/768-dim
 * parity is reviewed; an env flag cannot grant it the native storage identity. */
import {
  GEMINI_EMBEDDING_DIMENSIONS,
  GEMINI_EMBEDDING_MODEL,
  GeminiEmbeddingHttpClient,
  type GeminiEmbeddingClient,
} from './inspiration-embeddings.js';
import {cosineSimilarity} from '../scoring/vector.js';

export type EmbeddingSpace = {readonly model: string; readonly dimensions: number};
const nativeSpace = Object.freeze({model: GEMINI_EMBEDDING_MODEL, dimensions: GEMINI_EMBEDDING_DIMENSIONS});

export class EmbeddingProviderUnavailableError extends Error {
  constructor(readonly code: 'compatibility_held' | 'invalid_configuration') {
    super(`Embedding transport unavailable: ${code}`);
    this.name = 'EmbeddingProviderUnavailableError';
  }
}

/** Cached native memory remains readable even when a requested transport is held. */
export function readableEmbeddingSpace(): EmbeddingSpace {
  return nativeSpace;
}

/** Explicit injected clients may advertise a synthetic test space. Runtime
 * selection grants only the native factory below; a model name is no OR proof. */
export function embeddingSpaceForClient(client: {readonly model: string; readonly dimensions?: number}): EmbeddingSpace {
  const dimensions = client.dimensions ?? nativeSpace.dimensions;
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 4096 ||
      (client.model === nativeSpace.model && dimensions !== nativeSpace.dimensions)) {
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

export function createEmbeddingClient(deadlines?: {timeoutMs: number; exchangeTimeoutMs: number}): GeminiEmbeddingClient {
  if (requestedEmbeddingTransport() === 'openrouter') {
    throw new EmbeddingProviderUnavailableError('compatibility_held');
  }
  return new GeminiEmbeddingHttpClient(nativeSpace.model, deadlines);
}

/** Preserve chat's optional lookup; a held transport spends no lookup slot. */
export function configuredEmbeddingClient(deadlines: {timeoutMs: number; exchangeTimeoutMs: number}) {
  if (requestedEmbeddingTransport() === 'openrouter') {
    return {client: null, availability: 'compatibility_held' as const};
  }
  if (!process.env.GEMINI_API_KEY && !process.env.SST_RESOURCE_GeminiApiKey) {
    return {client: null, availability: 'not_configured' as const};
  }
  return {client: createEmbeddingClient(deadlines), availability: 'ready' as const};
}

/** Metadata and actual finite nonzero geometry must agree. No rescaling. */
export function embeddingInSpace(values: unknown, dimensions: number, space: EmbeddingSpace): values is number[] {
  return dimensions === space.dimensions && Array.isArray(values) && values.length === space.dimensions &&
    values.every(value => typeof value === 'number' && Number.isFinite(value)) &&
    Number.isFinite(cosineSimilarity(values, values));
}
