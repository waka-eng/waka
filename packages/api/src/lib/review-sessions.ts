import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { attachments, inspirationRevisions, inspirations, profiles, reflections, reviewItems, reviewSessions } from '../db/index.js';
import {attachmentSelection,serializeAttachment} from '../routes/attachments.js';
import {inspirationSelection,reflectionSelection,serializeInspirationDetail} from '../routes/inspirations-serialization.js';
import {readConversationOrigin} from './conversation-capture.js';
import type { getDb } from './db.js';
import { hashEmbeddingInput } from './inspiration-embeddings.js';

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Reader = Pick<Tx,'select'>;
export const MAX_REVIEW_ITEMS = 5;
export class ReviewSessionError extends Error {
  constructor(public status:404|409|410|429, public code:string, message:string) {super(message);}
}

export async function lockReviewOwner(tx:Tx,profileId:string) {
  const [owner]=await tx.select({id:profiles.id}).from(profiles).where(eq(profiles.id,profileId)).for('key share');
  if (!owner) throw new ReviewSessionError(404,'profile_not_found','Profile not found');
  const [lock]=await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${`review-session:${profileId}`},0)) AS acquired`);
  if (lock?.acquired!==true) throw new ReviewSessionError(409,'review_busy','This review is changing. Check it again.');
}
async function present(db:Reader,profileId:string,id:string,includeCurrent=false) {
  const [session]=await db.select().from(reviewSessions).where(and(eq(reviewSessions.profileId,profileId),eq(reviewSessions.id,id)));
  if (!session) return null;
  const rows=await db.select({item:reviewItems,currentRevision:inspirationRevisions.personalRevision,inspirationCreatedAt:inspirations.createdAt})
    .from(reviewItems).innerJoin(inspirations,and(eq(inspirations.profileId,reviewItems.profileId),eq(inspirations.id,reviewItems.inspirationId)))
    .innerJoin(inspirationRevisions,and(eq(inspirationRevisions.profileId,reviewItems.profileId),eq(inspirationRevisions.inspirationId,reviewItems.inspirationId)))
    .where(and(eq(reviewItems.profileId,profileId),eq(reviewItems.sessionId,id))).orderBy(asc(reviewItems.position));
  const current=session.completedAt?null:rows.find(row=>row.item.position>=session.cursor)??null;
  let currentInspiration=null;
  if(includeCurrent&&current){
    const sourceId=current.item.inspirationId;
    const [source]=await db.select(inspirationSelection).from(inspirations).where(and(eq(inspirations.profileId,profileId),eq(inspirations.id,sourceId)));
    if(source){
      const [media,answers,origin]=await Promise.all([
        db.select(attachmentSelection).from(attachments).where(and(eq(attachments.profileId,profileId),eq(attachments.inspirationId,sourceId))).orderBy(asc(attachments.createdAt),asc(attachments.id)),
        db.select(reflectionSelection).from(reflections).where(and(eq(reflections.profileId,profileId),eq(reflections.inspirationId,sourceId))).orderBy(asc(reflections.createdAt),asc(reflections.id)),
        readConversationOrigin(db,profileId,sourceId),
      ]);
      currentInspiration={...serializeInspirationDetail(source,{attachments:media.map(serializeAttachment),reflections:answers}),materialRevision:current.currentRevision.toString(),...(origin?{conversationOrigin:origin}:{})};
    }
  }
  return {id:session.id,profileId,revision:session.revision,cursor:session.cursor,supportsAdvance:true,
    currentInspirationId:current?.item.inspirationId??null,
    ...(includeCurrent?{currentInspiration}:{}),
    createdAt:session.createdAt.toISOString(),completedAt:session.completedAt?.toISOString()??null,
    items:rows.map(({item,currentRevision,inspirationCreatedAt})=>({inspirationId:item.inspirationId,position:item.position,
      sourceRevision:item.sourceRevision.toString(),currentRevision:currentRevision.toString(),sourceChanged:item.sourceRevision!==currentRevision,
      reason:item.reason,choice:item.choice,decidedAt:item.decidedAt?.toISOString()??null,inspirationCreatedAt:inspirationCreatedAt.toISOString()}))};
}
export function readReviewSession(db:Db,profileId:string,id:string,includeCurrent=false) {
  return db.transaction(tx=>present(tx,profileId,id,includeCurrent),{isolationLevel:'repeatable read',accessMode:'read only'});
}
export function readActiveReview(db:Db,profileId:string,includeCurrent=false) {
  return db.transaction(async tx=>{
    const [active]=await tx.select({id:reviewSessions.id}).from(reviewSessions).where(and(eq(reviewSessions.profileId,profileId),isNull(reviewSessions.completedAt)));
    return active ? present(tx,profileId,active.id,includeCurrent) : null;
  },{isolationLevel:'repeatable read',accessMode:'read only'});
}

export function createReviewSession(db:Db,profileId:string,input:{id:string;inspirationIds?:string[]},includeCurrent=false) {
  const inputHash=hashEmbeddingInput(JSON.stringify(input.inspirationIds??null));
  return db.transaction(async tx=>{
    await lockReviewOwner(tx,profileId);
    return createReviewInTransaction(tx,profileId,input,includeCurrent,inputHash);
  },{isolationLevel:'repeatable read'});
}
async function createReviewInTransaction(tx:Tx,profileId:string,input:{id:string;inspirationIds?:string[]},includeCurrent:boolean,inputHash:string){
    const [existing]=await tx.select().from(reviewSessions).where(and(eq(reviewSessions.profileId,profileId),eq(reviewSessions.id,input.id)));
    if (existing) {
      if (existing.inputHash!==inputHash) throw new ReviewSessionError(409,'review_request_changed','This review was started with a different selection.');
      return present(tx,profileId,existing.id,includeCurrent);
    }
    const [active]=await tx.select({id:reviewSessions.id}).from(reviewSessions).where(and(eq(reviewSessions.profileId,profileId),isNull(reviewSessions.completedAt)));
    if (active) {
      if (input.inspirationIds) throw new ReviewSessionError(409,'review_already_open','Finish or resume your open review first.');
      return present(tx,profileId,active.id,includeCurrent);
    }
    const reviewed=sql<boolean>`EXISTS (SELECT 1 FROM ${reviewItems} WHERE ${reviewItems.profileId}=${inspirations.profileId}
      AND ${reviewItems.inspirationId}=${inspirations.id} AND ${reviewItems.choice} IS NOT NULL)
      OR EXISTS (SELECT 1 FROM ${reflections} WHERE ${reflections.profileId}=${inspirations.profileId}
        AND ${reflections.inspirationId}=${inspirations.id} AND ${reflections.skipped}=false AND length(trim(${reflections.answer}))>0)`;
    const lastReviewed=sql`(SELECT max(${reviewItems.decidedAt}) FROM ${reviewItems}
      WHERE ${reviewItems.profileId}=${inspirations.profileId} AND ${reviewItems.inspirationId}=${inspirations.id}
        AND ${reviewItems.choice} IS NOT NULL)`;
    const candidates=await tx.select({id:inspirations.id,reviewed}).from(inspirations)
      .where(and(eq(inspirations.profileId,profileId),input.inspirationIds?inArray(inspirations.id,input.inspirationIds)
        :sql`(${lastReviewed} IS NULL OR ${lastReviewed}<now()-interval '24 hours')`))
      .orderBy(asc(reviewed),sql`${lastReviewed} ASC NULLS FIRST`,desc(inspirations.createdAt),desc(inspirations.id))
      // Old explicit manifests remain readable/replayable. New suggested
      // reviews own exactly one inspiration, never a cross-source dialogue.
      .limit(input.inspirationIds?MAX_REVIEW_ITEMS:1);
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
    return present(tx,profileId,input.id,includeCurrent);
}

type ReviewChoice={revision:number;inspirationId:string;sourceRevision:string;choice:'keep'|'skip'|null};
export function chooseReviewItem(db:Db,profileId:string,id:string,input:ReviewChoice,includeCurrent=false) {
  return db.transaction(async tx=>{
    await lockReviewOwner(tx,profileId);
    return chooseReviewInTransaction(tx,profileId,id,input,includeCurrent);
  },{isolationLevel:'repeatable read'});
}
async function chooseReviewInTransaction(tx:Tx,profileId:string,id:string,input:ReviewChoice,includeCurrent=false){
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
    if (session.revision===input.revision+1 && item.choice===input.choice && item.sourceRevision===source.personalRevision && session.cursor===cursor) return present(tx,profileId,id,includeCurrent);
    if (session.revision!==input.revision) throw new ReviewSessionError(409,'review_changed','This review changed in another tab. Reload it first.');
    await tx.update(reviewItems).set({choice:input.choice,sourceRevision:source.personalRevision,decidedAt:input.choice===null?null:new Date()})
      .where(and(eq(reviewItems.profileId,profileId),eq(reviewItems.sessionId,id),eq(reviewItems.inspirationId,input.inspirationId)));
    await tx.update(reviewSessions).set({cursor,revision:session.revision+1,updatedAt:new Date()}).where(eq(reviewSessions.id,id));
    return present(tx,profileId,id,includeCurrent);
}

export type ReviewAdvanceInput=ReviewChoice&{nextId:string;choice:'keep'|'skip'};
/** One explicit Next saves the choice, closes the old review and loads the
 * next owned original atomically. A durable next ID binds response-loss replay. */
export function advanceReviewSession(db:Db,profileId:string,id:string,input:ReviewAdvanceInput){
  return db.transaction(async tx=>{
    await lockReviewOwner(tx,profileId);
    if(input.nextId===id)throw new ReviewSessionError(409,'review_request_changed','The next review needs its own id.');
    const hash=hashEmbeddingInput(JSON.stringify({previousId:id,...input}));
    const [previous]=await tx.select().from(reviewSessions).where(and(eq(reviewSessions.profileId,profileId),eq(reviewSessions.id,id))).for('update');
    if(!previous)throw new ReviewSessionError(404,'review_not_found','Review not found');
    const [next]=await tx.select().from(reviewSessions).where(and(eq(reviewSessions.profileId,profileId),eq(reviewSessions.id,input.nextId)));
    if(next){
      if(next.inputHash!==hash||!previous.completedAt)throw new ReviewSessionError(409,'review_request_changed','This next review belongs to a different request.');
      return present(tx,profileId,next.id,true);
    }
    if(previous.completedAt){
      const [item]=await tx.select().from(reviewItems).where(and(eq(reviewItems.profileId,profileId),eq(reviewItems.sessionId,id),eq(reviewItems.inspirationId,input.inspirationId)));
      if(previous.revision===input.revision+2&&item?.choice===input.choice&&item.sourceRevision.toString()===input.sourceRevision)return null;
      throw new ReviewSessionError(409,'review_completed','This review is already finished.');
    }
    const current=await present(tx,profileId,id);
    const replay=current?.revision===input.revision+1&&current.items.some(item=>item.inspirationId===input.inspirationId&&item.choice===input.choice&&item.sourceRevision===input.sourceRevision);
    if(!replay&&current?.currentInspirationId!==input.inspirationId)throw new ReviewSessionError(409,'review_changed','This review changed in another tab.');
    const chosen=await chooseReviewInTransaction(tx,profileId,id,input,true);
    if(chosen?.currentInspirationId)return chosen;
    await tx.update(reviewSessions).set({completedAt:new Date(),updatedAt:new Date(),revision:input.revision+2}).where(eq(reviewSessions.id,id));
    return createReviewInTransaction(tx,profileId,{id:input.nextId},true,hash);
  },{isolationLevel:'repeatable read'});
}

export function completeReviewSession(db:Db,profileId:string,id:string,revision:number) {
  return db.transaction(async tx=>{
    await lockReviewOwner(tx,profileId);
    const [session]=await tx.select().from(reviewSessions).where(and(eq(reviewSessions.profileId,profileId),eq(reviewSessions.id,id))).for('update');
    if (!session) throw new ReviewSessionError(404,'review_not_found','Review not found');
    if (session.completedAt) return present(tx,profileId,id);
    if (session.revision!==revision) throw new ReviewSessionError(409,'review_changed','This review changed in another tab. Reload it first.');
    await tx.update(reviewSessions).set({completedAt:new Date(),updatedAt:new Date(),revision:revision+1}).where(eq(reviewSessions.id,id));
    return present(tx,profileId,id);
  });
}
