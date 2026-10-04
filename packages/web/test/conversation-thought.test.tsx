// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY: `lib/api` supplies success/lost receipts.
 * The real editor, ownership journals and authored-save recovery run. */
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ConversationThought} from '../src/components/ConversationThought';
import {ApiError,createInspiration,fetchInspiration,fetchInspirationSaveRequest,type ApiInspiration} from '../src/lib/api';
import type {ApiConversationMessage} from '../src/lib/api/conversations';
vi.mock('../src/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),createInspiration:vi.fn(),fetchInspiration:vi.fn(),fetchInspirationSaveRequest:vi.fn()}));
const scope={accountId:'owner',profileId:'profile'},onSaved=vi.fn(),onOpen=vi.fn();
const message:ApiConversationMessage={id:'11111111-1111-4111-8111-111111111111',conversationId:'22222222-2222-4222-8222-222222222222',profileId:scope.profileId,role:'user',content:'I need quiet mornings. Keep evenings flexible.',position:1,createdAt:'2026-10-03T00:00:00Z'};
const saved:ApiInspiration={id:'source',profileId:scope.profileId,text:'My revised thought',kind:'note',source:'app',visibility:'private',createdAt:message.createdAt,updatedAt:message.createdAt,attachments:[],reflections:[]};
let host:HTMLDivElement,root:Root;
beforeEach(()=>{vi.resetAllMocks();localStorage.clear();Object.defineProperty(document,'hidden',{configurable:true,value:false});(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);
  vi.mocked(fetchInspirationSaveRequest).mockRejectedValue(new ApiError({status:404,code:'save_not_found',message:'Missing'}));vi.mocked(createInspiration).mockResolvedValue(saved);vi.mocked(fetchInspiration).mockResolvedValue(saved);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();});
const mount=(row=message,owner=scope)=>act(async()=>root.render(<ConversationThought key={`${owner.accountId}:${row.id}`} scope={owner} message={row} locale="en-US" onSaved={onSaved} onOpen={onOpen}/>));
const button=(label:string)=>[...host.querySelectorAll('button')].find(row=>row.textContent===label)!;
const click=(label:string)=>act(async()=>button(label).click());
const type=(text:string)=>act(async()=>{const input=host.querySelector('textarea')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,text);input.dispatchEvent(new Event('input',{bubbles:true}));});
it('edits only selected message words then saves privately once without changing chat',async()=>{
  await mount();await click('Keep a thought');expect(host.querySelector('textarea')!.value).toBe(message.content);await type('I need quiet mornings.');await click('Save inspiration');
  expect(createInspiration).toHaveBeenCalledOnce();expect(vi.mocked(createInspiration).mock.calls[0][0]).toEqual({text:'I need quiet mornings.',kind:'note',visibility:'private',fromConversation:{conversationId:message.conversationId,messageId:message.id,selectedText:message.content,adopted:false}});
  expect(onSaved).toHaveBeenCalledOnce();expect(Object.keys(localStorage).filter(key=>key.includes('pendingSave'))).toHaveLength(0);expect(host.querySelector('textarea')).toBeNull();await click('Open saved inspiration');expect(onOpen).toHaveBeenCalledWith('source');
});
it('never prefills AI wording and requires rewriting and explicit adoption',async()=>{
  await mount({...message,role:'assistant'});await click('Make it my own');expect(host.querySelector('textarea')!.value).toBe('');await type('My own takeaway');expect(button('Save my takeaway').disabled).toBe(true);
  await act(async()=>host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());await type(message.content);expect(button('Save my takeaway').disabled).toBe(true);
  await type('I will try leaving one morning free.');await click('Save my takeaway');expect(vi.mocked(createInspiration).mock.calls[0][0].fromConversation?.adopted).toBe(true);
});
it('cancel creates no inspiration or request, and reopening does not silently adopt an AI suggestion',async()=>{
  await mount({...message,role:'assistant'});await click('Make it my own');await type('Maybe later');await click('Cancel');expect(createInspiration).not.toHaveBeenCalled();expect(fetchInspirationSaveRequest).not.toHaveBeenCalled();await click('Make it my own');expect(host.querySelector('textarea')!.value).toBe('');
});
it('recovers unsaved words after reload and forks another writer without consuming its draft',async()=>{
  await mount();await click('Keep a thought');await type('First draft');await act(async()=>root.unmount());root=createRoot(host);await mount();expect(host.querySelector('textarea')!.value).toBe('First draft');await type('Second draft');await click('Save inspiration');
  const retained=Object.values(localStorage).join(' ');expect(retained).toContain('First draft');expect(retained).not.toContain('Second draft');
});
it('keeps immutable intent after a lost response and recovers with GET instead of another POST',async()=>{
  vi.mocked(createInspiration).mockRejectedValueOnce(new Error('Lost'));await mount();await click('Keep a thought');await type('Saved once');await click('Save inspiration');expect(host.textContent).toContain('Couldn’t confirm');expect(host.querySelector('textarea')!.disabled).toBe(true);
  const requestId=vi.mocked(createInspiration).mock.calls[0][1]!.requestId!;
  vi.mocked(fetchInspirationSaveRequest).mockResolvedValue({requestId,operation:'inspiration',inspirationId:saved.id,reflectionId:null,createdAt:message.createdAt,processing:{profileId:scope.profileId,inspirationId:saved.id,jobId:'job',requestVersion:'1',materialRevision:'1'}});
  await click('Check saved thought');expect(createInspiration).toHaveBeenCalledOnce();expect(onSaved).toHaveBeenCalledOnce();expect(host.textContent).toContain('Open saved inspiration');
});
it('isolates account drafts and blocks a save when durable storage fails',async()=>{
  await mount();await click('Keep a thought');await type('PRIVATE');await mount(message,{...scope,accountId:'other'});expect(host.querySelector('textarea')).toBeNull();
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('Quota');});await click('Keep a thought');await type('Visible words');expect(host.querySelector('textarea')!.value).toBe('Visible words');expect(button('Save inspiration').disabled).toBe(true);expect(createInspiration).not.toHaveBeenCalled();
});
