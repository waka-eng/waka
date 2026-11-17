// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/api/conversations` replaces only
 * owned HTTP reads so replies can arrive/fail independently of polling. Fake
 * timers/Date/performance and a document.hidden override model scheduling and
 * visibility. The real hook runs; no provider, database, browser or physical
 * wall-time latency is represented by this suite. */
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {useConversationReply} from '../src/lib/use-conversation-reply';
import {fetchConversation,fetchConversationReply,type ConversationReplyState} from '../src/lib/api/conversations';
import {ApiError} from '../src/lib/api/http';
vi.mock('../src/lib/api/conversations',async original=>({...await original<typeof import('../src/lib/api/conversations')>(),fetchConversation:vi.fn(),fetchConversationReply:vi.fn()}));
let root:Root,host:HTMLDivElement,watch:ReturnType<typeof useConversationReply>,starts:number[],rtt:number[],arrives:number;
const delivered=vi.fn();
const pending:ConversationReplyState={profileId:'profile',conversationId:'conversation',messageId:'message',requestId:'request',phase:'running',revision:1,failureCode:null,retryAfter:null,runAfter:null,canRetry:false,generationEnabled:true};
function Harness({profile='profile'}:{profile?:string}){watch=useConversationReply(profile,'conversation',true,1,delivered);return null;}
const mount=()=>act(async()=>root.render(<Harness/>));
const tick=(ms:number)=>act(async()=>vi.advanceTimersByTimeAsync(ms));
beforeEach(()=>{
  vi.resetAllMocks();vi.useFakeTimers({toFake:['setTimeout','clearTimeout','Date','performance']});vi.setSystemTime(0);
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  host=document.createElement('div');document.body.append(host);root=createRoot(host);starts=[];rtt=[0];arrives=Infinity;
  vi.mocked(fetchConversation).mockResolvedValue({id:'conversation',profileId:'profile',revision:2,createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z',messages:[]});
  vi.mocked(fetchConversationReply).mockImplementation((_profile,_id,signal)=>{
    const n=starts.push(performance.now())-1,delay=rtt[Math.min(n,rtt.length-1)]!;
    if(delay===0)return Promise.resolve({...pending,...(performance.now()>=arrives?{phase:'ready' as const,revision:2}:{})});
    return new Promise((resolve,reject)=>{
    const done=()=>{signal?.removeEventListener('abort',aborted);resolve({...pending,...(performance.now()>=arrives?{phase:'ready' as const,revision:2}:{})});};
    const timer=window.setTimeout(done,delay),aborted=()=>{window.clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));};
    signal?.addEventListener('abort',aborted,{once:true});
    });
  });
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.useRealTimers();});
it('can deliver a quick current reply at the optional half-second check',async()=>{
  arrives=350;await mount();await tick(550);
  expect(watch.state?.phase).toBe('ready');expect(starts).toEqual([0,500]);expect(fetchConversation).toHaveBeenCalledOnce();
});
it('keeps regular check times and the old pending watch length with one extra bounded read',async()=>{
  await mount();await tick(60_000);
  expect(starts).toEqual([0,500,...Array.from({length:10},(_,n)=>(n+1)*1000),...Array.from({length:24},(_,n)=>12_000+n*2000)]);
  expect(starts).toHaveLength(36);expect(starts.at(-1)).toBe(58_000);expect(watch.waiting).toBe(true);
});
it('subtracts time used by the optional check instead of delaying the regular one',async()=>{
  rtt=[20,125,20];await mount();await tick(1100);
  expect(starts).toEqual([0,520,1020]);
});
it('skips the extra read when the first status request is already slow',async()=>{
  rtt=[600];await mount();await tick(2500);expect(starts).toEqual([0,1600]);
});
it('cancels a stalled optional probe at the original regular check, without treating its own deadline as a failed normal read',async()=>{
  rtt=[20,2000,20];arrives=800;await mount();await tick(1100);
  expect(starts).toEqual([0,520,1020]);expect(watch.state?.phase).toBe('ready');expect(watch.error).toBe(false);
});
it('stops an alternating failure/pending watch at the total read bound',async()=>{
  let n=0;vi.mocked(fetchConversationReply).mockImplementation(async()=>{starts.push(performance.now());if(++n%2===0)throw new Error('Synthetic network failure');return {...pending};});
  await mount();await tick(120_000);expect(starts).toHaveLength(36);expect(watch.waiting||watch.stopped).toBe(true);
});
it('does not wait for an optional status transport that ignores abort, or deliver its late result',async()=>{
  let resolveLate!:(value:ConversationReplyState)=>void;let optionalSignal:AbortSignal|undefined;
  vi.mocked(fetchConversationReply).mockImplementation(async(_p,_id,signal)=>{
    starts.push(performance.now());if(starts.length===1)return {...pending};
    if(starts.length===2){optionalSignal=signal;return new Promise(resolve=>{resolveLate=resolve;});}
    return {...pending,phase:'ready',revision:2};
  });
  await mount();await tick(1000);expect(starts).toEqual([0,500,1000]);expect(optionalSignal?.aborted).toBe(true);expect(watch.state?.revision).toBe(2);
  await act(async()=>resolveLate({...pending,phase:'running',revision:99}));expect(watch.state).toMatchObject({phase:'ready',revision:2});expect(fetchConversation).toHaveBeenCalledOnce();
});
it('also discards a late optional conversation read before publication',async()=>{
  arrives=350;let resolveLate!:(value:Awaited<ReturnType<typeof fetchConversation>>)=>void;
  vi.mocked(fetchConversation).mockImplementationOnce(()=>new Promise(resolve=>{resolveLate=resolve;}));
  await mount();await tick(1000);expect(starts).toEqual([0,500,1000]);expect(watch.state?.revision).toBe(2);
  await act(async()=>resolveLate({id:'conversation',profileId:'profile',revision:99,createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z',messages:[]}));
  expect(watch.state).toMatchObject({phase:'ready',revision:2});expect(watch.error).toBe(false);expect(delivered).toHaveBeenCalledOnce();expect(delivered.mock.calls[0]![0].revision).toBe(2);
});
it.each(['network','5xx','older state','older conversation'])('keeps the original regular point and failure history after optional %s',async kind=>{
  let n=0;vi.mocked(fetchConversationReply).mockImplementation(async()=>{
    starts.push(performance.now());if(++n!==2)return {...pending};
    if(kind==='network')throw new Error('Synthetic network failure');
    if(kind==='5xx')throw new ApiError({status:503,message:'Synthetic unavailable'});
    return {...pending,revision:kind==='older state'?0:2};
  });
  if(kind==='older conversation')vi.mocked(fetchConversation).mockResolvedValueOnce({id:'conversation',profileId:'profile',revision:1,createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z',messages:[]});
  await mount();await tick(1000);expect(starts).toEqual([0,500,1000]);expect(watch.error).toBe(false);expect(watch.behind).toBe(false);expect(watch.stopped).toBe(false);
});
it('still requires two regular failed reads after an optional failure',async()=>{
  vi.mocked(fetchConversationReply).mockImplementation(async()=>{starts.push(performance.now());if(starts.length===1)return {...pending};throw new Error('Synthetic network failure');});
  await mount();await tick(1000);expect(watch.stopped).toBe(false);await tick(1000);expect(starts).toEqual([0,500,1000,2000]);expect(watch.stopped).toBe(true);expect(watch.error).toBe(true);
});
it.each([401,404,410])('honors explicit optional HTTP %s without another scheduled read',async status=>{
  vi.mocked(fetchConversationReply).mockResolvedValueOnce({...pending}).mockRejectedValueOnce(new ApiError({status,message:'Synthetic refusal'}));
  await mount();await tick(10_000);expect(fetchConversationReply).toHaveBeenCalledTimes(2);
  if(status===401){expect(watch.stopped).toBe(true);expect(watch.error).toBe(true);}else expect(watch.terminal).toBe('gone');
});
it('does not start an optional read while hidden and resumes through the normal visible watch',async()=>{
  const hidden=vi.spyOn(document,'hidden','get').mockReturnValue(false);await mount();hidden.mockReturnValue(true);await tick(500);expect(starts).toEqual([0]);
  hidden.mockReturnValue(false);await act(async()=>document.dispatchEvent(new Event('visibilitychange')));expect(starts).toEqual([0,500]);
});
it('drops an old profile optional result after the profile changes',async()=>{
  let resolveLate!:(value:ConversationReplyState)=>void;
  vi.mocked(fetchConversationReply).mockImplementation(async profile=>{
    starts.push(performance.now());if(profile==='profile'&&starts.length===1)return {...pending};
    if(profile==='profile')return new Promise(resolve=>{resolveLate=resolve;});
    return {...pending,profileId:profile,phase:'ready',revision:2};
  });
  vi.mocked(fetchConversation).mockResolvedValue({id:'conversation',profileId:'other',revision:2,createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z',messages:[]});
  await mount();await tick(500);await act(async()=>root.render(<Harness profile="other"/>));
  await act(async()=>resolveLate({...pending,phase:'ready',revision:99}));expect(watch.state).toMatchObject({profileId:'other',revision:2});expect(delivered).toHaveBeenCalledOnce();expect(delivered.mock.calls[0]![0].profileId).toBe('other');
});
