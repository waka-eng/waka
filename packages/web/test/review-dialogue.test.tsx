// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/api` supplies network outcomes.
 * The real hook and durable owner-scoped drafts run through reloads, response
 * loss, two writers, timeouts and stale contexts; SQL is tested separately. */
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {useReviewDialogue} from '../src/lib/use-review-dialogue';
import {readReviewDrafts} from '../src/lib/review-dialogue-drafts';
import {profileStorageKey} from '../src/lib/profile-storage';
import {ApiError,fetchReviewDialogue,requestReviewQuestion,saveReviewAnswer,editReviewAnswer,removeReviewAnswer,type ApiReviewDialogue} from '../src/lib/api';
vi.mock('../src/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),fetchReviewDialogue:vi.fn(),requestReviewQuestion:vi.fn(),saveReviewAnswer:vi.fn(),editReviewAnswer:vi.fn(),removeReviewAnswer:vi.fn()}));
const id='11111111-1111-4111-8111-111111111111',source='22222222-2222-4222-8222-222222222222',job='33333333-3333-4333-8333-333333333333';
const scope={accountId:'account',profileId:'profile'},onRevision=vi.fn();
let state:ApiReviewDialogue,root:Root,host:HTMLDivElement,hook:ReturnType<typeof useReviewDialogue>;
function Harness({owner=scope}:{owner?:typeof scope}){hook=useReviewDialogue(owner,id,onRevision);return null;}
const copy=()=>structuredClone(state);
beforeEach(()=>{
  vi.resetAllMocks();localStorage.clear();(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  state={profileId:scope.profileId,sessionId:id,revision:2,answers:[],latestAnswerId:null,question:{phase:'ready',jobId:job,contextHash:'a'.repeat(64),connection:null,question:'What stayed with you?',sourceIds:[source],retryAfter:null}};
  vi.mocked(fetchReviewDialogue).mockImplementation(async()=>copy());
  vi.mocked(requestReviewQuestion).mockImplementation(async()=>{state={...state,question:{phase:'processing',retryAfter:null}};return copy();});
  vi.mocked(saveReviewAnswer).mockImplementation(async(_id,_profile,input)=>{state={...state,revision:state.revision+1,latestAnswerId:input.id,
    answers:[...state.answers,{id:input.id,revision:1,question:'What stayed with you?',connection:null,answer:input.answer,contextValid:true,createdAt:'2026-10-02T00:00:00Z',updatedAt:'2026-10-02T00:00:00Z',sources:[{inspirationId:source,sourceRevision:'1',currentRevision:'1',referenced:true}]}],question:{phase:'idle',retryAfter:null}};return copy();});
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.useRealTimers();});
const mount=(owner=scope)=>act(async()=>root.render(<Harness owner={owner}/>));
const remount=async()=>{await act(async()=>root.unmount());root=createRoot(host);await mount();};
it('restores a draft without saving or asking and isolates the next owner',async()=>{
  await mount();await act(async()=>hook.update('My unfinished thought'));expect(readReviewDrafts(scope,id)[0]?.value.answer).toBe('My unfinished thought');
  expect(readReviewDrafts(scope,id)[0]?.raw).not.toContain('What stayed with you?');
  await remount();expect(hook.draft?.answer).toBe('My unfinished thought');expect(saveReviewAnswer).not.toHaveBeenCalled();expect(requestReviewQuestion).not.toHaveBeenCalled();
  state={...state,profileId:'other'};await mount({accountId:'other',profileId:'other'});expect(hook.draft).toBeNull();
  expect(readReviewDrafts(scope,id)[0]?.value.answer).toBe('My unfinished thought');
});
it('journals before saving, then requests one follow-up only for explicit Continue',async()=>{
  await mount();await act(async()=>hook.update('I disagree with that connection.'));
  const save=vi.mocked(saveReviewAnswer).getMockImplementation()!;
  vi.mocked(saveReviewAnswer).mockImplementationOnce(async(...args)=>{expect(readReviewDrafts(scope,id)[0]?.value.submitted).toBe(true);return save(...args);});
  await act(async()=>hook.submit());expect(saveReviewAnswer).toHaveBeenCalledOnce();expect(requestReviewQuestion).toHaveBeenCalledOnce();expect(hook.draft).toBeNull();expect(hook.state?.answers).toHaveLength(1);
  await remount();expect(requestReviewQuestion).toHaveBeenCalledOnce();expect(hook.state?.question.phase).toBe('processing');
});
it('keeps a saved answer when the next question fails',async()=>{
  await mount();await act(async()=>hook.update('A thought worth keeping.'));vi.mocked(requestReviewQuestion).mockRejectedValueOnce(new Error('offline'));
  await act(async()=>hook.submit());expect(hook.state?.answers[0]?.answer).toBe('A thought worth keeping.');expect(hook.draft).toBeNull();expect(readReviewDrafts(scope,id)).toHaveLength(0);
  expect(hook.error).toBe('question');await act(async()=>hook.refresh());expect(saveReviewAnswer).toHaveBeenCalledOnce();
});
it('reconciles response loss using GET without duplicating the answer or auto asking',async()=>{
  await mount();await act(async()=>hook.update('One answer only.'));const save=vi.mocked(saveReviewAnswer).getMockImplementation()!;
  vi.mocked(saveReviewAnswer).mockImplementationOnce(async(...args)=>{await save(...args);throw new Error('response lost');});
  await act(async()=>hook.submit());expect(hook.draft?.submitted).toBe(true);
  await remount();expect(hook.draft).toBeNull();expect(hook.state?.answers).toHaveLength(1);expect(saveReviewAnswer).toHaveBeenCalledOnce();expect(requestReviewQuestion).not.toHaveBeenCalled();
});
it('preserves the exact pending save and retries only on request',async()=>{
  await mount();await act(async()=>hook.update('Offline draft'));vi.mocked(saveReviewAnswer).mockRejectedValueOnce(new Error('offline'));
  await act(async()=>hook.submit(false));const original=vi.mocked(saveReviewAnswer).mock.calls[0]![2];await remount();expect(hook.draft?.submitted).toBe(true);expect(saveReviewAnswer).toHaveBeenCalledOnce();
  await act(async()=>hook.submit(false));expect(vi.mocked(saveReviewAnswer).mock.calls[1]![2]).toEqual(original);expect(requestReviewQuestion).not.toHaveBeenCalled();
});
it('keeps stale/closed-review drafts without silently attaching them to a new question',async()=>{
  await mount();await act(async()=>hook.update('Still my words'));state={...state,question:{phase:'closed'}};await remount();
  expect(hook.draft?.answer).toBe('Still my words');expect(saveReviewAnswer).not.toHaveBeenCalled();
  vi.mocked(saveReviewAnswer).mockRejectedValueOnce(new ApiError({status:409,message:'Closed'}));await act(async()=>hook.submit(false));expect(hook.error).toBe('conflict');expect(hook.draft?.answer).toBe('Still my words');
});
it('forks restored drafts before typing so another mounted writer keeps its words',async()=>{
  await mount();await act(async()=>hook.update('Starting words'));const firstHook=hook;
  const secondHost=document.createElement('div');document.body.append(secondHost);const secondRoot=createRoot(secondHost);
  await act(async()=>secondRoot.render(<Harness/>));const secondHook=hook;
  await act(async()=>secondHook.update('Second tab words'));
  await act(async()=>firstHook.update('First tab words'));
  expect(readReviewDrafts(scope,id).map(row=>row.value.answer).sort()).toEqual(['First tab words','Second tab words']);
  await act(async()=>secondRoot.unmount());secondHost.remove();
});
it('blocks transmission but keeps visible words when draft storage fails',async()=>{
  await mount();const spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota');});
  await act(async()=>hook.update('Do not lose these words'));expect(hook.draft?.answer).toBe('Do not lose these words');expect(hook.error).toBe('storage');
  await act(async()=>hook.submit());expect(saveReviewAnswer).not.toHaveBeenCalled();spy.mockRestore();
  await act(async()=>hook.recoverStorage());expect(hook.draft?.answer).toBe('Do not lose these words');expect(readReviewDrafts(scope,id)[0]?.value.answer).toBe('Do not lose these words');
});
it('preserves corrupt owned bytes before explicit storage recovery without sending them',async()=>{
  const key=profileStorageKey(scope,`reviewDialogue:${id}:corrupt`)!;localStorage.setItem(key,'not readable JSON');await mount();expect(hook.error).toBe('storage');
  expect(localStorage.getItem(key)).toBe('not readable JSON');await act(async()=>hook.recoverStorage());
  expect(localStorage.getItem(key)).toBeNull();expect(Object.keys(localStorage).filter(key=>key.includes('reviewDialogueRecovery:')).map(key=>localStorage.getItem(key))).toEqual(['not readable JSON']);
  expect(saveReviewAnswer).not.toHaveBeenCalled();expect(requestReviewQuestion).not.toHaveBeenCalled();expect(hook.error).toBeNull();
});
it('edits/removes through versioned endpoints without starting a new question',async()=>{
  await mount();await act(async()=>hook.update('Original words'));await act(async()=>hook.submit(false));
  await act(async()=>hook.edit(hook.state!.answers[0]!,'edit'));await act(async()=>hook.update('Updated words'));
  vi.mocked(editReviewAnswer).mockImplementation(async()=>{state={...state,revision:4,answers:[{...state.answers[0]!,revision:2,answer:'Updated words'}]};return copy();});
  await act(async()=>hook.submit(false));expect(vi.mocked(editReviewAnswer).mock.calls[0]![3]).toEqual({revision:1,answer:'Updated words'});expect(hook.draft).toBeNull();
  await act(async()=>hook.edit(hook.state!.answers[0]!,'remove'));expect(removeReviewAnswer).not.toHaveBeenCalled();
  vi.mocked(removeReviewAnswer).mockImplementation(async()=>{state={...state,revision:5,answers:[],latestAnswerId:null};return copy();});
  await act(async()=>hook.submit(false));expect(vi.mocked(removeReviewAnswer).mock.calls[0]![3]).toBe(2);expect(hook.draft).toBeNull();expect(requestReviewQuestion).not.toHaveBeenCalled();
});
it('bounds a stalled request and ignores its result after switching owners',async()=>{
  vi.useFakeTimers();let resolve!:(value:ApiReviewDialogue)=>void;vi.mocked(fetchReviewDialogue).mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
  await mount();await act(async()=>vi.advanceTimersByTimeAsync(15001));expect(hook.error).toBe('load');
  const previous=copy();state={...state,profileId:'other',question:{phase:'empty'}};await mount({accountId:'other',profileId:'other'});
  await act(async()=>resolve(previous));expect(hook.state?.profileId).toBe('other');
});
