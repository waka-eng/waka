import {sql} from 'drizzle-orm';
import type {getDb} from './db.js';
import type {ConfidenceEvidence} from './signal-lifecycle.js';

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
