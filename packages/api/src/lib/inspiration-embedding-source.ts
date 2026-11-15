/** Pure canonical source reader; no provider/credentials/queue or DB singleton. */
import {and,eq,sql} from 'drizzle-orm';
import type {PostgresJsDatabase} from 'drizzle-orm/postgres-js';
import {attachments,inspirations,type Attachment,type Reflection,type InspirationEmbeddingScope} from '../db/index.js';
import type * as dbSchema from '../db/index.js';
import {effectiveAttachmentText} from './attachment-material.js';
import {EMBEDDING_SOURCE_READ_LIMITS,EmbeddingSourceReadLimit} from './embedding-source-limits.js';
type WakaDb=PostgresJsDatabase<typeof dbSchema>;
const CANONICAL_INPUT_VERSION='waka.inspiration_embedding_input.v1';
export type CanonicalReflectionInput = Pick<
  Reflection,
  "question" | "answer" | "skipped" | "createdAt"
>;

export type CanonicalAttachmentInput = Pick<Attachment, "type" | "enrichmentText">;

export interface CanonicalInspirationEmbeddingInput {
  text: string;
  kind: string | null;
  /**
   * Human-authored Q&A on the capture. The strongest context an inspiration
   * carries: the person saying, in their own words, why this mattered.
   */
  reflections?: CanonicalReflectionInput[];
  /**
   * What was saved alongside the text — a link's page body, an image's
   * description. Without it a bare link embeds as a URL, which resembles every
   * other URL and nothing else.
   */
  attachments?: CanonicalAttachmentInput[];
}

function normalizeTextForEmbedding(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

/**
 * Pure canonical input builder for inspiration embeddings.
 *
 * Deliberately small and ordered: the same capture must produce the same bytes
 * on every host, or the hash stops meaning "this content already has a vector".
 */
export function buildCanonicalInspirationEmbeddingInput(
  inspiration: CanonicalInspirationEmbeddingInput,
): string {
  const text = normalizeTextForEmbedding(inspiration.text);
  const kind = inspiration.kind?.trim() || "null";

  const reflectionLines = (inspiration.reflections ?? [])
    .filter(
      (reflection) =>
        !reflection.skipped &&
        normalizeTextForEmbedding(reflection.answer ?? "").length > 0,
    )
    .map((reflection, index) => {
      const question = normalizeTextForEmbedding(reflection.question);
      const answer = normalizeTextForEmbedding(reflection.answer ?? "");
      return [
        `reflection_${index + 1}_question:`,
        question,
        `reflection_${index + 1}_answer:`,
        answer,
      ].join("\n");
    });

  const attachmentLines = (inspiration.attachments ?? [])
    .filter(
      (attachment) => normalizeTextForEmbedding(attachment.enrichmentText ?? "").length > 0,
    )
    .map((attachment, index) => {
      const enrichment = normalizeTextForEmbedding(attachment.enrichmentText ?? "");
      return [`attachment_${index + 1}_${attachment.type}:`, enrichment].join("\n");
    });

  return [
    CANONICAL_INPUT_VERSION,
    `kind:${kind}`,
    "text:",
    text,
    "attachments:",
    attachmentLines.length > 0 ? attachmentLines.join("\n") : "none",
    "reflections:",
    reflectionLines.length > 0 ? reflectionLines.join("\n") : "none",
  ].join("\n");
}

/** Shared canonical reader for the model2 indexer/operator. Native callers keep
 * their existing transaction and exact canonical-v1 bytes. */
export async function readInspirationEmbeddingSource(db:WakaDb,profileId:string,id:string,scope:InspirationEmbeddingScope,lock:boolean|'nowait'=false,accountId?:string){
 const {bytesPerKind:bytes,childrenPerKind:children}=EMBEDDING_SOURCE_READ_LIMITS;
 const q=accountId?null:db.select({id:inspirations.id,profileId:inspirations.profileId,kind:inspirations.kind,visibility:inspirations.visibility,memoryExcludedAt:inspirations.memoryExcludedAt,
  text:sql<string|null>`CASE WHEN octet_length(${inspirations.text})<=${bytes} THEN ${inspirations.text} END`,oversized:sql<boolean>`octet_length(${inspirations.text})>${bytes}`}).from(inspirations).where(and(eq(inspirations.profileId,profileId),eq(inspirations.id,id))).limit(1);
 const owned=accountId?sql` AND EXISTS(SELECT 1 FROM profiles owner WHERE owner.id=${profileId}::uuid AND owner.account_id=${accountId}::uuid)`:sql``;
 // C0 uses execute-only bounded reads; native callers retain the original query.
 const source=accountId?(await db.execute<{id:string;profileId:string;kind:string|null;visibility:'public'|'private';memoryExcludedAt:Date|null;text:string|null;oversized:boolean}>(sql`SELECT id,profile_id AS "profileId",
  CASE WHEN octet_length(coalesce(kind::text,''))<=${bytes} THEN kind::text END AS kind,visibility,memory_excluded_at AS "memoryExcludedAt",
  CASE WHEN octet_length(text)<=${bytes} THEN text END AS text,
  octet_length(text)>${bytes} OR octet_length(coalesce(kind::text,''))>${bytes} AS oversized
  FROM inspirations WHERE profile_id=${profileId}::uuid AND id=${id}::uuid${owned} LIMIT 1`))[0]
  :(await(lock?q!.for('update',lock==='nowait'?{noWait:true}:{}):q!))[0];
 if(!source)return null;
 if(source.memoryExcludedAt||scope==='public'&&source.visibility!=='public')return {source:{...source,text:source.text??''},input:''};
 if(source.oversized||source.text===null)throw new EmbeddingSourceReadLimit();
 // Window bounds suppress oversized fields on the SERVER. At most65 metadata
 // rows per kind cross the connection; accepted raw UTF8 field totals are
 // <=48k parent +48k reflections +48k media (plus protocol/row overhead).
 // Locks stay on real bounded child rows before computing window aggregates.
 const answers=scope==='public'?[]:await db.execute<{question:string|null;answer:string|null;skipped:boolean;created_at:string;within_bounds:boolean}>(sql`WITH held AS MATERIALIZED (
   SELECT id,question,answer,skipped,created_at FROM reflections WHERE profile_id=${profileId}::uuid AND inspiration_id=${id}::uuid${owned} ORDER BY created_at,id LIMIT ${children+1} ${lock?sql`FOR SHARE ${lock==='nowait'?sql`NOWAIT`:sql``}`:sql``}
  ), bounded AS (SELECT *,count(*) OVER() AS n,sum(octet_length(question)+octet_length(coalesce(answer,''))) OVER() AS bytes FROM held)
  SELECT CASE WHEN n<=${children} AND bytes<=${bytes} THEN question END AS question,CASE WHEN n<=${children} AND bytes<=${bytes} THEN answer END AS answer,skipped,created_at::text,n<=${children} AND bytes<=${bytes} AS within_bounds FROM bounded ORDER BY bounded.created_at,bounded.id`);
 if(answers.some(r=>!r.within_bounds))throw new EmbeddingSourceReadLimit();
 const media=await db.execute<{type:Attachment['type'];enrichment_text:string|null;within_bounds:boolean}>(sql`WITH held AS MATERIALIZED (
   SELECT ${attachments.id} AS id,${attachments.type} AS type,${effectiveAttachmentText} AS text,${attachments.createdAt} AS created_at FROM ${attachments} WHERE ${attachments.profileId}=${profileId}::uuid AND ${attachments.inspirationId}=${id}::uuid${owned} ORDER BY ${attachments.createdAt},${attachments.id} LIMIT ${children+1} ${lock?sql`FOR SHARE ${lock==='nowait'?sql`NOWAIT`:sql``}`:sql``}
  ), bounded AS (SELECT *,count(*) OVER() AS n,sum(octet_length(coalesce(text,''))) OVER() AS bytes FROM held)
  SELECT type,CASE WHEN n<=${children} AND bytes<=${bytes} THEN text END AS enrichment_text,n<=${children} AND bytes<=${bytes} AS within_bounds FROM bounded ORDER BY bounded.created_at,bounded.id`);
 if(answers.some(r=>!r.within_bounds)||media.some(r=>!r.within_bounds))throw new EmbeddingSourceReadLimit();
 return {source:{...source,text:source.text},input:buildCanonicalInspirationEmbeddingInput({text:source.text,kind:source.kind,reflections:answers.map(r=>({question:r.question!,answer:r.answer,skipped:r.skipped,createdAt:new Date(r.created_at)})),attachments:media.map(r=>({type:r.type,enrichmentText:r.enrichment_text}))})};
}
