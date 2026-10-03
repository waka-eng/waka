// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/api` supplies status/publication
 * timing and failures. The real result component, request cancellation, retry
 * intent and exact-artifact rendering run; actual SQL has separate coverage. */
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ReviewResult} from '../src/components/ReviewResult';
import {fetchReviewProcessing,retryReviewProcessing,fetchTopOfMindVersion,type ApiReviewProcessing,type ApiTopOfMind} from '../src/lib/api';
vi.mock('../src/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),fetchReviewProcessing:vi.fn(),retryReviewProcessing:vi.fn(),fetchTopOfMindVersion:vi.fn()}));
let host:HTMLDivElement,root:Root,state:ApiReviewProcessing;
const id='11111111-1111-4111-8111-111111111111',profile='22222222-2222-4222-8222-222222222222',artifact='33333333-3333-4333-8333-333333333333';
const reading:ApiTopOfMind={id:artifact,profileId:profile,version:2,reason:'regenerated',createdAt:'2026-10-03T12:00:00Z',entries:[{id:'entry',type:'pattern',body:'The exact reading made during this review.',locked:false,pinned:false,dismissed:false,sortOrder:0,citedSignals:[]}]};
beforeEach(()=>{
  vi.resetAllMocks();vi.useFakeTimers();(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  state={profileId:profile,sessionId:id,phase:'pending',answerCount:1,completedCount:0,canRetry:false,runAfter:null,result:null,relatedPrinciples:[]};
  vi.mocked(fetchReviewProcessing).mockImplementation(async()=>structuredClone(state));
  vi.mocked(fetchTopOfMindVersion).mockResolvedValue(reading);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();});
const mount=(owner=profile,revision=1)=>act(async()=>root.render(<ReviewResult profileId={owner} id={id} revision={revision} locale="en-US"/>));
const click=(label:string)=>act(async()=>{[...host.querySelectorAll('button')].find(button=>button.textContent===label)!.click();});
const ready=(outcome:'changed'|'unchanged'|'empty'='changed')=>{state={...state,phase:'ready',completedCount:1,result:{kind:'top_of_mind',topOfMindId:outcome==='empty'?null:artifact,version:outcome==='empty'?0:2,outcome}};};
it('observes pending work and opens the exact completed artifact, not the latest reading',async()=>{
  await mount();expect(host.textContent).toContain('Your thoughts are saved. Your reading is taking shape.');expect(retryReviewProcessing).not.toHaveBeenCalled();
  ready();await act(async()=>vi.advanceTimersByTimeAsync(2000));await click('See this reading');
  expect(fetchTopOfMindVersion).toHaveBeenCalledWith(artifact,{profile},expect.any(AbortSignal));expect(host.textContent).toContain(reading.entries[0].body);
  expect(host.textContent).not.toContain('new principle');
});
it.each(['unchanged','empty'] as const)('treats %s as a successful result without promising a new principle',async outcome=>{
  ready(outcome);await mount();expect(host.textContent).toContain(outcome==='empty'?'There isn’t enough':'The reading stayed the same.');expect(host.querySelector('[role="alert"]')).toBeNull();
  if(outcome==='empty')expect(host.textContent).not.toContain('See this reading');
});
it('recovers a transient first status failure without flashing a retry error or creating work',async()=>{
  vi.mocked(fetchReviewProcessing).mockRejectedValueOnce(new Error('Transient'));await mount();expect(host.textContent).toContain('Checking your reading');expect(host.textContent).not.toContain('another try');
  ready();await act(async()=>vi.advanceTimersByTimeAsync(1000));expect(host.textContent).toContain('Your reading has an update.');expect(retryReviewProcessing).not.toHaveBeenCalled();
});
it('observes a lost retry response rather than sending the mutation twice',async()=>{
  state={...state,phase:'failed',canRetry:true};await mount();
  vi.mocked(retryReviewProcessing).mockImplementationOnce(async()=>{ready();throw new Error('Response lost');});
  await click('Resume reading');await act(async()=>vi.advanceTimersByTimeAsync(1000));
  expect(retryReviewProcessing).toHaveBeenCalledTimes(1);expect(host.textContent).toContain('Your reading has an update.');
  await mount(profile,2);expect(retryReviewProcessing).toHaveBeenCalledTimes(1);
});
it('does not show a late reading after the review revision changes',async()=>{
  ready();await mount();let resolve!:(value:ApiTopOfMind)=>void;
  vi.mocked(fetchTopOfMindVersion).mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));await click('See this reading');
  state={...state,phase:'pending',completedCount:0,result:null};await mount(profile,2);
  await act(async()=>resolve(reading));expect(host.textContent).not.toContain(reading.entries[0].body);expect(host.textContent).toContain('taking shape');
});
it('refuses another artifact or owner returned from the exact-version endpoint',async()=>{
  ready();vi.mocked(fetchTopOfMindVersion).mockResolvedValueOnce({...reading,id:'another-artifact',profileId:'another-owner'});
  await mount();await click('See this reading');expect(host.textContent).toContain('This reading couldn’t be opened');expect(host.textContent).not.toContain(reading.entries[0].body);
});
it('shows genuine unresolved support as a normal outcome and keeps related principles separate',async()=>{
  state={...state,phase:'needs_context'};await mount();expect(host.textContent).toContain('There isn’t a clear new direction');expect(host.textContent).not.toContain('Resume reading');
  ready();state.relatedPrinciples=[{id:'p',statement:'An existing principle'}];await mount(profile,2);
  expect(host.textContent).toContain('Related principles');expect(host.textContent).toContain('An existing principle');
});
