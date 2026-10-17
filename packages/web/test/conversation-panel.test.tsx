// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/api/conversations` supplies owned
 * records and lost responses; `Storage.setItem` simulates a quota failure.
 * `matchMedia` and `visualViewport` supply mobile and keyboard metrics;
 * DOM scroll geometry supplies a measurable viewport for the arrival test.
 * Real UI, owner-scoped drafts and recovery run; reply text is synthetic.
 *
 * WHAT THIS SUITE PROTECTS NOW, AFTER THE SURFACE WAS CUT TO A TRANSCRIPT, A
 * BOX AND A STOP (2026-10-10). Founder: "So the talk with Waka experience is
 * the most confusing chat experience ever with so many different buttons that
 * I have no idea what its supposed to do."
 *
 * Eleven tests in here were about controls that no longer exist, and each one
 * is tombstoned where it stood rather than quietly dropped — a test deleted
 * without a sentence saying what it used to guard reads, six months later, as
 * a rule nobody ever had. What is left is the half of this file that was
 * never about buttons: that a message is saved exactly once, that a lost
 * response is reconciled by reading rather than writing again, that a draft
 * belongs to one account, that the transcript does not jump away from what
 * you were reading, and that every failure still says so on screen. */
import {act} from 'react';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ConversationPanel} from '../src/components/ConversationPanel';
import {createConversation,fetchConversation,fetchConversationReply,listConversations,saveConversationMessage,stopConversationReply,type ApiConversation,type ConversationReplyState} from '../src/lib/api/conversations';
import {readConversationDrafts} from '../src/lib/conversation-drafts';
vi.mock('../src/lib/api/conversations',async original=>({...await original<typeof import('../src/lib/api/conversations')>(),createConversation:vi.fn(),fetchConversation:vi.fn(),fetchConversationReply:vi.fn(),stopConversationReply:vi.fn(),listConversations:vi.fn(),saveConversationMessage:vi.fn()}));
const scope={accountId:'owner',profileId:'profile'},id='11111111-1111-4111-8111-111111111111',choose=vi.fn();
/* THE SAME JOB, DONE BY THE RULE THAT CAN DO IT SYMMETRICALLY.
   This asked `.jar-conversation-body` in `chrome.css` for
   `padding-inline-end: var(--sp-8)` — a gutter on the END side only, to keep
   an overlay scrollbar off the words. It worked, and it also made the
   transcript's right gutter 8px wider than its left and 8px wider than the
   composer's, which was half of the misalignment `chat.css` opens by claiming
   it had fixed.

   `scrollbar-gutter: stable both-edges` reserves the same room on BOTH sides,
   so the scrollbar still never lands on the text and the column stays
   centred. `both-edges` rather than bare `stable` for the same reason: bare
   `stable` reserves one side and shifts the column by the gutter's width
   wherever classic scrollbars exist. */
it('leaves reply text clear of scrollbars without moving the column',()=>{
  const css=readFileSync(resolve(dirname(fileURLToPath(import.meta.url)),'../src/styles/chat.css'),'utf8');
  const scroll=css.match(/\.chat-scroll\s*\{([^}]+)\}/)?.[1]??'';
  expect(scroll).toContain('scrollbar-gutter: stable both-edges');
  const chrome=readFileSync(resolve(dirname(fileURLToPath(import.meta.url)),'../src/styles/chrome.css'),'utf8');
  expect(chrome.match(/\.jar-conversation-body\s*\{([^}]+)\}/)?.[1]).not.toContain('padding-inline-end');
});
let root:Root,host:HTMLDivElement,stored:ApiConversation,replyState:ConversationReplyState;
const replyId='22222222-2222-4222-8222-222222222222';
beforeEach(()=>{vi.resetAllMocks();vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});localStorage.clear();sessionStorage.clear();(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  stored={id,profileId:scope.profileId,revision:0,createdAt:'2026-10-03T00:00:00Z',updatedAt:'2026-10-03T00:00:00Z',messages:[]};
  vi.mocked(fetchConversation).mockImplementation(async()=>structuredClone(stored));vi.mocked(listConversations).mockResolvedValue({profileId:scope.profileId,conversations:[],generationEnabled:false});
  replyState={profileId:scope.profileId,conversationId:id,messageId:null,requestId:null,phase:'idle',revision:0,failureCode:null,retryAfter:null,runAfter:null,canRetry:false,generationEnabled:true};
  vi.mocked(fetchConversationReply).mockImplementation(async()=>structuredClone(replyState));
  vi.mocked(saveConversationMessage).mockImplementation(async(_profile,_id,input)=>{stored={...stored,revision:stored.revision+1,messages:[...stored.messages,{...input,profileId:scope.profileId,conversationId:id,position:stored.revision+1,role:'user',createdAt:'2026-10-03T01:00:00Z'}]};if(input.requestReply)replyState={...replyState,messageId:input.id,requestId:replyId,revision:stored.revision,phase:'pending'};return structuredClone(stored);});
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
const mount=(conversationId:string|null=id,owner=scope)=>act(async()=>root.render(<ConversationPanel key={`${owner.accountId}:${owner.profileId}:${conversationId}`} scope={owner} id={conversationId} locale="en-US" onChoose={choose}/>));
/* BY NAME, NOT BY INK. Send and Stop are circular icon-only buttons now —
   the shape the reference ships and the founder asked for — so they carry
   no text content at all. The `aria-label` is what they are CALLED, and it
   is also what a person using this product by ear hears, so matching on it
   tests the name that actually has to be right. Both are checked, because
   the controls that still have words should keep them. */
const click=(label:string)=>act(async()=>{
  const row=[...host.querySelectorAll('button')].find(b=>b.textContent===label||b.getAttribute('aria-label')===label);
  if(!row)throw new Error(`no control called ${label}`);
  row.click();
});
/* WHAT THE SURFACE CALLS ITS CONTROLS. Send and Stop carry their names on
   `aria-label` now rather than in ink — see `click` above — so an inventory
   taken from `textContent` reads a row of empty strings. This reads each
   control's accessible name, which is the thing the inventory was always
   really about: not how many `<button>`s there are, but how many things
   this surface offers. */
const named=()=>[...host.querySelectorAll('button')].map(b=>b.getAttribute('aria-label')??b.textContent);
const type=(content:string)=>act(async()=>{const area=host.querySelector('textarea')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(area,content);area.dispatchEvent(new Event('input',{bubbles:true}));});
const tick=(ms=2000)=>act(async()=>vi.advanceTimersByTimeAsync(ms));
function completeReply(){stored={...stored,revision:stored.revision+1,messages:[...stored.messages,{id:crypto.randomUUID(),profileId:scope.profileId,conversationId:id,position:stored.revision+1,role:'assistant',content:'Consider the conditions of the choice.',followUpQuestion:'Which condition matters most today?',replyRequestId:replyId,memoryChanged:false,citations:[{index:0,kind:'principle',id:'principle',available:true}],createdAt:'2026-10-03T01:00:01Z'}]};replyState={...replyState,phase:'ready',revision:stored.revision};}
/* ── FOUR TOMBSTONES: CORRECTING A REPLY, AND THE FOOTNOTES UNDER IT ────────
   `restores the correction target with its draft and sends it as a new
   message` and `canceling correction preserves typed words without sending or
   editing memory` guarded "Correct reply" — a control that opened a second
   editor, re-labelled the composer, and carried a principle editor with it.
   `keeps compact actions and descriptive references with the reply they
   belong to` and `brings an opened reference into the transcript without
   scrolling the whole page` guarded the footnote list and the quote panel it
   opened, including the `References (2)` count that should never have been on
   screen at all. All four surfaces are deleted (see `ConversationPanel`'s
   header); their API wrappers went with them, so there is nothing left for a
   test to press. The scroll-containment rule the fourth one measured is not
   lost: `restores a scoped non-bottom transcript position after reopening`
   and `does not jump away from older messages when a new reply arrives` below
   hold the transcript's scrolling to account. */
/* THE SENTENCE WENT; WHAT IT PROTECTED IS WHAT THIS ALWAYS TESTED.
   Founder, pointing at "WAKA can't reply yet — no model is connected. What
   you write is kept.": "remove this."

   THE HISTORY MATTERS HERE, because this is the second rewording of one
   line and now the deletion of it. It began as "Replies aren't connected
   yet. Your messages are saved privately." — founder: "what does this
   mean" — and was rewritten to name the cause and the consequence. The
   remaining objection is not about the words: a standing fact about the
   deployment, printed above the one control on the surface, is read once
   and stepped over forever, which is the rule that cleared the permanent
   explainers off every other screen.

   SO THIS CASE IS NOW WRITTEN AS THE NEGATIVE IT ALWAYS WAS. "Must not
   imply a reply is coming when none can" never needed a sentence to be
   true — it needed the surface to be silent about a reply, which is a
   stronger claim and the one asserted below. The save behaviour it guards
   is untouched. */
it('clearly saves messages without promising an assistant reply',async()=>{
  await mount();
  expect(host.textContent).not.toContain('Thinking');
  await type('I want quiet mornings.');await click('Send');
  expect(host.textContent).toContain('I want quiet mornings.');expect(host.querySelector('textarea')!.value).toBe('');expect(stored.messages).toHaveLength(1);expect(readConversationDrafts(scope,id)).toEqual([]);
  /* AND STILL NOTHING AFTER THE PRESS, which is the moment a person would
     start waiting. Nothing on screen says one is on the way. */
  expect(host.textContent).not.toContain('Thinking');
  expect(host.textContent).not.toContain('Still working');
});
it('offers a new-chat exit when a conversation is unavailable, without showing old words',async()=>{
  vi.mocked(fetchConversation).mockRejectedValueOnce(new Error('Unavailable'));await mount();
  /* No box to type in, so the exit has to be visible without opening
     anything — it sits next to the sentence that reports the failure. */
  expect(host.querySelector('textarea')).toBeNull();expect(host.querySelector('.chat-notice')?.textContent).toContain('New chat');
  await click('New chat');expect(choose).toHaveBeenCalledWith(null);expect(createConversation).not.toHaveBeenCalled();
});
it('reconciles a lost save response with a read, without resending',async()=>{
  const save=vi.mocked(saveConversationMessage).getMockImplementation()!;
  vi.mocked(saveConversationMessage).mockImplementationOnce(async(...args)=>{await save(...args);throw new Error('Response lost');});
  await mount();await type('Keep my exact thought');await click('Send');
  expect(host.querySelector('textarea')!.value).toBe('Keep my exact thought');expect(host.textContent).toContain('Couldn’t confirm this message.');
  await click('Check saved messages');expect(saveConversationMessage).toHaveBeenCalledTimes(1);expect(stored.messages).toHaveLength(1);expect(host.querySelector('textarea')!.value).toBe('');
});
it('restores unsent words after reopening and forks edits instead of overwriting the previous writer',async()=>{
  /* THE DRAFT PICKER WENT; THE FORKING DID NOT. Two tabs still keep two
     drafts rather than one tab overwriting the other's sentence — what
     changed is that reopening restores the newest silently instead of
     offering a `<select>` of your own revisions. */
  /* ANOTHER TAB is another `sessionStorage` — the writer id lives there
     (`lib/tab-writer`), so clearing it is what opening a second tab does. */
  await mount();await type('Original draft');await act(async()=>root.unmount());sessionStorage.clear();root=createRoot(host);await mount();
  expect(host.querySelector('textarea')!.value).toBe('Original draft');await type('Another tab version');
  expect(readConversationDrafts(scope,id).map(row=>row.value.content).sort()).toEqual(['Another tab version','Original draft']);
});
it('does not bring back a sent message on the next reload',async()=>{
  /* A reload is the SAME tab, so it keeps writing its own draft in place.
     It used to fork it under a new key, and sending the fork left the
     original on disk for the next reload to restore — the words just sent,
     back in the box as if unsent. */
  await mount();await type('Original draft');await act(async()=>root.unmount());root=createRoot(host);await mount();
  await type('Original draft, finished');await click('Send');
  expect(stored.messages.map(row=>row.content)).toEqual(['Original draft, finished']);
  expect(readConversationDrafts(scope,id),'the reloaded draft is still on disk').toEqual([]);
  await act(async()=>root.unmount());root=createRoot(host);await mount();
  expect(host.querySelector('textarea')!.value).toBe('');
});
it('leaves another open tab’s draft alone when this tab sends',async()=>{
  /* The draft this one forked from may belong to a tab that is still open;
     sending here must not delete the words over there. */
  await mount();await type('Words in the other tab');await act(async()=>root.unmount());sessionStorage.clear();root=createRoot(host);await mount();
  await type('Words in this tab');await click('Send');
  expect(readConversationDrafts(scope,id).map(row=>row.value.content)).toEqual(['Words in the other tab']);
});
it('never restores another account’s draft',async()=>{
  await mount();await type('PRIVATE_DRAFT');await mount(id,{...scope,accountId:'different-account'});
  expect(host.querySelector('textarea')!.value).toBe('');expect(host.textContent).not.toContain('PRIVATE_DRAFT');
});
it('blocks sending on storage failure while keeping the visible words',async()=>{
  await mount();vi.spyOn(Storage.prototype,'setItem').mockImplementationOnce(()=>{throw new Error('Quota');});await type('Still visible');
  expect(host.querySelector('textarea')!.value).toBe('Still visible');expect(host.textContent).toContain('Copy your words before leaving.');await click('Send');expect(saveConversationMessage).not.toHaveBeenCalled();
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
  /* THE LIST IS NOT ON THIS PAGE ANY MORE — it is the top-left corner, on
     every screen. What this has always really been testing survives and is
     all that is asserted now: a conversation list that cannot be fetched
     does not stop the conversation you are actually in from opening and
     working. */
  expect(host.querySelector('textarea')).not.toBeNull();
  await type('My conversation still works');await click('Send');expect(saveConversationMessage).toHaveBeenCalledOnce();
});
it('restores a scoped non-bottom transcript position after reopening',async()=>{
  completeReply();await mount();const body=host.querySelector<HTMLElement>('.jar-conversation-body')!;
  Object.defineProperties(body,{scrollHeight:{configurable:true,value:1500},clientHeight:{configurable:true,value:300}});body.scrollTop=120;
  await act(async()=>body.dispatchEvent(new Event('scroll',{bubbles:true})));
  await act(async()=>root.unmount());root=createRoot(host);await mount();expect(host.querySelector<HTMLElement>('.jar-conversation-body')!.scrollTop).toBe(120);
  expect(fetchConversation).toHaveBeenLastCalledWith(scope.profileId,id,expect.any(AbortSignal),1);
});
it('keeps the surface to a transcript, a box and nothing at rest',async()=>{
  /* THE SHAPE ITSELF, ASSERTED. This replaces `keeps the composer behind the
     memory sheet and its backdrop`, which guarded the one remaining sheet —
     "what the reply was allowed to read" — and the rule that opening it did
     not cost you a draft. There is no sheet, no backdrop and no dialog on
     this surface now, and an empty conversation offers exactly one control:
     the box's own button. If a fifteenth button is ever added here, this is
     the test that should stop it. */
  await mount();await type('A sentence in the box');
  expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(0);
  expect(host.querySelector('.chat-drawer-backdrop')).toBeNull();
  expect(host.querySelectorAll('select')).toHaveLength(0);
  expect(host.querySelectorAll('details')).toHaveLength(0);
  /* ONE CONTROL AT REST AGAIN. The drawer's trigger sat here for an hour —
     founder, cutting it: "let's get rid of the side part and referencing
     inspiration ... it's too complicated right now" — and this line is the
     ledger of that. If a fifteenth button is ever added here, this is still
     the test that should stop it.

     AND THE ＋ BESIDE IT (2026-10-16). Founder: a chat's ＋ offers "Add
     photos" and "Add file". Standing alone — no bar lending it a slot — the
     panel keeps it in its own footer, beside Send; on the home page it rides
     in the bar (`chat-bar.test.tsx`). Its two rows are not buttons until it
     is pressed. */
  expect(named()).toEqual(['Add photo or file','Send']);
  expect(host.querySelector('textarea')!.value).toBe('A sentence in the box');
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
/* ── TWO TOMBSTONES: DELETING A CONVERSATION, AND READING ITS MEMORY ────────
   `requires confirmation for deletion and removes only this conversation’s
   drafts` guarded "Delete conversation", which lived in a `···` menu on this
   page. The capability is not replaced anywhere yet and that is deliberate
   and reported: deleting belongs beside the row in the LIST of conversations,
   not inside the one you are reading, and `lib/api/conversations` carries the
   note for whoever restores it. The draft-clearing half of what it checked is
   still checked — `reconciles a lost save response with a read` and the
   account-isolation test above both read the journal directly.

   `shows current disputed and unconfirmed memory without creating a message`
   guarded the "Your memory" sheet: the principles, readings and inspirations
   selected for the next reply, with their disputed and unconfirmed states.
   That is the model's context window with a label on it, and it is the single
   clearest thing the founder's sentence was pointing at. */
it('sends one durable reply intent and displays the follow-up',async()=>{
  stored.generationEnabled=true;await mount();await type('What could I try?');await click('Send');
  expect(saveConversationMessage).toHaveBeenCalledWith(scope.profileId,id,expect.objectContaining({content:'What could I try?',requestReply:true}),expect.any(AbortSignal));
  expect(host.textContent).toContain('Thinking about that…');completeReply();await tick();expect(host.textContent).toContain('Which condition matters most today?');
  /* The reply arrived, so nothing is being waited for and the one other
     control on the surface goes away with the sentence it interrupted. */
  expect(host.textContent).not.toContain('Thinking about that…');expect(named()).toEqual(['Add photo or file','Send']);
});
it('stops a pending reply and still shows that the message was saved',async()=>{
  stored.generationEnabled=true;await mount();await type('Keep this question');await click('Send');
  vi.mocked(stopConversationReply).mockImplementation(async()=>{replyState={...replyState,phase:'stopped',canRetry:true};return structuredClone(replyState);});
  await click('Stop reply');expect(host.textContent).toContain('Stopped. Your message is saved.');expect(stored.messages).toHaveLength(1);
  /* AND NO WAY TO RE-RUN THE GENERATOR. "Retry reply" was the other half of
     this test; a stopped reply now ends in a sentence, and asking again means
     saying something again through the box. */
  expect(named()).toEqual(['Add photo or file','Send']);
  expect(host.querySelector('textarea')!.disabled).toBe(false);
});
it('does not jump away from older messages when a new reply arrives',async()=>{
  stored.generationEnabled=true;await mount();await type('A question');await click('Send');
  const body=host.querySelector<HTMLElement>('.jar-conversation-body')!;
  Object.defineProperties(body,{scrollHeight:{configurable:true,value:1500},clientHeight:{configurable:true,value:300}});body.scrollTop=10;
  await act(async()=>body.dispatchEvent(new Event('scroll',{bubbles:true})));completeReply();await tick();
  /* The "New messages ↓" button that used to announce this went with the
     other controls; the rule it announced is what mattered and is asserted
     here directly — the transcript does not move under you. */
  expect(body.scrollTop).toBe(10);expect(host.textContent).not.toContain('New messages');
});
function windowedThread(){
  const messages=Array.from({length:60},(_,i)=>({id:`window-${i+1}`,role:'user' as const,profileId:scope.profileId,conversationId:id,position:i+1,content:`Owned message ${i+1}`,createdAt:stored.createdAt}));
  stored={...stored,revision:60,messageWindowStart:31,preview:'The original human topic',messages:messages.slice(30)};
  return messages;
}
it('loads earlier words while preserving the visible scroll anchor and original topic',async()=>{
  const messages=windowedThread();await mount();const scroll=host.querySelector<HTMLElement>('.chat-scroll')!;
  Object.defineProperties(scroll,{scrollHeight:{configurable:true,get:()=>host.querySelectorAll('.chat-message').length*100},clientHeight:{configurable:true,value:300}});
  scroll.scrollTop=10;await act(async()=>scroll.dispatchEvent(new Event('scroll',{bubbles:true})));
  vi.mocked(fetchConversation).mockResolvedValueOnce({...stored,messageWindowStart:1,messages});
  await click('Load earlier messages');expect(fetchConversation).toHaveBeenLastCalledWith(scope.profileId,id,expect.any(AbortSignal),1);
  expect(host.querySelectorAll('.chat-message')).toHaveLength(60);expect(scroll.scrollTop).toBe(3010);
  expect(host.textContent).not.toContain('Load earlier messages');expect(saveConversationMessage).not.toHaveBeenCalled();
});
it('an earlier-read failure preserves current messages and the unfinished draft',async()=>{
  windowedThread();await mount();await type('Keep my unfinished thought');
  vi.mocked(fetchConversation).mockRejectedValueOnce(new Error('Read failed'));await click('Load earlier messages');
  expect(host.querySelectorAll('.chat-message')).toHaveLength(30);expect(host.querySelector('textarea')!.value).toBe('Keep my unfinished thought');
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
  expect(host.textContent).not.toContain('Couldn’t check reply progress.');await tick(1000);expect(host.textContent).not.toContain('Couldn’t check reply progress.');
});
/* ── ELEVEN TOMBSTONES: THE READINGS AND SOURCES A REPLY CITED ──────────────
   A reply could end in a list of top-of-mind previews, each one a button that
   fetched its verified text and SENT a follow-up message composed from it;
   other citations opened a quote panel offering "Discuss this". Eleven tests
   covered that machinery — one click sends once, a typed draft is never
   overwritten by a chosen reading, an unavailable reading refuses rather than
   inventing a follow-up, a response for the wrong profile is rejected before
   its text is copied, a double click coalesces, a stalled read recovers, a
   navigation cancels, a lost send is reconciled by GET, and an earlier record
   carries its date into the message it composes.
   All of it is deleted, `fetchConversationCitation` included. It was the
   densest control cluster on the screen and the least explicable: a person
   who has never seen this page cannot tell "Top of mind → changed" from an
   error. The ownership rule those tests leaned on is NOT only theirs — every
   remaining read goes through `checked()` in `lib/api/conversations`, which
   refuses any record whose `profileId` is not the caller's, and
   `never restores another account’s draft` holds the client half. */
it('coalesces rapid sends and retains one durable sending intent',async()=>{
  /* THIS WAS A STARTER TEST. Three starter pills used to sit on the empty
     screen and SEND on one press, which is how a stranger's first click could
     post a question they did not write; they are gone, and the box's own
     button carries the invariant they were really guarding — two presses in
     one tick are one message, with one durable intent on disk. */
  stored.generationEnabled=true;let finish!:()=>void;const actual=vi.mocked(saveConversationMessage).getMockImplementation()!;
  vi.mocked(saveConversationMessage).mockImplementationOnce(async(...args)=>{await new Promise<void>(resolve=>{finish=resolve;});return actual(...args);});
  await mount();await type('What has changed in how I think?');
  const send=host.querySelector<HTMLButtonElement>('.chat-send')!;
  await act(async()=>{send.click();send.click();});expect(saveConversationMessage).toHaveBeenCalledOnce();expect(readConversationDrafts(scope,id)[0].value.pending).toBe(true);
  expect(host.textContent).toContain('Sending…');await act(async()=>finish());expect(stored.messages).toHaveLength(1);
});
it('checks quick replies after one second rather than waiting two',async()=>{
  stored.generationEnabled=true;await mount();await type('A quick question');await click('Send');completeReply();await tick(1000);
  expect(host.textContent).toContain('Which condition matters most today?');
});
it('shows waiting immediately while reply status is still being read and preserves the next draft',async()=>{
  stored.generationEnabled=true;await mount();let finish!:(row:ConversationReplyState)=>void;
  vi.mocked(fetchConversationReply).mockImplementationOnce(()=>new Promise<ConversationReplyState>(resolve=>{finish=resolve;}));
  await type('A question');await click('Send');expect(host.textContent).toContain('Thinking about that…');await type('My next thought');
  const send=host.querySelector<HTMLButtonElement>('.chat-send')!;expect(send.disabled).toBe(true);
  await act(async()=>finish(structuredClone(replyState)));expect(host.querySelector('textarea')!.value).toBe('My next thought');
});
it('uses an immediately committed first-message response without another conversation read',async()=>{
  stored.generationEnabled=true;stored.revision=1;stored.messages=[{id:replyId,profileId:scope.profileId,conversationId:id,position:1,role:'user',content:'The committed first question',createdAt:stored.createdAt}];
  replyState={...replyState,revision:1,messageId:replyId,requestId:replyId,phase:'pending'};
  await act(async()=>root.render(<ConversationPanel scope={scope} id={id} initialConversation={structuredClone(stored)} locale="en-US" onChoose={choose}/>));
  expect(host.textContent).toContain('The committed first question');expect(fetchConversation).not.toHaveBeenCalled();expect(host.textContent).toContain('Thinking about that…');
});
it('bounds automatic progress reads and then says to come back later',async()=>{
  /* The explicit "Check reply" button this used to end on was regeneration's
     third name and went with it. The bound is still a bound: polling stops,
     and the sentence tells you the work continues without you watching it.
     Returning to the tab resumes the read — see the focus listener in
     `lib/use-conversation-reply`. */
  stored.generationEnabled=true;await mount();await type('A longer question');await click('Send');
  const initialCalls=vi.mocked(fetchConversationReply).mock.calls.length;await tick(70000);
  expect(vi.mocked(fetchConversationReply).mock.calls.length-initialCalls).toBeLessThanOrEqual(35);
  expect(host.textContent).toContain('Still working. You can come back later.');
});

/**
 * ═══ IT DOES NOT SAY IT FAILED WHEN IT SUCCEEDED ═══════════════════════════
 *
 * Found by walking the real surface against the real API on 2026-10-11:
 * every request returned 200, the transcript rendered, and above it the page
 * read "This conversation couldn't be opened. Try again."
 *
 * The cause was a guard asking the wrong object. Each async routine here
 * decided whether it had been cancelled by reading `lifecycle.current` — the
 * controller for the run happening NOW — instead of the one it was started
 * under. When the effect re-runs it REPLACES that ref, so the abandoned
 * run's `catch` asked about its successor, was told "not aborted", and
 * printed a failure over the successor's perfectly good result.
 *
 * `id` goes from `null` to the new conversation's id on the first send of
 * every new chat, so this fires on the most ordinary path through the
 * surface rather than only under StrictMode.
 *
 * WHAT THIS PRESSES, and why it is shaped like this: remounting with a
 * different `id` is exactly what that navigation does, and the assertion is
 * on what a person READS, not on an internal flag — the defect was visible
 * only as a sentence on screen and every existing test passed throughout.
 */
it('does not print a read failure after a re-aimed load succeeds',async()=>{
  const second='33333333-3333-4333-8333-333333333333';
  /* THE KEY IS HELD CONSTANT ON PURPOSE. A changed key remounts, which gives
     the abandoned run a `lifecycle` ref of its own and hides the defect
     entirely — the first version of this test did that and passed against
     the bug. What the product actually does on a first send is keep the
     component and change `id`, so the effect re-runs IN PLACE and the one
     ref is overwritten under the run still in flight. That is the race. */
  const aim=(which:string|null)=>act(async()=>root.render(
    <ConversationPanel key="held" scope={scope} id={which} locale="en-US" onChoose={choose}/>));
  let releaseFirst:()=>void=()=>undefined;
  const firstInFlight=new Promise<void>(resolve=>{releaseFirst=resolve;});
  vi.mocked(fetchConversation).mockImplementation(async(_profile,which)=>{
    if(which===id){await firstInFlight;throw new Error('Conversation request stopped');}
    return structuredClone({...stored,id:second,messages:[{id:'m1',profileId:scope.profileId,conversationId:second,position:1,role:'user' as const,content:'probe one',createdAt:'2026-10-03T01:00:00Z'}]});
  });
  await aim(id);
  await aim(second);
  releaseFirst();
  await tick();
  expect(host.textContent,'the transcript never arrived, so this proves nothing').toContain('probe one');
  expect(
    host.textContent,
    'the surface says the conversation could not be opened while showing it',
  ).not.toContain('couldn’t be opened');
});
