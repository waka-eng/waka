// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/api/conversations` supplies owned
 * records and lost responses; `window.confirm` supplies explicit delete choices,
 * and `Storage.setItem` simulates a quota failure.
 * `matchMedia` and `visualViewport` supply mobile and keyboard metrics;
 * DOM scroll geometry supplies a measurable viewport for the arrival test.
 * Real UI, owner-scoped drafts and recovery run; reply text is synthetic. */
import {act} from 'react';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ConversationPanel} from '../src/components/ConversationPanel';
import {createConversation,deleteConversation,fetchConversation,fetchConversationCitation,fetchConversationContext,fetchConversationReply,listConversations,requestConversationReply,saveConversationMessage,stopConversationReply,type ApiConversation,type ConversationReplyState} from '../src/lib/api/conversations';
import {readConversationDrafts} from '../src/lib/conversation-drafts';
import type {ConversationCitation} from '../src/lib/api/conversations';
vi.mock('../src/lib/api/conversations',async original=>({...await original<typeof import('../src/lib/api/conversations')>(),createConversation:vi.fn(),deleteConversation:vi.fn(),fetchConversation:vi.fn(),fetchConversationContext:vi.fn(),fetchConversationReply:vi.fn(),requestConversationReply:vi.fn(),stopConversationReply:vi.fn(),fetchConversationCitation:vi.fn(),listConversations:vi.fn(),saveConversationMessage:vi.fn()}));
const scope={accountId:'owner',profileId:'profile'},id='11111111-1111-4111-8111-111111111111',choose=vi.fn();
it('leaves reply text clear of mobile overlay scrollbars',()=>{
  const css=readFileSync(resolve(dirname(fileURLToPath(import.meta.url)),'../src/styles/chrome.css'),'utf8');
  expect(css.match(/\.jar-conversation-body\s*\{([^}]+)\}/)?.[1]).toContain('padding-inline-end:var(--sp-8)');
});
let root:Root,host:HTMLDivElement,stored:ApiConversation,replyState:ConversationReplyState;
const openSource=vi.fn(),replyId='22222222-2222-4222-8222-222222222222';
beforeEach(()=>{vi.resetAllMocks();vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});localStorage.clear();sessionStorage.clear();(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  stored={id,profileId:scope.profileId,revision:0,createdAt:'2026-10-03T00:00:00Z',updatedAt:'2026-10-03T00:00:00Z',messages:[]};
  vi.mocked(fetchConversation).mockImplementation(async()=>structuredClone(stored));vi.mocked(listConversations).mockResolvedValue({profileId:scope.profileId,conversations:[],generationEnabled:false});
  replyState={profileId:scope.profileId,conversationId:id,messageId:null,requestId:null,phase:'idle',revision:0,failureCode:null,retryAfter:null,runAfter:null,canRetry:false,generationEnabled:true};
  vi.mocked(fetchConversationReply).mockImplementation(async()=>structuredClone(replyState));
  vi.mocked(saveConversationMessage).mockImplementation(async(_profile,_id,input)=>{stored={...stored,revision:stored.revision+1,messages:[...stored.messages,{...input,profileId:scope.profileId,conversationId:id,position:stored.revision+1,role:'user',createdAt:'2026-10-03T01:00:00Z'}]};if(input.requestReply)replyState={...replyState,messageId:input.id,requestId:replyId,revision:stored.revision,phase:'pending'};return structuredClone(stored);});
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
const mount=(conversationId:string|null=id,owner=scope)=>act(async()=>root.render(<ConversationPanel key={`${owner.accountId}:${owner.profileId}:${conversationId}`} scope={owner} id={conversationId} locale="en-US"  onChoose={choose} onOpenSource={openSource}/>));
const click=(label:string)=>act(async()=>[...host.querySelectorAll('button')].find(row=>row.textContent===label)!.click());
const type=(content:string)=>act(async()=>{const area=host.querySelector('textarea')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(area,content);area.dispatchEvent(new Event('input',{bubbles:true}));});
const tick=(ms=2000)=>act(async()=>vi.advanceTimersByTimeAsync(ms));
function completeReply(){stored={...stored,revision:stored.revision+1,messages:[...stored.messages,{id:crypto.randomUUID(),profileId:scope.profileId,conversationId:id,position:stored.revision+1,role:'assistant',content:'Consider the conditions of the choice.',followUpQuestion:'Which condition matters most today?',replyRequestId:replyId,memoryChanged:false,citations:[{index:0,kind:'principle',id:'principle',available:true}],createdAt:'2026-10-03T01:00:01Z'}]};replyState={...replyState,phase:'ready',revision:stored.revision};}
it('restores the correction target with its draft and sends it as a new message',async()=>{
  stored.generationEnabled=true;completeReply();const corrected=stored.messages[0].id;await mount();await click('Correct reply');await type('No, only this month.');
  await act(async()=>root.unmount());root=createRoot(host);await mount();expect(host.textContent).toContain('This corrects the conversation, not your Principles.');await click('Send correction');
  expect(vi.mocked(saveConversationMessage).mock.calls[0][2]).toMatchObject({content:'No, only this month.',correctsMessageId:corrected,requestReply:true});expect(stored.messages[0].content).toBe('Consider the conditions of the choice.');expect(host.textContent).toContain('Update a principle');
});
it('canceling correction preserves typed words without sending or editing memory',async()=>{
  completeReply();await mount();await click('Correct reply');await type('Words to keep');await click('Cancel correction');expect(host.querySelector('textarea')!.value).toBe('Words to keep');expect(saveConversationMessage).not.toHaveBeenCalled();expect(readConversationDrafts(scope,id)[0].value.correctsMessageId).toBeUndefined();
});
it('keeps compact actions and descriptive references with the reply they belong to',async()=>{
  completeReply();stored.messages[0].citations![0].preview='Leave room for an idea.';
  vi.mocked(fetchConversationCitation).mockResolvedValue({profileId:scope.profileId,conversationId:id,requestId:replyId,index:0,source:{kind:'principle',id:'principle',text:'Leave room for an idea.',quote:'Leave room'}});
  await mount();
  const actions=host.querySelector('.jar-conversation-actions')!;
  expect(actions.textContent).toContain('Save insight');expect(actions.textContent).toContain('Correct reply');
  const reference=host.querySelector<HTMLButtonElement>('.jar-conversation-citations button')!;
  expect(reference.textContent).toContain('Leave room for an idea.');await act(async()=>reference.click());
  expect(host.querySelector('.jar-conversation-reference')?.closest('li')?.getAttribute('data-role')).toBe('assistant');
});
it('brings an opened reference into the transcript without scrolling the whole page',async()=>{
  completeReply();vi.mocked(fetchConversationCitation).mockResolvedValue({profileId:scope.profileId,conversationId:id,requestId:replyId,index:0,source:{kind:'principle',id:'principle',text:'Leave room.',quote:'Leave room.'}});
  const rect=HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){
    if(this.classList.contains('chat-scroll'))return {top:0,bottom:300,height:300} as DOMRect;
    if(this.classList.contains('jar-conversation-reference')){const top=280-(host.querySelector<HTMLElement>('.chat-scroll')?.scrollTop??0);return {top,bottom:top+260,height:260} as DOMRect;}
    return rect.call(this);
  });
  await mount();await click('Principle 1');expect(host.querySelector<HTMLElement>('.chat-scroll')!.scrollTop).toBe(240);
  expect(document.documentElement.scrollTop).toBe(0);
});
it('clearly saves messages without promising an assistant reply',async()=>{
  await mount();expect(host.textContent).toContain('Replies aren’t connected yet.');await type('I want quiet mornings.');expect(host.textContent).toContain('Draft on this device');await click('Save message');
  expect(host.textContent).toContain('I want quiet mornings.');expect(host.querySelector('textarea')!.value).toBe('');expect(stored.messages).toHaveLength(1);expect(readConversationDrafts(scope,id)).toEqual([]);
});
it('offers a new-chat exit when a conversation is unavailable, without showing old words',async()=>{
  vi.mocked(fetchConversation).mockRejectedValueOnce(new Error('Unavailable'));await mount();
  /* No box to type in, so the exit has to be visible without opening
     anything — it sits next to the sentence that reports the failure. */
  expect(host.querySelector('textarea')).toBeNull();expect(host.querySelector('.chat-notice')?.textContent).toContain('New conversation');
  await click('New conversation');expect(choose).toHaveBeenCalledWith(null);expect(createConversation).not.toHaveBeenCalled();
});
it('reconciles a lost save response with a read, without resending',async()=>{
  const save=vi.mocked(saveConversationMessage).getMockImplementation()!;
  vi.mocked(saveConversationMessage).mockImplementationOnce(async(...args)=>{await save(...args);throw new Error('Response lost');});
  await mount();await type('Keep my exact thought');await click('Save message');
  expect(host.querySelector('textarea')!.value).toBe('Keep my exact thought');expect(host.textContent).toContain('Couldn’t confirm this message.');
  await click('Check saved messages');expect(saveConversationMessage).toHaveBeenCalledTimes(1);expect(stored.messages).toHaveLength(1);expect(host.querySelector('textarea')!.value).toBe('');
});
it('restores unsent words after reopening and forks edits instead of overwriting the previous writer',async()=>{
  await mount();await type('Original draft');await act(async()=>root.unmount());root=createRoot(host);await mount();
  expect(host.querySelector('textarea')!.value).toBe('Original draft');await type('Another tab version');
  expect(readConversationDrafts(scope,id).map(row=>row.value.content).sort()).toEqual(['Another tab version','Original draft']);
});
it('never restores another account’s draft',async()=>{
  await mount();await type('PRIVATE_DRAFT');await mount(id,{...scope,accountId:'different-account'});
  expect(host.querySelector('textarea')!.value).toBe('');expect(host.textContent).not.toContain('PRIVATE_DRAFT');
});
it('blocks sending on storage failure while keeping the visible words',async()=>{
  await mount();vi.spyOn(Storage.prototype,'setItem').mockImplementationOnce(()=>{throw new Error('Quota');});await type('Still visible');
  expect(host.querySelector('textarea')!.value).toBe('Still visible');expect(host.textContent).toContain('Copy your words before leaving.');await click('Save message');expect(saveConversationMessage).not.toHaveBeenCalled();
});
it('reuses the exact conversation id when creation response is lost',async()=>{
  vi.mocked(listConversations).mockResolvedValue({profileId:scope.profileId,conversations:[],generationEnabled:true});
  vi.mocked(createConversation).mockRejectedValueOnce(new Error('Lost')).mockImplementationOnce(async(_profile,conversationId,_signal,_principle,first)=>({...stored,id:conversationId,revision:1,generationEnabled:true,messages:[{id:first!.id,content:first!.content,profileId:scope.profileId,conversationId,position:1,role:'user',createdAt:stored.createdAt}]}));
  await mount(null);expect(createConversation).not.toHaveBeenCalled();await type('My first message');await click('Send');await click('Retry this message');
  expect(vi.mocked(createConversation).mock.calls[0][1]).toBe(vi.mocked(createConversation).mock.calls[1][1]);
  expect(vi.mocked(createConversation).mock.calls[0][4]).toEqual(vi.mocked(createConversation).mock.calls[1][4]);
  expect(choose).toHaveBeenCalledTimes(1);expect(readConversationDrafts(scope,'new:general')).toEqual([]);
});
it('reconciles a committed first Send after reload using GET only',async()=>{
  vi.mocked(listConversations).mockResolvedValue({profileId:scope.profileId,conversations:[],generationEnabled:true});
  vi.mocked(createConversation).mockImplementationOnce(async(_profile,conversationId,_signal,_principle,first)=>{
    stored={...stored,id:conversationId,revision:1,generationEnabled:true,messages:[{id:first!.id,content:first!.content,profileId:scope.profileId,conversationId,position:1,role:'user',createdAt:stored.createdAt}]};throw new Error('Response lost after commit');
  });
  await mount(null);await type('Keep my first question');await click('Send');
  expect(readConversationDrafts(scope,'new:general')[0].value).toMatchObject({pending:true,conversationId:stored.id});
  await act(async()=>root.unmount());root=createRoot(host);await mount(null);
  expect(fetchConversation).toHaveBeenCalledWith(scope.profileId,stored.id,expect.any(AbortSignal));
  expect(createConversation).toHaveBeenCalledOnce();expect(choose).toHaveBeenCalledWith(stored.id);
  expect(readConversationDrafts(scope,'new:general')).toEqual([]);
});
it('expands a later tail to confirm an old uncertain first Send without resending',async()=>{
  vi.mocked(listConversations).mockResolvedValue({profileId:scope.profileId,conversations:[],generationEnabled:true});
  vi.mocked(createConversation).mockImplementationOnce(async(_profile,conversationId,_signal,_principle,first)=>{
    stored={...stored,id:conversationId,revision:1,generationEnabled:true,messages:[{id:first!.id,content:first!.content,profileId:scope.profileId,conversationId,position:1,role:'user',createdAt:stored.createdAt}]};throw new Error('Response lost');
  });
  await mount(null);await type('My original question');await click('Send');
  const conversationId=stored.id,first=stored.messages[0];
  const all=[first,...Array.from({length:79},(_,i)=>({...first,id:`later-${i}`,position:i+2,content:`Later words ${i+2}`}))];
  stored={...stored,revision:80,messages:all};
  vi.mocked(fetchConversation).mockImplementation(async(_profile,_id,_signal,from)=>({...stored,messageWindowStart:from??51,messages:all.filter(message=>message.position>=(from??51))}));
  await act(async()=>root.unmount());root=createRoot(host);await mount(null);
  expect(fetchConversation).toHaveBeenLastCalledWith(scope.profileId,conversationId,expect.any(AbortSignal),1);
  expect(createConversation).toHaveBeenCalledOnce();expect(readConversationDrafts(scope,'new:general')).toEqual([]);
});
it('keeps a new-chat draft private and does not create a conversation on opening',async()=>{
  await mount(null);expect(host.querySelector('textarea')).not.toBeNull();expect(createConversation).not.toHaveBeenCalled();
  await type('My unfinished first message');await act(async()=>root.unmount());root=createRoot(host);await mount(null);
  expect(host.querySelector('textarea')!.value).toBe('My unfinished first message');expect(createConversation).not.toHaveBeenCalled();
  await mount(null,{accountId:'other',profileId:'other-profile'});expect(host.querySelector('textarea')!.value).toBe('');
});
it('sends on desktop Enter but preserves composition and Shift Enter',async()=>{
  stored.generationEnabled=true;await mount();await type('A composed message');
  const enter=(options:KeyboardEventInit)=>act(async()=>host.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,...options})));
  await enter({isComposing:true});await enter({keyCode:229});await enter({shiftKey:true});await enter({altKey:true});await enter({repeat:true});expect(saveConversationMessage).not.toHaveBeenCalled();
  await enter({});expect(saveConversationMessage).toHaveBeenCalledOnce();
});
it('loads the current conversation even if its history list is unavailable',async()=>{
  vi.mocked(listConversations).mockRejectedValueOnce(new Error('List unavailable'));await mount();
  /* The failure is reported inside the sheet the list lives in, not as a
     page-level alarm about a secondary list — but the conversation you are
     actually in opens regardless, which is what this is really testing. */
  expect(host.querySelector('textarea')).not.toBeNull();
  await click('All conversations');expect(host.textContent).toContain('Couldn’t load your conversation list.');await click('close');
  await type('My conversation still works');await click('Save message');expect(saveConversationMessage).toHaveBeenCalledOnce();
});
it('restores a scoped non-bottom transcript position after reopening',async()=>{
  completeReply();await mount();const body=host.querySelector<HTMLElement>('.jar-conversation-body')!;
  Object.defineProperties(body,{scrollHeight:{configurable:true,value:1500},clientHeight:{configurable:true,value:300}});body.scrollTop=120;
  await act(async()=>body.dispatchEvent(new Event('scroll',{bubbles:true})));
  await act(async()=>root.unmount());root=createRoot(host);await mount();expect(host.querySelector<HTMLElement>('.jar-conversation-body')!.scrollTop).toBe(120);
  expect(fetchConversation).toHaveBeenLastCalledWith(scope.profileId,id,expect.any(AbortSignal),1);
});
it('keeps the two sheets mutually exclusive and preserves the composer behind their backdrop',async()=>{
  vi.mocked(fetchConversationContext).mockResolvedValue({profileId:scope.profileId,generationEnabled:false,principles:[],reading:[],inspirations:[]});
  await mount();await type('A draft behind the drawer');
  await click('All conversations');
  expect(host.querySelector('.chat-drawer-backdrop')).not.toBeNull();expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  await click('Your memory');expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1);expect(host.querySelector('.chat-sidebar')).toBeNull();
  await act(async()=>host.querySelector<HTMLButtonElement>('.chat-drawer-backdrop')!.click());
  expect(host.querySelector('[role="dialog"]')).toBeNull();expect(host.querySelector('textarea')!.value).toBe('A draft behind the drawer');
});
it('keeps the full-page composer within the visible keyboard viewport',async()=>{
  const viewport=Object.assign(new EventTarget(),{height:844,offsetTop:0});vi.stubGlobal('visualViewport',viewport);await mount();
  const page=host.querySelector<HTMLElement>('.chat-page')!;
  const transcript=host.querySelector<HTMLElement>('.chat-scroll')!;Object.defineProperty(transcript,'scrollHeight',{configurable:true,value:1200});
  viewport.height=340;viewport.offsetTop=40;await act(async()=>viewport.dispatchEvent(new Event('resize')));
  expect(page.style.getPropertyValue('--chat-height')).toBe('340px');expect(page.style.getPropertyValue('--chat-top')).toBe('40px');
  expect(transcript.scrollTop).toBe(1200);
  viewport.height=0;await act(async()=>viewport.dispatchEvent(new Event('resize')));expect(page.style.getPropertyValue('--chat-height')).toBe('340px');
});
it('requires confirmation for deletion and removes only this conversation’s drafts',async()=>{
  await mount();await type('Draft to erase');const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);await click('Delete conversation');expect(deleteConversation).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);vi.mocked(deleteConversation).mockResolvedValue(undefined);await click('Delete conversation');expect(deleteConversation).toHaveBeenCalledWith(scope.profileId,id,expect.any(AbortSignal));expect(readConversationDrafts(scope,id)).toEqual([]);expect(choose).toHaveBeenCalledWith(null);
});
it('shows current disputed and unconfirmed memory without creating a message',async()=>{
  vi.mocked(fetchConversationContext).mockResolvedValue({profileId:scope.profileId,generationEnabled:false,principles:[{id:'p',text:'My current words',state:'contested',supportCurrent:false,truncated:false}],reading:[],inspirations:[]});
  await mount();await click('Your memory');expect(host.textContent).toContain('Marked as disputed');expect(host.textContent).toContain('Support not confirmed');expect(saveConversationMessage).not.toHaveBeenCalled();
  vi.mocked(fetchConversationContext).mockRejectedValueOnce(new Error('Unavailable'));await click('Check current memory');expect(host.textContent).not.toContain('My current words');expect(host.textContent).toContain('Current memory couldn’t be loaded.');
});
it('sends one durable reply intent, displays the follow-up and opens verified references',async()=>{
  stored.generationEnabled=true;await mount();await type('What could I try?');await click('Send');
  expect(saveConversationMessage).toHaveBeenCalledWith(scope.profileId,id,expect.objectContaining({content:'What could I try?',requestReply:true}),expect.any(AbortSignal));expect(requestConversationReply).not.toHaveBeenCalled();
  expect(host.textContent).toContain('Waiting to start…');completeReply();await tick();expect(host.textContent).toContain('Which condition matters most today?');
  vi.mocked(fetchConversationCitation).mockResolvedValue({profileId:scope.profileId,conversationId:id,requestId:replyId,index:0,source:{kind:'principle',id:'principle',text:'Keep room for thought.',quote:'Keep room for thought.',supportCurrent:false}});
  await click('Principle 1');expect(host.textContent).toContain('Keep room for thought.');expect(host.textContent).toContain('Support not confirmed');await click('Open original');expect(openSource).toHaveBeenCalledWith('principle','principle');
  vi.mocked(fetchConversationCitation).mockRejectedValueOnce(new Error('Changed'));await click('Principle 1');expect(host.textContent).not.toContain('Keep room for thought.');expect(host.textContent).toContain('The reference changed or couldn’t be loaded.');
});
it('stops a pending reply and reconciles a lost retry response without resending',async()=>{
  stored.generationEnabled=true;await mount();await type('Keep this question');await click('Send');
  vi.mocked(stopConversationReply).mockImplementation(async()=>{replyState={...replyState,phase:'stopped',canRetry:true};return structuredClone(replyState);});
  await click('Stop reply');expect(host.textContent).toContain('Stopped. Your message is saved.');expect(stored.messages).toHaveLength(1);
  vi.mocked(requestConversationReply).mockImplementationOnce(async()=>{replyState={...replyState,phase:'pending',requestId:'33333333-3333-4333-8333-333333333333',canRetry:false};throw new Error('Response lost');});
  await click('Retry reply');expect(requestConversationReply).toHaveBeenCalledTimes(1);expect(saveConversationMessage).toHaveBeenCalledTimes(1);expect(host.textContent).toContain('Waiting to start…');
});
it('does not jump away from older messages when a new reply arrives',async()=>{
  stored.generationEnabled=true;await mount();await type('A question');await click('Send');
  const body=host.querySelector<HTMLElement>('.jar-conversation-body')!;
  Object.defineProperties(body,{scrollHeight:{configurable:true,value:1500},clientHeight:{configurable:true,value:300}});body.scrollTop=10;
  await act(async()=>body.dispatchEvent(new Event('scroll',{bubbles:true})));completeReply();await tick();
  expect(body.scrollTop).toBe(10);expect(host.textContent).toContain('New messages ↓');await click('New messages ↓');expect(body.scrollTop).toBe(1500);
});
function windowedThread(){
  const messages=Array.from({length:60},(_,i)=>({id:`window-${i+1}`,role:'user' as const,profileId:scope.profileId,conversationId:id,position:i+1,content:`Owned message ${i+1}`,createdAt:stored.createdAt}));
  stored={...stored,revision:60,messageWindowStart:31,preview:'The original human topic',messages:messages.slice(30)};
  return messages;
}
it('loads earlier words while preserving the visible scroll anchor and original topic',async()=>{
  const messages=windowedThread();await mount();const scroll=host.querySelector<HTMLElement>('.chat-scroll')!;
  Object.defineProperties(scroll,{scrollHeight:{configurable:true,get:()=>host.querySelectorAll('.chat-messages > li').length*100},clientHeight:{configurable:true,value:300}});
  scroll.scrollTop=10;await act(async()=>scroll.dispatchEvent(new Event('scroll',{bubbles:true})));
  vi.mocked(fetchConversation).mockResolvedValueOnce({...stored,messageWindowStart:1,messages});
  await click('Load earlier messages');expect(fetchConversation).toHaveBeenLastCalledWith(scope.profileId,id,expect.any(AbortSignal),1);
  expect(host.querySelectorAll('.chat-messages > li')).toHaveLength(60);expect(scroll.scrollTop).toBe(3010);
  await click('All conversations');expect(host.querySelector('.chat-sidebar nav')?.textContent).toContain('The original human topic');await click('close');
  expect(host.textContent).not.toContain('Load earlier messages');expect(saveConversationMessage).not.toHaveBeenCalled();
});
it('an earlier-read failure preserves current messages and the unfinished draft',async()=>{
  windowedThread();await mount();await type('Keep my unfinished thought');
  vi.mocked(fetchConversation).mockRejectedValueOnce(new Error('Read failed'));await click('Load earlier messages');
  expect(host.querySelectorAll('.chat-messages > li')).toHaveLength(30);expect(host.querySelector('textarea')!.value).toBe('Keep my unfinished thought');
  expect(host.textContent).toContain('Earlier messages couldn’t be loaded.');expect(saveConversationMessage).not.toHaveBeenCalled();
});
it('reopens the same scoped loaded window before restoring an older scroll position',async()=>{
  windowedThread();await mount();const scroll=host.querySelector<HTMLElement>('.chat-scroll')!;
  Object.defineProperties(scroll,{scrollHeight:{configurable:true,value:3000},clientHeight:{configurable:true,value:300}});scroll.scrollTop=120;
  await act(async()=>scroll.dispatchEvent(new Event('scroll',{bubbles:true})));
  await act(async()=>root.unmount());root=createRoot(host);vi.mocked(fetchConversation).mockClear();await mount();
  expect(fetchConversation).toHaveBeenCalledWith(scope.profileId,id,expect.any(AbortSignal),31);
  expect(host.querySelector<HTMLElement>('.chat-scroll')!.scrollTop).toBe(120);
});
it('treats the first reply-read failure as transient rather than flashing an error',async()=>{
  stored.generationEnabled=true;vi.mocked(fetchConversationReply).mockRejectedValueOnce(new Error('Transient'));await mount();
  expect(host.textContent).not.toContain('Couldn’t check reply progress.');await tick(1000);expect(host.textContent).not.toContain('Couldn’t check reply progress.');expect(requestConversationReply).not.toHaveBeenCalled();
});

function readingReply(){
  stored.generationEnabled=true;completeReply();
  stored.messages[0].content='Which top of mind would you like to explore?';
  stored.messages[0].citations=[{index:0,kind:'top_of_mind_entry',id:'reading-one',available:true,preview:'Try a small experiment.'},{index:1,kind:'top_of_mind_entry',id:'reading-two',available:true,preview:'Leave time to notice.'}];
}
const readingReference=(index=1):ConversationCitation=>({profileId:scope.profileId,conversationId:id,requestId:replyId,index,source:{kind:'top_of_mind_entry',id:index===1?'reading-two':'reading-one',text:index===1?'Leave time to notice what changes before making a commitment.':'Try a small experiment before making a commitment.',quote:index===1?'Leave time to notice':'Try a small experiment'}});
it('lets an older reading preview continue the chat with its verified words once',async()=>{
  readingReply();stored.messages.push({id:'later',role:'assistant',profileId:scope.profileId,conversationId:id,position:2,content:'Choose whichever topic matters now.',createdAt:stored.createdAt});stored.revision=2;replyState.revision=2;
  vi.mocked(fetchConversationCitation).mockResolvedValue(readingReference(0));await mount();
  expect(host.querySelector('.chat-reading-choices')).toBeNull();
  await act(async()=>host.querySelector<HTMLButtonElement>('.chat-citations button')!.click());
  await click('Discuss this');expect(saveConversationMessage).toHaveBeenCalledOnce();
  expect(vi.mocked(saveConversationMessage).mock.calls[0][2].content).toContain('Try a small experiment before making a commitment.');
  expect(requestConversationReply).not.toHaveBeenCalled();
});
it('labels an earlier record and carries its date into the selected follow-up',async()=>{
  readingReply();stored.messages.push({id:'later',role:'assistant',profileId:scope.profileId,conversationId:id,position:2,content:'You can compare with an earlier reading.',createdAt:stored.createdAt});stored.revision=2;replyState.revision=2;
  stored.messages[0].citations![0]={...stored.messages[0].citations![0],historical:true,recordedAt:'2026-09-01T12:00:00Z'};
  vi.mocked(fetchConversationCitation).mockResolvedValue({...readingReference(0),source:{...readingReference(0).source,historical:true,recordedAt:'2026-09-01T12:00:00Z',artifactVersion:1}});
  await mount();expect(host.querySelector('.chat-citations button')?.textContent).toContain('Earlier reading · Sep 1, 2026');
  await act(async()=>host.querySelector<HTMLButtonElement>('.chat-citations button')!.click());
  expect(host.textContent).toContain('Earlier reading');expect(host.textContent).toContain('Sep 1, 2026');
  await click('Discuss this');expect(vi.mocked(saveConversationMessage).mock.calls[0][2].content).toContain('from the record dated (Sep 1, 2026)');
});
it('discloses the earlier date on a reading choice before it is opened',async()=>{
  readingReply();stored.messages[0].citations![0]={...stored.messages[0].citations![0],historical:true,recordedAt:'2026-09-01T12:00:00Z'};
  await mount();expect(host.querySelector('.chat-reading-choice')?.textContent).toContain('Earlier reading · Sep 1, 2026');
  expect(host.querySelector('.chat-reading-choice')?.getAttribute('aria-label')).toContain('Earlier reading · Sep 1, 2026');
  expect(fetchConversationCitation).not.toHaveBeenCalled();expect(saveConversationMessage).not.toHaveBeenCalled();
});
it.each(['principle','inspiration'] as const)('continues from a verified %s preview and never overwrites a draft',async kind=>{
  stored.generationEnabled=true;completeReply();stored.messages[0].citations![0].kind=kind;
  const source={kind,id:'principle',text:'Verified words for this topic.',quote:'Verified words'};
  vi.mocked(fetchConversationCitation).mockResolvedValue({profileId:scope.profileId,conversationId:id,requestId:replyId,index:0,source});
  await mount();await act(async()=>host.querySelector<HTMLButtonElement>('.chat-citations button')!.click());
  await type('Keep my unfinished words');expect([...host.querySelectorAll<HTMLButtonElement>('button')].find(row=>row.textContent==='Discuss this')!.disabled).toBe(true);
  expect(host.querySelector('textarea')!.value).toBe('Keep my unfinished words');expect(saveConversationMessage).not.toHaveBeenCalled();
  await type('');await click('Discuss this');expect(saveConversationMessage).toHaveBeenCalledOnce();
  expect(vi.mocked(saveConversationMessage).mock.calls[0][2]).toMatchObject({content:'“Verified words for this topic.”\n\nLet’s explore this idea further.',requestReply:true});
});
it('keeps the local sidebar title aligned with the actual human topic',async()=>{
  stored.messages=[{id:'first',role:'user',profileId:scope.profileId,conversationId:id,position:1,content:'Help me think through a choice.',createdAt:stored.createdAt},{id:'second',role:'user',profileId:scope.profileId,conversationId:id,position:2,content:'Should I take the evening course?',createdAt:stored.createdAt}];
  await mount();await click('All conversations');expect(host.querySelector('.chat-sidebar nav')?.textContent).toContain('Should I take the evening course?');
});
it('sends a starter in one click instead of requiring another Send',async()=>{
  stored.generationEnabled=true;await mount();await click('What has changed in how I think?');
  expect(saveConversationMessage).toHaveBeenCalledExactlyOnceWith(scope.profileId,id,expect.objectContaining({content:'What has changed in how I think?',requestReply:true}),expect.any(AbortSignal));
  expect(host.querySelector('textarea')!.value).toBe('');expect(host.textContent).toContain('Waiting to start…');expect(requestConversationReply).not.toHaveBeenCalled();
});
it('coalesces rapid starter clicks and retains one durable sending intent',async()=>{
  stored.generationEnabled=true;let finish!:()=>void;const actual=vi.mocked(saveConversationMessage).getMockImplementation()!;
  vi.mocked(saveConversationMessage).mockImplementationOnce(async(...args)=>{await new Promise<void>(resolve=>{finish=resolve;});return actual(...args);});
  await mount();const starter=[...host.querySelectorAll('button')].find(row=>row.textContent==='What has changed in how I think?')!;
  await act(async()=>{starter.click();starter.click();});expect(saveConversationMessage).toHaveBeenCalledOnce();expect(readConversationDrafts(scope,id)[0].value.pending).toBe(true);
  expect(host.textContent).toContain('Sending…');await act(async()=>finish());expect(stored.messages).toHaveLength(1);
});
it('selects a verified top of mind and automatically sends a contextual follow-up',async()=>{
  readingReply();vi.mocked(fetchConversationCitation).mockResolvedValue(readingReference());await mount();
  expect(host.querySelectorAll('.chat-reading-choice')).toHaveLength(2);
  await act(async()=>host.querySelectorAll<HTMLButtonElement>('.chat-reading-choice')[1].click());
  expect(fetchConversationCitation).toHaveBeenCalledExactlyOnceWith(scope.profileId,id,replyId,1,expect.any(AbortSignal));
  expect(vi.mocked(saveConversationMessage).mock.calls[0][2]).toMatchObject({content:'“Leave time to notice what changes before making a commitment.”\n\nLet’s explore this top of mind further.',requestReply:true});
  expect(saveConversationMessage).toHaveBeenCalledOnce();expect(stored.messages.at(-1)?.role).toBe('user');expect(requestConversationReply).not.toHaveBeenCalled();
});
it('preserves typed words instead of replacing them with a selected reading',async()=>{
  readingReply();await mount();await type('My unfinished question');
  const choice=host.querySelector<HTMLButtonElement>('.chat-reading-choice')!;expect(choice.disabled).toBe(true);
  await act(async()=>choice.click());expect(fetchConversationCitation).not.toHaveBeenCalled();expect(saveConversationMessage).not.toHaveBeenCalled();
  expect(host.querySelector('textarea')!.value).toBe('My unfinished question');expect(host.textContent).toContain('Send or clear your draft before choosing.');
});
it('refuses unavailable or changed readings without inventing a follow-up',async()=>{
  readingReply();stored.messages[0].citations![0]={...stored.messages[0].citations![0],available:false,preview:undefined};
  vi.mocked(fetchConversationCitation).mockRejectedValue(new Error('Changed'));await mount();
  const choices=host.querySelectorAll<HTMLButtonElement>('.chat-reading-choice');expect(choices[0].disabled).toBe(true);
  await act(async()=>choices[1].click());expect(host.textContent).toContain('This top of mind changed or couldn’t be opened');
  expect(saveConversationMessage).not.toHaveBeenCalled();expect(host.querySelector('textarea')!.value).toBe('');
});
it('rejects a mismatched owned source response before copying its text',async()=>{
  readingReply();vi.mocked(fetchConversationCitation).mockResolvedValue({...readingReference(),profileId:'other-profile',source:{...readingReference().source,text:'PRIVATE_OTHER_PROFILE'}});
  await mount();await act(async()=>host.querySelectorAll<HTMLButtonElement>('.chat-reading-choice')[1].click());
  expect(saveConversationMessage).not.toHaveBeenCalled();expect(host.textContent).not.toContain('PRIVATE_OTHER_PROFILE');expect(readConversationDrafts(scope,id)).toEqual([]);
});
it('coalesces double selection and recovers a stalled read without sending later',async()=>{
  readingReply();let resolve!:(row:ConversationCitation)=>void;
  vi.mocked(fetchConversationCitation).mockImplementationOnce(()=>new Promise<ConversationCitation>(done=>{resolve=done;}));
  await mount();const choice=host.querySelectorAll<HTMLButtonElement>('.chat-reading-choice')[1];
  await act(async()=>{choice.click();choice.click();});expect(fetchConversationCitation).toHaveBeenCalledOnce();expect(host.textContent).toContain('Opening this top of mind…');
  await tick(15000);expect(host.textContent).toContain('This top of mind changed or couldn’t be opened');
  await act(async()=>resolve(readingReference()));expect(saveConversationMessage).not.toHaveBeenCalled();
});
it('cancels a source selection on navigation and cannot send into the next conversation',async()=>{
  readingReply();let resolve!:(row:ConversationCitation)=>void;vi.mocked(fetchConversationCitation).mockImplementationOnce(()=>new Promise<ConversationCitation>(done=>{resolve=done;}));
  await mount();await act(async()=>host.querySelectorAll<HTMLButtonElement>('.chat-reading-choice')[1].click());
  await mount(id,{accountId:'different-owner',profileId:'different-profile'});await act(async()=>resolve(readingReference()));
  expect(saveConversationMessage).not.toHaveBeenCalled();expect(host.textContent).not.toContain('Leave time to notice what changes');
});
it('checks quick replies after one second rather than waiting two',async()=>{
  stored.generationEnabled=true;await mount();await type('A quick question');await click('Send');completeReply();await tick(1000);
  expect(host.textContent).toContain('Which condition matters most today?');expect(requestConversationReply).not.toHaveBeenCalled();
});
it('shows waiting immediately while reply status is still being read and preserves the next draft',async()=>{
  stored.generationEnabled=true;await mount();let finish!:(row:ConversationReplyState)=>void;
  vi.mocked(fetchConversationReply).mockImplementationOnce(()=>new Promise<ConversationReplyState>(resolve=>{finish=resolve;}));
  await type('A question');await click('Send');expect(host.textContent).toContain('Waiting to start…');await type('My next thought');
  const send=host.querySelector<HTMLButtonElement>('.chat-send')!;expect(send.disabled).toBe(true);
  await act(async()=>finish(structuredClone(replyState)));expect(host.querySelector('textarea')!.value).toBe('My next thought');
});
it('uses an immediately committed first-message response without another conversation read',async()=>{
  stored.generationEnabled=true;stored.revision=1;stored.messages=[{id:replyId,profileId:scope.profileId,conversationId:id,position:1,role:'user',content:'The committed first question',createdAt:stored.createdAt}];
  replyState={...replyState,revision:1,messageId:replyId,requestId:replyId,phase:'pending'};
  await act(async()=>root.render(<ConversationPanel scope={scope} id={id} initialConversation={structuredClone(stored)} locale="en-US" onChoose={choose} onClose={close}/>));
  expect(host.textContent).toContain('The committed first question');expect(fetchConversation).not.toHaveBeenCalled();expect(host.textContent).toContain('Waiting to start…');
});
it('recovers a lost selected-reading send with GET, without repeating the message or reply request',async()=>{
  readingReply();vi.mocked(fetchConversationCitation).mockResolvedValue(readingReference());
  const actual=vi.mocked(saveConversationMessage).getMockImplementation()!;
  vi.mocked(saveConversationMessage).mockImplementationOnce(async(...args)=>{await actual(...args);throw new Error('Response lost');});
  await mount();await act(async()=>host.querySelectorAll<HTMLButtonElement>('.chat-reading-choice')[1].click());
  expect(readConversationDrafts(scope,id)[0].value.pending).toBe(true);expect(host.textContent).toContain('Couldn’t confirm this message.');
  await click('Check saved messages');expect(saveConversationMessage).toHaveBeenCalledOnce();expect(requestConversationReply).not.toHaveBeenCalled();
  expect(readConversationDrafts(scope,id)).toEqual([]);expect(stored.messages).toHaveLength(2);
});
it('bounds automatic progress reads and then offers an explicit check',async()=>{
  stored.generationEnabled=true;await mount();await type('A longer question');await click('Send');
  const initialCalls=vi.mocked(fetchConversationReply).mock.calls.length;await tick(70000);
  expect(vi.mocked(fetchConversationReply).mock.calls.length-initialCalls).toBeLessThanOrEqual(35);
  expect(host.textContent).toContain('Still working. You can come back later.');expect(requestConversationReply).not.toHaveBeenCalled();
});
