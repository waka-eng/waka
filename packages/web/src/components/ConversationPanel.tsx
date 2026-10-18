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
import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {createConversation,fetchConversation,listConversations,saveConversationMessage,type ApiConversation} from '../lib/api/conversations';
import {profileStorageKey,type ProfileStorageScope} from '../lib/profile-storage';
import {useConversationReply} from '../lib/use-conversation-reply';
import {Companion} from './Companion';
import {agentBeing} from '../character/body';
import {ConversationText} from './ConversationText';
import {HomeActionIcon} from './HomeActionIcon';
import {timeOf} from '../lib/words';
import {dictationAvailable,useDictation} from '../lib/use-dictation';
import {ApiError,fetchPrinciples,type ApiPrinciple} from '../lib/api';
import {t,type SupportedLocale} from '../lib/locales';
import {readConversationDrafts,storeConversationDraft,clearConversationDraft,type ConversationDraft as Draft,type ConversationDraftAttachment,type StoredConversationDraft} from '../lib/conversation-drafts';
import {AddMenu} from './AddMenu';
import {MessageAttachments} from './MessageAttachments';
import {discardMessageAttachment,fetchAttachmentUrl,uploadMessageAttachment} from '../lib/api/attachments';
import {FileRefused,MAX_MESSAGE_ATTACHMENTS,fileSizeWords,inspectAttachmentFile} from '../lib/api/file-accept';
import {attachmentLabel} from '../lib/attachment-label';
import {inspectInspirationPhoto,PhotoRefused} from '../lib/inspiration-photo';
import {formatMessage,type MessageKey} from '../lib/locales';

/** The id `Home` gives the bar's middle group on a chat; see `toolsSlot`. */
export const CHAT_TOOLS_SLOT='waka-chat-tools';

/* ═══ ONE PHOTO OR FILE ON ITS WAY INTO A MESSAGE ═════════════════════════
   A chip above the field. `file` is set while this tab holds the bytes (an
   upload in flight, or one it uploaded) so the chip can draw a photo without
   a round trip; a chip restored from a saved draft has only its id and asks
   the server for a short-lived look. Soft rather than bordered — a low fill
   and a round corner, the founder's 몽글몽글 — because a row of boxed chips
   above a bordered field is three edges stacked. */
function Chip({type,name,size,file,attachmentId,state,locale,onRemove,onRetry}:{type:'image'|'file';name:string;size:number|null;file?:File;attachmentId?:string;
  state:'ready'|'uploading'|'failed';locale:SupportedLocale;onRemove:()=>void;onRetry?:()=>void}){
  const [url,setUrl]=useState('');
  useEffect(()=>{
    if(type!=='image')return;
    if(file){if(typeof URL.createObjectURL!=='function')return;const value=URL.createObjectURL(file);setUrl(value);return()=>URL.revokeObjectURL(value);}
    if(!attachmentId)return;const stop=new AbortController();
    fetchAttachmentUrl(attachmentId,stop.signal).then(setUrl,()=>undefined);return()=>stop.abort();
  },[type,file,attachmentId]);
  const say=(key:MessageKey)=>t(locale,key);
  return <li className={state==='uploading'?'chat-chip chat-chip--uploading':state==='failed'?'chat-chip chat-chip--failed':'chat-chip chat-chip--ready'} title={name}>
    {type==='image'?(url?<img className="chat-chip-thumb" src={url} alt={name}/>:<span className="chat-chip-thumb" aria-hidden="true"><HomeActionIcon kind="photo"/></span>)
      :<span className="chat-chip-file"><HomeActionIcon kind="file"/><span className="chat-chip-name">{name}</span>{size?<span className="chat-chip-size">{fileSizeWords(size)}</span>:null}</span>}
    {state==='uploading'?<span className="chat-chip-state" role="status">{say('worldComposerUploading')}</span>
      :state==='failed'?<span className="chat-chip-state" role="alert">{say('worldAttachFailed')}</span>:null}
    {state==='failed'&&onRetry?<button type="button" className="chat-chip-act" aria-label={formatMessage(locale,'worldComposerRetryFile',{name})} onClick={onRetry}>↻</button>:null}
    <button type="button" className="chat-chip-act" aria-label={formatMessage(locale,'worldComposerRemoveFile',{name})} onClick={onRemove}>×</button>
  </li>;
}
/** An upload this tab started and has not finished, or that failed. No
    `name` when the file had none — the chip says "Photo" or "File", the
    server is told nothing (`attachmentLabel`). */
interface Upload{key:string;file:File;type:'image'|'file';contentType:string;name?:string;failed:boolean}
/* WHAT A PICK BECOMES, OR WHY IT WAS REFUSED. "Add photos" is sniffed;
   "Add file" is read against the server's list — and a photo that arrives
   by "Add file" is a photo, so it is sniffed too and sent as one. Each
   refusal is a key, said in the reader's language on the status line. */
async function checkPick(file:File,door:'photo'|'file'):Promise<{file:File;type:'image'|'file';contentType:string}>{
  if(door==='file'){const verdict=inspectAttachmentFile(file);if(verdict.kind==='file')return {file:verdict.file,type:'file',contentType:verdict.contentType};}
  const photo=await inspectInspirationPhoto(file);return {file:photo,type:'image',contentType:photo.type};
}
/** The browser's own word that there is no network — the one case where a
    failed request is known not to have left this device. */
const offlineNow=()=>typeof navigator!=='undefined'&&navigator.onLine===false;
const refusalOf=(reason:unknown):MessageKey=>reason instanceof PhotoRefused?reason.reason
  :reason instanceof FileRefused?(reason.reason==='too_large'?'worldAttachTooLarge':reason.reason==='empty'?'worldPhotoEmpty':'worldAttachUnsupported'):'worldAttachFailed';

export function ConversationPanel({scope,id,initialPrincipleId,initialConversation,locale,onChoose,onCreated,agent=null,toolsSlot}:{scope:ProfileStorageScope;id:string|null;initialPrincipleId?:string;initialConversation?:ApiConversation;locale:SupportedLocale;onChoose:(id:string|null)=>void;onCreated?:(row:ApiConversation)=>void;
  /** The account's agent, when it has one: a new chat may talk with it, or with both. */
  agent?:{id:string;name:string}|null;
  /** The id of an element the page's bar lends for the mic and the ＋ (`CHAT_TOOLS_SLOT`).
      Absent, both stay in this panel's own footer, as a panel standing alone has them. */
  toolsSlot?:string}){
  /* ═══ WHO YOU ARE TALKING WITH ═══════════════════════════════════════
     Founder, 2026-10-15: "new chat should also let you select if you want
     to chat with me vs my agent or both perspectives." Chosen before the
     first message and fixed after it — the chat is still yours and sits in
     your one list; what changes is the memory the reply stands on. */
  const [talkWith,setTalkWith]=useState<'mine'|'agent'|'both'>('mine');
  /* One object per agent, so the creature is not re-drawn on every keystroke. */
  const agentForm=useMemo(()=>agent?agentBeing(agent.id):null,[agent?.id]);
  const journal=id??`new:${initialPrincipleId??'general'}`;
  const initial=initialConversation?.id===id&&initialConversation.profileId===scope.profileId?initialConversation:null;
  const bootstrap=useRef(initial);
  const [conversation,setConversation]=useState<ApiConversation|null>(initial),[draft,setDraft]=useState<Draft|null>(null);
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(!initial),[error,setError]=useState<string|null>(null),[storageFailed,setStorageFailed]=useState(false);
  /* True when the notice is about words that never left this device — the
     notice's own button then sends them again rather than re-reading. */
  const [unsent,setUnsent]=useState(false);
  const [mobile,setMobile]=useState(()=>window.matchMedia?.('(max-width:760px)').matches??false);
  const [earlierBusy,setEarlierBusy]=useState(false),[earlierFailed,setEarlierFailed]=useState(false);
  const prependScroll=useRef<{height:number;top:number}|null>(null);
  const [focusPrinciple,setFocusPrinciple]=useState<ApiPrinciple|null>(null),[focusFailed,setFocusFailed]=useState(false);
  const lifecycle=useRef(new AbortController()),draftRef=useRef<Draft|null>(null),working=useRef(false);
  const conversationRef=useRef<ApiConversation|null>(initial),writer=useRef(crypto.randomUUID()),receipt=useRef<StoredConversationDraft>();
  const [generationEnabled,setGenerationEnabled]=useState<boolean|null>(initial?.generationEnabled??null);
  const generationRef=useRef(generationEnabled);generationRef.current=generationEnabled;
  const root=useRef<HTMLElement>(null),body=useRef<HTMLDivElement>(null),editor=useRef<HTMLTextAreaElement>(null),nearBottom=useRef(true);
  const restoredScroll=useRef<{top:number;nearBottom:boolean;messageWindowStart?:number}|null>(null),scrollKey=profileStorageKey(scope,`conversationScroll:${journal}`)!;
  const say=(key:Parameters<typeof t>[1])=>t(locale,key);
  /* ═══ PHOTOS AND FILES ON THE WAY IN (2026-10-16) ══════════════════════
     Founder: "＋ menu rows: 'Add photos' and 'Add file' … upload
     immediately … show them as CHIPS above the text field". Uploaded ones
     live in the draft (`attachments`, written to storage with it); ones in
     flight or failed live here, because their bytes cannot be written down.
     `localFiles` remembers the bytes of what this tab uploaded, so its own
     chips draw at once instead of asking the server for a look. */
  const [uploads,setUploads]=useState<Upload[]>([]),uploadsRef=useRef<Upload[]>([]);
  const localFiles=useRef(new Map<string,File>());
  /* ONE STOP PER UPLOAD, so × on a chip still uploading can call off that
     request and no other — but only while it is still presigning
     (`uploadMessageAttachment`): past that the bytes or the row may already
     exist, so the upload finishes and what it made is discarded. Keyed by
     the chip's local key. */
  const uploadStops=useRef(new Map<string,AbortController>());
  const [attachNote,setAttachNote]=useState<MessageKey|null>(null);
  const track=(next:(rows:Upload[])=>Upload[])=>{uploadsRef.current=next(uploadsRef.current);setUploads(uploadsRef.current);};
  /* THE BAR'S SLOT IS FOUND AFTER PAINT, as `NoteTools` finds its own: `Home`
     mounts it in the same commit this first renders in, and two siblings'
     effects are not an order to rely on. */
  const [toolsHost,setToolsHost]=useState<HTMLElement|null>(null);
  useEffect(()=>{if(toolsSlot)setToolsHost(document.getElementById(toolsSlot));});
  useEffect(()=>{const media=window.matchMedia?.('(max-width:760px)');if(!media)return;const change=()=>setMobile(media.matches);media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
  /* ═══ THE PAGE FOLLOWS THE KEYBOARD ON iOS (audit f2afcbe2, mob) ══════════
     The two variables below place a STANDALONE `.chat-page` in the visual
     viewport. Inside the world it is not standalone: `.waka-over--talk
     .chat-page` is `position: static` (home.css) and the fixed box is the
     enclosing `.waka-page`, sized to the LAYOUT viewport — which iOS does
     not shrink for its keyboard. So the composer sat under the keyboard.
     While a keyboard is up (the visual viewport is a keyboard's height
     shorter than the layout one) the page itself is pinned to the visual
     viewport, and `data-keyboard` drops the dock's reserve, since the dock
     is under the keyboard too. Android resizes the layout viewport with its
     keyboard and desktop has none, so for both the difference is ~0 and
     nothing is written. */
  useLayoutEffect(()=>{const viewport=window.visualViewport,node=root.current;if(!viewport||!node)return;
    const page=node.parentElement?.closest<HTMLElement>('.waka-page')??null;
    /* A KEYBOARD, NOT A PINCH. Pinch-zoom shrinks the visual viewport too, and
       pinning the page to a zoomed viewport would fight the zoom (review). A
       keyboard leaves `scale` at 1 and has a field in focus to type into. */
    const keyboardUp=()=>{const active=document.activeElement;
      return Math.abs((viewport.scale??1)-1)<0.01&&window.innerHeight-viewport.height>120&&
        active instanceof HTMLElement&&(active.isContentEditable||/^(TEXTAREA|INPUT|SELECT)$/.test(active.tagName));};
    const release=()=>{if(!page)return;page.style.removeProperty('top');page.style.removeProperty('height');page.style.removeProperty('bottom');delete page.dataset.keyboard;};
    const update=()=>{if(!Number.isFinite(viewport.height)||viewport.height<=0||!Number.isFinite(viewport.offsetTop))return;node.style.setProperty('--chat-height',`${viewport.height}px`);node.style.setProperty('--chat-top',`${viewport.offsetTop}px`);
      if(page){if(keyboardUp()){page.style.top=`${viewport.offsetTop}px`;page.style.height=`${viewport.height}px`;page.style.bottom='auto';page.dataset.keyboard='1';}else release();}
      if(nearBottom.current&&body.current)body.current.scrollTop=body.current.scrollHeight;};
    update();viewport.addEventListener('resize',update);viewport.addEventListener('scroll',update);return()=>{viewport.removeEventListener('resize',update);viewport.removeEventListener('scroll',update);release();};},[]);
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
    /* THE ID IS THE MESSAGE. Ids are chosen here, and the server refuses (409)
       a second write under one id with different words, so a message under
       the pending id IS this send — whatever form the server kept its words
       in. (Comparing words too meant keeping a copy of the server's rule
       for blank ones here, and a photo sent with only spaces read as unsent
       forever the day the copy drifted.) */
    const pending=draftRef.current;
    if(pending?.pending&&next.messages.some(message=>message.id===pending.id)){
      try{if(receipt.current)clearConversationDraft(receipt.current);}catch{setStorageFailed(true);}
      receipt.current=undefined;draftRef.current=null;setDraft(null);setError(null);
      if(!id){onCreated?.(next);onChoose(next.id);}
    }
  };
  const reply=useConversationReply(scope.profileId,id,Boolean(conversation?.generationEnabled),conversation?.revision??0,observe,conversation?.messageWindowStart);
  const replyPending=reply.state?.phase==='pending'||reply.state?.phase==='running';
  const latestMessage=conversation?.messages.at(-1);
  /* ═══ THE MESSAGE STILL IN FLIGHT IS PART OF THE TRANSCRIPT ══════════
     Named here, beside `latestMessage`, because the two are read together:
     the run arithmetic below asks what the last confirmed turn was AND
     whether something of yours is sitting under it. It was previously asked
     inline at the one place it was rendered, which is how it came to be
     outside the arithmetic that needed it (see the grouping note below).

     `pending` AND not already in `messages`, in that order: between the save
     landing and `observe` clearing the draft there is a frame where both are
     true, and rendering both would print your sentence twice. */
  const sending=draft?.pending&&!conversation?.messages.some(message=>message.id===draft.id)?draft:null;
  const replyUnconfirmed=Boolean(generationEnabled&&latestMessage?.role==='user'&&(!reply.state||reply.error));
  const awaitingReply=replyPending||replyUnconfirmed;
  // The send guards as they stand now, for code that resumes after an await.
  const guards=useRef({loading,awaitingReply,storageFailed,focusFailed,conversation});guards.current={loading,awaitingReply,storageFailed,focusFailed,conversation};
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
  /* A FAILED LIST READ IS SAID WHEN NOTHING ELSE CAN SAY WHETHER REPLIES ARE
     ON (review): left silent, `generationEnabled` stayed null and Send stayed
     "loading" with no way on. A conversation read that lands sets it and
     clears this; otherwise the notice offers Try again. */
  /* ...and never over a more specific sentence, nor once the conversation has
     loaded since (its own read answers the question): `setError` is given a
     function that keeps any error already standing. */
  const loadHistory=(owner=lifecycle.current)=>{void refreshList(owner).catch(()=>{if(mine(owner)&&generationRef.current===null&&!conversationRef.current)setError(current=>current??say('worldConversationUnreachable'));});};
  const refresh=async()=>{
    const owner=lifecycle.current;
    setLoading(true);setError(null);setUnsent(false);
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
    }catch{
      /* SAY WHICH THING COULD NOT BE REACHED (audit f2afcbe2, desk/93). A
         new chat has nothing to open, so "This conversation couldn't be
         opened" over an empty page was false: only the server was out of
         reach. A journalled (pending) message is NOT CONFIRMED rather than
         "not sent", offline or not: the browser's offline flag says nothing
         about whether an earlier request reached the server before the
         connection went (review). Retry sends it again under the same id. */
      const target=id??(draftRef.current?.pending?draftRef.current.conversationId:null);
      if(mine(owner))setError(say(draftRef.current?.pending?(offlineNow()?'worldConversationNotConfirmed':'worldConversationSaveFailed'):target?'worldConversationReadFailed':'worldConversationUnreachable'));}
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
    try{const saved=readConversationDrafts(scope,journal);if(saved[0]){receipt.current=saved[0];draftRef.current=saved[0].value;setDraft(saved[0].value);if(saved[0].value.talkWith)setTalkWith(saved[0].value.talkWith);}}catch{setStorageFailed(true);}
    try{const saved=JSON.parse(sessionStorage.getItem(scrollKey)??'null');if(saved&&Number.isFinite(saved.top)&&saved.top>=0&&typeof saved.nearBottom==='boolean'&&(saved.messageWindowStart===undefined||Number.isSafeInteger(saved.messageWindowStart)&&saved.messageWindowStart>=1&&saved.messageWindowStart<=200))restoredScroll.current={...saved,messageWindowStart:saved.messageWindowStart??1};}catch{/* Scrolling is recoverable without a stored position. */}
    void refresh();return()=>lifecycle.current.abort();
  },[scope.accountId,scope.profileId,id,initialPrincipleId]);
  const save=async()=>{
    if(working.current||loading||(generationEnabled===null&&!error)||awaitingReply||!draftRef.current?.content.trim()&&!draftRef.current?.attachments?.length||uploadsRef.current.length||storageFailed||focusFailed||id&&!conversation)return;
    /* A draft kept before its agent was recorded waits for the agent to load,
       rather than starting a chat on your own memory instead. */
    if(!id&&draftRef.current.talkWith&&!draftRef.current.agentId&&!agent)return;
    /* REPLIES UNKNOWN BECAUSE THE SERVER WAS UNREACHABLE: ask again first.
       Send used to be dead here — disabled as "loading" forever after a
       failed first read — so words typed offline could not be sent even
       once the network was back. If the server still cannot be reached, the
       words never left: the draft is NOT marked pending, so it stays
       editable, and the notice says it was not sent and offers to retry. */
    let replies=generationEnabled;
    const pressed=draftRef.current;
    if(replies===null){
      const owner=lifecycle.current;working.current=true;setBusy(true);
      try{const listed=await run(signal=>listConversations(scope.profileId,signal));if(!mine(owner))return;replies=listed.generationEnabled;setGenerationEnabled(replies);setError(null);setUnsent(false);}
      /* A JOURNALLED message is never "not sent" on a failed pre-flight
         (review): an earlier send under its id may have reached the server.
         Only words that were never sent at all are "not sent". */
      catch{if(mine(owner)){const held=Boolean(draftRef.current?.pending);setError(say(held?'worldConversationNotConfirmed':'worldConversationNotSent'));setUnsent(!held);}return;}
      finally{working.current=false;if(mine(owner))setBusy(false);}
      /* EVERY SEND GUARD AGAIN, AFTER THE AWAIT (review): the list read takes
         time, and in it the words may have been cleared or changed, an upload
         begun, a reply started, a reload begun. The press was for the draft
         as it stood; anything else is not what the person sent. State read
         through `guards`, not this render's stale closure. */
      const g=guards.current,now=draftRef.current;
      if(now!==pressed||!now||!now.content.trim()&&!now.attachments?.length||uploadsRef.current.length||working.current||
        g.loading||g.awaitingReply||g.storageFailed||g.focusFailed||(id&&!g.conversation))return;
    }
    if(!draftRef.current)return;
    const current=draftRef.current,intent:Draft={...current,revision:conversation?.revision??0,pending:true,updatedAt:Date.now(),...(!id?{conversationId:current.conversationId??crypto.randomUUID(),...(current.talkWith?{}:agent&&talkWith!=='mine'?{talkWith,agentId:agent.id}:{})}:{})};
    if(!keep(intent))return;const owner=lifecycle.current;working.current=true;setBusy(true);setError(null);nearBottom.current=true;
    try{
      /* The agent the draft was started with; a draft kept before that was recorded falls back to the one shown. */
      const talkAgent=intent.agentId??agent?.id;
      /* THE IDS OF WHAT IS ON THE CHIPS, and only those: the server links
         them to this message in the same write and drops anything else it
         staged under this id. */
      const attachmentIds=intent.attachments?.length?{attachmentIds:intent.attachments.map(item=>item.id)}:{};
      const next=id?await run(signal=>{const input={id:intent.id,content:intent.content,revision:intent.revision,...(replies?{requestReply:true}:{}),...attachmentIds},from=conversationRef.current?.messageWindowStart;
        return from!==undefined?saveConversationMessage(scope.profileId,id,input,signal,from):saveConversationMessage(scope.profileId,id,input,signal);})
        :await run(signal=>createConversation(scope.profileId,intent.conversationId!,signal,initialPrincipleId,{id:intent.id,content:intent.content,requestReply:replies===true,...attachmentIds},intent.talkWith&&talkAgent?{perspective:intent.talkWith,agentId:talkAgent}:undefined));
      if(mine(owner)){observe(next);setError(null);setUnsent(false);setAttachNote(null);if(id)reply.check();}
    }catch(reason){
      if(!mine(owner))return;
      /* ═══ A PHOTO THAT IS NO LONGER THERE ════════════════════════════
         A draft can outlive what it carries: the daily sweep takes a staged
         upload after seven days, and another tab's × takes one at once. The
         server then refuses the whole send (409 `attachment_not_ready`), and
         a draft left pending would be refused on every retry with its field
         and ＋ shut — words you can see and cannot send or change. So the
         send is called off, not retried: the chips the server named go (all
         of them if it named none), the words stay, and one plain line says
         what to do. The rest are still staged under this message's id, so
         the next Send links them. */
      const current=draftRef.current;
      if(reason instanceof ApiError&&reason.status===409&&reason.code==='attachment_not_ready'&&current?.pending&&current.id===intent.id){
        const gone=new Set(reason.missingAttachmentIds?.length?reason.missingAttachmentIds:(current.attachments??[]).map(item=>item.id));
        const left=(current.attachments??[]).filter(item=>!gone.has(item.id));
        const back:Draft={...current,pending:false,updatedAt:Date.now()};
        if(left.length)back.attachments=left;else delete back.attachments;
        keep(back);
        setError(null);setAttachNote('worldAttachGone');
        return;
      }
      /* NOT CONFIRMED, NOT "NOT SENT": the request may have reached the server
         before the connection dropped, so only the server can say. Retry (and
         the send control, now "Retry this message") sends the same message
         under the same id, which the server dedupes. */
      setError(say(offlineNow()?'worldConversationNotConfirmed':'worldConversationSaveFailed'));
    }
    finally{working.current=false;if(mine(owner))setBusy(false);}
  };
  /* THE MESSAGE'S ID IS KEPT WHILE IT CARRIES ANYTHING. Photos and files are
     staged on the server under the id this message WILL be sent with, so a
     draft read back from another tab or a reload — which `edit` would
     otherwise fork under a fresh id — keeps its id, its chat id and its
     attachments, and this tab becomes its writer. Without any, the fork is
     as before: two tabs' words never overwrite each other. */
  const edit=(content:string)=>{const current=draftRef.current,carry=Boolean(current&&(current.writer===writer.current||current.attachments?.length));
    keep({id:carry?current!.id:crypto.randomUUID(),writer:writer.current,updatedAt:Date.now(),content,revision:conversation?.revision??0,pending:false,
      ...(carry&&current!.conversationId?{conversationId:current!.conversationId}:{}),...(carry&&current!.attachments?.length?{attachments:current!.attachments}:{})});};
  /* A MESSAGE TO STAGE ONTO, made before the first chip if nothing is typed
     yet. A new chat's id is chosen here rather than at Send — the server
     stages a photo for a conversation that does not exist yet, and the
     create links it, so the two must name the same id. `save` already reuses
     `conversationId` when the draft has one. */
  const draftForAttaching=():Draft|null=>{
    const current=draftRef.current;if(current?.pending)return null;
    const carry=Boolean(current&&(current.writer===writer.current||current.attachments?.length));
    const next:Draft=carry?{...current!,writer:writer.current}:{id:crypto.randomUUID(),writer:writer.current,updatedAt:Date.now(),content:current?.content??'',revision:conversation?.revision??0,pending:false};
    if(!id&&!next.conversationId)next.conversationId=crypto.randomUUID();
    if(carry&&next.writer===current!.writer&&next.conversationId===current!.conversationId)return current;
    return keep(next)?next:null;
  };
  const wanted=(key:string)=>uploadsRef.current.some(row=>row.key===key);
  const upload=async(item:Upload)=>{
    const target=draftForAttaching(),owner=lifecycle.current;
    if(!target){track(rows=>rows.map(row=>row.key===item.key?{...row,failed:true}:row));return;}
    track(rows=>rows.map(row=>row.key===item.key?{...row,failed:false}:row));
    uploadStops.current.get(item.key)?.abort();
    const stop=new AbortController(),leave=()=>stop.abort();uploadStops.current.set(item.key,stop);
    owner.signal.addEventListener('abort',leave,{once:true});
    try{
      /* NOT THROUGH `run`: its fifteen seconds are for a JSON round trip, and
         a 25 MB photo on a phone's connection can take longer than that. The
         page's own lifetime and this chip's × still call it off while it is
         presigning; after that it finishes, and lands below. */
      const row=await uploadMessageAttachment({profile:scope.profileId,conversationId:id??target.conversationId!,messageId:target.id,file:item.file,contentType:item.contentType,type:item.type,...(item.name?{name:item.name}:{})},stop.signal);
      /* × WHILE IT WAS ON ITS WAY, OR THE PAGE LEFT — the chip is gone, so
         the row must not come back as one; it is discarded, as × would have
         discarded it, rather than left staged against this message's caps. */
      if(!mine(owner)||!wanted(item.key)){void discardMessageAttachment(row.id,{profile:scope.profileId}).catch(()=>undefined);return;}
      localFiles.current.set(row.id,item.file);
      track(rows=>rows.filter(other=>other.key!==item.key));
      const current=draftRef.current;
      /* The message moved on while this was uploading (it was sent, or
         replaced): the staged row is the server's to sweep, never ours to
         attach to a different message. */
      if(!current||current.id!==target.id||current.pending)return;
      const attached:ConversationDraftAttachment={id:row.id,type:row.type,name:row.name,contentType:row.contentType,size:row.size};
      keep({...current,updatedAt:Date.now(),attachments:[...(current.attachments??[]),attached]});
    }catch{if(mine(owner)&&!stop.signal.aborted)track(rows=>rows.map(row=>row.key===item.key?{...row,failed:true}:row));}
    finally{owner.signal.removeEventListener('abort',leave);if(uploadStops.current.get(item.key)===stop)uploadStops.current.delete(item.key);}
  };
  /* × ON A CHIP STILL ON ITS WAY: off the box at once, and so out of the
     count below — a removed upload still finishing must not hold a place a
     new pick could take. Its request is called off if it has not started
     sending; otherwise it finishes and `upload` discards what it made. */
  const dropUpload=(key:string)=>{track(rows=>rows.filter(row=>row.key!==key));uploadStops.current.get(key)?.abort();uploadStops.current.delete(key);};
  /* WANTED ONES ONLY: what is on the draft and the chips still showing. */
  const attachedCount=(draft?.attachments?.length??0)+uploads.length;
  const occupied=()=>(draftRef.current?.attachments?.length??0)+uploadsRef.current.length;
  const pick=async(files:File[],door:'photo'|'file')=>{
    setAttachNote(null);
    const vacant=MAX_MESSAGE_ATTACHMENTS-occupied();
    if(files.length>vacant)setAttachNote('worldAttachLimit');
    for(const file of files.slice(0,Math.max(0,vacant))){
      try{const checked=await checkPick(file,door);
        /* SIX COUNTED AGAIN AT THE MOMENT OF ADDING. `vacant` was counted
           before the sniffing awaited, and a second pick made meanwhile has
           counted the same empty places; the one that arrives second finds
           them taken and says so. */
        if(occupied()>=MAX_MESSAGE_ATTACHMENTS){setAttachNote('worldAttachLimit');break;}
        const item:Upload={key:crypto.randomUUID(),file:checked.file,type:checked.type,contentType:checked.contentType,...(file.name?{name:file.name.slice(0,255)}:{}),failed:false};
        track(rows=>[...rows,item]);void upload(item);}
      catch(reason){setAttachNote(refusalOf(reason));}
    }
  };
  /* × TAKES IT OFF THIS MESSAGE, AND OFF THE SERVER. The upload is discarded
     at once (`DELETE /api/attachments/:id`); if that fails — offline, say — the
     send still deletes every staged row the message did not name, and a daily
     sweep clears week-old ones, so the chip goes either way and nothing is
     said about the miss. */
  const unattach=(attachmentId:string)=>{const current=draftRef.current;if(!current||current.pending)return;
    keep({...current,updatedAt:Date.now(),attachments:(current.attachments??[]).filter(item=>item.id!==attachmentId)});
    void discardMessageAttachment(attachmentId,{profile:scope.profileId}).catch(()=>undefined);};

  /* ═══ SPEAKING INTO THE FIELD ═════════════════════════════════════════
     The same hook the notepad uses, pointed at this draft. `use-dictation`
     carries the argument for why the microphone writes WORDS rather than a
     file; here it is simply that a chat has nowhere to put an audio blob.

     THE ANCHOR IS THE CURRENT DRAFT, read through a ref so a sentence
     spoken over one already typed joins it rather than replacing it. */
  const dictation=useDictation(()=>draftRef.current?.content??'',(text)=>edit(text),locale);
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
    : loading||generationEnabled===null&&!error ? 'worldChatLoading' as const
    : awaitingReply ? 'worldConversationThinking' as const
    : busy ? 'worldChatSending' as const
    : uploads.some(row=>!row.failed) ? 'worldComposerUploading' as const
    : uploads.length ? 'worldAttachFix' as const
    /* A PHOTO IS A MESSAGE. Founder: "photo-only messages allowed" — words
       or at least one attachment, and the server accepts '' then. */
    : !draft?.content.trim()&&!draft?.attachments?.length ? 'worldConversationNeedsWords' as const
    : null;
  const replyNotice=reply.error?'worldConversationReplyCheckFailed' as const
    :reply.state?.retryAfter&&reply.state.phase!=='ready'?'worldConversationReplyLimit' as const
    :reply.state?.phase==='failed'?'worldConversationReplyFailed' as const
    :reply.state?.phase==='stopped'?'worldConversationReplyStopped' as const:null;
  /* THE MIC AND THE ＋, rendered once and placed by whoever has room for
     them: the bar's lent group when there is one, this footer when not. */
  const vacant=MAX_MESSAGE_ATTACHMENTS-attachedCount;
  const tools=(dictateClass:string,addClass:string)=><>
    {dictationAvailable()?<button type="button"
      className={`${dictateClass}${dictation.listening?' chat-dictate--on':''}`}
      aria-pressed={dictation.listening}
      aria-label={say(dictation.listening?'worldComposerDictateStop':'worldComposerDictate')}
      disabled={busy||draft?.pending}
      onClick={()=>dictation.listening?dictation.stop():dictation.start()}>
      <HomeActionIcon kind="record"/></button>:null}
    {/* SIX, AND IT SAYS SO. At the server's cap the ＋ dims and its title
        is the reason, rather than offering a menu whose every row fails. */}
    <AddMenu buttonClassName={addClass} multiple label={say('worldAddMenu')}
      photoLabel={say('worldAddPhotos')} fileLabel={say('worldAddFile')}
      disabled={!canCompose||busy||Boolean(draft?.pending)||vacant<=0||storageFailed}
      title={vacant<=0?say('worldAttachLimit'):undefined}
      onPhotos={files=>{void pick(files,'photo');}} onFiles={files=>{void pick(files,'file');}}/>
  </>;
  return <main ref={root} className="chat-page">
    {toolsSlot&&toolsHost&&canCompose?createPortal(tools('waka-dock-tool chat-dictate','waka-dock-tool'),toolsHost):null}
    {/* NO ROW ACROSS THE TOP AT ALL. `.chat-top` held "Your memory" and a
        `···` menu, and a comment arguing it was "not a second header" — which
        it was, on a product whose other screens have one bar and two corner
        buttons. The corners are the navigation here as everywhere. */}
    <section className="chat-main" aria-label={say('worldConversationTitle')}>
      {error?<div className="chat-notice" role="alert">{error} {(unsent&&!draft?.pending&&Boolean(draft?.content.trim()||draft?.attachments?.length))||(draft?.pending&&(!id||conversation))?<button type="button" disabled={busy||loading} onClick={()=>void save()}>{say('worldConversationRetry')}</button>
        /* A pending message on a conversation that could not be read cannot be
           re-sent (`save` needs the conversation), so the act offered is the
           re-read that brings it back (review): Retry only where it works. */
        :<button type="button" disabled={busy||loading} onClick={()=>void refresh()}>{say('worldRoomHistoryRetry')}</button>}
        {/* THE WAY OUT SITS BESIDE THE FAILURE. When a conversation cannot be
            opened there is no box to type in, so starting a fresh one is the
            only move left — and it used to be a button in a column down the
            side of the page. It belongs next to the sentence that says the
            conversation is gone. */}
        {id&&!conversation&&!draft?.pending?<button type="button" disabled={busy} onClick={()=>onChoose(null)}>{say('worldConversationNew')}</button>:null}</div>:null}
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
              gets out of the way.

              AND IT STAYS WHILE YOU TYPE. Founder, 2026-10-15, of the page
              going blank on the first keystroke: "till user sends first
              message, keep [it] on." Typing is not a turn yet; the opening
              leaves when the first message is actually on its way. */}
          {!conversation?.messages.length&&!draft?.pending&&!loading&&!error?
            <div className="chat-opening">
              {/* The one you are about to talk with is the one on screen:
                  yours, your agent in its own pixel form, or the two of
                  you side by side. */}
              <span className="chat-opening-beings">
                {talkWith!=='agent'?<Companion size={64}/>:null}
                {agent&&agentForm&&talkWith!=='mine'?<Companion size={talkWith==='both'?52:64} being={agentForm} cool pixel label={agent.name}/>:null}
              </span>
              <p>{say(talkWith==='agent'?'worldConversationOpeningAgent':talkWith==='both'?'worldConversationOpeningBoth':'worldConversationOpening')}</p>
              {agent&&!id&&!initialPrincipleId?(
                <div className="chat-with" role="group" aria-label={say('worldChatWithLabel')}>
                  {(['mine','agent','both'] as const).map(choice=>(
                    <button key={choice} type="button" aria-pressed={talkWith===choice}
                      className={`chat-with-choice${talkWith===choice?' chat-with-choice--on':''}`}
                      onClick={()=>setTalkWith(choice)}>
                      {say(choice==='mine'?'worldChatWithMe':choice==='agent'?'worldChatWithAgent':'worldChatWithBoth')}
                    </button>
                  ))}
                </div>
              ):null}
            </div>:null}
          {/* AND ONCE IT HAS STARTED, A CHAT THAT IS NOT ONLY YOURS SAYS SO,
              in one quiet line, so an answer from the agent's memory is
              never read as one from yours. */}
          {conversation?.messages.length&&conversation.perspective&&conversation.perspective!=='mine'?
            <p className="chat-with-note">{say(conversation.perspective==='agent'?'worldChatWithAgentNote':'worldChatWithBothNote')}</p>:null}
          {/* ═══ THE TRANSCRIPT, ON THE REFERENCE'S MESSAGE ANATOMY ═════
              Founder: "make the chat message list and the chat message
              thing also follow what you see on this AI chat conversation."

              `role="log"` RATHER THAN A BARE LIST. The reference library's
              message-list component is documented as providing 'role="log" with
              aria-live="polite"', and log is the right role for a
              transcript: it tells a screen reader this is a running record
              where new entries arrive at the end, which `aria-live` alone
              on an `<ol>` does not.

              FILLED FOR YOU, GHOST FOR WAKA — the reference's two bubble
              variants, and this surface had already reasoned its way to
              half of it. The old note here is worth keeping because it
              explains why the asymmetry is not decoration: "a container
              implies an utterance and cannot hold a document". Your turns
              are utterances, so they get the container; a reply can run to
              paragraphs, lists and code, so it gets 'ghost' — transparent,
              keeping the alignment padding, exactly as named.

              AND GROUPING, which is the part that was missing entirely.
              Consecutive turns from one speaker tighten their facing
              corners so a run reads as one person continuing rather than
              as two separate sayings. */}
          <div className="chat-messages" role="log" aria-label={say('worldConversationMessages')} aria-live="polite" aria-relevant="additions">
            {(conversation?.messages??[]).map((message,at,all)=>{
              /* AND THE ONE BEING SENT IS A NEIGHBOUR LIKE ANY OTHER. The
                 draft used to be rendered after this `map` with a fixed
                 `data-run="fl"`, which made a question you had just pressed
                 Send on into a run of its own: a confirmed question with
                 `after === undefined` claimed to be the end of a run, the
                 draft claimed to be the start AND end of another, and two
                 of your own consecutive bubbles printed two metadata rows
                 with a loosened corner between them — against the rule this
                 file quotes and obeys everywhere else. A reviewer's probe,
                 2026-10-11: `got ["user:fl","user:fl"], want ["user:fm",
                 "user:ml"]`. Reachable with replies unconnected, or after a
                 reply is stopped, because Send re-enables with a user
                 message last.

                 Standing it in as `after` rather than appending it to `all`
                 is deliberate: an unconfirmed draft in the array that the
                 keys, the metadata and the window arithmetic all read would
                 be a second kind of message for every one of them to know
                 about. One neighbour test is the whole of what it changes. */
              const before=all[at-1],after=all[at+1]??(sending?{role:'user' as const}:undefined);
              const run=`${before?.role===message.role?'m':'f'}${after?.role===message.role?'m':'l'}`;
              return <article key={message.id} className="chat-message" data-role={message.role} data-run={run}>
                <p className="chat-said">{say(message.role==='user'?'worldConversationYou':'worldConversationWaka')}</p>
                {message.content||message.followUpQuestion?<div className="chat-bubble">
                  <ConversationText text={message.content}/>{message.followUpQuestion?<ConversationText text={message.followUpQuestion}/>:null}
                </div>:null}
                {/* WHAT WAS SENT WITH IT, under the words. A photo-only turn
                    is these alone; a reply never has any. */}
                <MessageAttachments attachments={message.attachments??[]} locale={locale}/>
                {/* ═══ THE METADATA ROW, ON THE LAST BUBBLE OF A RUN ══════
                    The reference's rule, verbatim: "put metadata in the
                    last ChatMessageBubble metadata slot when the message
                    uses bubbles" and "do not put the same metadata on both
                    a bubble and its enclosing message." A timestamp under
                    every bubble in a run is the repetition the speaker
                    label was already removed for. */}
                {run.endsWith('l')&&message.createdAt?<p className="chat-meta">{timeOf(Date.parse(message.createdAt),locale)}</p>:null}
              </article>;
            })}
            {/* AND IT IS THE END OF THE RUN, WHICH END BEING THE WHOLE
                QUESTION. It is the last thing on screen, so it takes the
                `l` and the confirmed message above it loses one; and the
                metadata row it keeps is the live status rather than a
                timestamp, which is the one of the two a person waiting on a
                send actually needs. The timestamp is not lost — it returns
                on the confirmed bubble the moment the save lands and this
                row stops being rendered. */}
            {sending?
              <article className="chat-message chat-sending" data-role="user" data-run={`${latestMessage?.role==='user'?'m':'f'}l`}>
                <p className="chat-said">{say('worldConversationYou')}</p>
                {sending.content?<div className="chat-bubble"><ConversationText text={sending.content}/></div>:null}
                {/* What it carries, drawn the way it will be once it lands. */}
                <MessageAttachments locale={locale} attachments={(sending.attachments??[]).map(item=>({...item,conversationId:id??sending.conversationId??'',messageId:sending.id,staged:true,createdAt:new Date(sending.updatedAt).toISOString()}))}/>
                <p className="chat-meta" role="status">{say(busy?'worldChatSending':'worldReviewPending')}</p>
              </article>:null}
          </div>
          {/* THE ONE OTHER CONTROL ON THE SURFACE, AND IT IS HERE RATHER THAN
              IN THE FOOTER ON PURPOSE: it interrupts this sentence, so it
              stands beside this sentence. The status text keeps the live
              region to itself — a button inside one gets re-announced every
              time the phase changes. */}
          {/* STOP LEFT THIS LINE FOR THE SEND BUTTON. It was here on the
              argument that it "interrupts this sentence, so it stands
              beside this sentence" — which is true and is outweighed by
              where a hand already is. The reference puts send and stop on
              one control in the composer, and a person who wants to
              interrupt a reply is looking at the place they asked for it,
              not at a status line halfway up a scrolling transcript. What
              is left is the status, which keeps the live region to itself
              — a button inside one gets re-announced on every phase. */}
          {awaitingReply&&!reply.error?<div className="chat-thinking"><span className="chat-thinking-dots" aria-hidden="true"><i/><i/><i/></span>
            <span role="status">{say(reply.waiting?'worldConversationReplyWaiting':'worldConversationThinking')}</span></div>:null}
        </div>
      </div>
      {canCompose?<footer className="chat-composer">
        {/* ═══ THE COMPOSER, ON THE ANATOMY THE REFERENCE SPELLS OUT ══════
            Founder, with a screenshot of the old one: "this is really ugly.
            So can you research some actual components that are used to
            design chat experiences? ... don't necessarily just use this
            code by code, but reference this and modify to match our own
            thing."

            The reference library publishes `ChatComposer` as five named parts, and
            the naming is the useful bit rather than the styling:

              FRAME — groups the body with a status message ABOVE or BELOW
              it. Not inside. That is the fix for the thing this surface got
              wrong twice: a notice that lives in the body moves the field
              when it appears.

              BODY — "rounded, elevated surface containing the header,
              input, and footer". One object, not a row of three.

              INPUT, then FOOTER — "row for caller-supplied footer and send
              actions plus the primary action". The send control belongs
              UNDER the text, not beside it, which is what lets the field
              grow to several lines without the button sliding down with it.

              SEND OR STOP — one control, "circular icon-only", toggling on
              streaming state.

            WHAT WE DO DIFFERENTLY, deliberately. The reference's default is
            `elevation="low"` — a raised surface — and it documents
            `elevation="none"` as "flat, with a text-input-style border and
            focus ring". We take the flat one: this product has exactly one
            floating object per screen and it is the dock, directly beneath
            this. Two raised pills stacked is the "double layer is so weird"
            the founder reported, and the reference happens to ship the
            variant that avoids it. */}
        {generationEnabled&&replyNotice?<p className="chat-reply-status" role="status">{say(replyNotice)}</p>:null}
        {/* AND WHEN REPLIES ARE NOT CONNECTED AT ALL, THE SURFACE SAYS SO.
            Every notice above is gated behind `generationEnabled`, correctly
            — but that left the one case where nothing will ever come back as
            the only case the composer was silent about. A person typed, sent,
            and waited on a surface whose whole argument is that you type and
            it answers. Found in a browser, not in the code: an agent probing
            the run grouping could send twice in a row precisely because this
            machine has replies switched off, and the panel never mentioned it.

            A STATUS, NOT A REFUSAL. It deliberately does NOT go through
            `whyNoSend`, which both titles and DISABLES the send button:
            sending still works here and must (the save path permits it and
            passes `requestReply:false`), so the message is kept. Saying "your
            messages are still saved" is the whole point — the words are not
            lost, they just will not be answered yet. */}
        {/* `=== false`, NOT falsy: `null` means the server could not be
            asked, and then "your messages are still saved" was a promise
            about messages that had not been sent (audit f2afcbe2). */}
        {generationEnabled===false?<p className="chat-reply-status" role="status">{say('worldConversationRepliesUnavailable')}</p>:null}
        {storageFailed?<p className="chat-reply-status" role="alert">{say('worldConversationDraftFailed')}</p>:null}
        {full?<p className="chat-reply-status">{say('worldConversationFull')}</p>:null}
        {/* WHY A PICK WAS NOT ADDED, in the line the box already speaks in —
            a photo that is not one, a file over the cap or off the list, a
            seventh. Cleared by the next pick. */}
        {attachNote?<p className="chat-reply-status" role="status">{say(attachNote)}</p>:null}
        <div className="chat-composer-body">
          {/* ═══ THE CHIPS, ABOVE THE FIELD ════════════════════════════════
              What this message will carry, before it is sent: a photo as a
              small picture, a file as its glyph, name and size, each with an
              ×. Uploading and "Couldn’t add this" are said on the chip they
              are about, and a failed one offers its retry beside its ×. */}
          {draft?.attachments?.length||uploads.length?<ul className="chat-chips" aria-label={say('worldAttachList')}>
            {(draft?.attachments??[]).map(item=><Chip key={item.id} type={item.type} name={attachmentLabel(locale,item.type,item.name)} size={item.size}
              file={localFiles.current.get(item.id)} attachmentId={item.id} state="ready" locale={locale} onRemove={()=>unattach(item.id)}/>)}
            {uploads.map(item=><Chip key={item.key} type={item.type} name={attachmentLabel(locale,item.type,item.name)} size={item.file.size} file={item.file} state={item.failed?'failed':'uploading'} locale={locale}
              onRemove={()=>dropUpload(item.key)} onRetry={()=>void upload(item)}/>)}
          </ul>:null}
          <label className="chat-input-label"><span>{say('worldConversationMessage')}</span><textarea ref={editor} autoFocus={!mobile} maxLength={4000} rows={1} aria-label={say('worldConversationMessage')} placeholder={say('worldConversationFirst')} value={draft?.content??''} disabled={busy||draft?.pending} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.altKey&&(!mobile||event.metaKey||event.ctrlKey)&&!event.nativeEvent.isComposing&&event.nativeEvent.keyCode!==229&&!event.repeat){event.preventDefault();void save();}}} onChange={event=>edit(event.target.value)}/></label>
          <div className="chat-composer-footer">
            {/* ═══ THE SEND ACTIONS, AND DICTATION IS ONE OF THEM ═══════
                The reference is explicit about where a microphone goes:
                "place the dictation button in the sendActions slot of
                ChatComposer so it sits next to the send button where users
                expect voice input controls." That is a correction to what
                this product did an hour ago — the notepad's mic went into
                the dock, which is right THERE because the dock is that
                page's footer, and wrong here because this page has a
                footer of its own.

                "The button hides itself by default when the browser lacks
                SpeechRecognition, but you should still design the composer
                to work without it." Both halves are obeyed: absent where
                it cannot work, and the field is typed into either way. */}
            {/* ═══ AND SINCE 2026-10-16 THEY MAY STAND IN THE BAR INSTEAD ════
                Founder: "The dictate button and ＋ move OUT of the chat box
                INTO the bar's middle group (the box keeps the text field and
                Send)." The reference's advice above is about a composer that
                is the page's only footer; on the home page the bar is that
                footer, as it is on a note, and a note's mic is in the bar. So
                when `Home` lends a slot the two go there, and a panel
                standing alone keeps them here. */}
            {toolsSlot?null:tools('chat-dictate','chat-add')}
            {/* ONE CONTROL FOR THE TRANSPORT. Stop used to sit beside the
                "thinking" line halfway up the page, which is the reference's
                own anti-pattern — the thing you press to interrupt a reply
                should be where the thing you press to ask for one is. And
                `isDisabled` deliberately does not apply to the stop state:
                a stop you cannot press is a conversation you cannot leave. */}
            {replyPending
              ?<button type="button" className="chat-send chat-send--stop" aria-label={say('worldConversationStop')}
                 disabled={reply.busy} onClick={()=>void reply.stop()}><HomeActionIcon kind="stop"/></button>
              :<button type="button" className="chat-send"
                 /* ═══ THE SAME CONTROL RETRIES AN UNCERTAIN SAVE ═══════
                    A message whose response was lost is still in the box
                    and still unsent as far as anybody can tell, so the
                    thing you press to send it is the thing you press to
                    try again — this is one act in two states, not two
                    acts. It was carrying this name before the button
                    became a glyph and the name went with the words; a
                    screen reader hearing "Send" for a message already on
                    screen would be told the wrong thing about what is
                    about to happen. */
                 aria-label={say(draft?.pending?'worldConversationRetry':'worldConversationSend')}
                 title={say(whyNoSend??(draft?.pending?'worldConversationRetry':'worldConversationSend'))}
                 disabled={Boolean(whyNoSend)}
                 onClick={()=>void save()}><HomeActionIcon kind="send"/></button>}
          </div>
        </div>
        {/* A SAVE THAT WAS NOT CONFIRMED KEEPS ITS ONE WAY OUT. This reads
            the conversation back rather than writing again, which is why it
            survived the sweep of retry-shaped controls: it is the only way to
            learn whether words you can still see on screen actually landed. */}
        {draft?.pending?<button type="button" className="chat-recheck" disabled={busy||loading} onClick={()=>void refresh()}>{say('worldConversationCheck')}</button>:null}
      </footer>:null}
    </section>
    {/* ═══ THE SIDE PANEL IS GONE, AND SO IS PINNING ══════════════════
        Founder, having used it: "actually for now, let's get rid of the
        side part and referencing inspiration. I'm sorry. Let's get rid of
        it. It's too complicated right now."

        WHAT IT WAS. A drawer beside the transcript for picking one saved
        keep, which the server then pinned into what the reply may read —
        "when the user specifically brings that up then the agent can read
        it." The reason it came out is not that it failed: a chat with a
        picker, a chip, a drawer and a pinned state is four things to
        understand before you can ask a question, on a surface whose whole
        argument is that you type and it answers.

        WHAT SURVIVES, so this is one wiring job rather than a rebuild.
        The SERVER side is built, tested and live: `conversations
        .initialInspirationId`, `POST`/`PATCH` accepting it, and
        `readConversationContext` pinning the keep first in the reply's
        sources — with db tests for the round trip, the cross-profile
        refusal, and the pin reaching the model input. Migration 0070.
        Nothing on the client reaches it.

        AND THE NAMING IS WORTH KEEPING. Founder, mid-thought before
        cutting it: "maybe it should say 'reference and inspiration'
        instead of 'what is this about'." The label was the weakest part
        of what shipped, and that is a better one. */}
  </main>;
}
