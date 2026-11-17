// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/api/conversations` supplies
 * synthetic owned HTTP results; `components/ConversationText` counts calls
 * around the REAL formatter while preserving React.memo. DOM scroll geometry
 * and requestAnimationFrame are controlled; Storage writes remain real/spied.
 * This proves work counts and durable draft writes, not paint/provider latency. */
/** Real panel/formatter/draft store; only HTTP results and scroll geometry are
 * fixtures. Measures repeated work, not browser paint or provider latency. */
import {act,createElement,memo,Profiler} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ConversationPanel} from '../src/components/ConversationPanel';
import type {ApiConversation} from '../src/lib/api/conversations';
import {readConversationDrafts} from '../src/lib/conversation-drafts';
const count=vi.hoisted(()=>({formats:0}));
vi.mock('../src/components/ConversationText',async original=>{
 const actual=await original<any>(),component=actual.ConversationText;
 const measured=(props:any)=>{count.formats++;return createElement(component.type??component,props);};
 return {...actual,ConversationText:component.$$typeof===Symbol.for('react.memo')?memo(measured,component.compare):measured};
});
vi.mock('../src/lib/api/conversations',async original=>({...await original<any>(),
 fetchConversation:async()=>row,listConversations:async()=>({profileId:scope.profileId,conversations:[],generationEnabled:true}),
 fetchConversationReply:async()=>({profileId:scope.profileId,conversationId:id,revision:row.revision,phase:'idle',generationEnabled:true,canRetry:false,messageId:null,requestId:null,runAfter:null,retryAfter:null}),
}));
const scope={accountId:'11111111-1111-4111-8111-111111111111',profileId:'22222222-2222-4222-8222-222222222222'},id='33333333-3333-4333-8333-333333333333';
let row:ApiConversation,host:HTMLDivElement,root:ReturnType<typeof createRoot>,durations:number[];
beforeEach(()=>{
 localStorage.clear();sessionStorage.clear();count.formats=0;durations=[];
 (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
 row={id,profileId:scope.profileId,revision:120,createdAt:'2026-11-13T00:00:00Z',updatedAt:'2026-11-13T00:00:00Z',generationEnabled:true,messageWindowStart:1,
  messages:Array.from({length:120},(_,i)=>({id:`synthetic-${i}`,profileId:scope.profileId,conversationId:id,position:i+1,role:i%2?'assistant':'user',content:`Synthetic turn ${i}.\n\n**A small decision**\n- Keep the choice reversible\n- Protect a quiet hour\n\n${'There is room for uncertainty. '.repeat(16)}`,createdAt:'2026-11-13T00:00:00Z'}))};
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.useRealTimers();});
async function mount(){await act(async()=>root.render(<Profiler id="panel" onRender={(_id,phase,ms)=>{if(phase==='update')durations.push(ms);}}><ConversationPanel scope={scope} id={id} initialConversation={row} locale="en-US" onChoose={()=>{}}/></Profiler>));}
it('keeps unchanged transcript formatting out of the typing path while saving every draft edit',async()=>{
 await mount();count.formats=0;durations=[];
 const writes=vi.spyOn(Storage.prototype,'setItem'),field=host.querySelector('textarea')!,set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!;
 const text='A durable draft, typed one letter at a time.';
 for(let n=1;n<=text.length;n++)await act(async()=>{set.call(field,text.slice(0,n));field.dispatchEvent(new Event('input',{bubbles:true}));});
 const saved=readConversationDrafts(scope,id)[0]?.value;
 const sample={measurement:'chat-typing-transform',messages:120,keystrokes:text.length,formatterCalls:count.formats,draftWrites:writes.mock.calls.filter(([key])=>String(key).includes(':draft:')).length,medianRenderMs:[...durations].sort((a,b)=>a-b)[Math.floor(durations.length/2)],maxRenderMs:Math.max(...durations),realNetwork:false,realLayout:false};
 if(process.env.WAKA_CHAT_MEASURE==='1')console.info(JSON.stringify(sample));
 expect(saved?.content).toBe(text);expect(sample.draftWrites).toBe(text.length);
 expect(count.formats).toBe(0);
});
it('coalesces scroll metadata writes and flushes the final reader position on leave',async()=>{
 await mount();vi.useFakeTimers({toFake:['requestAnimationFrame','cancelAnimationFrame']});
 const scroll=host.querySelector<HTMLElement>('.chat-scroll')!;
 Object.defineProperties(scroll,{scrollHeight:{value:5000,configurable:true},clientHeight:{value:500,configurable:true}});
 const writes=vi.spyOn(Storage.prototype,'setItem');
 for(let n=0;n<80;n++){scroll.scrollTop=n*10;scroll.dispatchEvent(new Event('scroll',{bubbles:true}));}
 const before=writes.mock.calls.filter(([key])=>String(key).includes('conversationScroll:')).length;
 await act(async()=>{await vi.advanceTimersByTimeAsync(20);});
 const after=writes.mock.calls.filter(([key])=>String(key).includes('conversationScroll:')).length;
 if(process.env.WAKA_CHAT_MEASURE==='1')console.info(JSON.stringify({measurement:'chat-scroll-work',events:80,writesBeforeFrame:before,writesAfterFrame:after}));
 expect(before).toBe(0);expect(after).toBe(1);
 scroll.scrollTop=920;scroll.dispatchEvent(new Event('scroll',{bubbles:true}));
 await act(async()=>root.unmount());
 const last=writes.mock.calls.filter(([key])=>String(key).includes('conversationScroll:')).at(-1);
 expect(JSON.parse(String(last?.[1])).top).toBe(920);
});
