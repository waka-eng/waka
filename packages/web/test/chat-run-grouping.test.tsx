// @vitest-environment jsdom
/**
 * ONE RUN, ONE TIMESTAMP — INCLUDING THE SENTENCE STILL IN FLIGHT.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `lib/api/conversations` only, the same
 * seam `conversation-panel.test.tsx` and `chat-first-send.test.tsx` use —
 * owned records in, and a `saveConversationMessage` that NEVER RESOLVES, which
 * is the whole fixture. A send that never comes back is the only way to hold
 * the panel in the state this file is about for long enough to read the DOM;
 * nothing else is replaced. `matchMedia` and `visualViewport` are absent in
 * jsdom and the panel already treats them as optional. The real
 * `ConversationPanel`, the real drafts and the real run arithmetic render.
 *
 * WHAT IT PROTECTS. The transcript groups consecutive turns from one speaker
 * into a RUN and prints the metadata row — the timestamp, or "Sending…" while
 * a message is in flight — only on the LAST bubble of it. That rule is quoted
 * from the reference library in the panel itself: "put metadata in the last
 * ChatMessageBubble metadata slot when the message uses bubbles" and "do not
 * put the same metadata on both a bubble and its enclosing message."
 *
 * The arithmetic over CONFIRMED messages was always right. The message that is
 * STILL BEING SENT was rendered outside the `.map()` that computes it, as a
 * fixed `data-run="fl"`, so a confirmed question followed by one you had just
 * pressed Send on produced:
 *
 *     got  ["user:fl", "user:fl"], 2 metadata rows
 *     want ["user:fm", "user:ml"], 1 metadata row
 *
 * — two ends-of-run, two metadata rows and a loosened corner radius between
 * two bubbles that are one person continuing. It is reachable on the ordinary
 * path: with replies unconnected (`generationEnabled === false`), or after a
 * reply is stopped, Send re-enables with a user message last.
 *
 * WHY THE PENDING ONE TAKES THE `l` AND NOT THE CONFIRMED ONE. It is the last
 * thing on screen, so it is the end of the run by position; and its metadata
 * row is the live "Sending…" status, which is the one thing in the pair a
 * person actually needs while they wait. The confirmed message's timestamp
 * comes back the moment the save lands and the draft stops being rendered.
 *
 * G7, "nothing green is blind": the confirmed-only cases are asserted beside
 * the pending ones on purpose. A fix that made the pending draft a middle of a
 * run by simply never ending a run would pass the first case and fail these,
 * which is the mutation worth catching.
 */
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ConversationPanel} from '../src/components/ConversationPanel';
import {fetchConversation,fetchConversationReply,listConversations,saveConversationMessage,type ApiConversation,type ApiConversationMessage} from '../src/lib/api/conversations';
vi.mock('../src/lib/api/conversations',async original=>({...await original<typeof import('../src/lib/api/conversations')>(),createConversation:vi.fn(),fetchConversation:vi.fn(),fetchConversationReply:vi.fn(),stopConversationReply:vi.fn(),listConversations:vi.fn(),saveConversationMessage:vi.fn()}));
const scope={accountId:'owner',profileId:'profile'},id='11111111-1111-4111-8111-111111111111',choose=vi.fn();
let root:Root,host:HTMLDivElement,stored:ApiConversation;
/* WHOSE TURNS ARE ON SCREEN BEFORE ANYTHING IS TYPED. Every message carries a
   `createdAt`, because a bubble with no time is a bubble with no metadata row
   at all and would make the counting below vacuous. */
const said=(roles:ApiConversationMessage['role'][]):ApiConversationMessage[]=>roles.map((role,at)=>({
  id:`message-${at}`,profileId:scope.profileId,conversationId:id,position:at+1,role,
  content:role==='user'?`What I asked, ${at}`:`What WAKA answered, ${at}`,
  createdAt:`2026-10-03T0${at+1}:00:00Z`,
}));
/* REPLIES ARE NOT CONNECTED IN HERE, which is deliberate rather than
   incidental: `generationEnabled: false` is one of the two states in which two
   of your own questions can stand next to each other, so it is the state the
   defect lives in. It also keeps the reply poller asleep, so nothing arrives
   mid-assertion. */
beforeEach(()=>{vi.resetAllMocks();vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});localStorage.clear();sessionStorage.clear();(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  stored={id,profileId:scope.profileId,revision:1,generationEnabled:false,createdAt:'2026-10-03T00:00:00Z',updatedAt:'2026-10-03T00:00:00Z',messages:[]};
  vi.mocked(fetchConversation).mockImplementation(async()=>structuredClone(stored));
  vi.mocked(listConversations).mockResolvedValue({profileId:scope.profileId,conversations:[],generationEnabled:false});
  vi.mocked(fetchConversationReply).mockImplementation(async()=>({profileId:scope.profileId,conversationId:id,messageId:null,requestId:null,phase:'idle',revision:0,failureCode:null,retryAfter:null,runAfter:null,canRetry:false,generationEnabled:false}));
  /* THE HELD SEND. It is left in flight for the length of one assertion, not
     rejected — a rejection would clear `pending` and take the draft bubble off
     the screen, which is the row under test. */
  vi.mocked(saveConversationMessage).mockImplementation(()=>new Promise(()=>{}));
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.useRealTimers();});
const mount=()=>act(async()=>{root.render(<ConversationPanel key={id} scope={scope} id={id} locale="en-US" onChoose={choose}/>);await vi.advanceTimersByTimeAsync(0);});
const ask=async(words:string)=>{
  await act(async()=>{const area=host.querySelector('textarea')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(area,words);area.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>{host.querySelector<HTMLButtonElement>('.chat-send')!.click();await vi.advanceTimersByTimeAsync(0);});
};
/* `role:run` per bubble, in transcript order — the two facts the CSS and the
   metadata row both select on, read the way they are written. */
const runs=()=>[...host.querySelectorAll('.chat-message')].map(node=>`${(node as HTMLElement).dataset.role}:${(node as HTMLElement).dataset.run}`);
const metadata=()=>host.querySelectorAll('.chat-meta').length;
it('joins the message being sent to the run it continues, so one run still prints one metadata row',async()=>{
  stored={...stored,messages:said(['user'])};
  await mount();
  expect(runs()).toEqual(['user:fl']);
  await ask('And one more thing.');
  /* THE DEFECT, AS ONE LINE: the confirmed question is no longer the end of
     anything, because the one in flight is sitting under it. */
  expect(runs()).toEqual(['user:fm','user:ml']);
  expect(metadata()).toBe(1);
  /* And the row that survived is the live one, not a timestamp. A person
     waiting on a send needs to be told it is still going. */
  expect(host.querySelector('.chat-sending .chat-meta')?.getAttribute('role')).toBe('status');
});
it('still ends a run at a change of speaker, with the sent message starting its own',async()=>{
  stored={...stored,messages:said(['user','assistant'])};
  await mount();
  await ask('A new question, after an answer.');
  expect(runs()).toEqual(['user:fl','assistant:fl','user:fl']);
  expect(metadata()).toBe(3);
});
it('keeps the confirmed arithmetic it already had when nothing is in flight',async()=>{
  stored={...stored,messages:said(['user','user','assistant'])};
  await mount();
  expect(runs()).toEqual(['user:fm','user:ml','assistant:fl']);
  /* One per run, which is two — and the first bubble of the pair has none. */
  expect(metadata()).toBe(2);
  expect(host.querySelector('.chat-message[data-run="fm"] .chat-meta')).toBeNull();
});
