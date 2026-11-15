/** Active-space identity travels with owned inputs, never in a global cache.
 * Scalar policy subqueries are projected on existing single-owner reads. */
import {sql,type SQLWrapper} from 'drizzle-orm';
import {EMBEDDING_2_SPACE} from './embedding-2-space.js';
export interface EmbeddingIndexPolicy{
 profileId:string;activeSpace:string;activeEpoch:bigint;activeThresholdPolicy:string;buildingSpace:string|null;
}
export const NATIVE_EMBEDDING_POLICY='gemini-embedding-001.thresholds.v1';
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
export function assertKnownEmbeddingPolicy(policy:EmbeddingIndexPolicy){
 if(policy.activeSpace==='gemini-embedding-001'&&policy.activeThresholdPolicy===NATIVE_EMBEDDING_POLICY)return;
 if(policy.activeSpace===EMBEDDING_2_SPACE.id&&policy.activeThresholdPolicy===PROVISIONAL_EMBEDDING_2_POLICY)return;
 throw Error('Embedding policy is unavailable');
}
/** No accepted model2 calibration exists. This is the operator activation gate. */
export function embeddingPolicyValidated(space:string,policy:string){return space==='gemini-embedding-001'&&policy===NATIVE_EMBEDDING_POLICY;}
/** Provisional retrieval gate only. The smoke corpus does NOT calibrate truth,
 * agreement, contradiction or redundancy. Activation remains separately held. */
export function embeddingRetrievalMinimum(model:string,legacy:number){return model===EMBEDDING_2_SPACE.id?0.80:legacy;}
export function embeddingNeedsMeaningReview(model:string){return model===EMBEDDING_2_SPACE.id;}
/** Single PK InitPlan for a reader whose owner is already authorized. */
export function activeEmbeddingSpaceSql(profileId:string){return sql<string>`coalesce((SELECT active_space FROM profile_embedding_indexes WHERE profile_id=${profileId}::uuid),'gemini-embedding-001')`;}
