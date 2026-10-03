/** WHAT THIS MOCKS, AND WHY (gate G6): `fetch` supplies wire responses;
 * real scoped HTTP, identity and result validation run. No provider calls. */
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {fetchReviewProcessing,retryReviewProcessing,type ApiReviewProcessing} from '../src/lib/api';
const id='11111111-1111-4111-8111-111111111111',profile='22222222-2222-4222-8222-222222222222';
let state:ApiReviewProcessing;
beforeEach(()=>{state={profileId:profile,sessionId:id,phase:'pending',answerCount:1,completedCount:0,canRetry:false,runAfter:null,result:null,relatedPrinciples:[]};
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json(state)));});
afterEach(()=>vi.unstubAllGlobals());
it('scopes reads and explicit retries without sending answer text',async()=>{
  await fetchReviewProcessing(id,profile);await retryReviewProcessing(id,profile);
  expect(vi.mocked(fetch).mock.calls[0][0]).toContain(`/review-sessions/${id}/processing?profile=${profile}`);
  expect(vi.mocked(fetch).mock.calls[1][1]).toMatchObject({method:'POST',body:'{}'});
});
it('rejects a foreign owner and premature or malformed completion',async()=>{
  state.profileId=id;await expect(fetchReviewProcessing(id,profile)).rejects.toThrow('Could not verify');state.profileId=profile;
  state.phase='ready';await expect(fetchReviewProcessing(id,profile)).rejects.toThrow('Could not verify');
  state.result={kind:'top_of_mind',topOfMindId:null,version:1,outcome:'changed'};await expect(fetchReviewProcessing(id,profile)).rejects.toThrow('Could not verify');
});
