/** WHAT THIS MOCKS, AND WHY (gate G6): `fetch` supplies wire responses.
 * Owner/session validation and the actual scoped HTTP helpers remain real. */
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {fetchReviewDialogue,saveReviewAnswer,removeReviewAnswer,type ApiReviewDialogue} from '../src/lib/api';
const id='11111111-1111-4111-8111-111111111111',profileId='22222222-2222-4222-8222-222222222222';
let row:ApiReviewDialogue;
beforeEach(()=>{row={profileId,sessionId:id,revision:0,answers:[],latestAnswerId:null,question:{phase:'idle',retryAfter:null}};
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(row),{status:200,headers:{'Content-Type':'application/json'}})));});
afterEach(()=>vi.unstubAllGlobals());
it('checks the owner/session and scopes all requests',async()=>{
  expect((await fetchReviewDialogue(id,profileId)).sessionId).toBe(id);expect(vi.mocked(fetch).mock.calls[0]![0]).toContain(`profile=${profileId}`);
  row.profileId=id;await expect(fetchReviewDialogue(id,profileId)).rejects.toThrow('Could not verify');
  row.profileId=profileId;row.sessionId=profileId;await expect(fetchReviewDialogue(id,profileId)).rejects.toThrow('Could not verify');
});
it('does not accept null/malformed bodies as a successful answer save',async()=>{
  const input={id,questionJobId:id,contextHash:'a'.repeat(64),answer:'My thought'};
  vi.mocked(fetch).mockResolvedValueOnce(new Response('null',{status:200}));await expect(saveReviewAnswer(id,profileId,input)).rejects.toThrow('Could not verify');
  row.question={phase:'ready',question:'Why?',connection:null,jobId:id,sourceIds:[],contextHash:'a'.repeat(64),retryAfter:null};
  await expect(saveReviewAnswer(id,profileId,input)).rejects.toThrow('Could not verify');
});
it('passes the revision and abort signal on explicit removal',async()=>{
  const controller=new AbortController();await removeReviewAnswer(id,profileId,id,3,controller.signal);
  expect(vi.mocked(fetch).mock.calls[0]![1]).toMatchObject({method:'DELETE',body:'{"revision":3}',signal:controller.signal});
});
