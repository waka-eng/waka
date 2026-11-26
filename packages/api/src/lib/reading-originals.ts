import {and,eq,inArray,isNull,sql} from 'drizzle-orm';
import {inspirations,reflections} from '../db/index.js';
import type {getDb} from './db.js';

export const READING_ORIGINAL_LIMIT=48;
const partLimit=1200;
const childLimit=4;

/** Bounded owned excerpts for the Principle grounding review. */
export async function loadOwnedReadingOriginals(
  db:Pick<ReturnType<typeof getDb>,'select'>,profileId:string,ids:string[],
){
  if(!ids.length)return [];
  if(ids.length>READING_ORIGINAL_LIMIT)throw new Error('Reading originals exceed source limit');
  // Keep this outer reference qualified inside the correlated subquery.
  const originalId = sql`"inspirations"."id"`;
  return db.select({
    id:inspirations.id,kind:inspirations.kind,
    text:sql<string>`left(${inspirations.text},${partLimit+1})`,
    reflections:sql<string[]>`ARRAY(SELECT left(${reflections.answer},${partLimit+1}) FROM ${reflections}
      WHERE ${reflections.profileId}=${profileId}::uuid AND ${reflections.inspirationId}=${originalId}
        AND NOT ${reflections.skipped} AND btrim(${reflections.answer})<>''
      ORDER BY ${reflections.createdAt},${reflections.id} LIMIT ${childLimit+1})`,
  }).from(inspirations).where(and(eq(inspirations.profileId,profileId),inArray(inspirations.id,ids),isNull(inspirations.memoryExcludedAt)));
}
