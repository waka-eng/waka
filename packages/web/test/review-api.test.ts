/** WHAT THIS MOCKS, AND WHY (gate G6): `fetch` supplies HTTP JSON at the
 * transport boundary. The actual API helpers and owner/id validation run. */
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {fetchActiveReview,fetchReviewSession,chooseReviewInspiration,type ApiReviewSession} from '../src/lib/api';
const SID='11111111-1111-4111-8111-111111111111',PROFILE='22222222-2222-4222-8222-222222222222';
let row:ApiReviewSession;
beforeEach(()=>{row={id:SID,profileId:PROFILE,revision:0,cursor:0,currentInspirationId:null,createdAt:'2026-10-02T00:00:00Z',completedAt:null,items:[]};
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({session:row}),{status:200,headers:{'Content-Type':'application/json'}})));});
afterEach(()=>vi.unstubAllGlobals());
it('scopes a read and rejects a response belonging to another owner',async()=>{
  expect((await fetchActiveReview(PROFILE))?.id).toBe(SID);expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain(`profile=${PROFILE}`);
  row.profileId='other';await expect(fetchActiveReview(PROFILE)).rejects.toThrow('Could not verify');
});
it('does not treat null as a successful choice or identified review read',async()=>{
  vi.mocked(fetch).mockImplementation(async()=>new Response('{"session":null}',{status:200,headers:{'Content-Type':'application/json'}}));
  expect(await fetchActiveReview(PROFILE)).toBeNull();await expect(fetchReviewSession(SID,PROFILE)).rejects.toThrow('Could not verify');
  await expect(chooseReviewInspiration(SID,{revision:0,inspirationId:SID,choice:'keep',sourceRevision:'1'},PROFILE)).rejects.toThrow('Could not verify');
});
it('rejects wrong ids and invalid cursor metadata instead of rendering another session',async()=>{
  await expect(fetchReviewSession(PROFILE,PROFILE)).rejects.toThrow('Could not verify');
  row.cursor=6;await expect(fetchReviewSession(SID,PROFILE)).rejects.toThrow('Could not verify');
});
