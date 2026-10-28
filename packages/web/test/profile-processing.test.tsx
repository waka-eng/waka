// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/api/inspiration-processing` returns
 * explicit server receipts and delayed responses. Real HomeActions and its
 * dialog test discovery, focus and profile changes without Home fallback data. */
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const api=vi.hoisted(()=>({summary:vi.fn(),status:vi.fn(),retry:vi.fn()}));
vi.mock('../src/lib/api/inspiration-processing',()=>({fetchProfileProcessing:api.summary,fetchInspirationProcessing:api.status,retryInspirationProcessing:api.retry}));
import {HomeActions} from '../src/components/HomeActions';
let host:HTMLDivElement,root:Root;
const render=(profileId='agent')=><HomeActions key={profileId} profileId={profileId} locale="en-US" revision={0} onPrinciples={()=>{}} onOpen={()=>{}}/>;
const button=(text:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent?.startsWith(text))!;
beforeEach(()=>{(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.clearAllMocks();});
it('discovers server-owned work in a new session and restores focus after closing progress',async()=>{
 api.summary.mockResolvedValue({profileId:'agent',total:1,failed:1,items:[{inspirationId:'source',createdAt:'2026-10-28T12:00:00Z',stage:'reading',phase:'failed',runAfter:null}]});
 await act(async()=>root.render(render()));
 expect(api.summary).toHaveBeenCalledWith('agent',expect.any(AbortSignal));
 await act(async()=>button('Actions').click());
 const opener=button('Saved inspiration progress (1)');await act(async()=>{opener.focus();opener.click();});
 expect(document.querySelector('[role="dialog"]')).not.toBeNull();
 await act(async()=>document.querySelector('[role="dialog"]')!.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true})));
 await act(async()=>button('Close').click());
 expect(document.querySelector('[role="dialog"]')).toBeNull();expect(document.activeElement).toBe(opener);
 expect(host.querySelector('[hidden]')).toBeNull();
});
it('does not show a late previous-profile result after switching agents',async()=>{
 let late!:(value:unknown)=>void;
 api.summary.mockImplementationOnce(()=>new Promise(resolve=>{late=resolve;})).mockResolvedValue({profileId:'another',total:2,failed:2,items:[]});
 await act(async()=>root.render(render()));const signal=api.summary.mock.calls[0][1] as AbortSignal;
 await act(async()=>root.render(render('another')));expect(signal.aborted).toBe(true);
 await act(async()=>late({profileId:'agent',total:99,failed:99,items:[]}));
 expect(host.textContent).toContain('Saved inspiration progress (2)');expect(host.textContent).not.toContain('(99)');
});
