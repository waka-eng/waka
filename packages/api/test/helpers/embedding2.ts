// Exact active policy for SQL fixtures that exercise supported semantic paths.
import {EMBEDDING_2_SPACE,hashEmbedding2Input} from '../../src/lib/embedding-2-space.js';
import {EMBEDDING_2_CANDIDATE_POLICY} from '../../src/lib/embedding-policy.js';
import type {TestDatabase} from './index.js';

export function fixtureEmbedding2Policy(profileId:string) {
  return {profileId,activeSpace:EMBEDDING_2_SPACE.id,activeEpoch:1n,activeThresholdPolicy:EMBEDDING_2_CANDIDATE_POLICY,buildingSpace:null};
}

export async function enableFixtureEmbedding2(db:TestDatabase, profileId:string) {
  const policy=fixtureEmbedding2Policy(profileId);
  await db.sql`INSERT INTO profile_embedding_indexes(profile_id,active_space,active_epoch,active_threshold_policy)
    VALUES(${profileId},${policy.activeSpace},1,${policy.activeThresholdPolicy})
    ON CONFLICT (profile_id) DO UPDATE SET active_space=excluded.active_space,active_epoch=1,active_threshold_policy=excluded.active_threshold_policy`;
  return policy;
}

// Isolate derivation/publication jobs in suites that test their own claims.
// The real index work and queue rows stay present for all ownership checks.
export async function deferFixtureIndexJobs(db:TestDatabase) {
  await db.sql`UPDATE background_jobs SET run_after=now()+interval '1 year' WHERE type='index_embedding' AND status='pending'`;
}

// A pre-existing semantic target must have a current vector. Derivation
// refuses to mint around an owned active signal with incomplete coverage.
export async function seedFixtureSignalVector(db:TestDatabase,profileId:string,signalId:string,statement:string){
  const vector=[0,1,...Array<number>(766).fill(0)];
  await db.sql`INSERT INTO signal_embeddings(profile_id,signal_id,model,dimensions,input_hash,embedding)
    VALUES(${profileId},${signalId},${EMBEDDING_2_SPACE.id},768,${hashEmbedding2Input(statement,'RETRIEVAL_DOCUMENT')},${JSON.stringify(vector)}::jsonb)`;
}
