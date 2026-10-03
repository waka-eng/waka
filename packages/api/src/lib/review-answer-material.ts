import {and,asc,eq,sql} from 'drizzle-orm';
import {inspirations,profiles,reviewAnswers,reviewAnswerSources,reviewSessions} from '../db/index.js';
import type {getDb} from './db.js';
import {loadInspirationMaterial} from './inspiration-material.js';
import {hashEmbeddingInput} from './inspiration-embeddings.js';
import {normalizeSupportedLocale} from './locales.js';

type Reader=Pick<ReturnType<typeof getDb>,'select'>;
/** Review answers are their own material, never appended to each inspiration. */
export async function loadReviewAnswerMaterial(db:Reader,profileId:string,answerId:string){
  const [row]=await db.select({answer:reviewAnswers,locale:profiles.preferredLocale,
    questionCurrent:sql<boolean>`review_question_context_current(${reviewAnswers.profileId},${reviewAnswers.sessionId},${reviewAnswers.id})`})
    .from(reviewAnswers).innerJoin(profiles,eq(profiles.id,reviewAnswers.profileId))
    .where(and(eq(reviewAnswers.profileId,profileId),eq(reviewAnswers.id,answerId),sql`${profiles.type}::text<>'group'`));
  if(!row)return null;
  const refs=await db.select().from(reviewAnswerSources).where(and(eq(reviewAnswerSources.profileId,profileId),eq(reviewAnswerSources.answerId,answerId)))
    .orderBy(asc(reviewAnswerSources.inspirationId));
  const sources=[];
  if(!row.answer.deletedAt)for(const ref of refs){
    const material=await loadInspirationMaterial(db,profileId,ref.inspirationId,'personal');
    if(!material)throw new Error('Review origin changed while loading');
    sources.push({material,referenced:ref.referenced});
  }
  const questionIncluded=!row.answer.deletedAt&&row.questionCurrent===true;
  const identity={policy:'review-answer-material-v1',answerId,sessionId:row.answer.sessionId,answerRevision:row.answer.revision,
    deleted:row.answer.deletedAt!==null,questionIncluded,
    sources:sources.map(({material,referenced})=>({id:material.inspiration.id,revision:material.identity.revision!,referenced,hash:material.identity.hash}))};
  const hash=hashEmbeddingInput(JSON.stringify({identity,answer:row.answer.answer,
    question:questionIncluded?row.answer.question:null}));
  return {profileId,answerId,sessionId:row.answer.sessionId,answerRevision:row.answer.revision,
    answer:row.answer.answer??'',deleted:row.answer.deletedAt!==null,questionIncluded,
    question:questionIncluded?row.answer.question:null,contextChanged:!questionIncluded,
    locale:normalizeSupportedLocale(row.locale),sources,identity,hash};
}
export type ReviewAnswerMaterial=NonNullable<Awaited<ReturnType<typeof loadReviewAnswerMaterial>>>;

/** Final commit only. NOWAIT prevents waiting back on a source writer that
 * already holds its material row and is requesting this review's fence. */
export async function assertReviewAnswerMaterial(db:Reader,material:ReviewAnswerMaterial){
  await db.select({id:reviewSessions.id}).from(reviewSessions).where(and(eq(reviewSessions.profileId,material.profileId),eq(reviewSessions.id,material.sessionId))).for('update',{noWait:true});
  for(const source of material.identity.sources)await db.select({id:inspirations.id}).from(inspirations)
    .where(and(eq(inspirations.profileId,material.profileId),eq(inspirations.id,source.id))).for('share',{noWait:true});
  await db.select({id:reviewAnswers.id}).from(reviewAnswers).where(and(eq(reviewAnswers.profileId,material.profileId),eq(reviewAnswers.id,material.answerId))).for('share',{noWait:true});
  const current=await loadReviewAnswerMaterial(db,material.profileId,material.answerId);
  if(!current||current.hash!==material.hash)throw new Error('Review material changed before commit');
}
