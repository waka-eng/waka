import {and,eq,sql} from 'drizzle-orm';
import type {getDb} from './db.js';
import type {ConfidenceEvidence} from './signal-lifecycle.js';
import {reviewSignalSupport,signalReviewEvidence,signalReviewEvidenceSources,signals} from '../db/index.js';
import type {ReviewAnswerMaterial} from './review-answer-material.js';
export const REVIEW_SUPPORT_POLICY='review-support-v1';
type Transaction=Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

type Reader=Pick<ReturnType<typeof getDb>,'execute'>;
export interface SignalEvidenceSnapshot {
  witnesses:Map<string,ConfidenceEvidence[]>;
  pending:Set<string>;
}

/** One current-source predicate feeds counters, generation and the SQL guard.
 * Incomplete support is pending, never an invented unsupported verdict. */
export async function loadSignalEvidence(db:Reader,profileId:string,signalIds:string[]):Promise<SignalEvidenceSnapshot>{
  const witnesses=new Map<string,ConfidenceEvidence[]>(),pending=new Set<string>();
  if(!signalIds.length)return {witnesses,pending};
  const rows=await db.execute<{signalId:string;unitId:string;kind:'inspiration'|'review';originId:string|null;createdAt:Date|string;source:'app'|'agent';current:boolean|null}>(sql`
    SELECT e.signal_id AS "signalId",e.unit_id AS "unitId",e.kind,e.origin_id AS "originId",e.created_at AS "createdAt",e.source,e.current
    FROM signals s CROSS JOIN LATERAL signal_support_edges(s.id) e
    WHERE s.profile_id=${profileId}::uuid AND s.id IN (${sql.join(signalIds.map(id=>sql`${id}::uuid`),sql`,`)})
    ORDER BY s.id,e.kind,e.created_at,e.unit_id,e.origin_id`);
  for(const row of rows){
    if(row.current!==true||!row.originId){pending.add(row.signalId);continue;}
    const list=witnesses.get(row.signalId)??[];
    list.push({createdAt:new Date(row.createdAt),source:row.source,lineage:{kind:row.kind,unitId:row.unitId,originIds:[row.originId]}});
    witnesses.set(row.signalId,list);
  }
  return {witnesses,pending};
}

export function reviewEvidenceCurrent(evidenceName='signal_review_evidence',signalName='signals'){
  const c=(table:string,name:string)=>sql`${sql.identifier(table)}.${sql.identifier(name)}`;
  return sql`review_evidence_current(${c(evidenceName,'profile_id')},${c(evidenceName,'signal_id')},${c(evidenceName,'answer_id')},${c(signalName,'statement_revision')})`;
}

/** Caller holds current-material and generation fences before these writes. */
export async function recordReviewSupport(tx:Transaction,material:ReviewAnswerMaterial,signalId:string,statementRevision:bigint,verdict:'supported'|'unsupported'|'unresolved'){
  const lastExplicit=verdict==='unresolved'?null:verdict;
  await tx.insert(reviewSignalSupport).values({profileId:material.profileId,sessionId:material.sessionId,answerId:material.answerId,signalId,
    answerRevision:material.answerRevision,statementRevision,materialHash:material.hash,policy:REVIEW_SUPPORT_POLICY,verdict,lastExplicit})
    .onConflictDoUpdate({target:[reviewSignalSupport.profileId,reviewSignalSupport.answerId,reviewSignalSupport.signalId],set:{
      answerRevision:material.answerRevision,statementRevision,materialHash:material.hash,policy:REVIEW_SUPPORT_POLICY,verdict,
      lastExplicit:verdict==='unresolved'?sql`${reviewSignalSupport.lastExplicit}`:lastExplicit,checkedAt:sql`clock_timestamp()`,
    }});
  if(verdict==='unsupported')await tx.delete(signalReviewEvidence).where(and(eq(signalReviewEvidence.profileId,material.profileId),eq(signalReviewEvidence.signalId,signalId),eq(signalReviewEvidence.answerId,material.answerId)));
}
export async function writeReviewEvidence(tx:Transaction,material:ReviewAnswerMaterial,signalId:string,expectedRevision?:bigint){
  if(material.deleted||!material.answer.trim()||!material.sources.some(source=>source.referenced))throw new Error('No eligible review witness');
  const [claim]=await tx.select({revision:signals.statementRevision}).from(signals).where(and(eq(signals.profileId,material.profileId),eq(signals.id,signalId)));
  if(!claim||(expectedRevision!==undefined&&claim.revision!==expectedRevision))throw new Error('Review claim changed');
  await recordReviewSupport(tx,material,signalId,claim.revision,'supported');
  const values={profileId:material.profileId,signalId,sessionId:material.sessionId,answerId:material.answerId,statementRevision:claim.revision,
    answerRevision:material.answerRevision,sourceCount:material.sources.length,questionContextIncluded:material.questionIncluded};
  await tx.insert(signalReviewEvidence).values(values).onConflictDoUpdate({target:[signalReviewEvidence.profileId,signalReviewEvidence.signalId,signalReviewEvidence.answerId],set:values});
  await tx.delete(signalReviewEvidenceSources).where(and(eq(signalReviewEvidenceSources.profileId,material.profileId),eq(signalReviewEvidenceSources.signalId,signalId),eq(signalReviewEvidenceSources.answerId,material.answerId)));
  await tx.insert(signalReviewEvidenceSources).values(material.identity.sources.map(source=>({profileId:material.profileId,signalId,answerId:material.answerId,
    inspirationId:source.id,materialRevision:BigInt(source.revision),referenced:source.referenced})));
}
