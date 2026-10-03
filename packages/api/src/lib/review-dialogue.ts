import {randomUUID} from 'node:crypto';
import {and,asc,desc,eq,inArray,like,sql} from 'drizzle-orm';
import {backgroundJobs,generationRevisions,inspirations,reviewAnswers,reviewAnswerSources,reviewSessions,type GenerateReviewQuestionPayload} from '../db/index.js';
import type {getDb} from './db.js';
import {loadReviewQuestionContext,readReviewAnswers} from './review-dialogue-context.js';
import {enqueueReviewQuestion,reviewQuestionJobPrefix,STALE_LOCK_SECONDS,wakeCommittedBackgroundJobs} from './queue.js';
import {lockReviewOwner,ReviewSessionError} from './review-sessions.js';
import {hashEmbeddingInput} from './inspiration-embeddings.js';

type Db=ReturnType<typeof getDb>;
type Tx=Parameters<Parameters<Db['transaction']>[0]>[0];
const HOUR_MS=3600000,MAX_QUESTION_REQUESTS=3;
async function ownedSession(tx:Tx,profileId:string,id:string,lock=false){
  const query=tx.select().from(reviewSessions).where(and(eq(reviewSessions.profileId,profileId),eq(reviewSessions.id,id)));
  const [session]=await(lock?query.for('update',{noWait:true}):query);
  if(!session)throw new ReviewSessionError(404,'review_not_found','Review not found');return session;
}
async function questionState(tx:Tx,profileId:string,id:string){
  const session=await ownedSession(tx,profileId,id),answers=await readReviewAnswers(tx,profileId,id);
  const context=await loadReviewQuestionContext(tx,profileId,id,{includeMaterial:false,answers});
  if(!context)return {profileId,sessionId:id,revision:session.revision,answers,context:null,question:{phase:session.completedAt?'closed' as const:'empty' as const}};
  const prefix=reviewQuestionJobPrefix(profileId,id,context.latestAnswerId,context.hash);
  const jobs=await tx.select().from(backgroundJobs).where(and(eq(backgroundJobs.profileId,profileId),eq(backgroundJobs.type,'generate_review_question'),like(backgroundJobs.idempotencyKey,`${prefix}%`))).orderBy(desc(backgroundJobs.createdAt),desc(backgroundJobs.id));
  const recent=jobs.filter(job=>job.createdAt.getTime()>Date.now()-HOUR_MS),job=jobs[0];
  const budget={retryAfter:recent.length>=MAX_QUESTION_REQUESTS?new Date(Math.min(...recent.map(row=>row.createdAt.getTime()))+HOUR_MS).toISOString():null};
  const base={profileId,sessionId:id,revision:session.revision,answers,context,latestAnswerId:context.latestAnswerId,historyChanged:context.historyChanged};
  if(!job)return {...base,question:{phase:'idle' as const,...budget}};
  const payload=job.payload as Partial<GenerateReviewQuestionPayload>&{reviewContextInvalidated?:boolean};
  if(payload.reviewContextInvalidated)return {...base,question:{phase:'idle' as const,...budget}};
  if(job.status==='succeeded'&&payload.contextHash===context.hash&&typeof payload.question==='string'&&Array.isArray(payload.sourceIds)&&payload.sourceIds.length>0&&payload.sourceIds.every(sourceId=>context.sourceIdentities.some(row=>row.id===sourceId))){
    return {...base,question:{phase:'ready' as const,jobId:job.id,question:payload.question,connection:payload.connection??null,sourceIds:payload.sourceIds,contextHash:context.hash,...budget}};
  }
  const exhausted=job.status==='running'&&job.attempts>=job.maxAttempts&&(!job.lockedAt||job.lockedAt.getTime()<Date.now()-STALE_LOCK_SECONDS*1000);
  return {...base,question:{phase:(job.status==='pending'||job.status==='running'&&!exhausted)?'processing' as const:'failed' as const,
    runAfter:job.status==='pending'&&job.runAfter.getTime()>Date.now()?job.runAfter.toISOString():null,...budget}};
}
function publicState(state:Awaited<ReturnType<typeof questionState>>){const {context,...rest}=state;return rest;}
export async function readReviewDialogue(db:Db,profileId:string,id:string){return db.transaction(async tx=>publicState(await questionState(tx,profileId,id)),{isolationLevel:'repeatable read'});}
export async function requestReviewQuestion(db:Db,profileId:string,id:string,afterAnswerId:string|null,retry=false){
  const result=await db.transaction(async tx=>{
    await lockReviewOwner(tx,profileId);await ownedSession(tx,profileId,id,true);
    const state=await questionState(tx,profileId,id);
    if(!state.context)return publicState(state);
    if(state.context.latestAnswerId!==afterAnswerId)throw new ReviewSessionError(409,'review_answers_changed','The saved thoughts changed. Reload this review.');
    if(['ready','processing'].includes(state.question.phase)||(state.question.phase==='failed'&&!retry))return publicState(state);
    if('retryAfter' in state.question&&state.question.retryAfter)throw new ReviewSessionError(429,'review_question_limit','Please wait before asking again. Your thoughts are kept.');
    await enqueueReviewQuestion({profileId,sessionId:id,afterAnswerId,inspirationIds:state.context.sourceIdentities.map(row=>row.id),contextHash:state.context.hash,requestId:randomUUID()},tx);
    return publicState(await questionState(tx,profileId,id));
  });await wakeCommittedBackgroundJobs();return result;
}

export async function saveReviewAnswer(db:Db,profileId:string,id:string,input:{id:string;questionJobId:string;contextHash:string;answer:string}){
  const inputHash=hashEmbeddingInput(JSON.stringify(input));
  return db.transaction(async tx=>{
    await lockReviewOwner(tx,profileId);const session=await ownedSession(tx,profileId,id,true);
    const [existing]=await tx.select().from(reviewAnswers).where(and(eq(reviewAnswers.profileId,profileId),eq(reviewAnswers.sessionId,id),eq(reviewAnswers.id,input.id)));
    if(existing){if(existing.deletedAt)throw new ReviewSessionError(410,'review_answer_removed','That saved thought was removed.');if(existing.inputHash!==inputHash)throw new ReviewSessionError(409,'review_answer_changed','That answer id was used for different words.');return publicState(await questionState(tx,profileId,id));}
    if(session.completedAt)throw new ReviewSessionError(409,'review_completed','This review is already finished. Your draft can be kept.');
    await tx.select().from(generationRevisions).where(eq(generationRevisions.profileId,profileId)).for('update',{noWait:true});
    const context=await loadReviewQuestionContext(tx,profileId,id,{includeMaterial:false});
    if(!context||context.hash!==input.contextHash)throw new ReviewSessionError(409,'review_context_changed','The question context changed. Your draft is still yours.');
    const sources=await tx.select({id:inspirations.id}).from(inspirations).where(and(eq(inspirations.profileId,profileId),inArray(inspirations.id,context.sourceIdentities.map(row=>row.id)))).orderBy(asc(inspirations.id)).for('key share',{noWait:true});
    if(sources.length!==context.sourceIdentities.length)throw new ReviewSessionError(409,'review_context_changed','A source changed. Reload the review.');
    const [job]=await tx.select().from(backgroundJobs).where(and(eq(backgroundJobs.id,input.questionJobId),eq(backgroundJobs.profileId,profileId),eq(backgroundJobs.type,'generate_review_question'))).for('update',{noWait:true});
    const payload=job?.payload as Partial<GenerateReviewQuestionPayload>|undefined;
    if(job?.status!=='succeeded'||payload?.sessionId!==id||payload.contextHash!==context.hash||typeof payload.question!=='string'||!Array.isArray(payload.sourceIds)||!payload.sourceIds.length||payload.sourceIds.some(sourceId=>!sources.some(row=>row.id===sourceId)))throw new ReviewSessionError(409,'review_question_changed','That question is no longer current.');
    await tx.insert(reviewAnswers).values({id:input.id,profileId,sessionId:id,questionJobId:job.id,inputHash,contextHash:context.hash,question:payload.question,connection:payload.connection??null,answer:input.answer,sourceCount:sources.length});
    await tx.insert(reviewAnswerSources).values(context.sourceIdentities.map(row=>({profileId,sessionId:id,answerId:input.id,inspirationId:row.id,sourceRevision:BigInt(row.revision),referenced:payload.sourceIds!.includes(row.id)})));
    await tx.update(reviewSessions).set({revision:session.revision+1,updatedAt:new Date()}).where(eq(reviewSessions.id,id));
    return publicState(await questionState(tx,profileId,id));
  });
}
export async function changeReviewAnswer(db:Db,profileId:string,id:string,answerId:string,revision:number,answer:string|null){
  return db.transaction(async tx=>{
    await lockReviewOwner(tx,profileId);const session=await ownedSession(tx,profileId,id,true);
    const [row]=await tx.select().from(reviewAnswers).where(and(eq(reviewAnswers.profileId,profileId),eq(reviewAnswers.sessionId,id),eq(reviewAnswers.id,answerId))).for('update',{noWait:true});
    if(!row)throw new ReviewSessionError(404,'review_answer_not_found','That thought is no longer available.');
    if(row.deletedAt){if(answer===null)return publicState(await questionState(tx,profileId,id));throw new ReviewSessionError(410,'review_answer_removed','That saved thought was removed.');}
    if(row.revision!==revision){if(answer!==null&&row.revision===revision+1&&row.answer===answer)return publicState(await questionState(tx,profileId,id));throw new ReviewSessionError(409,'review_answer_changed','This thought changed in another tab.');}
    if(answer===null){
      await tx.update(reviewAnswers).set({answer:null,question:null,connection:null,inputHash:'',deletedAt:sql`clock_timestamp()`,revision:revision+1,updatedAt:sql`clock_timestamp()`}).where(eq(reviewAnswers.id,answerId));
      await tx.delete(reviewAnswerSources).where(and(eq(reviewAnswerSources.profileId,profileId),eq(reviewAnswerSources.answerId,answerId)));
    }
    else if(answer!==row.answer)await tx.update(reviewAnswers).set({answer,revision:revision+1,updatedAt:sql`clock_timestamp()`}).where(eq(reviewAnswers.id,answerId));
    else return publicState(await questionState(tx,profileId,id));
    await tx.update(reviewSessions).set({revision:session.revision+1,updatedAt:new Date()}).where(eq(reviewSessions.id,id));
    return publicState(await questionState(tx,profileId,id));
  });
}
