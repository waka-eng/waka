/** Proposed text-only space. It is NOT active or quality-calibrated.
 * Changing any wire model, format, dimensions, endpoint or normalization policy
 * requires a new versioned identity; native001 vectors never share this ID. */
import {createHash} from 'node:crypto';
import type {EmbeddingTaskType} from './inspiration-embeddings.js';

export const EMBEDDING_2_SPACE = Object.freeze({
  id: 'waka.embedding.gemini-2.text-retrieval.v1.768.raw',
  wireModel: 'google/gemini-embedding-2',
  provider: 'google-ai-studio',
  dimensions: 768,
  documentPrefix: 'title: none | text: ',
  queryPrefix: 'task: search result | query: ',
  normalization: 'provider-output-raw-no-client-l2-v1',
  inputHash: 'sha256-exact-formatted-utf8-v1',
});

/** Domain inputs are already canonicalized by the existing caller. Do not trim,
 * truncate, translate, or rewrite them here. Model2 task instructions are text,
 * rather than task_type or an assumed broker input_type mapping. */
export function formatEmbedding2Input(input: string, task: EmbeddingTaskType): string {
  if (typeof input !== 'string' || input.length === 0) throw new Error('Embedding2 input is empty');
  if (task === 'RETRIEVAL_DOCUMENT') return EMBEDDING_2_SPACE.documentPrefix + input;
  if (task === 'RETRIEVAL_QUERY') return EMBEDDING_2_SPACE.queryPrefix + input;
  throw new Error('Embedding2 task is invalid');
}

/** This new-space hash cannot stand in for native001's raw-canonical hash. */
export function hashEmbedding2Input(input: string, task: EmbeddingTaskType): string {
  return createHash('sha256').update(formatEmbedding2Input(input, task), 'utf8').digest('hex');
}
