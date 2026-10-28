// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/api` transport methods and timers.
 * The real hook owns silent observation, receipt validation and account fences.
 * No progress UI or model calls are involved. */
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ApiError,fetchInspirationProcessing,retryInspirationProcessing,type ApiInspirationProcessingStatus} from '../src/lib/api';
import {useInspirationProcessing} from '../src/lib/use-inspiration-processing';
import {profileStorageKey} from '../src/lib/profile-storage';
vi.mock('../src/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),fetchInspirationProcessing:vi.fn(),retryInspirationProcessing:vi.fn()}));
const scope={accountId:'account-A',profileId:'profile-A'};
const receipt={id:'receipt-A',profileId:scope.profileId,inspirationId:'source-A',materialRevision:'1',jobId:'job-A',requestVersion:'1'};
const waiting:ApiInspirationProcessingStatus={profileId:scope.profileId,inspirationId:'source-A',receipt,
  currentMaterialRevision:'1',requestedMaterialRevision:'1',latestDerivedRevision:'0',latestCompletedRevision:'0',superseded:false,
  phase:'queued',stage:'derivation',runAfter:null,result:null,unavailableAttachments:0,canRetry:false};
const ready:ApiInspirationProcessingStatus={...waiting,phase:'ready',stage:null,latestDerivedRevision:'1',latestCompletedRevision:'1',
  result:{kind:'top_of_mind',topOfMindId:'reading-2',version:2,outcome:'changed'}};
const key=profileStorageKey(scope,'sourceProcessing')!;
let host:HTMLDivElement,root:Root,latest:ReturnType<typeof useInspirationProcessing>;
function Probe({owner=scope}:{owner?:typeof scope}){latest=useInspirationProcessing(owner);return null;}
const track=async()=>{await act(async()=>latest.track(receipt.inspirationId,receipt));};
beforeEach(()=>{
  vi.useFakeTimers();vi.clearAllMocks();sessionStorage.clear();
  Object.defineProperty(document,'hidden',{configurable:true,value:false});
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  vi.mocked(fetchInspirationProcessing).mockResolvedValue(waiting);vi.mocked(retryInspirationProcessing).mockResolvedValue(waiting);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();});

it('revalidates completion before adoption and clears only after success',async()=>{
  await act(async()=>root.render(<Probe/>));await track();
  vi.mocked(fetchInspirationProcessing).mockResolvedValue(ready);
  await act(async()=>vi.advanceTimersByTimeAsync(1500));
  const adopt=vi.fn(async()=>{});expect(latest.phase).toBe('ready');
  await act(async()=>latest.open(adopt));
  expect(adopt).toHaveBeenCalledWith(ready.result,expect.any(Function));
  expect(latest.phase).toBe('idle');expect(sessionStorage.getItem(key)).toBeNull();
  expect(retryInspirationProcessing).not.toHaveBeenCalled();
});
it('retains completion when the caller defers adoption for an open page or draft',async()=>{
  vi.mocked(fetchInspirationProcessing).mockResolvedValue(ready);
  await act(async()=>root.render(<Probe/>));await track();
  await act(async()=>latest.open(async()=>false));
  expect(latest.phase).toBe('ready');expect(sessionStorage.getItem(key)).not.toBeNull();
  await act(async()=>latest.open(async()=>{}));expect(latest.phase).toBe('idle');
});
it('does not adopt an old completion after newer material starts processing',async()=>{
  vi.mocked(fetchInspirationProcessing).mockResolvedValue(ready);
  await act(async()=>root.render(<Probe/>));await track();
  vi.mocked(fetchInspirationProcessing).mockResolvedValue({...waiting,currentMaterialRevision:'2',superseded:true});
  const adopt=vi.fn(async()=>{});await act(async()=>latest.open(adopt));
  expect(adopt).not.toHaveBeenCalled();expect(latest.phase).toBe('queued');
});
it('resumes only its scoped receipt and never starts another job',async()=>{
  sessionStorage.setItem(key,JSON.stringify({profileId:scope.profileId,inspirationId:receipt.inspirationId,receiptId:receipt.id}));
  await act(async()=>root.render(<Probe/>));
  expect(fetchInspirationProcessing).toHaveBeenCalledWith(receipt.inspirationId,{profile:scope.profileId,receiptId:receipt.id},expect.any(AbortSignal));
  expect(retryInspirationProcessing).not.toHaveBeenCalled();expect(host.textContent).toBe('');
});
it('leaves terminal failure to the operator instead of automatically retrying',async()=>{
  vi.mocked(fetchInspirationProcessing).mockResolvedValue({...waiting,phase:'failed',canRetry:true});
  await act(async()=>root.render(<Probe/>));await track();
  await act(async()=>vi.advanceTimersByTimeAsync(120_000));
  expect(latest.phase).toBe('failed');expect(fetchInspirationProcessing).toHaveBeenCalledOnce();
  expect(retryInspirationProcessing).not.toHaveBeenCalled();expect(host.textContent).toBe('');
});
it('waits for a scheduled hold to end without repeatedly polling',async()=>{
  vi.mocked(fetchInspirationProcessing).mockResolvedValue({...waiting,phase:'waiting',runAfter:new Date(Date.now()+3_600_000).toISOString()});
  await act(async()=>root.render(<Probe/>));await track();
  await act(async()=>vi.advanceTimersByTimeAsync(3_599_999));expect(fetchInspirationProcessing).toHaveBeenCalledOnce();
  vi.mocked(fetchInspirationProcessing).mockResolvedValue({...waiting,phase:'processing'});
  await act(async()=>vi.advanceTimersByTimeAsync(1));expect(fetchInspirationProcessing).toHaveBeenCalledTimes(2);expect(latest.phase).toBe('processing');
});
it('refuses a late response from another account',async()=>{
  let finish!:(value:ApiInspirationProcessingStatus)=>void;
  vi.mocked(fetchInspirationProcessing).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  await act(async()=>root.render(<Probe/>));await track();
  const signal=vi.mocked(fetchInspirationProcessing).mock.calls[0]![2];
  await act(async()=>root.render(<Probe owner={{accountId:'account-B',profileId:'profile-B'}}/>));
  expect(signal?.aborted).toBe(true);await act(async()=>finish(ready));
  expect(latest.phase).toBe('idle');expect(latest.status).toBeNull();
});
it.each([403,404])('withdraws metadata after access is lost (%s)',async status=>{
  await act(async()=>root.render(<Probe/>));await track();
  vi.mocked(fetchInspirationProcessing).mockRejectedValue(new ApiError({status,message:'Not available'}));
  await act(async()=>vi.advanceTimersByTimeAsync(1500));
  expect(latest.phase).toBe('idle');expect(sessionStorage.getItem(key)).toBeNull();
  expect(retryInspirationProcessing).not.toHaveBeenCalled();
});
it('refuses malformed ready results without declaring success',async()=>{
  vi.mocked(fetchInspirationProcessing).mockResolvedValue({...ready,result:null});
  await act(async()=>root.render(<Probe/>));await track();
  await act(async()=>vi.advanceTimersByTimeAsync(3000));
  expect(latest.phase).toBe('error');expect(latest.status).toBeNull();
  expect(retryInspirationProcessing).not.toHaveBeenCalled();
});
