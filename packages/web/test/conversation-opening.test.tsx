// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/api/conversations` supplies
 * owned API projections, committed responses and definite/lost refusals.
 * Real panel/account-scoped Storage journals execute; `crypto` replaces the
 * jsdom placeholder with actual Node WebCrypto. A wrapper tracks the runtime
 * digest promises for React readiness; digest bytes are never mocked.
 * Actual SQL ownership/current-source/publication proofs live in the API DB
 * suites; this file does not claim a browser mock establishes those gates. */
/** Real panel, draft journal and WebCrypto. Only owned API replies are synthetic. */
import {webcrypto} from 'node:crypto';
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ConversationPanel} from '../src/components/ConversationPanel';
import {ApiError} from '../src/lib/api/http';
import {createConversation,fetchConversation,fetchConversationReply,listConversations,prepareConversationOpening,type ApiConversation} from '../src/lib/api/conversations';
import {readConversationDrafts,storeConversationDraft} from '../src/lib/conversation-drafts';
import {isOpeningView,openingJournal,type ConversationOpening,type ConversationOpeningView,type OpeningSelection} from '../src/lib/conversation-opening';
import en from '../src/lib/i18n/messages/en-US.json';
vi.mock('../src/lib/api/conversations',async original=>({...await original<any>(),createConversation:vi.fn(),fetchConversation:vi.fn(),fetchConversationReply:vi.fn(),listConversations:vi.fn(),prepareConversationOpening:vi.fn()}));
const scope={accountId:'11111111-1111-4111-8111-111111111111',profileId:'22222222-2222-4222-8222-222222222222'},id='33333333-3333-4333-8333-333333333333',sourceId='44444444-4444-4444-8444-444444444444',photoId='55555555-5555-4555-8555-555555555555';
const actualDigest=webcrypto.subtle.digest.bind(webcrypto.subtle);
let digestWork:Array<ReturnType<typeof actualDigest>>=[];
const binding:ConversationOpening={version:1,locale:'en-US',kind:'source',source:{kind:'inspiration',id:sourceId,hash:'current-material-proof'},why:false,supports:[],hash:'1'.repeat(64)};
const view:ConversationOpeningView={binding,available:true,provenance:'application',quote:'Original saved words',sources:[]};
let host:HTMLDivElement,root:ReturnType<typeof createRoot>,row:ApiConversation;
beforeEach(()=>{
  vi.resetAllMocks();digestWork=[];
  vi.spyOn(webcrypto.subtle,'digest').mockImplementation((...args:Parameters<typeof actualDigest>)=>{const work=actualDigest(...args);digestWork.push(work);return work;});
  vi.stubGlobal('crypto',webcrypto);localStorage.clear();sessionStorage.clear();(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  row={id,profileId:scope.profileId,revision:0,messages:[],createdAt:'2026-11-13T00:00:00Z',updatedAt:'2026-11-13T00:00:00Z',generationEnabled:false};
  vi.mocked(listConversations).mockResolvedValue({profileId:scope.profileId,conversations:[],generationEnabled:false});vi.mocked(fetchConversation).mockImplementation(async()=>row);
  vi.mocked(prepareConversationOpening).mockResolvedValue(view);
  vi.mocked(createConversation).mockImplementation(async(_profile,conversationId,_signal,_principle,first,_talk,_inspiration,opening)=>({...row,id:conversationId,opening:opening?view:null,revision:1,messages:[{id:first!.id,profileId:scope.profileId,conversationId,position:1,role:'user',content:first!.content,createdAt:row.createdAt}]}));
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function mount(selection?:OpeningSelection,conversationId:string|null=null){
  const start=digestWork.length;
  await act(async()=>{root.render(<ConversationPanel scope={scope} id={conversationId} locale="en-US" onChoose={()=>{}} opener={selection?{selection,ask:selection.source?undefined:selection.text,quote:selection.source?.kind==='inspiration'?selection.text:undefined}:undefined}/>);});
  // Wait for the component's own digest, bounded by the normal test timeout.
  await act(async()=>{await Promise.all(digestWork.slice(start));});
  expect(host.querySelector('textarea'),'composer after runtime opening digest').not.toBeNull();
}
async function type(text:string){await act(async()=>{const field=host.querySelector('textarea')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(field,text);field.dispatchEvent(new Event('input',{bubbles:true}));});}
async function click(name:string){await act(async()=>{const control=[...host.querySelectorAll('button')].find(button=>(button.getAttribute('aria-label')??button.textContent)===name);if(!control)throw Error('Missing synthetic control: '+name);control.click();});}
it('uses distinct companion journals and restores each exact human draft with its own bound question',async()=>{
  const a={locale:'en-US' as const,text:en.worldCompanionChatPrompt},b={locale:'en-US' as const,text:en.worldGroundReady};
  vi.mocked(prepareConversationOpening).mockImplementation(async(_profile,input)=>{const key='binding' in input?(input.binding.kind==='prompt'?input.binding.key:'worldCompanionChatPrompt'):input.text===a.text?'worldCompanionChatPrompt':'worldGroundReady';const text=en[key as keyof typeof en];return {available:true,provenance:'application',ask:text,binding:{version:1,locale:'en-US',kind:'prompt',key,hash:'2'.repeat(64)}};});
  await mount(a);await type('  My first exact draft.  ');
  const first=readConversationDrafts(scope,await openingJournal(a))[0].value;
  await mount(b);expect(host.querySelector('textarea')!.value).toBe('');await type('A different thought');
  await mount(a);expect(host.querySelector('textarea')!.value).toBe(first.content);
  expect(readConversationDrafts(scope,await openingJournal(b))[0].value.content).toBe('A different thought');
  expect(first.opening).toMatchObject({kind:'prompt',key:'worldCompanionChatPrompt'});
  expect(JSON.stringify(first.opening)).not.toContain(a.text);expect(await openingJournal(a)).not.toBe(await openingJournal(b));
});
it('keeps a definitely refused uncommitted draft editable and explicitly detaches an unavailable opening',async()=>{
  const selection={locale:'en-US' as const,text:'Original saved words',source:{kind:'inspiration' as const,id:sourceId}};
  await mount(selection);await type('  My words stay exact.  ');
  vi.mocked(createConversation).mockRejectedValueOnce(new ApiError({status:409,code:'conversation_opening_unavailable',message:'This opening changed.'}));
  await click('Send');const held=readConversationDrafts(scope,await openingJournal(selection))[0].value;
  expect(held).toMatchObject({pending:false,content:'  My words stay exact.  ',opening:binding});expect(host.querySelector('textarea')!.disabled).toBe(false);
  await click('Continue without the opening');expect(host.querySelector('textarea')!.value).toBe(held.content);
  await click('Send');const args=vi.mocked(createConversation).mock.calls[1];
  expect(args[1]).toBe(held.conversationId);expect(args[4]).toMatchObject({id:held.id,content:held.content});expect(args[6]).toBeUndefined();expect(args[7]).toBeUndefined();
  expect(vi.mocked(createConversation).mock.calls[0][7]).toEqual(binding);
});
it('recovers a committed pending first send by its original IDs even when its opening is now unavailable',async()=>{
  const selection={locale:'en-US' as const,text:'Changed display',source:{kind:'inspiration' as const,id:sourceId}},journal=await openingJournal(selection),messageId=crypto.randomUUID();
  storeConversationDraft(scope,journal,{id:messageId,writer:crypto.randomUUID(),conversationId:id,content:'Exact lost-ack words',revision:0,pending:true,updatedAt:Date.now(),opening:binding});
  vi.mocked(prepareConversationOpening).mockRejectedValue(new Error('Source changed'));
  row={...row,revision:1,opening:{binding,available:false,provenance:'application'},messages:[{id:messageId,profileId:scope.profileId,conversationId:id,position:1,role:'user',content:'Exact lost-ack words',createdAt:row.createdAt}]};
  await mount(selection);expect(createConversation).not.toHaveBeenCalled();expect(readConversationDrafts(scope,journal)).toEqual([]);expect(host.textContent).toContain('Exact lost-ack words');
});
it('renders server-resolved photo-only opening and Why cards after history/reload, rejecting malformed media metadata',async()=>{
  const opening:ConversationOpeningView={...view,quote:'',photoId,wordless:true,sources:[{id:sourceId,preview:'',photoId,wordless:true}]};
  expect(isOpeningView(opening)).toBe(true);expect(isOpeningView({...opening,photoId:'https://private.example/canary'})).toBe(false);expect(isOpeningView({...opening,sources:[{id:sourceId,preview:'',wordless:'yes'}]})).toBe(false);
  row={...row,opening};await mount(undefined,id);
  expect(host.querySelectorAll('.chat-shared .waka-saved-photo')).toHaveLength(2);expect(host.querySelector('.chat-message--shared')).not.toBeNull();
  expect(host.textContent).not.toContain('https://private.example');
});
