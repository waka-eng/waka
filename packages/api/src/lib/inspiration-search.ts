import {sql} from 'drizzle-orm';
import {inspirations} from '../db/index.js';
import type {getDb} from './db.js';

/** Parser policy, not a material revision. Migration 0067's trigger writes it. */
export const INSPIRATION_TEXT_SEARCH_POLICY=1;
/** Missing/unsupported coverage never hides an original. Only raw text is
 * projected; current owned reflection/media matching stays in the reader. */
export const currentInspirationTextSearchVector=sql`COALESCE(
  CASE WHEN ${inspirations.textSearchVectorPolicy}=${INSPIRATION_TEXT_SEARCH_POLICY} THEN ${inspirations.textSearchVector} END,
  to_tsvector('simple',${inspirations.text}))`;

/** Explicit maintenance only, never called by a read. Each bounded batch is
 * committed independently, skips busy rows and computes from locked current
 * text. Interruption can resume without a cursor or repeating completed rows. */
export async function backfillInspirationTextSearch(db:ReturnType<typeof getDb>,input:{limit?:number;profileId?:string}={}){
  const limit=input.limit??250;
  if(!Number.isSafeInteger(limit)||limit<1||limit>1000)throw new Error('Search backfill batch must be 1 to 1000');
  if(input.profileId&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.profileId))throw new Error('Invalid backfill profile');
  return db.transaction(async tx=>{
    const rows=await tx.execute(sql`WITH batch AS (
      SELECT id FROM ${inspirations}
      WHERE (text_search_vector IS NULL OR text_search_vector_policy IS DISTINCT FROM ${INSPIRATION_TEXT_SEARCH_POLICY})
        ${input.profileId?sql`AND profile_id=${input.profileId}::uuid`:sql``}
      ORDER BY id LIMIT ${limit} FOR UPDATE SKIP LOCKED
    ) UPDATE ${inspirations} SET text_search_vector=to_tsvector('simple',text),
      text_search_vector_policy=${INSPIRATION_TEXT_SEARCH_POLICY}
      WHERE id IN (SELECT id FROM batch) RETURNING id`);
    return {updated:rows.length};
  });
}
