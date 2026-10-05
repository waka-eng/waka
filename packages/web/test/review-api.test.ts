/** WHAT THIS MOCKS, AND WHY (gate G6): `fetch` supplies HTTP JSON at the
 * transport boundary. The actual API helpers and owner/id validation run. */
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {fetchActiveReview,fetchReviewSession,chooseReviewInspiration,startReviewSession,type ApiReviewSession} from '../src/lib/api';
const SID='11111111-1111-4111-8111-111111111111',PROFILE='22222222-2222-4222-8222-222222222222';
let row:ApiReviewSession;
beforeEach(()=>{row={id:SID,profileId:PROFILE,revision:0,cursor:0,currentInspirationId:null,createdAt:'2026-10-02T00:00:00Z',completedAt:null,items:[]};
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({session:row}),{status:200,headers:{'Content-Type':'application/json'}})));});
afterEach(()=>vi.unstubAllGlobals());
it('scopes a read and rejects a response belonging to another owner',async()=>{
  expect((await fetchActiveReview(PROFILE))?.id).toBe(SID);expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain(`profile=${PROFILE}`);
  row.profileId='other';await expect(fetchActiveReview(PROFILE)).rejects.toThrow('Could not verify');
});
it('requests current material explicitly and refuses a mismatched original/revision',async()=>{
  row.currentInspirationId=SID;row.items=[{inspirationId:SID,position:0,sourceRevision:'1',currentRevision:'2',sourceChanged:true,reason:'chosen',choice:null,decidedAt:null,inspirationCreatedAt:row.createdAt}];
  row.currentInspiration={id:SID,profileId:PROFILE,materialRevision:'1',text:'Synthetic original',kind:'note',source:'app',visibility:'private',createdAt:row.createdAt,updatedAt:row.createdAt,attachments:[],reflections:[]};
  await expect(fetchReviewSession(SID,PROFILE,undefined,true)).rejects.toThrow('Could not verify');
  row.currentInspiration.materialRevision='2';expect((await fetchReviewSession(SID,PROFILE,undefined,true))?.currentInspiration?.text).toBe('Synthetic original');
  expect(vi.mocked(fetch).mock.calls.at(-1)![0]).toContain('include=current');
  row.currentInspiration.profileId='other';await expect(fetchReviewSession(SID,PROFILE,undefined,true)).rejects.toThrow('Could not verify');
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
it('requires the requested identity for a manual start before its selection can be consumed',async()=>{
  await expect(startReviewSession({id:PROFILE,inspirationIds:[SID]},PROFILE)).rejects.toThrow('Could not verify');
  expect((await startReviewSession({id:PROFILE},PROFILE))?.id).toBe(SID);
  vi.mocked(fetch).mockResolvedValueOnce(new Response('{"session":null}',{status:200}));
  await expect(startReviewSession({id:SID,inspirationIds:[SID]},PROFILE)).rejects.toThrow('Could not verify');
});
