import {and,asc,eq,inArray,sql} from 'drizzle-orm';
import {backgroundJobs,profiles,reviewAnswerProcessing,reviewSignalSupport,signalReviewEvidence,signals,type BackgroundJob,type BackgroundJobResult} from '../db/index.js';
import {getDb} from './db.js';
import {loadReviewAnswerMaterial,assertReviewAnswerMaterial,type ReviewAnswerMaterial} from './review-answer-material.js';
import {getDefaultModelProvider,type ModelProvider,type ReviewAnswerDerivationInput} from './model-provider.js';
import {readGenerationRevision,assertGenerationRevision} from './generation-revision.js';
import {REVIEW_SUPPORT_POLICY,recordReviewSupport,writeReviewEvidence} from './review-evidence.js';
import {refreshSignalLifecycle,reconcileSignalsAfterEvidenceLoss} from './signal-lifecycle.js';
import {acquireSignalDerivationLock,applyCandidates} from './signal-match-or-mint.js';
import {GeminiEmbeddingHttpClient} from './inspiration-embeddings.js';
import type {StatementEmbeddingClient} from './signal-embeddings.js';
import {enqueueReviewAnswerDerivation,enqueueTopOfMindRefresh,reserveReviewModelRun,type EnqueueResult} from './queue.js';
import {BackgroundJobHeldError} from './background-job-hold.js';
import {currentArtifactResult} from './inspiration-processing.js';
import {parseReviewAnswerDerivation} from '../queue/gemini.js';

type Database=ReturnType<typeof getDb>;
type Transaction=Parameters<Parameters<Database['transaction']>[0]>[0];
type Dependencies={db?:Database;modelProvider?:ModelProvider;embeddingClient?:StatementEmbeddingClient;job?:BackgroundJob;beforeCommit?:(tx:Transaction)=>Promise<void>};
const SUPPORT_BATCH=20;

function modelInput(material:ReviewAnswerMaterial,claims:ReviewAnswerDerivationInput['claims'],discover:boolean):ReviewAnswerDerivationInput{
  return {preferredLocale:material.locale,answer:material.answer,question:material.question,contextChanged:material.contextChanged,claims,discover,
    sources:material.sources.map(({material:source})=>({text:source.inspiration.text,
      reflections:source.reflectionRows.map(row=>({question:row.question,answer:row.answer??''})),
      attachments:source.attachmentRows.map(row=>({type:row.type,status:row.status??'unavailable',kind:row.kind,text:row.status==='ready'?row.text:null}))}))};
}
async function finish(tx:Transaction,material:ReviewAnswerMaterial,deps:Dependencies,options:{reading?:EnqueueResult;derived:boolean;discovered?:boolean;signalIds:string[]}){
  const [prior]=await tx.select().from(reviewAnswerProcessing).where(and(eq(reviewAnswerProcessing.profileId,material.profileId),eq(reviewAnswerProcessing.answerId,material.answerId))).for('update');
  let reading=options.reading;
  if(!reading&&prior?.readingJobId&&!prior.result){
    const [job]=await tx.select().from(backgroundJobs).where(eq(backgroundJobs.id,prior.readingJobId));
    reading=!job||job.status==='failed'||job.status==='succeeded'&&!job.result
      ?await enqueueTopOfMindRefresh(material.profileId,'signals_changed',tx)
      :{jobId:prior.readingJobId,requestVersion:prior.readingRequestVersion!.toString(),created:false};
  }
  let result:BackgroundJobResult|null=null;
  if(options.derived&&!reading){
    result=await currentArtifactResult(tx,material.profileId);
  }
  const values={profileId:material.profileId,sessionId:material.sessionId,answerId:material.answerId,materialHash:material.hash,
    discoveryHash:options.discovered?material.hash:prior?.discoveryHash??null,
    derivationJobId:deps.job?.id??null,derivationRequestVersion:deps.job?.requestVersion??null,
    readingJobId:reading?.jobId??null,readingRequestVersion:reading?BigInt(reading.requestVersion):null,
    signalIds:[...new Set([...(prior?.signalIds??[]),...options.signalIds])],result,
    derivedAt:options.derived?new Date():null,completedAt:result?new Date():null,updatedAt:new Date()};
  await tx.insert(reviewAnswerProcessing).values(values).onConflictDoUpdate({target:[reviewAnswerProcessing.profileId,reviewAnswerProcessing.answerId],set:values});
}

/** Two bounded phases: current support first, then new discovery. A failed
 * discovery cannot undo a committed withdrawal or the person's saved words. */
export async function deriveSignalsForReviewAnswer(input:{profileId:string;sessionId:string;answerId:string;signalIds?:string[]},deps:Dependencies={}){
  const db=deps.db??getDb();
  const [owner]=await db.select({type:profiles.type}).from(profiles).where(eq(profiles.id,input.profileId));
  if(!owner||owner.type==='group')return {status:'missing' as const};
  let generation=await readGenerationRevision(db,{profileId:input.profileId});
  if(!generation)return {status:'missing' as const};
  let material=await db.transaction(tx=>loadReviewAnswerMaterial(tx,input.profileId,input.answerId),{isolationLevel:'repeatable read'});
  if(material&&material.sessionId!==input.sessionId)throw new Error('Review session owner changed');
  const [prior]=await db.select().from(reviewAnswerProcessing).where(and(eq(reviewAnswerProcessing.profileId,input.profileId),eq(reviewAnswerProcessing.answerId,input.answerId)));
  const linked=await db.select({id:signalReviewEvidence.signalId}).from(signalReviewEvidence).where(and(eq(signalReviewEvidence.profileId,input.profileId),eq(signalReviewEvidence.answerId,input.answerId)));
  const touched=[...new Set([...(input.signalIds??[]),...(prior?.signalIds??[]),...linked.map(row=>row.id)])];
  const guard=async(tx:Transaction,snapshot:ReviewAnswerMaterial,version:NonNullable<typeof generation>)=>{
    await assertReviewAnswerMaterial(tx,snapshot);await assertGenerationRevision(tx,version,true);await deps.beforeCommit?.(tx);
  };
  if(!material||material.deleted||!material.sources.some(source=>source.referenced)){
    await db.transaction(async tx=>{
      if(material)await guard(tx,material,generation!);else{await assertGenerationRevision(tx,generation!,true);await deps.beforeCommit?.(tx);}
      await tx.delete(signalReviewEvidence).where(and(eq(signalReviewEvidence.profileId,input.profileId),eq(signalReviewEvidence.answerId,input.answerId)));
      await reconcileSignalsAfterEvidenceLoss(tx,{profileId:input.profileId,signalIds:touched});
      const reading=touched.length?await enqueueTopOfMindRefresh(input.profileId,'signals_changed',tx):undefined;
      if(!material||material.deleted){
        await tx.delete(reviewAnswerProcessing).where(and(eq(reviewAnswerProcessing.profileId,input.profileId),eq(reviewAnswerProcessing.answerId,input.answerId)));
        await tx.delete(reviewSignalSupport).where(and(eq(reviewSignalSupport.profileId,input.profileId),eq(reviewSignalSupport.answerId,input.answerId)));
      }else await finish(tx,material,deps,{derived:true,discovered:true,reading,signalIds:touched});
    });return {status:'missing' as const};
  }
  if(prior?.derivedAt&&prior.materialHash===material.hash&&deps.job&&prior.derivationJobId===deps.job.id&&prior.derivationRequestVersion===deps.job.requestVersion){
    await db.transaction(tx=>guard(tx,material!,generation!));return {status:'replayed' as const};
  }
  const provider=deps.modelProvider??await getDefaultModelProvider();
  let metered=false;
  const beforeModel=async()=>{if(!metered&&deps.job){await reserveReviewModelRun(deps.job);metered=true;}};
  const sourceHash=material.hash;
  const cached=await db.select().from(reviewSignalSupport).where(and(eq(reviewSignalSupport.profileId,input.profileId),eq(reviewSignalSupport.answerId,input.answerId)));
  const claimIds=[...new Set([...linked.map(row=>row.id),...cached.map(row=>row.signalId)])];
  const claims=claimIds.length?await db.select({id:signals.id,statement:signals.statement,revision:signals.statementRevision}).from(signals)
    .where(and(eq(signals.profileId,input.profileId),inArray(signals.id,claimIds))).orderBy(asc(signals.id)):[];
  const pending=claims.filter(claim=>!cached.some(row=>row.signalId===claim.id&&row.materialHash===material!.hash&&row.statementRevision===claim.revision&&row.policy===REVIEW_SUPPORT_POLICY));
  if(pending.length){
    const batch=pending.slice(0,SUPPORT_BATCH),request=modelInput(material,batch.map(row=>({signalId:row.id,statement:row.statement})),false);
    await beforeModel();const report=parseReviewAnswerDerivation(await provider.deriveReviewAnswer(request),request);
    await db.transaction(async tx=>{
      await acquireSignalDerivationLock(tx,input.profileId);await guard(tx,material!,generation!);
      await tx.select({id:signals.id}).from(signals).where(and(eq(signals.profileId,input.profileId),inArray(signals.id,batch.map(row=>row.id)))).orderBy(asc(signals.id)).for('share',{noWait:true});
      for(const assessment of report.assessments){
        const claim=batch.find(row=>row.id===assessment.signalId)!;
        if(!claim)throw new Error('Unknown review support claim');
        if(assessment.verdict==='supported')await writeReviewEvidence(tx,material!,claim.id,claim.revision);
        else await recordReviewSupport(tx,material!,claim.id,claim.revision,assessment.verdict);
      }
      await reconcileSignalsAfterEvidenceLoss(tx,{profileId:input.profileId,signalIds:batch.map(row=>row.id)});
      for(const claim of batch)await refreshSignalLifecycle(tx,claim.id,new Date());
      const reading=report.assessments.some(row=>row.verdict!=='unresolved')?await enqueueTopOfMindRefresh(input.profileId,'signals_changed',tx):undefined;
      await finish(tx,material!,deps,{derived:false,reading,signalIds:batch.map(row=>row.id)});
      if(pending.length>SUPPORT_BATCH)await enqueueReviewAnswerDerivation(input.profileId,input.sessionId,input.answerId,tx);
    });
    if(pending.length>SUPPORT_BATCH)return {status:'partial' as const};
  }
  generation=await readGenerationRevision(db,{profileId:input.profileId});
  material=await db.transaction(tx=>loadReviewAnswerMaterial(tx,input.profileId,input.answerId),{isolationLevel:'repeatable read'});
  if(!generation||!material||material.deleted||material.hash!==sourceHash)throw new Error('Review material changed between phases');
  const decisions=await db.select().from(reviewSignalSupport).where(and(eq(reviewSignalSupport.profileId,input.profileId),eq(reviewSignalSupport.answerId,input.answerId)));
  const [unchecked]=await db.execute(sql`SELECT s.id FROM signals s WHERE s.profile_id=${input.profileId}::uuid AND (
    EXISTS(SELECT 1 FROM signal_review_evidence e WHERE e.profile_id=s.profile_id AND e.signal_id=s.id AND e.answer_id=${input.answerId}::uuid)
    OR EXISTS(SELECT 1 FROM review_signal_support r WHERE r.profile_id=s.profile_id AND r.signal_id=s.id AND r.answer_id=${input.answerId}::uuid))
    AND NOT EXISTS(SELECT 1 FROM review_signal_support r WHERE r.profile_id=s.profile_id AND r.signal_id=s.id AND r.answer_id=${input.answerId}::uuid
      AND r.material_hash=${material.hash} AND r.statement_revision=s.statement_revision AND r.policy=${REVIEW_SUPPORT_POLICY}) LIMIT 1`);
  if(unchecked){await db.transaction(tx=>enqueueReviewAnswerDerivation(input.profileId,input.sessionId,input.answerId,tx));return {status:'partial' as const};}
  if(decisions.some(row=>row.materialHash===material!.hash&&row.verdict==='unresolved'))return {status:'needs_context' as const};
  const [receipt]=await db.select().from(reviewAnswerProcessing).where(and(eq(reviewAnswerProcessing.profileId,input.profileId),eq(reviewAnswerProcessing.answerId,input.answerId)));
  if(receipt?.discoveryHash===material.hash){
    await db.transaction(async tx=>{await guard(tx,material!,generation!);await finish(tx,material!,deps,{derived:true,signalIds:touched});});return {status:'derived' as const};
  }
  const [reembedding]=await db.select({id:backgroundJobs.id}).from(backgroundJobs).where(and(eq(backgroundJobs.profileId,input.profileId),eq(backgroundJobs.type,'reembed_signal'),inArray(backgroundJobs.status,['pending','running']))).limit(1);
  if(reembedding)throw new BackgroundJobHeldError(new Date(Date.now()+5000),'Signal wording is being indexed');
  const request=modelInput(material,[],true);await beforeModel();const discovered=parseReviewAnswerDerivation(await provider.deriveReviewAnswer(request),request);
  const embedding=deps.embeddingClient??new GeminiEmbeddingHttpClient();
  const candidates=await Promise.all(discovered.statements.map(async row=>({statement:row.statement,reason:null,quote:null,quoteSource:null,relatedEvidence:[],embedding:await embedding.embed(row.statement)})));
  const result=await db.transaction(async tx=>{
    await acquireSignalDerivationLock(tx,input.profileId);
    const applied=await applyCandidates(tx,{profileId:input.profileId,inspirationId:null,evidenceOwnerProfileId:input.profileId,
      reviewSource:{answerId:input.answerId,withdrawnSignalIds:new Set(decisions.filter(row=>row.lastExplicit==='unsupported').map(row=>row.signalId)),attach:(transaction,signalId)=>writeReviewEvidence(transaction,material!,signalId)},
      candidates,embeddingModel:embedding.model,provider,preferredLocale:material!.locale,now:new Date(),beforeWrites:()=>guard(tx,material!,generation!)});
    const ids=[...applied.matchedSignalIds,...applied.mintedSignalIds];
    const reading=ids.length?await enqueueTopOfMindRefresh(input.profileId,'signals_changed',tx):undefined;
    await finish(tx,material!,deps,{derived:true,discovered:true,reading,signalIds:ids});return applied;
  });return {status:'derived' as const,...result};
}
