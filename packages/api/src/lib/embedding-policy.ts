/** Active-space identity travels with owned inputs, never in a global cache.
 * Scalar policy subqueries are projected on existing single-owner reads. */
import {sql,type SQLWrapper} from 'drizzle-orm';
import {EMBEDDING_2_SPACE} from './embedding-2-space.js';
export interface EmbeddingIndexPolicy{
 profileId:string;activeSpace:string;activeEpoch:bigint;activeThresholdPolicy:string;buildingSpace:string|null;
}
export const NATIVE_EMBEDDING_POLICY='gemini-embedding-001.thresholds.v1';
export const EMBEDDING_2_CANDIDATE_POLICY='embedding2.dev-candidates.v1';
/** Main review record SHA256 43fc6e3076e2ce610f8e4dd63c8df48a30cbacebf260c2298096a3c39694cb13.
 * Limited-dev candidate risk choice, not calibration. Retuning requires a NEW identity. */
export const EMBEDDING_2_CANDIDATE_RULES=Object.freeze({
 chat:Object.freeze({minimum:.75,scan:500,validate:24,topK:6,queryCalls:1,lookupDeadlineMs:5000,exchangeTimeoutMs:10000,answerCalls:1,accountCallsPerHour:20,attemptsPerMessage:3,lexicalWeight:.45,semanticWeight:.55,diversityPenalty:0,uncorroborated:null,relativeFloor:null,relativeGap:null}),
 recall:Object.freeze({minimum:.75,scan:500,topK:8,queryCalls:1,attemptsPerMinute:10,attemptsPerHour:60,deadlineMs:5000,retryOrFallback:false}),
 related:Object.freeze({minimum:.75,scan:500,topK:5,queryCalls:0}),
 match:Object.freeze({minimum:-1,scan:500,topK:1,suppressionTopK:1,judgesPerCandidate:2,nonidenticalJudged:true,ordinaryCandidates:3,ordinaryJudges:6}),
 gardener:Object.freeze({minimum:.75,scan:300,topK:8,judgesPerPair:1}),
 reading:Object.freeze({cosinePruning:false,maxSignals:12,maxFocus:3,queryCalls:0,draftCalls:1,mandatoryReviewCalls:1}),
 principles:Object.freeze({newCosineDecision:false,queryCalls:0}),
});
export const PROVISIONAL_EMBEDDING_2_POLICY='embedding2.semantic-review-only.provisional.v1';
export function nativeEmbeddingPolicy(profileId:string):EmbeddingIndexPolicy{return{profileId,activeSpace:'gemini-embedding-001',activeEpoch:0n,activeThresholdPolicy:NATIVE_EMBEDDING_POLICY,buildingSpace:null};}
export function parseEmbeddingPolicy(profileId:string,value:unknown):EmbeddingIndexPolicy{
 if(value===null||value===undefined)return nativeEmbeddingPolicy(profileId);
 if(typeof value!=='object'||Array.isArray(value))throw Error('Embedding policy metadata is invalid');
 const row=value as Record<string,unknown>;
 if(row.profileId!==profileId||!['gemini-embedding-001',EMBEDDING_2_SPACE.id].includes(String(row.activeSpace))||typeof row.activeEpoch!=='string'||!/^\d+$/.test(row.activeEpoch)||typeof row.activeThresholdPolicy!=='string'||row.buildingSpace!==null&&!['gemini-embedding-001',EMBEDDING_2_SPACE.id].includes(String(row.buildingSpace)))throw Error('Embedding policy metadata is invalid');
 return{profileId,activeSpace:row.activeSpace as string,activeEpoch:BigInt(row.activeEpoch),activeThresholdPolicy:row.activeThresholdPolicy,buildingSpace:row.buildingSpace as string|null};
}
/** This record is emitted once by an owner/source query, not once per vector. */
export function embeddingPolicySql(profileId:string|SQLWrapper){return sql<unknown>`coalesce((SELECT jsonb_build_object('profileId',e.profile_id::text,'activeSpace',e.active_space,'activeEpoch',e.active_epoch::text,'activeThresholdPolicy',e.active_threshold_policy,'buildingSpace',e.building_space) FROM profile_embedding_indexes e WHERE e.profile_id=${profileId}::uuid),jsonb_build_object('profileId',${profileId}::text,'activeSpace','gemini-embedding-001','activeEpoch','0','activeThresholdPolicy',${NATIVE_EMBEDDING_POLICY}::text,'buildingSpace',NULL))`;}
/** One PK probe in the existing proof statement. Missing control is legacy001. */
export function embeddingPolicyMatchesSql(policy:EmbeddingIndexPolicy){
 const absent=policy.activeSpace==='gemini-embedding-001'&&policy.activeEpoch===0n&&policy.activeThresholdPolicy===NATIVE_EMBEDDING_POLICY;
 return sql<boolean>`coalesce((SELECT e.active_space=${policy.activeSpace} AND e.active_epoch=${policy.activeEpoch.toString()}::bigint AND e.active_threshold_policy=${policy.activeThresholdPolicy} FROM profile_embedding_indexes e WHERE e.profile_id=${policy.profileId}::uuid),${absent})`;
}
export function embeddingPolicyIdentity(policy:EmbeddingIndexPolicy){return[policy.profileId,policy.activeSpace,policy.activeEpoch.toString(),policy.activeThresholdPolicy].join(':');}
/** Legacy epoch0 context/provider bytes remain unchanged. Build state is not an input. */
export function embeddingPolicyContextIdentity(policies:EmbeddingIndexPolicy[]){return policies.every(p=>p.activeSpace==='gemini-embedding-001'&&p.activeEpoch===0n&&p.activeThresholdPolicy===NATIVE_EMBEDDING_POLICY)?undefined:policies.map(embeddingPolicyIdentity).sort();}
/** Only the compiled reviewed model2 policy authorizes semantic work or C1. */
export function embeddingPolicyValidated(space:string,policy:string){
 return space===EMBEDDING_2_SPACE.id&&policy===EMBEDDING_2_CANDIDATE_POLICY;
}
export function embeddingCandidateRules(policy:EmbeddingIndexPolicy|undefined){
 return policy&&embeddingPolicyValidated(policy.activeSpace,policy.activeThresholdPolicy)
  ?EMBEDDING_2_CANDIDATE_RULES:null;
}
export function embeddingRetrievalMinimum(policy:EmbeddingIndexPolicy|undefined,task:'chat'|'recall'|'related'|'gardener',legacy:number){return embeddingCandidateRules(policy)?.[task].minimum??legacy;}
export function embeddingNeedsMeaningReview(model:string){return model===EMBEDDING_2_SPACE.id;}
/** Single PK InitPlan for a reader whose owner is already authorized. */
export function activeEmbeddingSpaceSql(profileId:string){return sql<string|null>`(SELECT active_space FROM profile_embedding_indexes WHERE profile_id=${profileId}::uuid AND active_space=${EMBEDDING_2_SPACE.id} AND active_threshold_policy=${EMBEDDING_2_CANDIDATE_POLICY})`;}
