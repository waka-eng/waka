// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/api/conversations` supplies owned
 * records and lost responses; `window.confirm` supplies explicit delete choices,
 * and `Storage.setItem` simulates a quota failure.
 * DOM scroll geometry supplies a measurable viewport for the arrival test.
 * Real UI, owner-scoped drafts and recovery run; reply text is synthetic. */
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ConversationPanel} from '../src/components/ConversationPanel';
import {createConversation,deleteConversation,fetchConversation,fetchConversationCitation,fetchConversationContext,fetchConversationReply,listConversations,requestConversationReply,saveConversationMessage,stopConversationReply,type ApiConversation,type ConversationReplyState} from '../src/lib/api/conversations';
import {readConversationDrafts} from '../src/lib/conversation-drafts';
vi.mock('../src/lib/api/conversations',async original=>({...await original<typeof import('../src/lib/api/conversations')>(),createConversation:vi.fn(),deleteConversation:vi.fn(),fetchConversation:vi.fn(),fetchConversationContext:vi.fn(),fetchConversationReply:vi.fn(),requestConversationReply:vi.fn(),stopConversationReply:vi.fn(),fetchConversationCitation:vi.fn(),listConversations:vi.fn(),saveConversationMessage:vi.fn()}));
const scope={accountId:'owner',profileId:'profile'},id='11111111-1111-4111-8111-111111111111',choose=vi.fn(),close=vi.fn();
let root:Root,host:HTMLDivElement,stored:ApiConversation,replyState:ConversationReplyState;
const openSource=vi.fn(),replyId='22222222-2222-4222-8222-222222222222';
beforeEach(()=>{vi.resetAllMocks();vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});localStorage.clear();(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  stored={id,profileId:scope.profileId,revision:0,createdAt:'2026-10-03T00:00:00Z',updatedAt:'2026-10-03T00:00:00Z',messages:[]};
  vi.mocked(fetchConversation).mockImplementation(async()=>structuredClone(stored));vi.mocked(listConversations).mockResolvedValue({profileId:scope.profileId,conversations:[],generationEnabled:false});
  replyState={profileId:scope.profileId,conversationId:id,messageId:null,requestId:null,phase:'idle',revision:0,failureCode:null,retryAfter:null,runAfter:null,canRetry:false,generationEnabled:true};
  vi.mocked(fetchConversationReply).mockImplementation(async()=>structuredClone(replyState));
  vi.mocked(saveConversationMessage).mockImplementation(async(_profile,_id,input)=>{stored={...stored,revision:stored.revision+1,messages:[...stored.messages,{...input,profileId:scope.profileId,conversationId:id,position:stored.revision+1,role:'user',createdAt:'2026-10-03T01:00:00Z'}]};if(input.requestReply)replyState={...replyState,messageId:input.id,requestId:replyId,revision:stored.revision,phase:'pending'};return structuredClone(stored);});
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.useRealTimers();});
const mount=(conversationId:string|null=id,owner=scope)=>act(async()=>root.render(<ConversationPanel key={`${owner.accountId}:${owner.profileId}:${conversationId}`} scope={owner} id={conversationId} locale="en-US" onChoose={choose} onClose={close} onOpenSource={openSource}/>));
const click=(label:string)=>act(async()=>[...host.querySelectorAll('button')].find(row=>row.textContent===label)!.click());
const type=(content:string)=>act(async()=>{const area=host.querySelector('textarea')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(area,content);area.dispatchEvent(new Event('input',{bubbles:true}));});
const tick=(ms=2000)=>act(async()=>vi.advanceTimersByTimeAsync(ms));
function completeReply(){stored={...stored,revision:stored.revision+1,messages:[...stored.messages,{id:crypto.randomUUID(),profileId:scope.profileId,conversationId:id,position:stored.revision+1,role:'assistant',content:'Consider the conditions of the choice.',followUpQuestion:'Which condition matters most today?',replyRequestId:replyId,memoryChanged:false,citations:[{index:0,kind:'principle',id:'principle',available:true}],createdAt:'2026-10-03T01:00:01Z'}]};replyState={...replyState,phase:'ready',revision:stored.revision};}
it('restores the correction target with its draft and sends it as a new message',async()=>{
  stored.generationEnabled=true;completeReply();const corrected=stored.messages[0].id;await mount();await click('That’s not quite right');await type('No, only this month.');
  await act(async()=>root.unmount());root=createRoot(host);await mount();expect(host.textContent).toContain('This corrects the conversation, not your Principles.');await click('Send correction');
  expect(vi.mocked(saveConversationMessage).mock.calls[0][2]).toMatchObject({content:'No, only this month.',correctsMessageId:corrected,requestReply:true});expect(stored.messages[0].content).toBe('Consider the conditions of the choice.');expect(host.textContent).toContain('Update a principle');
});
it('canceling correction preserves typed words without sending or editing memory',async()=>{
  completeReply();await mount();await click('That’s not quite right');await type('Words to keep');await click('Cancel correction');expect(host.querySelector('textarea')!.value).toBe('Words to keep');expect(saveConversationMessage).not.toHaveBeenCalled();expect(readConversationDrafts(scope,id)[0].value.correctsMessageId).toBeUndefined();
});
it('clearly saves messages without promising an assistant reply',async()=>{
  await mount();expect(host.textContent).toContain('Replies aren’t connected yet.');await type('I want quiet mornings.');expect(host.textContent).toContain('Draft on this device');await click('Save message');
  expect(host.textContent).toContain('I want quiet mornings.');expect(host.querySelector('textarea')!.value).toBe('');expect(stored.messages).toHaveLength(1);expect(readConversationDrafts(scope,id)).toEqual([]);
});
it('offers the history exit when a conversation is unavailable, without showing old words',async()=>{
  vi.mocked(fetchConversation).mockRejectedValueOnce(new Error('Unavailable'));await mount();
  expect(host.querySelector('textarea')).toBeNull();await click('All conversations');expect(choose).toHaveBeenCalledWith(null);expect(createConversation).not.toHaveBeenCalled();
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
  vi.mocked(createConversation).mockRejectedValueOnce(new Error('Lost')).mockResolvedValueOnce(stored);
  await mount(null);await click('New conversation');await click('New conversation');
  expect(vi.mocked(createConversation).mock.calls[0][1]).toBe(vi.mocked(createConversation).mock.calls[1][1]);expect(choose).toHaveBeenCalledTimes(1);
});
it('requires confirmation for deletion and removes only this conversation’s drafts',async()=>{
  await mount();await type('Draft to erase');const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);await click('Delete conversation');expect(deleteConversation).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);vi.mocked(deleteConversation).mockResolvedValue(undefined);await click('Delete conversation');expect(deleteConversation).toHaveBeenCalledWith(scope.profileId,id,expect.any(AbortSignal));expect(readConversationDrafts(scope,id)).toEqual([]);expect(choose).toHaveBeenCalledWith(null);
});
it('shows current disputed and unconfirmed memory without creating a message',async()=>{
  vi.mocked(fetchConversationContext).mockResolvedValue({profileId:scope.profileId,generationEnabled:false,principles:[{id:'p',text:'My current words',state:'contested',supportCurrent:false,truncated:false}],reading:[],inspirations:[]});
  await mount();await click('Check current memory');expect(host.textContent).toContain('Marked as disputed');expect(host.textContent).toContain('Support not confirmed');expect(saveConversationMessage).not.toHaveBeenCalled();
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
it('treats the first reply-read failure as transient rather than flashing an error',async()=>{
  stored.generationEnabled=true;vi.mocked(fetchConversationReply).mockRejectedValueOnce(new Error('Transient'));await mount();
  expect(host.textContent).not.toContain('Couldn’t check reply progress.');await tick(1000);expect(host.textContent).not.toContain('Couldn’t check reply progress.');expect(requestConversationReply).not.toHaveBeenCalled();
});
