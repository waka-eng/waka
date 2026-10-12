/**
 * A TRANSCRIPT, A BOX, AND ONE WAY TO STOP.
 *
 * Founder, 2026-10-10: "So the talk with Waka experience is the most confusing
 * chat experience ever with so many different buttons that I have no idea what
 * its supposed to do." Pointing at the same screen earlier: "so ugly."
 *
 * He was counting correctly. This panel rendered FOURTEEN controls and
 * forty-nine pieces of copy, and almost none of them were about talking. They
 * were about the machinery UNDER talking: which memories the reply had been
 * allowed to read, which reply request was in flight and whether it could be
 * asked for again, which revision a saved draft was written against, which
 * principle you might like to re-word while you were here. Every one of them
 * was a real mechanism — and a person opening this screen for the first time
 * cannot tell a mechanism from a mistake.
 *
 * THE BAR THAT DECIDED EVERY REMOVAL: would someone who has never seen this
 * screen know what the control does, and want it on their first visit? Nothing
 * that exposes generation plumbing passes that bar, however honest the
 * plumbing is. So what is left is what a conversation IS:
 *
 *   THE TRANSCRIPT — what was said, in order, your turns dim and the reply
 *   lit, with its own top edge ("Load earlier messages") because a transcript
 *   that cannot reach its own beginning is not a transcript.
 *
 *   THE BOX — one field, one filled button, three labels between them
 *   ("Send", "Sending…", "Try sending again"). One control, its states.
 *
 *   AND ONE OTHER THING — "Stop reply", which exists only while a reply is
 *   being written. At rest this surface has no third control at all, which is
 *   the whole point; while WAKA is answering it has exactly one, sitting
 *   beside the sentence that says WAKA is answering.
 *
 * WHAT WENT, AND WHERE A FUTURE READER SHOULD LOOK FOR IT. Each of these is
 * also commented at the site it used to occupy:
 *
 *   YOUR MEMORY (`ConversationMemory`, `fetchConversationContext`) — a sheet
 *   listing the principles, readings and inspirations selected for the reply.
 *   This is the clearest possible example of the bar above: it is the model's
 *   context window with a label on it. Deleted outright.
 *
 *   REFERENCES (the `details` per reply, `ConversationReadingChoices`,
 *   `ConversationSourceDate`, `fetchConversationCitation`) — footnotes under
 *   each reply, opening a quote, offering "Discuss this". It also printed a
 *   COUNT — `References (2)` — against the founder law that states render and
 *   numerals never. Deleted outright.
 *
 *   CORRECT REPLY / UPDATE A PRINCIPLE (`ConversationPrincipleEdit`) — a
 *   second editor, with its own confirmation checkbox, conflict reconciliation
 *   and retry, nested inside a chat message. Editing a principle belongs on
 *   the principles surface, which has it.
 *
 *   SAVE INSIGHT / SAVE THOUGHT (`ConversationThought`) — the authored-save
 *   flow under every message: a disclosure, a textarea, an "I adopt this"
 *   checkbox, a draft picker, check and retry. Saving is this product's
 *   central act and it still has its own box on the home screen; it does not
 *   also need eight controls per transcript row. If it comes back here it
 *   comes back as ONE button that opens ONE field.
 *
 *   CONVERSATION OPTIONS (`···`) — a menu holding a draft picker and "Delete
 *   conversation". Deleting belongs to the LIST of conversations, beside the
 *   row being deleted, not inside the conversation you are reading; the
 *   client wrapper went with it (see `lib/api/conversations`). The draft
 *   picker exposed revisions of your own unsent sentence; the newest is
 *   restored silently now, and every fork is still on disk.
 *
 *   STARTERS — three buttons that SENT a message on one press, on the first
 *   screen a stranger sees. The box's own placeholder asks the same question
 *   and waits to be answered.
 *
 *   RETRY REPLY / GET A REPLY / CHECK REPLY — regeneration, by three names.
 *   A failed reply still says so in plain words; the way to ask again is to
 *   say something again.
 *
 * FAILURE IS STILL VISIBLE EVERYWHERE IT WAS. That was the one thing removal
 * was not allowed to touch: a lost save still says "Couldn’t confirm this
 * message", with the one control that can reconcile it next to the sentence;
 * an unopenable conversation still says so and still offers the only move
 * left; a reply that fails, stops or is rate-limited still prints a sentence
 * saying which. A quiet surface is not the same as a quiet failure.
 */
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createConversation,fetchConversation,listConversations,saveConversationMessage,type ApiConversation} from '../lib/api/conversations';
import {profileStorageKey,type ProfileStorageScope} from '../lib/profile-storage';
import {useConversationReply} from '../lib/use-conversation-reply';
import {Companion} from './Companion';
import {ConversationText} from './ConversationText';
import {fetchPrinciples,type ApiPrinciple} from '../lib/api';
import {t,type SupportedLocale} from '../lib/locales';
import {readConversationDrafts,storeConversationDraft,clearConversationDraft,type ConversationDraft as Draft,type StoredConversationDraft} from '../lib/conversation-drafts';

export function ConversationPanel({scope,id,initialPrincipleId,initialConversation,locale,onChoose,onCreated}:{scope:ProfileStorageScope;id:string|null;initialPrincipleId?:string;initialConversation?:ApiConversation;locale:SupportedLocale;onChoose:(id:string|null)=>void;onCreated?:(row:ApiConversation)=>void}){
  const journal=id??`new:${initialPrincipleId??'general'}`;
  const initial=initialConversation?.id===id&&initialConversation.profileId===scope.profileId?initialConversation:null;
  const bootstrap=useRef(initial);
  const [conversation,setConversation]=useState<ApiConversation|null>(initial),[draft,setDraft]=useState<Draft|null>(null);
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(!initial),[error,setError]=useState<string|null>(null),[storageFailed,setStorageFailed]=useState(false);
  const [mobile,setMobile]=useState(()=>window.matchMedia?.('(max-width:760px)').matches??false);
  const [earlierBusy,setEarlierBusy]=useState(false),[earlierFailed,setEarlierFailed]=useState(false);
  const prependScroll=useRef<{height:number;top:number}|null>(null);
  const [focusPrinciple,setFocusPrinciple]=useState<ApiPrinciple|null>(null),[focusFailed,setFocusFailed]=useState(false);
  const lifecycle=useRef(new AbortController()),draftRef=useRef<Draft|null>(null),working=useRef(false);
  const conversationRef=useRef<ApiConversation|null>(initial),writer=useRef(crypto.randomUUID()),receipt=useRef<StoredConversationDraft>();
  const [generationEnabled,setGenerationEnabled]=useState<boolean|null>(initial?.generationEnabled??null);
  const root=useRef<HTMLElement>(null),body=useRef<HTMLDivElement>(null),editor=useRef<HTMLTextAreaElement>(null),nearBottom=useRef(true);
  const restoredScroll=useRef<{top:number;nearBottom:boolean;messageWindowStart?:number}|null>(null),scrollKey=profileStorageKey(scope,`conversationScroll:${journal}`)!;
  const say=(key:Parameters<typeof t>[1])=>t(locale,key);
  useEffect(()=>{const media=window.matchMedia?.('(max-width:760px)');if(!media)return;const change=()=>setMobile(media.matches);media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
  useLayoutEffect(()=>{const viewport=window.visualViewport,node=root.current;if(!viewport||!node)return;const update=()=>{if(!Number.isFinite(viewport.height)||viewport.height<=0||!Number.isFinite(viewport.offsetTop))return;node.style.setProperty('--chat-height',`${viewport.height}px`);node.style.setProperty('--chat-top',`${viewport.offsetTop}px`);if(nearBottom.current&&body.current)body.current.scrollTop=body.current.scrollHeight;};update();viewport.addEventListener('resize',update);viewport.addEventListener('scroll',update);return()=>{viewport.removeEventListener('resize',update);viewport.removeEventListener('scroll',update);};},[]);
  /* THE TEXTAREA SIZES ITSELF, AND ONLY ONE THING DECIDES HOW. Four
     mechanisms used to fight over this element: a CSS `min-height`, a CSS
     `max-height`, `field-sizing: content`, and a `Math.max(52, Math.min(
     scrollHeight, 180))` written here — whose floor contradicted the CSS
     floor and whose cap contradicted the CSS cap. `field-sizing: content`
     between the two CSS bounds does the whole job, so the inline style that
     fought them is gone rather than reconciled. */
  const run=async<T,>(work:(signal:AbortSignal)=>Promise<T>)=>{
    const owner=lifecycle.current,request=new AbortController(),abort=()=>request.abort();owner.signal.addEventListener('abort',abort,{once:true});const timer=window.setTimeout(abort,15000);
    const stopped=()=>rejectStopped(new Error('Conversation request stopped'));let rejectStopped!:(error:Error)=>void;
    const canceled=new Promise<never>((_,reject)=>{rejectStopped=reject;});request.signal.addEventListener('abort',stopped,{once:true});
    try{if(owner.signal.aborted)throw new Error('Conversation request stopped');const value=await Promise.race([work(request.signal),canceled]);if(request.signal.aborted||owner.signal.aborted)throw new Error('Conversation request stopped');return value;}
    finally{window.clearTimeout(timer);owner.signal.removeEventListener('abort',abort);request.signal.removeEventListener('abort',stopped);}
  };
  const keep=(next:Draft)=>{draftRef.current=next;setDraft(next);try{receipt.current=storeConversationDraft(scope,journal,next,receipt.current);setStorageFailed(false);return true;}catch{setStorageFailed(true);return false;}};
  const observe=(next:ApiConversation)=>{
    if(conversationRef.current?.id===next.id&&conversationRef.current.profileId===next.profileId&&conversationRef.current.revision>next.revision)next=conversationRef.current;
    conversationRef.current=next;setConversation(next);setGenerationEnabled(next.generationEnabled??false);
    const pending=draftRef.current;
    if(pending?.pending&&next.messages.some(message=>message.id===pending.id&&message.content===pending.content)){
      try{if(receipt.current)clearConversationDraft(receipt.current);}catch{setStorageFailed(true);}
      receipt.current=undefined;draftRef.current=null;setDraft(null);setError(null);
      if(!id){onCreated?.(next);onChoose(next.id);}
    }
  };
  const reply=useConversationReply(scope.profileId,id,Boolean(conversation?.generationEnabled),conversation?.revision??0,observe,conversation?.messageWindowStart);
  const replyPending=reply.state?.phase==='pending'||reply.state?.phase==='running';
  const latestMessage=conversation?.messages.at(-1);
  const replyUnconfirmed=Boolean(generationEnabled&&latestMessage?.role==='user'&&(!reply.state||reply.error));
  const awaitingReply=replyPending||replyUnconfirmed;
  useLayoutEffect(()=>{const node=body.current;if(!node||!conversation)return;const saved=restoredScroll.current;
    if(prependScroll.current){const previous=prependScroll.current;node.scrollTop=previous.top+node.scrollHeight-previous.height;prependScroll.current=null;return;}
    if(saved){nearBottom.current=saved.nearBottom;node.scrollTop=saved.nearBottom?node.scrollHeight:saved.top;restoredScroll.current=null;}
    /* STILL NO JUMP AWAY FROM WHAT YOU WERE READING. The "New messages ↓"
       button that used to appear when a reply landed above your scroll
       position went with the other controls; the rule it existed to announce
       did not. If you are reading older words, nothing moves. */
    else if(nearBottom.current)node.scrollTop=node.scrollHeight;
  },[conversation?.messages.length]);
  /* THE LIST ITSELF LIVES IN THE CORNER. What this still reads it for is
     `generationEnabled` — whether replies are connected at all, which the
     composer's own state depends on and which this endpoint happens to
     carry. The conversations it returns are not rendered here. */
  /**
   * ═══ WHOSE RUN IS THIS? — the guard that was asking the wrong object ═══
   *
   * Measured 2026-10-11 against the real API: every request on this surface
   * returned 200, the transcript rendered, and above it the page said "This
   * conversation couldn't be opened. Try again." A surface lying about its
   * own success, on the screen the founder called "the most confusing chat
   * experience ever".
   *
   * The cause is one word repeated eleven times. Every guard read
   * `lifecycle.current` — the controller for the run happening NOW — to
   * decide whether the run it is INSIDE was cancelled. Those are the same
   * object exactly until the effect replaces it, which it does on every
   * change of `[accountId, profileId, id, initialPrincipleId]`:
   *
   *   1. run A starts; `lifecycle.current` is A
   *   2. the effect tears down and aborts A; A's work rejects at once with
   *      the deliberate `Conversation request stopped`
   *   3. run B starts; `lifecycle.current` is now B
   *   4. A's `catch` asks whether `lifecycle.current` is aborted, is told no
   *      — because it is asking about B — and prints the failure
   *   5. B's request comes back, `observe` renders the transcript, and
   *      nothing clears A's sentence, because `observe` never touched it
   *
   * `id` changes from `null` to the new conversation's id on the FIRST SEND
   * of every new chat, so this is not a dev-only StrictMode artifact; it is
   * on the most ordinary path through the surface.
   *
   * BOTH HALVES ARE THE FIX, and step 5 is the one that makes it visible: a
   * wrong sentence that is cleared a frame later is a flicker, and a wrong
   * sentence nothing retracts is what was on screen. So each routine
   * captures the controller it belongs to and asks that one, AND a read
   * that works clears the sentence saying it did not.
   */
  const mine=(owner:AbortController)=>!owner.signal.aborted;
  const refreshList=async(owner=lifecycle.current)=>{const next=await run(signal=>listConversations(scope.profileId,signal));if(mine(owner)&&!id)setGenerationEnabled(next.generationEnabled);};
  const loadHistory=(owner=lifecycle.current)=>{void refreshList(owner).catch(()=>undefined);};
  const refresh=async()=>{
    const owner=lifecycle.current;
    setLoading(true);setError(null);
    try{
      if(id)loadHistory(owner);else await refreshList(owner);if(!mine(owner))return;
      const target=id??(draftRef.current?.pending?draftRef.current.conversationId:null);
      if(target){const committed=bootstrap.current;bootstrap.current=null;
        const pending=draftRef.current,from=conversationRef.current?.messageWindowStart??restoredScroll.current?.messageWindowStart;
        let next=committed?.id===target&&committed.profileId===scope.profileId?committed:await run(signal=>from!==undefined?fetchConversation(scope.profileId,target,signal,from):fetchConversation(scope.profileId,target,signal));
        // An uncertain write may not exist. First read current state; expand
        // only when its expected position is hidden by a confirmed later tail.
        const expected=pending?.pending?Math.max(1,pending.revision+1):null;
        if(expected!==null&&next.revision>=expected&&(next.messageWindowStart??1)>expected&&!next.messages.some(message=>message.id===pending!.id))next=await run(signal=>fetchConversation(scope.profileId,target,signal,expected));
        if(mine(owner)){observe(next);setError(null);}}
      if(!id&&initialPrincipleId){const available=await run(signal=>fetchPrinciples({profile:scope.profileId},signal));if(mine(owner)){const focus=available.find(row=>row.id===initialPrincipleId)??null;setFocusPrinciple(focus);setFocusFailed(!focus);}}
    }catch{if(mine(owner))setError(say(draftRef.current?.pending?'worldConversationSaveFailed':'worldConversationReadFailed'));}
    finally{if(mine(owner))setLoading(false);}
  };
  const loadEarlier=async()=>{
    if(!id||earlierBusy||busy||loading||!conversation?.messageWindowStart||conversation.messageWindowStart<=1)return;
    const owner=lifecycle.current;
    setEarlierBusy(true);setEarlierFailed(false);
    try{const from=Math.max(1,conversation.messageWindowStart-30),next=await run(signal=>fetchConversation(scope.profileId,id,signal,from));
      if(!mine(owner))return;
      if(next.revision<(conversationRef.current?.revision??0)||(next.messageWindowStart??1)>from)throw new Error('Older history window');
      const node=body.current;if(node)prependScroll.current={height:node.scrollHeight,top:node.scrollTop};observe(next);
    }catch{if(mine(owner))setEarlierFailed(true);}finally{if(mine(owner))setEarlierBusy(false);}
  };
  useEffect(()=>{
    lifecycle.current=new AbortController();
    /* THE NEWEST UNSENT SENTENCE, WITHOUT ASKING WHICH. Two tabs each fork
       their own draft and both are still on disk; what went is the `<select>`
       that offered them to you by their first fifty characters, which is a
       revision list wearing a label. */
    try{const saved=readConversationDrafts(scope,journal);if(saved[0]){receipt.current=saved[0];draftRef.current=saved[0].value;setDraft(saved[0].value);}}catch{setStorageFailed(true);}
    try{const saved=JSON.parse(sessionStorage.getItem(scrollKey)??'null');if(saved&&Number.isFinite(saved.top)&&saved.top>=0&&typeof saved.nearBottom==='boolean'&&(saved.messageWindowStart===undefined||Number.isSafeInteger(saved.messageWindowStart)&&saved.messageWindowStart>=1&&saved.messageWindowStart<=200))restoredScroll.current={...saved,messageWindowStart:saved.messageWindowStart??1};}catch{/* Scrolling is recoverable without a stored position. */}
    void refresh();return()=>lifecycle.current.abort();
  },[scope.accountId,scope.profileId,id,initialPrincipleId]);
  const save=async()=>{
    if(working.current||loading||generationEnabled===null||awaitingReply||!draftRef.current?.content.trim()||storageFailed||focusFailed||id&&!conversation)return;
    const current=draftRef.current,intent:Draft={...current,revision:conversation?.revision??0,pending:true,updatedAt:Date.now(),...(!id?{conversationId:current.conversationId??crypto.randomUUID()}:{})};
    if(!keep(intent))return;const owner=lifecycle.current;working.current=true;setBusy(true);setError(null);nearBottom.current=true;
    try{
      const next=id?await run(signal=>{const input={id:intent.id,content:intent.content,revision:intent.revision,...(generationEnabled?{requestReply:true}:{})},from=conversationRef.current?.messageWindowStart;
        return from!==undefined?saveConversationMessage(scope.profileId,id,input,signal,from):saveConversationMessage(scope.profileId,id,input,signal);})
        :await run(signal=>createConversation(scope.profileId,intent.conversationId!,signal,initialPrincipleId,{id:intent.id,content:intent.content,requestReply:generationEnabled===true}));
      if(mine(owner)){observe(next);setError(null);if(id)reply.check();}
    }catch{if(mine(owner))setError(say('worldConversationSaveFailed'));}
    finally{working.current=false;if(mine(owner))setBusy(false);}
  };
  const edit=(content:string)=>{const current=draftRef.current,own=current?.writer===writer.current;keep({id:own?current.id:crypto.randomUUID(),writer:writer.current,updatedAt:Date.now(),content,revision:conversation?.revision??0,pending:false});};
  const first=conversation?.initialPrinciple??focusPrinciple,canCompose=!id||Boolean(conversation);
  const full=(conversation?.revision??0)>=(generationEnabled?199:200);
  /* ONE SENTENCE FOR THE REPLY'S BAD NEWS, AND NO BUTTON UNDER IT. Three of
     the five states that used to print here carried a control — retry, ask,
     check — and one of them, `stale`, was a word about the model's context
     rather than about anything the person did. What a person needs from a
     reply that did not arrive is to know it did not arrive. */
  /**
   * WHY SEND CANNOT BE PRESSED, in the order a person would meet the
   * reasons. `null` means it can.
   *
   * This was an inline boolean of eight terms with no way to ask it what it
   * meant, so the button could be dead for half a dozen different causes
   * and looked identical in all of them. `e2e:usability` H7 — "no control
   * is disabled with no reason" — caught it the first time that gate was
   * pointed at a conversation. Naming each cause is what lets the control
   * carry its own reason, and it also makes the condition readable, which
   * eight `||`s were not.
   */
  const whyNoSend = storageFailed ? 'worldConversationDraftFailed' as const
    : focusFailed ? 'worldPrincipleUnavailable' as const
    : full ? 'worldConversationFull' as const
    : loading||generationEnabled===null ? 'worldChatLoading' as const
    : awaitingReply ? 'worldConversationThinking' as const
    : busy ? 'worldChatSending' as const
    : !draft?.content.trim() ? 'worldConversationNeedsWords' as const
    : null;
  const replyNotice=reply.error?'worldConversationReplyCheckFailed' as const
    :reply.state?.retryAfter&&reply.state.phase!=='ready'?'worldConversationReplyLimit' as const
    :reply.state?.phase==='failed'?'worldConversationReplyFailed' as const
    :reply.state?.phase==='stopped'?'worldConversationReplyStopped' as const:null;
  return <main ref={root} className="chat-page">
    {/* NO ROW ACROSS THE TOP AT ALL. `.chat-top` held "Your memory" and a
        `···` menu, and a comment arguing it was "not a second header" — which
        it was, on a product whose other screens have one bar and two corner
        buttons. The corners are the navigation here as everywhere. */}
    <section className="chat-main" aria-label={say('worldConversationTitle')}>
      {error?<div className="chat-notice" role="alert">{error} {!draft?.pending?<button type="button" disabled={busy||loading} onClick={()=>void refresh()}>{say('worldRoomHistoryRetry')}</button>:null}
        {/* THE WAY OUT SITS BESIDE THE FAILURE. When a conversation cannot be
            opened there is no box to type in, so starting a fresh one is the
            only move left — and it used to be a button in a column down the
            side of the page. It belongs next to the sentence that says the
            conversation is gone. */}
        {!conversation&&!draft?.pending?<button type="button" disabled={busy} onClick={()=>onChoose(null)}>{say('worldConversationNew')}</button>:null}</div>:null}
      {loading?<p className="chat-notice" role="status">{say('worldChatLoading')}</p>:null}
      {focusFailed?<p className="chat-notice" role="alert">{say('worldPrincipleUnavailable')} <button type="button" onClick={()=>onChoose(null)}>{say('worldConversationNew')}</button></p>:null}
      <div className="jar-conversation-body chat-scroll" ref={body} onScroll={()=>{const node=body.current;if(!node)return;nearBottom.current=node.scrollHeight-node.scrollTop-node.clientHeight<80;try{sessionStorage.setItem(scrollKey,JSON.stringify({top:node.scrollTop,nearBottom:nearBottom.current,...(conversationRef.current?.messageWindowStart!==undefined?{messageWindowStart:conversationRef.current.messageWindowStart}:{})}));}catch{/* The transcript remains available. */}}}>
        <div className="chat-transcript">
          {/* The transcript's own top edge, not a feature beside it: a window
              of thirty messages that cannot reach the thirty before it is a
              transcript with its beginning cut off. */}
          {(conversation?.messageWindowStart??1)>1?<div className="chat-earlier"><button type="button" disabled={earlierBusy||busy||loading} onClick={()=>void loadEarlier()}>{say(earlierBusy?'worldChatEarlierLoading':'worldChatEarlierMessages')}</button>{earlierFailed?<p role="alert">{say('worldChatEarlierFailed')}</p>:null}</div>:null}
          {/* WHAT THIS CONVERSATION IS ABOUT, when it was opened from a
              principle. The quote stays because arriving from elsewhere with
              no sign of where you came from is its own confusion; the state
              word under it ("Marked as disputed") went, because a principle's
              standing is the principles surface's sentence to say. */}
          {first?<div className="chat-topic"><span>{say('worldConversationStartingFrom')}</span><blockquote>{first.statement}</blockquote></div>:null}
          {/* ═══ THE ONE YOU ARE TALKING TO IS ON SCREEN ════════════════
              Founder, of the home screen: "this is my only favorite screen
              of the experience." Of this one, empty: "nothing here feels
              몽글몽글." The difference between those two sentences was
              standing right here — a conversation with WAKA with no WAKA in
              it, which is a form, and read as one.

              It sits where the first turn will sit, so the first real turn
              replaces it in place and nothing jumps — the seat argument
              above is unchanged.

              AT THE OPENING ONLY. Once there are turns on screen the
              companion is speaking IN them, and a portrait above the
              transcript would be a second claim to the same voice. It holds
              the empty page the way it holds the home screen, and then it
              gets out of the way. */}
          {!conversation?.messages.length&&!draft?.content&&!loading&&!error?
            <div className="chat-opening">
              <Companion size={64}/>
              <p>{say('worldConversationOpening')}</p>
            </div>:null}
          <ol className="chat-messages" aria-label={say('worldConversationMessages')} aria-live="polite" aria-relevant="additions">
            {(conversation?.messages??[]).map(message=><li key={message.id} data-role={message.role}><p className="chat-said">{say(message.role==='user'?'worldConversationYou':'worldConversationWaka')}</p>
              <ConversationText text={message.content}/>{message.followUpQuestion?<ConversationText text={message.followUpQuestion}/>:null}
              {/* Under each reply there used to be: an actions disclosure, a
                  takeaway editor with an adoption checkbox, a correction
                  button, a principle editor, and a footnote list with a
                  count in its label. See this file's header. */}
            </li>)}
            {draft?.pending&&!conversation?.messages.some(message=>message.id===draft.id)?<li className="chat-sending" data-role="user"><span>{say('worldConversationYou')}</span><ConversationText text={draft.content}/><small role="status">{say(busy?'worldChatSending':'worldReviewPending')}</small></li>:null}
          </ol>
          {/* THE ONE OTHER CONTROL ON THE SURFACE, AND IT IS HERE RATHER THAN
              IN THE FOOTER ON PURPOSE: it interrupts this sentence, so it
              stands beside this sentence. The status text keeps the live
              region to itself — a button inside one gets re-announced every
              time the phase changes. */}
          {awaitingReply&&!reply.error?<div className="chat-thinking"><span className="chat-thinking-dots" aria-hidden="true"><i/><i/><i/></span>
            <span role="status">{say(reply.waiting?'worldConversationReplyWaiting':'worldConversationThinking')}</span>
            {replyPending?<button type="button" disabled={reply.busy} onClick={()=>void reply.stop()}>{say('worldConversationStop')}</button>:null}</div>:null}
        </div>
      </div>
      {canCompose?<footer className="chat-composer">
        {/* THE INSTALL'S OWN CONFIGURATION IS NOT NEWS FOR THE PERSON TYPING.
            "WAKA can't reply yet — no model is connected. What you write is
            kept." stood above this field on every local build. Founder,
            pointing at it: "remove this."

            It is a true sentence and it was still wrong here, for the reason
            the permanent explainers went out everywhere else: it is read once
            and stepped over forever, it describes the deployment rather than
            anything the person did, and it occupied the line directly above
            the one control on the surface. Somebody who presses Send with no
            model connected still learns what happened — the message is kept,
            which is what the sentence promised, and `whyNoSend` names any
            state where the button cannot be pressed at all. */}
        {generationEnabled&&replyNotice?<p className="chat-reply-status" role="status">{say(replyNotice)}</p>:null}
        <div className="chat-input-row"><label className="chat-input-label"><span>{say('worldConversationMessage')}</span><textarea ref={editor} autoFocus={!mobile} maxLength={4000} rows={1} aria-label={say('worldConversationMessage')} placeholder={say('worldConversationFirst')} value={draft?.content??''} disabled={busy||draft?.pending} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.altKey&&(!mobile||event.metaKey||event.ctrlKey)&&!event.nativeEvent.isComposing&&event.nativeEvent.keyCode!==229&&!event.repeat){event.preventDefault();void save();}}} onChange={event=>edit(event.target.value)}/></label>
          {/* ONE BUTTON, THREE STATES. It used to carry five labels, two of
              which announced a mode ("Save message" when replies are not
              connected) rather than an act. The notice above the transcript
              already says replies are not connected; the button says Send
              either way, because sending is what you are doing. */}
          {/* AND IT SAYS WHY IT CANNOT BE PRESSED — see `whyNoSend`. A `title`
              rather than visible copy: the reason belongs to the control, is
              wanted only by somebody who has just tried to press it, and
              printing six possible sentences beside a button would be the
              clutter this surface was stripped to remove. The two states
              worth saying out loud already print their own line above. */}
          <button className="chat-send" type="button" title={say(whyNoSend ?? 'worldConversationSend')} disabled={Boolean(whyNoSend)} onClick={()=>void save()}>{say(busy&&draft?.pending?'worldChatSending':draft?.pending?'worldConversationRetry':'worldConversationSend')}</button>
        </div>
        {storageFailed?<p className="chat-muted" role="alert">{say('worldConversationDraftFailed')}</p>:null}
        {/* A SAVE THAT WAS NOT CONFIRMED KEEPS ITS ONE WAY OUT. This reads
            the conversation back rather than writing again, which is why it
            survived the sweep of retry-shaped controls: it is the only way to
            learn whether words you can still see on screen actually landed. */}
        {draft?.pending?<button type="button" disabled={busy||loading} onClick={()=>void refresh()}>{say('worldConversationCheck')}</button>:null}
        {full?<p className="chat-muted">{say('worldConversationFull')}</p>:null}
      </footer>:null}
    </section>
  </main>;
}
