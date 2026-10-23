// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `fetch` returns profile-owned history
 * and holds search responses. Real ConversationsOverlay and API URL/owner
 * validation run; stale requests deliberately ignore AbortSignal in this seam. */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConversationsOverlay } from '../src/components/ConversationsOverlay';
let root:Root,host:HTMLDivElement;
const calls:Array<{url:string;resolve:(value:Response)=>void}>=[];
const row={id:'chat',profileId:'noah',revision:2,updatedAt:'2026-10-23T00:00:00Z',preview:'Planning a walk'};
function answer(index:number,rows:unknown[]){calls[index]!.resolve(new Response(JSON.stringify({profileId:'noah',generationEnabled:false,conversations:rows}),{status:200,headers:{'Content-Type':'application/json'}}));}
async function search(query:string){await act(async()=>{
 const input=host.querySelector('input')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,query);input.dispatchEvent(new Event('input',{bubbles:true}));
});await act(async()=>{await vi.advanceTimersByTimeAsync(201);});}
beforeEach(async()=>{(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;vi.useFakeTimers();calls.length=0;
 vi.stubGlobal('fetch',vi.fn((url:string)=>new Promise<Response>(resolve=>calls.push({url:String(url),resolve}))));
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 await act(async()=>root.render(<ConversationsOverlay locale="en-US" profileId="noah" title="Noah’s chats" onClose={()=>{}} onOpen={()=>{}}/>));
 await act(async()=>answer(0,[row]));
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals();});
it('keeps recognizable titles with matching message snippets and ignores stale search responses',async()=>{
 await search('purple umbrella');expect(calls[1]!.url).toContain('profile=noah&q=purple%20umbrella');
 await search('forest');
 await act(async()=>answer(2,[{...row,match:'A later message about the forest path.'}]));
 expect(host.textContent).toContain('Planning a walk');expect(host.textContent).toContain('forest path');
 await act(async()=>answer(1,[]));expect(host.textContent).toContain('forest path');
 await search('absent');await act(async()=>answer(3,[]));expect(host.textContent).toContain('No matching chats');
 await search('');await act(async()=>answer(4,[row]));expect(calls[4]!.url).not.toContain('&q=');expect(host.textContent).toContain('Planning a walk');
});
