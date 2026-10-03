import {and,asc,eq,isNull} from 'drizzle-orm';
import {inspirationRevisions,profiles,reviewAnswers,reviewAnswerSources,reviewItems,reviewSessions} from '../db/index.js';
import type {getDb} from './db.js';
import {loadInspirationMaterial} from './inspiration-material.js';
import {hashEmbeddingInput} from './inspiration-embeddings.js';
import {normalizeSupportedLocale} from './locales.js';
import type {ReviewQuestionInput} from './model-provider.js';
type Reader=Pick<ReturnType<typeof getDb>,'select'>;

export async function readReviewAnswers(db:Reader,profileId:string,sessionId:string){
  const rows=await db.select().from(reviewAnswers).where(and(eq(reviewAnswers.profileId,profileId),eq(reviewAnswers.sessionId,sessionId),isNull(reviewAnswers.deletedAt)))
    .orderBy(asc(reviewAnswers.createdAt),asc(reviewAnswers.id));
  const refs=rows.length?await db.select({ref:reviewAnswerSources,currentRevision:inspirationRevisions.personalRevision}).from(reviewAnswerSources)
    .innerJoin(inspirationRevisions,and(eq(inspirationRevisions.profileId,reviewAnswerSources.profileId),eq(inspirationRevisions.inspirationId,reviewAnswerSources.inspirationId)))
    .where(and(eq(reviewAnswerSources.profileId,profileId),eq(reviewAnswerSources.sessionId,sessionId))).orderBy(asc(reviewAnswerSources.inspirationId)):[];
  return rows.map(row=>{
    const sources=refs.filter(ref=>ref.ref.answerId===row.id);
    const contextValid=!row.contextInvalidatedAt&&row.question!==null&&sources.length===row.sourceCount&&sources.every(ref=>ref.currentRevision===ref.ref.sourceRevision);
    return {id:row.id,revision:row.revision,question:contextValid?row.question:null,connection:contextValid?row.connection:null,answer:row.answer!,contextValid,
      createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString(),sources:sources.map(({ref,currentRevision})=>({inspirationId:ref.inspirationId,
        sourceRevision:ref.sourceRevision.toString(),currentRevision:currentRevision.toString(),referenced:ref.referenced}))};
  });
}

/** A review answer is consumed once, not once per source reference. */
export async function loadReviewQuestionContext(db:Reader,profileId:string,sessionId:string,options:{includeMaterial?:boolean;answers?:Awaited<ReturnType<typeof readReviewAnswers>>}={}){
  const [session]=await db.select().from(reviewSessions).where(and(eq(reviewSessions.profileId,profileId),eq(reviewSessions.id,sessionId)));
  if(!session||session.completedAt)return null;
  const [profile]=await db.select({locale:profiles.preferredLocale}).from(profiles).where(eq(profiles.id,profileId));
  if(!profile)return null;
  const items=await db.select({id:reviewItems.inspirationId,revision:inspirationRevisions.personalRevision}).from(reviewItems)
    .innerJoin(inspirationRevisions,and(eq(inspirationRevisions.profileId,reviewItems.profileId),eq(inspirationRevisions.inspirationId,reviewItems.inspirationId)))
    .where(and(eq(reviewItems.profileId,profileId),eq(reviewItems.sessionId,sessionId),eq(reviewItems.choice,'keep'))).orderBy(asc(reviewItems.position));
  if(!items.length)return null;
  const sources=[];
  if(options.includeMaterial!==false)for(const item of items){
    const material=await loadInspirationMaterial(db,profileId,item.id,'personal');
    if(!material||material.identity.revision!==item.revision.toString())throw new Error('Review sources changed while loading');
    sources.push(material);
  }
  const answers=options.answers??await readReviewAnswers(db,profileId,sessionId),ids=new Set(items.map(row=>row.id));
  const byActivity=[...answers].sort((a,b)=>a.updatedAt.localeCompare(b.updatedAt)||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
  const eligible=byActivity.filter(row=>row.contextValid&&row.sources.every(source=>ids.has(source.inspirationId)));
  // Never fall back to an older affirmation after a newer answer lost its
  // context. Preserve it in history, but restart from current sources.
  const history=byActivity.at(-1)?.id===eligible.at(-1)?.id?eligible:[];
  const input:ReviewQuestionInput={preferredLocale:normalizeSupportedLocale(profile.locale),contextChanged:answers.length>0&&history.length===0,
    sources:sources.map(row=>({text:row.inspiration.text,
      reflections:row.reflectionRows.map(answer=>({question:answer.question,answer:answer.answer??''})),
      attachments:row.attachmentRows.map(attachment=>({type:attachment.type,status:attachment.status??'unavailable',kind:attachment.kind,text:attachment.status==='ready'?attachment.text:null}))})),
    history:history.map(row=>({question:row.question!,connection:row.connection,answer:row.answer}))};
  const sourceIdentities=items.map(row=>({id:row.id,revision:row.revision.toString()}));
  return {sessionRevision:session.revision,latestAnswerId:byActivity.at(-1)?.id??null,sourceIdentities,input,
    historyChanged:answers.length>0&&history.length===0,
    hash:hashEmbeddingInput(JSON.stringify({preferredLocale:input.preferredLocale,contextChanged:input.contextChanged,history:input.history,sourceIdentities,
      latestAnswerId:byActivity.at(-1)?.id??null,latestAnswerRevision:byActivity.at(-1)?.revision??null}))};
}
