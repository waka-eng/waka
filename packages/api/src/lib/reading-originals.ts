import {and,eq,inArray,isNull,sql} from 'drizzle-orm';
import {attachments,inspirations,reflections} from '../db/index.js';
import {effectiveAttachmentStatus,effectiveAttachmentText} from './attachment-material.js';
import type {getDb} from './db.js';

export const READING_ORIGINAL_LIMIT=48;
const partLimit=1200;
const childLimit=4;

/** One owned read. A fifth child or oversized part is a sentinel, so a
 * truncated fingerprint cannot make repeated material look independent. */
export async function loadOwnedReadingOriginals(
  db:Pick<ReturnType<typeof getDb>,'select'>,profileId:string,ids:string[],includeAttachments=false,
){
  if(!ids.length)return [];
  if(ids.length>READING_ORIGINAL_LIMIT)throw new Error('Reading originals exceed source limit');
  // Keep this outer reference qualified inside both correlated subqueries.
  const originalId = sql`"inspirations"."id"`;
  const rows=await db.select({
    id:inspirations.id,createdAt:inspirations.createdAt,kind:inspirations.kind,
    text:sql<string>`left(${inspirations.text},${partLimit+1})`,
    reflections:sql<string[]>`ARRAY(SELECT left(${reflections.answer},${partLimit+1}) FROM ${reflections}
      WHERE ${reflections.profileId}=${profileId}::uuid AND ${reflections.inspirationId}=${originalId}
        AND NOT ${reflections.skipped} AND btrim(${reflections.answer})<>''
      ORDER BY ${reflections.createdAt},${reflections.id} LIMIT ${childLimit+1})`,
    media:includeAttachments ? sql<string[]>`ARRAY(SELECT left(${effectiveAttachmentText},${partLimit+1}) FROM ${attachments}
      WHERE ${attachments.profileId}=${profileId}::uuid AND ${attachments.inspirationId}=${originalId}
        AND ${effectiveAttachmentStatus}='ready' AND btrim(${effectiveAttachmentText})<>''
      ORDER BY ${attachments.createdAt},${attachments.id} LIMIT ${childLimit+1})` : sql<string[]>`ARRAY[]::text[]`,
  }).from(inspirations).where(and(eq(inspirations.profileId,profileId),inArray(inspirations.id,ids),isNull(inspirations.memoryExcludedAt)));
  return rows.map(row=>({...row,complete:row.reflections.length<=childLimit&&row.media.length<=childLimit&&
    [row.text,...row.reflections,...row.media].every(text=>text.length<=partLimit)}));
}
