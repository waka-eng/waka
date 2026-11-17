/** Model2 source-read ceilings. Never truncate and embed a partial source. */
export const EMBEDDING_SOURCE_READ_LIMITS={bytesPerKind:48000,childrenPerKind:64} as const;
export class EmbeddingSourceReadLimit extends Error{
 constructor(){super('Embedding source exceeds the bounded reader');this.name='EmbeddingSourceReadLimit';}
}
