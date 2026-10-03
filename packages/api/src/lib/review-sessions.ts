import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { inspirationRevisions, inspirations, profiles, reflections, reviewItems, reviewSessions } from '../db/index.js';
import type { getDb } from './db.js';
import { hashEmbeddingInput } from './inspiration-embeddings.js';

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Reader = Pick<Tx,'select'>;
export const MAX_REVIEW_ITEMS = 5;
export class ReviewSessionError extends Error {
  constructor(public status:404|409, public code:string, message:string) {super(message);}
}

async function lockOwner(tx:Tx,profileId:string) {
  const [owner]=await tx.select({id:profiles.id}).from(profiles).where(eq(profiles.id,profileId)).for('key share');
  if (!owner) throw new ReviewSessionError(404,'profile_not_found','Profile not found');
  const [lock]=await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${`review-session:${profileId}`},0)) AS acquired`);
  if (lock?.acquired!==true) throw new ReviewSessionError(409,'review_busy','This review is changing. Check it again.');
}
async function present(db:Reader,profileId:string,id:string) {
  const [session]=await db.select().from(reviewSessions).where(and(eq(reviewSessions.profileId,profileId),eq(reviewSessions.id,id)));
  if (!session) return null;
  const rows=await db.select({item:reviewItems,currentRevision:inspirationRevisions.personalRevision,inspirationCreatedAt:inspirations.createdAt})
    .from(reviewItems).innerJoin(inspirations,and(eq(inspirations.profileId,reviewItems.profileId),eq(inspirations.id,reviewItems.inspirationId)))
    .innerJoin(inspirationRevisions,and(eq(inspirationRevisions.profileId,reviewItems.profileId),eq(inspirationRevisions.inspirationId,reviewItems.inspirationId)))
    .where(and(eq(reviewItems.profileId,profileId),eq(reviewItems.sessionId,id))).orderBy(asc(reviewItems.position));
  return {id:session.id,profileId,revision:session.revision,cursor:session.cursor,
    currentInspirationId:session.completedAt ? null : rows.find(row=>row.item.position>=session.cursor)?.item.inspirationId??null,
    createdAt:session.createdAt.toISOString(),completedAt:session.completedAt?.toISOString()??null,
    items:rows.map(({item,currentRevision,inspirationCreatedAt})=>({inspirationId:item.inspirationId,position:item.position,
      sourceRevision:item.sourceRevision.toString(),currentRevision:currentRevision.toString(),sourceChanged:item.sourceRevision!==currentRevision,
      reason:item.reason,choice:item.choice,decidedAt:item.decidedAt?.toISOString()??null,inspirationCreatedAt:inspirationCreatedAt.toISOString()}))};
}
export function readReviewSession(db:Db,profileId:string,id:string) {
  return db.transaction(tx=>present(tx,profileId,id),{isolationLevel:'repeatable read'});
}
export function readActiveReview(db:Db,profileId:string) {
  return db.transaction(async tx=>{
    const [active]=await tx.select({id:reviewSessions.id}).from(reviewSessions).where(and(eq(reviewSessions.profileId,profileId),isNull(reviewSessions.completedAt)));
    return active ? present(tx,profileId,active.id) : null;
  },{isolationLevel:'repeatable read'});
}

export function createReviewSession(db:Db,profileId:string,input:{id:string;inspirationIds?:string[]}) {
  const inputHash=hashEmbeddingInput(JSON.stringify(input.inspirationIds??null));
  return db.transaction(async tx=>{
    await lockOwner(tx,profileId);
    const [existing]=await tx.select().from(reviewSessions).where(and(eq(reviewSessions.profileId,profileId),eq(reviewSessions.id,input.id)));
    if (existing) {
      if (existing.inputHash!==inputHash) throw new ReviewSessionError(409,'review_request_changed','This review was started with a different selection.');
      return present(tx,profileId,existing.id);
    }
    const [active]=await tx.select({id:reviewSessions.id}).from(reviewSessions).where(and(eq(reviewSessions.profileId,profileId),isNull(reviewSessions.completedAt)));
    if (active) {
      if (input.inspirationIds) throw new ReviewSessionError(409,'review_already_open','Finish or resume your open review first.');
      return present(tx,profileId,active.id);
    }
    const reviewed=sql<boolean>`EXISTS (SELECT 1 FROM ${reviewItems} WHERE ${reviewItems.profileId}=${inspirations.profileId}
      AND ${reviewItems.inspirationId}=${inspirations.id} AND ${reviewItems.choice} IS NOT NULL)
      OR EXISTS (SELECT 1 FROM ${reflections} WHERE ${reflections.profileId}=${inspirations.profileId}
        AND ${reflections.inspirationId}=${inspirations.id} AND ${reflections.skipped}=false AND length(trim(${reflections.answer}))>0)`;
    const candidates=await tx.select({id:inspirations.id,reviewed}).from(inspirations)
      .where(and(eq(inspirations.profileId,profileId),input.inspirationIds?inArray(inspirations.id,input.inspirationIds):undefined))
      .orderBy(asc(reviewed),desc(inspirations.createdAt),desc(inspirations.id)).limit(MAX_REVIEW_ITEMS);
    if (input.inspirationIds && candidates.length!==input.inspirationIds.length) throw new ReviewSessionError(404,'inspiration_not_found','An inspiration is no longer available.');
    if (!candidates.length) return null;
    const ids=input.inspirationIds??candidates.map(row=>row.id);
    // Freeze only source identity while taking the revision, never across a
    // provider call. Consistent source lock order also covers manual ordering.
    const sources=await tx.select({id:inspirations.id}).from(inspirations)
      .where(and(eq(inspirations.profileId,profileId),inArray(inspirations.id,ids))).orderBy(asc(inspirations.id)).for('share');
    if (sources.length!==ids.length) throw new ReviewSessionError(409,'review_sources_changed','An inspiration changed. Start the review again.');
    const revisions=await tx.select().from(inspirationRevisions).where(and(eq(inspirationRevisions.profileId,profileId),inArray(inspirationRevisions.inspirationId,ids)))
      .orderBy(asc(inspirationRevisions.inspirationId)).for('share',{noWait:true});
    if (revisions.length!==ids.length) throw new ReviewSessionError(409,'review_sources_changed','Source versions are unavailable.');
    await tx.insert(reviewSessions).values({id:input.id,profileId,inputHash});
    await tx.insert(reviewItems).values(ids.map((inspirationId,position)=>({profileId,sessionId:input.id,inspirationId,position,
      sourceRevision:revisions.find(row=>row.inspirationId===inspirationId)!.personalRevision,
      reason:input.inspirationIds?'chosen' as const:candidates.find(row=>row.id===inspirationId)!.reviewed?'revisit' as const:'unreviewed' as const})));
    return present(tx,profileId,input.id);
  });
}

export function chooseReviewItem(db:Db,profileId:string,id:string,input:{revision:number;inspirationId:string;sourceRevision:string;choice:'keep'|'skip'|null}) {
  return db.transaction(async tx=>{
    await lockOwner(tx,profileId);
    const [session]=await tx.select().from(reviewSessions).where(and(eq(reviewSessions.profileId,profileId),eq(reviewSessions.id,id))).for('update');
    if (!session) throw new ReviewSessionError(404,'review_not_found','Review not found');
    if (session.completedAt) throw new ReviewSessionError(409,'review_completed','This review is already finished.');
    const [item]=await tx.select().from(reviewItems).where(and(eq(reviewItems.profileId,profileId),eq(reviewItems.sessionId,id),eq(reviewItems.inspirationId,input.inspirationId)));
    if (!item) throw new ReviewSessionError(404,'inspiration_not_found','This inspiration is no longer in the review.');
    await tx.select({id:inspirations.id}).from(inspirations).where(and(eq(inspirations.profileId,profileId),eq(inspirations.id,input.inspirationId))).for('share');
    const [source]=await tx.select().from(inspirationRevisions).where(and(eq(inspirationRevisions.profileId,profileId),eq(inspirationRevisions.inspirationId,input.inspirationId))).for('share',{noWait:true});
    if (!source || source.personalRevision.toString()!==input.sourceRevision) throw new ReviewSessionError(409,'review_source_changed','This inspiration changed. Read its current version first.');
    const cursor=input.choice===null?item.position:item.position+1;
    // Response-loss replay is a no-op only for exactly the already-applied
    // next revision, choice, source and cursor; never overwrite a later tab.
    if (session.revision===input.revision+1 && item.choice===input.choice && item.sourceRevision===source.personalRevision && session.cursor===cursor) return present(tx,profileId,id);
    if (session.revision!==input.revision) throw new ReviewSessionError(409,'review_changed','This review changed in another tab. Reload it first.');
    await tx.update(reviewItems).set({choice:input.choice,sourceRevision:source.personalRevision,decidedAt:input.choice===null?null:new Date()})
      .where(and(eq(reviewItems.profileId,profileId),eq(reviewItems.sessionId,id),eq(reviewItems.inspirationId,input.inspirationId)));
    await tx.update(reviewSessions).set({cursor,revision:session.revision+1,updatedAt:new Date()}).where(eq(reviewSessions.id,id));
    return present(tx,profileId,id);
  });
}

export function completeReviewSession(db:Db,profileId:string,id:string,revision:number) {
  return db.transaction(async tx=>{
    await lockOwner(tx,profileId);
    const [session]=await tx.select().from(reviewSessions).where(and(eq(reviewSessions.profileId,profileId),eq(reviewSessions.id,id))).for('update');
    if (!session) throw new ReviewSessionError(404,'review_not_found','Review not found');
    if (session.completedAt) return present(tx,profileId,id);
    if (session.revision!==revision) throw new ReviewSessionError(409,'review_changed','This review changed in another tab. Reload it first.');
    await tx.update(reviewSessions).set({completedAt:new Date(),updatedAt:new Date(),revision:revision+1}).where(eq(reviewSessions.id,id));
    return present(tx,profileId,id);
  });
}
