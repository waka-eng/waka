// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/api` supplies review HTTP outcomes.
 * The real hook, owner-scoped journals, reconciliation and timeout run. */
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {useReviewSession} from '../src/lib/use-review-session';
import {profileStorageKey} from '../src/lib/profile-storage';
import {ApiError,chooseReviewInspiration,fetchActiveReview,fetchReviewSession,finishReviewSession,startReviewSession,type ApiReviewSession} from '../src/lib/api';
vi.mock('../src/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),chooseReviewInspiration:vi.fn(),fetchActiveReview:vi.fn(),fetchReviewSession:vi.fn(),finishReviewSession:vi.fn(),startReviewSession:vi.fn()}));
const SID='11111111-1111-4111-8111-111111111111',SOURCE='22222222-2222-4222-8222-222222222222';
const scope={accountId:'account',profileId:'profile'},prefix=profileStorageKey(scope,'reviewIntent:')!;
let host:HTMLDivElement,root:Root,hook:ReturnType<typeof useReviewSession>,current:ApiReviewSession|null;
const onId=vi.fn();
function session():ApiReviewSession{return {id:SID,profileId:scope.profileId,revision:0,cursor:0,currentInspirationId:SOURCE,createdAt:'2026-10-02T00:00:00Z',completedAt:null,
  items:[{inspirationId:SOURCE,position:0,sourceRevision:'1',currentRevision:'1',sourceChanged:false,reason:'unreviewed',choice:null,decidedAt:null,inspirationCreatedAt:'2026-10-01T00:00:00Z'}]};}
function Harness({id='new',owner=scope}:{id?:string;owner?:typeof scope}){hook=useReviewSession(owner,id,onId);return null;}
const copy=()=>current?JSON.parse(JSON.stringify(current)) as ApiReviewSession:null;
beforeEach(()=>{
  vi.resetAllMocks();localStorage.clear();current=null;(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  vi.mocked(fetchActiveReview).mockImplementation(async()=>copy());vi.mocked(fetchReviewSession).mockImplementation(async()=>copy());
  vi.mocked(startReviewSession).mockImplementation(async input=>{current={...session(),id:input.id};return copy();});
  vi.mocked(chooseReviewInspiration).mockImplementation(async(_id,input)=>{current={...current!,revision:input.revision+1,cursor:input.choice===null?0:1,currentInspirationId:input.choice===null?SOURCE:null,
    items:current!.items.map(item=>({...item,choice:input.choice}))};return copy();});
  vi.mocked(finishReviewSession).mockImplementation(async()=>{current={...current!,revision:current!.revision+1,completedAt:'2026-10-02T01:00:00Z',currentInspirationId:null};return copy();});
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();});
const mount=(id='new',owner=scope)=>act(async()=>root.render(<Harness id={id} owner={owner}/>));
const keys=()=>Object.keys(localStorage).filter(key=>key.startsWith(prefix));
it('only reads on opening and durably journals an explicit start before posting',async()=>{
  await mount();expect(startReviewSession).not.toHaveBeenCalled();
  vi.mocked(startReviewSession).mockImplementationOnce(async input=>{expect(keys()).toHaveLength(1);expect(localStorage.getItem(keys()[0]!)).toContain(input.id);return {...session(),id:input.id};});
  await act(async()=>hook.start());expect(startReviewSession).toHaveBeenCalledOnce();expect(keys()).toHaveLength(0);expect(onId).toHaveBeenCalled();
});
it('recovers a committed start after a lost response without posting again',async()=>{
  await mount();vi.mocked(startReviewSession).mockImplementationOnce(async input=>{current={...session(),id:input.id};throw new Error('Response lost');});
  await act(async()=>hook.start());expect(hook.pending?.kind).toBe('start');
  await act(async()=>root.unmount());root=createRoot(host);await mount();
  expect(hook.session?.id).toBe(current!.id);expect(hook.pending).toBeNull();expect(startReviewSession).toHaveBeenCalledOnce();expect(keys()).toHaveLength(0);
});
it('does not silently replace a pending manual selection with another device’s open review',async()=>{
  await mount();vi.mocked(startReviewSession).mockImplementationOnce(async()=>{current=session();throw new ApiError({status:409,message:'Another review is open'});});
  await act(async()=>hook.start([SOURCE]));await act(async()=>root.unmount());root=createRoot(host);await mount();
  expect(hook.error).toBe('conflict');expect(hook.pending?.kind).toBe('start');expect(onId).not.toHaveBeenCalled();
  await act(async()=>hook.useLatest());expect(hook.pending).toBeNull();expect(onId).toHaveBeenCalledWith(SID);
});
it('does not let a source refresh interrupt an in-flight choice',async()=>{
  current=session();await mount(SID);let finish!:(value:ApiReviewSession)=>void;
  vi.mocked(chooseReviewInspiration).mockImplementationOnce(()=>new Promise(done=>{finish=done;}));
  await act(async()=>hook.choose(hook.session!.items[0]!,'keep'));const reads=vi.mocked(fetchReviewSession).mock.calls.length;
  await act(async()=>hook.refresh());expect(fetchReviewSession).toHaveBeenCalledTimes(reads);
  await act(async()=>finish({...session(),revision:1}));expect(hook.busy).toBe(false);expect(hook.pending).toBeNull();
});
it('retains an uncertain choice on reload and retries its original version only on request',async()=>{
  current=session();await mount(SID);vi.mocked(chooseReviewInspiration).mockRejectedValueOnce(new Error('offline'));
  await act(async()=>hook.choose(hook.session!.items[0]!,'skip'));expect(hook.pending?.kind).toBe('choice');
  const input=vi.mocked(chooseReviewInspiration).mock.calls[0]![1];
  await act(async()=>root.unmount());root=createRoot(host);await mount(SID);expect(chooseReviewInspiration).toHaveBeenCalledOnce();expect(hook.pending).not.toBeNull();
  await act(async()=>hook.retry());expect(vi.mocked(chooseReviewInspiration).mock.calls[1]![1]).toEqual(input);expect(hook.session?.items[0]?.choice).toBe('skip');expect(keys()).toHaveLength(0);
});
it('keeps newer server choices until the person explicitly accepts the latest review',async()=>{
  current=session();await mount(SID);vi.mocked(chooseReviewInspiration).mockImplementationOnce(async()=>{current={...session(),revision:2};throw new ApiError({status:409,message:'Changed'});});
  await act(async()=>hook.choose(hook.session!.items[0]!,'keep'));expect(hook.error).toBe('conflict');expect(hook.pending).not.toBeNull();
  await act(async()=>hook.useLatest());expect(hook.session?.revision).toBe(2);expect(hook.pending).toBeNull();expect(chooseReviewInspiration).toHaveBeenCalledOnce();
});
it('settles only its own journal, never another tab’s pending update',async()=>{
  current=session();await mount(SID);const otherKey=prefix+'33333333-3333-4333-8333-333333333333';
  vi.mocked(chooseReviewInspiration).mockImplementationOnce(async()=>{localStorage.setItem(otherKey,'other pending bytes');return {...session(),revision:1};});
  await act(async()=>hook.choose(hook.session!.items[0]!,'keep'));expect(localStorage.getItem(otherKey)).toBe('other pending bytes');expect(keys()).toEqual([otherKey]);
});
it('does not post when device storage fails',async()=>{
  await mount();const spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota');});
  await act(async()=>hook.start());expect(hook.error).toBe('storage');expect(startReviewSession).not.toHaveBeenCalled();spy.mockRestore();
});
it('quarantines corrupt owned bytes only after explicit recovery',async()=>{
  localStorage.setItem(prefix+'corrupt','unreadable');await mount();expect(hook.error).toBe('storage');
  await act(async()=>hook.start());expect(startReviewSession).not.toHaveBeenCalled();
  await act(async()=>hook.recoverStorage());expect(localStorage.getItem(prefix+'corrupt')).toBeNull();
  expect(Object.keys(localStorage).filter(key=>key.includes('reviewRecovery:')).map(key=>localStorage.getItem(key))).toEqual(['unreadable']);
});
it('bounds a stalled read and ignores the earlier owner’s late result',async()=>{
  vi.useFakeTimers();let finish!:(value:ApiReviewSession)=>void;
  vi.mocked(fetchActiveReview).mockImplementationOnce(()=>new Promise(done=>{finish=done;}));
  await mount();await act(async()=>vi.advanceTimersByTimeAsync(15001));expect(hook.error).toBe('load');expect(hook.loading).toBe(false);
  await mount('new',{accountId:'other',profileId:'other'});
  await act(async()=>finish(session()));expect(hook.session).toBeNull();
});
