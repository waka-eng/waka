// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/api/attachments` supplies
 * deferred presigned-read results without S3. `IntersectionObserver` supplies
 * explicit visibility, and `Date`/timers control expiry and bounded recovery.
 * Real ThumbnailStore/Provider/SavedPhoto lifecycle, owner scope and cache run.
 * Delayed transports settle independently of cancellation to test slot churn. */
import {act,StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ThumbnailProvider,ThumbnailStore} from '../src/lib/thumbnail-reads';
import {SavedPhoto} from '../src/components/SavedPhoto';
import {fetchAttachmentUrl} from '../src/lib/api/attachments';
vi.mock('../src/lib/api/attachments',async original=>({...await original<any>(),fetchAttachmentUrl:vi.fn()}));
let observers:FakeObserver[],stores:ThumbnailStore[],roots:Array<ReturnType<typeof createRoot>>;
class FakeObserver{
 nodes=new Set<Element>();constructor(readonly callback:IntersectionObserverCallback){observers.push(this);}
 observe=(node:Element)=>this.nodes.add(node);unobserve=(node:Element)=>this.nodes.delete(node);disconnect=()=>this.nodes.clear();
 show(node:Element,visible=true){this.callback([{target:node,isIntersecting:visible,intersectionRatio:visible?1:0} as IntersectionObserverEntry],this as unknown as IntersectionObserver);}
}
beforeEach(()=>{observers=[];stores=[];roots=[];vi.useFakeTimers({toFake:['Date','setTimeout','clearTimeout']});vi.setSystemTime(0);vi.stubGlobal('IntersectionObserver',FakeObserver);(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;});
afterEach(async()=>{for(const root of roots)await act(async()=>root.unmount());for(const store of stores)store.dispose();document.body.innerHTML='';vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();vi.mocked(fetchAttachmentUrl).mockReset();});
const tick=()=>act(async()=>{await Promise.resolve();await Promise.resolve();});
function store(read:ConstructorParameters<typeof ThumbnailStore>[1]){const s=new ThumbnailStore('account:profile',read);stores.push(s);return s;}
function node(){const n=document.createElement('span');document.body.append(n);return n;}
it('shares one observer, starts no offscreen reads and caps/deduplicates visible work at three',async()=>{
 const pending:Array<{id:string;signal:AbortSignal;resolve:(url:string)=>void}>=[];let active=0,peak=0;
 const read=vi.fn((id:string,signal?:AbortSignal)=>{active++;peak=Math.max(active,peak);return new Promise<string>(resolve=>pending.push({id,signal:signal!,resolve:url=>{active--;resolve(url);}}));});
 const s=store(read),nodes=Array.from({length:50},node),changes=nodes.map(()=>vi.fn());
 nodes.forEach((n,i)=>s.observe(n,`photo-${i}`,changes[i]));expect(observers).toHaveLength(1);expect(read).not.toHaveBeenCalled();
 nodes.slice(0,6).forEach(n=>observers[0].show(n));expect(read).toHaveBeenCalledTimes(3);
 const duplicate=node();s.observe(duplicate,'photo-0',vi.fn());observers[0].show(duplicate);expect(read).toHaveBeenCalledTimes(3);
 pending[0].resolve('https://fixture.invalid/0');await tick();expect(read).toHaveBeenCalledTimes(4);expect(peak).toBe(3);
 expect(read.mock.calls.every(([id])=>Number(id.slice(6))<6)).toBe(true);
});
it('unsubscribes an unmounted tile without reusing its transport slot; scope disposal aborts',async()=>{
 let finish!:(url:string)=>void,signal!:AbortSignal;
 const s=store((_id,s)=>{signal=s!;return new Promise(resolve=>{finish=resolve;});}),target=node(),change=vi.fn();
 const leave=s.observe(target,'one',change);observers[0].show(target);leave();expect(signal.aborted).toBe(false);s.dispose();expect(signal.aborted).toBe(true);
 finish('https://fixture.invalid/old');await tick();expect(change.mock.calls.some(([url])=>url==='https://fixture.invalid/old')).toBe(false);
});
it('rapid viewport churn drops queued work but waits for same-owner transports to finish',async()=>{
 let active=0,peak=0;const finish:Array<()=>void>=[],signals:AbortSignal[]=[];
 const read=vi.fn((_id:string,signal?:AbortSignal)=>{active++;peak=Math.max(peak,active);signals.push(signal!);return new Promise<string>(resolve=>finish.push(()=>{active--;resolve('https://fixture.invalid/photo');}));});
 const s=store(read),targets=Array.from({length:50},node);targets.forEach((target,i)=>s.observe(target,`photo-${i}`,vi.fn()));
 targets.slice(0,10).forEach(target=>observers[0].show(target));expect(read).toHaveBeenCalledTimes(3);
 targets.slice(0,10).forEach(target=>observers[0].show(target,false));targets.slice(30,40).forEach(target=>observers[0].show(target));
 expect(read).toHaveBeenCalledTimes(3);expect(signals.every(signal=>!signal.aborted)).toBe(true);
 finish.shift()!();await tick();expect(read).toHaveBeenCalledTimes(4);expect(read.mock.calls[3][0]).toBe('photo-30');expect(peak).toBe(3);
});
it('reuses only fresh scope-local URLs; reopening after expiry reads again without idle expiry polling',async()=>{
 const read=vi.fn(async()=>`https://fixture.invalid/${read.mock.calls.length}`),s=store(read),first=node();
 const leave=s.observe(first,'one',vi.fn());observers[0].show(first);await tick();leave();
 const second=node(),change=vi.fn();s.observe(second,'one',change);observers[0].show(second);await tick();expect(read).toHaveBeenCalledTimes(1);expect(change).toHaveBeenLastCalledWith('https://fixture.invalid/1');
 await vi.advanceTimersByTimeAsync(4*60_000+1);expect(read).toHaveBeenCalledTimes(1);
 observers[0].show(second,false);observers[0].show(second);await tick();expect(read).toHaveBeenCalledTimes(2);
});
it('has one bounded failure retry; focus can recover a failed visible tile without a timer loop',async()=>{
 const read=vi.fn().mockRejectedValue(Error('Synthetic offline')),s=store(read),target=node();s.observe(target,'one',vi.fn());observers[0].show(target);await tick();
 await vi.advanceTimersByTimeAsync(1500);await tick();expect(read).toHaveBeenCalledTimes(2);
 await vi.advanceTimersByTimeAsync(60_000);expect(read).toHaveBeenCalledTimes(2);
 read.mockResolvedValue('https://fixture.invalid/recovered');window.dispatchEvent(new Event('focus'));await tick();expect(read).toHaveBeenCalledTimes(3);
});
it('does not loop signed-URL reads when image bytes repeatedly fail',async()=>{
 const read=vi.fn(async()=>`https://fixture.invalid/${read.mock.calls.length}`),s=store(read),target=node();s.observe(target,'one',vi.fn());observers[0].show(target);await tick();
 s.invalidate('one');await vi.advanceTimersByTimeAsync(1500);await tick();s.invalidate('one');await vi.advanceTimersByTimeAsync(60_000);expect(read).toHaveBeenCalledTimes(2);
});
it('clears old owner URLs synchronously on logout/switch and survives StrictMode effect replay',async()=>{
 vi.mocked(fetchAttachmentUrl).mockResolvedValue('https://fixture.invalid/owner-a');
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root);
 const render=(owner:string|null)=>act(async()=>root.render(<StrictMode><ThumbnailProvider owner={owner}><SavedPhoto id="same-id"/></ThumbnailProvider></StrictMode>));
 await render('account-a:profile-a');const target=host.querySelector('span')!;observers.at(-1)!.show(target);await tick();expect(host.querySelector('img')?.src).toBe('https://fixture.invalid/owner-a');
 await render(null);expect(host.querySelector('img')).toBeNull();
 vi.mocked(fetchAttachmentUrl).mockResolvedValue('https://fixture.invalid/owner-b');await render('account-b:profile-b');observers.at(-1)!.show(host.querySelector('span')!);await tick();expect(host.querySelector('img')?.src).toBe('https://fixture.invalid/owner-b');expect(fetchAttachmentUrl).toHaveBeenCalledTimes(2);
});
