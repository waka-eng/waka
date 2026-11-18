/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. Closed policy parsing and
 * deterministic rank arithmetic do not claim population embedding quality. */
import {expect,it} from 'vitest';
import {EMBEDDING_2_SPACE} from './embedding-2-space.js';
import {EMBEDDING_2_CANDIDATE_POLICY,EMBEDDING_2_CANDIDATE_RULES,embeddingCandidateRules,embeddingPolicyValidated,nativeEmbeddingPolicy,type EmbeddingIndexPolicy} from './embedding-policy.js';
import {rankConversationCandidates} from './conversation-retrieval.js';
const policy:EmbeddingIndexPolicy={profileId:'10000000-0000-4000-8000-000000000001',activeSpace:EMBEDDING_2_SPACE.id,activeEpoch:1n,activeThresholdPolicy:EMBEDDING_2_CANDIDATE_POLICY,buildingSpace:null};
it('requires exact space and compiled identity; provisional/arbitrary accepted strings cannot activate',()=>{
 expect(embeddingPolicyValidated(policy.activeSpace,policy.activeThresholdPolicy)).toBe(true);
 for(const s of ['embedding2.unvalidated','embedding2.semantic-review-only.provisional.v1','accepted','EMBEDDING2.DEV-CANDIDATES.V1'])expect(embeddingPolicyValidated(policy.activeSpace,s)).toBe(false);
 expect(embeddingCandidateRules({...policy,activeThresholdPolicy:'accepted'})).toBeNull();
 expect(embeddingCandidateRules(nativeEmbeddingPolicy(policy.profileId))).toBeNull();
 expect(Object.isFrozen(EMBEDDING_2_CANDIDATE_RULES.chat)).toBe(true);
});
it('fixes reviewed candidate caps while preserving mandatory semantic decisions and no cosine ToM pruning',()=>{
 const r=embeddingCandidateRules(policy)!;expect([r.chat.minimum,r.recall.minimum,r.related.minimum,r.gardener.minimum]).toEqual([.75,.75,.75,.75]);
 expect([r.chat.topK,r.recall.topK,r.related.topK,r.gardener.topK]).toEqual([6,8,5,8]);
 expect(r.match).toMatchObject({minimum:-1,topK:1,suppressionTopK:1,judgesPerCandidate:2,nonidenticalJudged:true});
 expect(r.reading).toMatchObject({cosinePruning:false,maxSignals:12,maxFocus:3,mandatoryReviewCalls:1});
});
it('does not lose the two weak saved smoke hits to provisional chat extra floors; rejects far candidates',()=>{
 const candidates=[{id:'en',similarity:.8057608565,vector:[1,0]},{id:'ko',similarity:.8263664516,vector:[0,1]},{id:'far',similarity:.6342659,vector:[1,1]}];
 expect(rankConversationCandidates([],candidates,undefined,policy).sort()).toEqual(['en','ko']);
});
it('does not interpret opposed high scores as diversity/independence; passes current passages only to existing source/answer guards',()=>{
 const candidates=[{id:'claim',similarity:.9276844619,vector:[1,0]},{id:'opposed',similarity:.9062746269,vector:[1,0]}];
 expect(rankConversationCandidates([],candidates,undefined,policy)).toEqual(['claim','opposed']);
 expect(rankConversationCandidates([],candidates)).toEqual(['claim','opposed']);
});
