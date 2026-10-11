import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createConversation,deleteConversation,fetchConversation,fetchConversationCitation,fetchConversationContext,listConversations,saveConversationMessage,type ApiConversation,type ConversationCitation,type ConversationContext,type ConversationSourceKind} from '../lib/api/conversations';
import {profileStorageKey,type ProfileStorageScope} from '../lib/profile-storage';
import {useConversationReply} from '../lib/use-conversation-reply';
import {ConversationThought} from './ConversationThought';
import {ConversationPrincipleEdit} from './ConversationPrincipleEdit';
import {ConversationMemory} from './ConversationMemory';
import {ConversationText} from './ConversationText';
import {ConversationReadingChoices} from './ConversationReadingChoices';
import {ConversationSourceDate} from './ConversationSourceDate';
import {fetchPrinciples,type ApiInspiration,type ApiPrinciple} from '../lib/api';
import {t,type SupportedLocale} from '../lib/locales';
import {readConversationDrafts,storeConversationDraft,clearConversationDraft,clearConversationDrafts,type ConversationDraft as Draft,type StoredConversationDraft} from '../lib/conversation-drafts';

export function ConversationPanel({scope,id,initialPrincipleId,initialConversation,locale,onChoose,onCreated,onOpenSource,onInspirationSaved,onPrincipleUpdated}:{scope:ProfileStorageScope;id:string|null;initialPrincipleId?:string;initialConversation?:ApiConversation;locale:SupportedLocale;onChoose:(id:string|null)=>void;onCreated?:(row:ApiConversation)=>void;onOpenSource?:(kind:ConversationSourceKind,id:string)=>void;onInspirationSaved?:(row:ApiInspiration)=>void;onPrincipleUpdated?:(row:ApiPrinciple)=>void}){
  const journal=id??`new:${initialPrincipleId??'general'}`;
  const initial=initialConversation?.id===id&&initialConversation.profileId===scope.profileId?initialConversation:null;
  const bootstrap=useRef(initial);
  const [conversation,setConversation]=useState<ApiConversation|null>(initial),[draft,setDraft]=useState<Draft|null>(null);
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(!initial),[error,setError]=useState<string|null>(null),[storageFailed,setStorageFailed]=useState(false);
  const [context,setContext]=useState<ConversationContext|null>(null),[memoryOpen,setMemoryOpen]=useState(false),[memoryBusy,setMemoryBusy]=useState(false),[memoryFailed,setMemoryFailed]=useState(false);
  const [mobile,setMobile]=useState(()=>window.matchMedia?.('(max-width:760px)').matches??false);
  const [earlierBusy,setEarlierBusy]=useState(false),[earlierFailed,setEarlierFailed]=useState(false);
  const prependScroll=useRef<{height:number;top:number}|null>(null);
  const [focusPrinciple,setFocusPrinciple]=useState<ApiPrinciple|null>(null),[focusFailed,setFocusFailed]=useState(false);
  const lifecycle=useRef(new AbortController()),draftRef=useRef<Draft|null>(null),working=useRef(false),memorySerial=useRef(0);
  const conversationRef=useRef<ApiConversation|null>(initial),writer=useRef(crypto.randomUUID()),receipt=useRef<StoredConversationDraft>();
  const [drafts,setDrafts]=useState<StoredConversationDraft[]>([]),[generationEnabled,setGenerationEnabled]=useState<boolean|null>(initial?.generationEnabled??null);
  const [readingChoice,setReadingChoice]=useState<{messageId:string;index:number}|null>(null),[readingChoiceFailed,setReadingChoiceFailed]=useState<string|null>(null),choosingReading=useRef(false);
  const [citation,setCitation]=useState<{requestId:string;index:number;value:ConversationCitation|null;failed:boolean}|null>(null),citationSerial=useRef(0);
  const root=useRef<HTMLElement>(null),body=useRef<HTMLDivElement>(null),editor=useRef<HTMLTextAreaElement>(null),nearBottom=useRef(true),[newMessages,setNewMessages]=useState(false);
  const restoredScroll=useRef<{top:number;nearBottom:boolean;messageWindowStart?:number}|null>(null),scrollKey=profileStorageKey(scope,`conversationScroll:${journal}`)!;
  const say=(key:Parameters<typeof t>[1])=>t(locale,key);
  const sourceName=(kind:ConversationSourceKind)=>say(kind==='principle'?'worldConversationPrincipleRef':kind==='inspiration'?'worldConversationInspirationRef':'worldConversationReadingRef');
  useEffect(()=>{const media=window.matchMedia?.('(max-width:760px)');if(!media)return;const change=()=>setMobile(media.matches);media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
  useLayoutEffect(()=>{const viewport=window.visualViewport,node=root.current;if(!viewport||!node)return;const update=()=>{if(!Number.isFinite(viewport.height)||viewport.height<=0||!Number.isFinite(viewport.offsetTop))return;node.style.setProperty('--chat-height',`${viewport.height}px`);node.style.setProperty('--chat-top',`${viewport.offsetTop}px`);if(nearBottom.current&&body.current)body.current.scrollTop=body.current.scrollHeight;};update();viewport.addEventListener('resize',update);viewport.addEventListener('scroll',update);return()=>{viewport.removeEventListener('resize',update);viewport.removeEventListener('scroll',update);};},[]);
  useLayoutEffect(()=>{const node=editor.current;if(!node)return;node.style.height='auto';node.style.height=`${Math.max(52,Math.min(node.scrollHeight,180))}px`;},[draft?.content,conversation?.id,loading]);
  const run=async<T,>(work:(signal:AbortSignal)=>Promise<T>)=>{
    const owner=lifecycle.current,request=new AbortController(),abort=()=>request.abort();owner.signal.addEventListener('abort',abort,{once:true});const timer=window.setTimeout(abort,15000);
    const stopped=()=>rejectStopped(new Error('Conversation request stopped'));let rejectStopped!:(error:Error)=>void;
    const canceled=new Promise<never>((_,reject)=>{rejectStopped=reject;});request.signal.addEventListener('abort',stopped,{once:true});
    try{if(owner.signal.aborted)throw new Error('Conversation request stopped');const value=await Promise.race([work(request.signal),canceled]);if(request.signal.aborted||owner.signal.aborted)throw new Error('Conversation request stopped');return value;}
    finally{window.clearTimeout(timer);owner.signal.removeEventListener('abort',abort);request.signal.removeEventListener('abort',stopped);}
  };
  const keep=(next:Draft)=>{draftRef.current=next;setDraft(next);try{receipt.current=storeConversationDraft(scope,journal,next,receipt.current);setDrafts(readConversationDrafts(scope,journal));setStorageFailed(false);return true;}catch{setStorageFailed(true);return false;}};
  const observe=(next:ApiConversation)=>{
    if(conversationRef.current?.id===next.id&&conversationRef.current.profileId===next.profileId&&conversationRef.current.revision>next.revision)next=conversationRef.current;
    conversationRef.current=next;setConversation(next);setGenerationEnabled(next.generationEnabled??false);setContext(null);setCitation(null);citationSerial.current++;memorySerial.current++;setMemoryBusy(false);
        const pending=draftRef.current;
    if(pending?.pending&&next.messages.some(message=>message.id===pending.id&&message.content===pending.content&&(message.correctsMessageId??undefined)===pending.correctsMessageId)){
      try{if(receipt.current)clearConversationDraft(receipt.current);}catch{setStorageFailed(true);}
      receipt.current=undefined;draftRef.current=null;setDraft(null);setError(null);
      if(!id){onCreated?.(next);onChoose(next.id);}
    }
    try{setDrafts(readConversationDrafts(scope,journal));}catch{setStorageFailed(true);}
  };
  const reply=useConversationReply(scope.profileId,id,Boolean(conversation?.generationEnabled),conversation?.revision??0,observe,conversation?.messageWindowStart);
  const replyPending=reply.state?.phase==='pending'||reply.state?.phase==='running';
  const latestMessage=conversation?.messages.at(-1);
  const replyUnconfirmed=Boolean(generationEnabled&&latestMessage?.role==='user'&&(!reply.state||reply.error));
  const awaitingReply=replyPending||replyUnconfirmed;
  useLayoutEffect(()=>{
    const node=body.current,panel=node?.querySelector<HTMLElement>('.jar-conversation-reference');if(!citation||!node||!panel)return;
    const visible=node.getBoundingClientRect(),opened=panel.getBoundingClientRect();
    if(opened.height>visible.height||opened.top<visible.top)node.scrollTop+=opened.top-visible.top;
    else if(opened.bottom>visible.bottom)node.scrollTop+=opened.bottom-visible.bottom;
  },[citation]);
  useLayoutEffect(()=>{const node=body.current;if(!node||!conversation)return;const saved=restoredScroll.current;
    if(prependScroll.current){const previous=prependScroll.current;node.scrollTop=previous.top+node.scrollHeight-previous.height;prependScroll.current=null;return;}
    if(saved){nearBottom.current=saved.nearBottom;node.scrollTop=saved.nearBottom?node.scrollHeight:saved.top;restoredScroll.current=null;}
    else if(nearBottom.current){node.scrollTop=node.scrollHeight;setNewMessages(false);}else setNewMessages(true);
  },[conversation?.messages.length]);
  /* THE LIST ITSELF MOVED TO THE CORNER. What this still reads it for is
     `generationEnabled` — whether replies are connected at all, which the
     composer's own state depends on and which this endpoint happens to
     carry. The conversations it returns are no longer rendered here. */
  const refreshList=async()=>{const next=await run(signal=>listConversations(scope.profileId,signal));if(!lifecycle.current.signal.aborted&&!id)setGenerationEnabled(next.generationEnabled);};
  const loadHistory=()=>{void refreshList().catch(()=>undefined);};
  const refresh=async()=>{
    setLoading(true);setError(null);
    try{
      if(id)loadHistory();else await refreshList();if(lifecycle.current.signal.aborted)return;
      const target=id??(draftRef.current?.pending?draftRef.current.conversationId:null);
      if(target){const committed=bootstrap.current;bootstrap.current=null;
        const pending=draftRef.current,from=conversationRef.current?.messageWindowStart??restoredScroll.current?.messageWindowStart;
        let next=committed?.id===target&&committed.profileId===scope.profileId?committed:await run(signal=>from!==undefined?fetchConversation(scope.profileId,target,signal,from):fetchConversation(scope.profileId,target,signal));
        // An uncertain write may not exist. First read current state; expand
        // only when its expected position is hidden by a confirmed later tail.
        const expected=pending?.pending?Math.max(1,pending.revision+1):null;
        if(expected!==null&&next.revision>=expected&&(next.messageWindowStart??1)>expected&&!next.messages.some(message=>message.id===pending!.id))next=await run(signal=>fetchConversation(scope.profileId,target,signal,expected));
        if(!lifecycle.current.signal.aborted)observe(next);}
      if(!id&&initialPrincipleId){const available=await run(signal=>fetchPrinciples({profile:scope.profileId},signal));if(!lifecycle.current.signal.aborted){const focus=available.find(row=>row.id===initialPrincipleId)??null;setFocusPrinciple(focus);setFocusFailed(!focus);}}
    }catch{if(!lifecycle.current.signal.aborted)setError(say(draftRef.current?.pending?'worldConversationSaveFailed':'worldConversationReadFailed'));}
    finally{if(!lifecycle.current.signal.aborted)setLoading(false);}
  };
  const loadEarlier=async()=>{
    if(!id||earlierBusy||busy||loading||!conversation?.messageWindowStart||conversation.messageWindowStart<=1)return;
    setEarlierBusy(true);setEarlierFailed(false);
    try{const from=Math.max(1,conversation.messageWindowStart-30),next=await run(signal=>fetchConversation(scope.profileId,id,signal,from));
      if(lifecycle.current.signal.aborted)return;
      if(next.revision<(conversationRef.current?.revision??0)||(next.messageWindowStart??1)>from)throw new Error('Older history window');
      const node=body.current;if(node)prependScroll.current={height:node.scrollHeight,top:node.scrollTop};observe(next);
    }catch{if(!lifecycle.current.signal.aborted)setEarlierFailed(true);}finally{if(!lifecycle.current.signal.aborted)setEarlierBusy(false);}
  };
  useEffect(()=>{
    lifecycle.current=new AbortController();
    try{const saved=readConversationDrafts(scope,journal);setDrafts(saved);if(saved[0]){receipt.current=saved[0];draftRef.current=saved[0].value;setDraft(saved[0].value);}}catch{setStorageFailed(true);}
    try{const saved=JSON.parse(sessionStorage.getItem(scrollKey)??'null');if(saved&&Number.isFinite(saved.top)&&saved.top>=0&&typeof saved.nearBottom==='boolean'&&(saved.messageWindowStart===undefined||Number.isSafeInteger(saved.messageWindowStart)&&saved.messageWindowStart>=1&&saved.messageWindowStart<=200))restoredScroll.current={...saved,messageWindowStart:saved.messageWindowStart??1};}catch{/* Scrolling is recoverable without a stored position. */}
    void refresh();return()=>lifecycle.current.abort();
  },[scope.accountId,scope.profileId,id,initialPrincipleId]);
  const save=async()=>{
    if(working.current||loading||generationEnabled===null||awaitingReply||!draftRef.current?.content.trim()||storageFailed||focusFailed||id&&!conversation)return;
    const current=draftRef.current,intent:Draft={...current,revision:conversation?.revision??0,pending:true,updatedAt:Date.now(),...(!id?{conversationId:current.conversationId??crypto.randomUUID()}:{})};
    if(!keep(intent))return;working.current=true;setBusy(true);setError(null);nearBottom.current=true;
    try{
      const next=id?await run(signal=>{const input={id:intent.id,content:intent.content,revision:intent.revision,...(intent.correctsMessageId?{correctsMessageId:intent.correctsMessageId}:{}),...(generationEnabled?{requestReply:true}:{})},from=conversationRef.current?.messageWindowStart;
        return from!==undefined?saveConversationMessage(scope.profileId,id,input,signal,from):saveConversationMessage(scope.profileId,id,input,signal);})
        :await run(signal=>createConversation(scope.profileId,intent.conversationId!,signal,initialPrincipleId,{id:intent.id,content:intent.content,requestReply:generationEnabled===true}));
      if(!lifecycle.current.signal.aborted){observe(next);if(id)reply.check();}
    }catch{if(!lifecycle.current.signal.aborted)setError(say('worldConversationSaveFailed'));}
    finally{working.current=false;if(!lifecycle.current.signal.aborted)setBusy(false);}
  };
  const remove=async()=>{
    if(!id||busy||!window.confirm(say('worldConversationDeleteConfirm')))return;setBusy(true);setError(null);
    try{await run(signal=>deleteConversation(scope.profileId,id,signal));if(lifecycle.current.signal.aborted)return;clearConversationDrafts(scope,id);onChoose(null);}
    catch{if(!lifecycle.current.signal.aborted)setError(say('worldConversationDeleteFailed'));}finally{if(!lifecycle.current.signal.aborted)setBusy(false);}
  };
  const memory=async()=>{
    setMemoryOpen(true);if(!id||memoryBusy)return;const serial=++memorySerial.current;setMemoryBusy(true);setMemoryFailed(false);setContext(null);
    try{const next=await run(signal=>fetchConversationContext(scope.profileId,id,signal));if(!lifecycle.current.signal.aborted&&serial===memorySerial.current)setContext(next);}
    catch{if(!lifecycle.current.signal.aborted&&serial===memorySerial.current)setMemoryFailed(true);}finally{if(!lifecycle.current.signal.aborted&&serial===memorySerial.current)setMemoryBusy(false);}
  };
  const closeMemory=()=>{setMemoryOpen(false);memorySerial.current++;setMemoryBusy(false);};
  const openCitation=async(requestId:string,index:number)=>{
    if(!id)return;const serial=++citationSerial.current;setCitation({requestId,index,value:null,failed:false});
    try{const value=await run(signal=>fetchConversationCitation(scope.profileId,id,requestId,index,signal));if(!lifecycle.current.signal.aborted&&serial===citationSerial.current)setCitation({requestId,index,value,failed:false});}
    catch{if(!lifecycle.current.signal.aborted&&serial===citationSerial.current)setCitation({requestId,index,value:null,failed:true});}
  };
  const edit=(content:string)=>{const current=draftRef.current,own=current?.writer===writer.current;keep({id:own?current.id:crypto.randomUUID(),writer:writer.current,updatedAt:Date.now(),content,revision:conversation?.revision??0,pending:false,...(current?.correctsMessageId?{correctsMessageId:current.correctsMessageId}:{})});};
  const suggestionBlocked=busy||loading||generationEnabled===null||awaitingReply||storageFailed||focusFailed||Boolean(draft?.pending||draft?.content.trim())||(conversation?.revision??0)>=(generationEnabled?199:200);
  const sendSuggestion=(content:string)=>{
    if(working.current||choosingReading.current||suggestionBlocked||draftRef.current?.pending||draftRef.current?.content.trim())return;
    edit(content);void save();
  };
  const chooseSource=async(messageId:string,requestId:string,reference:NonNullable<ApiConversation['messages'][number]['citations']>[number])=>{
    if(!id||generationEnabled!==true||suggestionBlocked||working.current||choosingReading.current||!reference.available||draftRef.current?.pending||draftRef.current?.content.trim())return;
    const revision=conversationRef.current?.revision;choosingReading.current=true;setBusy(true);setReadingChoice({messageId,index:reference.index});setReadingChoiceFailed(null);
    try{
      const current=await run(signal=>fetchConversationCitation(scope.profileId,id,requestId,reference.index,signal));
      if(lifecycle.current.signal.aborted)return;
      if(current.profileId!==scope.profileId||current.conversationId!==id||current.requestId!==requestId||current.index!==reference.index||current.source.kind!==reference.kind||current.source.id!==reference.id||conversationRef.current?.revision!==revision)throw new Error('Reading changed');
      if(draftRef.current?.pending||draftRef.current?.content.trim())return;
      const text=current.source.text.length<=3000?current.source.text:current.source.quote;
      const content=`“${text}”\n\n${current.source.historical&&current.source.recordedAt?`${say('worldChatExploreEarlierReadingMessage')} (${new Date(current.source.recordedAt).toLocaleDateString(locale,{dateStyle:'medium',timeZone:'UTC'})})`:say(reference.kind==='top_of_mind_entry'?'worldChatExploreReadingMessage':'worldChatExploreSourceMessage')}`;
      if(!keep({id:crypto.randomUUID(),writer:writer.current,updatedAt:Date.now(),content,revision:revision??0,pending:false}))return;
      nearBottom.current=true;await save();
    }catch{if(!lifecycle.current.signal.aborted)setReadingChoiceFailed(messageId);}
    finally{choosingReading.current=false;if(!lifecycle.current.signal.aborted){setReadingChoice(null);setBusy(false);}}
  };
  const first=conversation?.initialPrinciple??focusPrinciple,canCompose=!id||Boolean(conversation);
  const otherDrafts=drafts.filter(row=>row.value.content.trim()&&row.value.id!==draft?.id);
  return <main ref={root} className="chat-page" data-memory-open={memoryOpen||undefined}>
    <div className="chat-top">
      {/* The switcher at the top of the screen names this page too, so the
          name is not printed again here. See Menu's `label`. */}
      {/* ALL CONVERSATIONS IS NOT HERE ANY MORE. It is the top-left corner
          now, on every screen including this one, so a second door to the
          same list sitting in this page's own row was the duplication the
          corner was built to remove.
          What is left is the one thing that belongs to THIS conversation:
          what the reply was allowed to read. */}
      <button type="button" aria-expanded={memoryOpen} onClick={()=>memoryOpen?closeMemory():void memory()}>{say('worldChatMemory')}</button>
      {id||otherDrafts.length?<details className="chat-options"><summary aria-label={say('worldConversationOptions')}>···</summary><div className="chat-options-menu">
        {otherDrafts.length?<label>{say('worldShareDrafts')}<select value="" disabled={busy||Boolean(draft?.pending)||storageFailed} onChange={event=>{const selected=drafts.find(row=>row.value.id===event.target.value);if(selected){receipt.current=selected;draftRef.current=selected.value;setDraft(selected.value);}}}>
          <option value="">{say('worldConversationMessage')}</option>{otherDrafts.map(row=><option key={row.key} value={row.value.id}>{row.value.content.slice(0,50)}</option>)}
        </select></label>:null}
        {id?<button type="button" disabled={busy} onClick={()=>void remove()}>{say('worldConversationDelete')}</button>:null}
      </div></details>:null}
    </div>
    {memoryOpen?<button type="button" className="chat-drawer-backdrop" aria-hidden="true" tabIndex={-1} onClick={closeMemory}/>:null}
    <section className="chat-main" aria-label={say('worldConversationTitle')}>
      {generationEnabled===false?<p className="chat-notice">{say('worldConversationFoundation')}</p>:null}
      {error?<div className="chat-notice" role="alert">{error} {!draft?.pending?<button type="button" disabled={busy||loading} onClick={()=>void refresh()}>{say('worldRoomHistoryRetry')}</button>:null}
        {/* THE WAY OUT SITS BESIDE THE FAILURE. When a conversation cannot be
            opened there is no box to type in, so starting a fresh one is the
            only move left — and it used to be a button in a column down the
            side of the page. It belongs next to the sentence that says the
            conversation is gone. */}
        {!conversation&&!draft?.pending?<button type="button" disabled={busy} onClick={()=>onChoose(null)}>{say('worldConversationNew')}</button>:null}</div>:null}
      {loading?<p className="chat-notice" role="status">{say('worldChatLoading')}</p>:null}
      {focusFailed?<p className="chat-notice" role="alert">{say('worldPrincipleUnavailable')} <button type="button" onClick={()=>onChoose(null)}>{say('worldConversationNew')}</button></p>:null}
      <div className="jar-conversation-body chat-scroll" ref={body} onScroll={()=>{const node=body.current;if(!node)return;nearBottom.current=node.scrollHeight-node.scrollTop-node.clientHeight<80;if(nearBottom.current)setNewMessages(false);try{sessionStorage.setItem(scrollKey,JSON.stringify({top:node.scrollTop,nearBottom:nearBottom.current,...(conversationRef.current?.messageWindowStart!==undefined?{messageWindowStart:conversationRef.current.messageWindowStart}:{})}));}catch{/* The transcript remains available. */}}}>
        <div className="chat-transcript">
          {(conversation?.messageWindowStart??1)>1?<div className="chat-earlier"><button type="button" disabled={earlierBusy||busy||loading} onClick={()=>void loadEarlier()}>{say(earlierBusy?'worldChatEarlierLoading':'worldChatEarlierMessages')}</button>{earlierFailed?<p role="alert">{say('worldChatEarlierFailed')}</p>:null}</div>:null}
          {first?<div className="chat-topic"><span>{say('worldConversationStartingFrom')}</span><blockquote>{first.statement}</blockquote>{first.state==='contested'?<p>{say('worldConversationContested')}</p>:null}</div>:null}
          {canCompose&&!conversation?.messages.length&&!draft?.pending?<section className="chat-welcome"><h2>{say('worldConversationFirst')}</h2><p>{say('worldChatContextHint')}</p><div className="chat-starters">
            {(['worldConversationStarterChoice','worldConversationStarterMeaning','worldConversationStarterChange'] as const).map(key=><button key={key} type="button" disabled={suggestionBlocked} onClick={()=>sendSuggestion(say(key))}>{say(key)}</button>)}
          </div></section>:null}
          <ol className="chat-messages" aria-label={say('worldConversationMessages')} aria-live="polite" aria-relevant="additions">
            {(conversation?.messages??[]).map(message=><li key={message.id} data-role={message.role}><p className="chat-message-heading">{say(message.role==='user'?'worldConversationYou':'worldConversationWaka')}</p>
              {message.memoryChanged?<p className="chat-muted">{say('worldConversationMemoryChanged')}</p>:null}
              <ConversationText text={message.content}/>{message.followUpQuestion?<ConversationText text={message.followUpQuestion}/>:null}
              {message.correctsMessageId?<><p className="chat-muted">{say('worldChatCorrectionSaved')}</p><ConversationPrincipleEdit scope={scope} contextId={`${id}:${message.id}`} locale={locale} onUpdated={row=>{onPrincipleUpdated?.(row);void refresh();reply.check();}}/></>:null}
              <ConversationThought scope={scope} message={message} locale={locale} onSaved={row=>{onInspirationSaved?.(row);void refresh();}} onOpen={onOpenSource?sourceId=>onOpenSource('inspiration',sourceId):undefined}
                actions={message.role==='assistant'?<button type="button" disabled={busy||Boolean(draft?.content)||Boolean(draft?.pending)} onClick={()=>{keep({id:crypto.randomUUID(),writer:writer.current,updatedAt:Date.now(),content:'',revision:conversation!.revision,pending:false,correctsMessageId:message.id});editor.current?.focus();}}>{say('worldChatCorrectReply')}</button>:null}/>
              {message.citations?.length?<details className="chat-source-summary"><summary>{say('worldConversationReferences')} ({message.citations.length})</summary>
              {message.replyRequestId&&message.id===latestMessage?.id&&generationEnabled&&message.citations?.some(reference=>reference.kind==='top_of_mind_entry')?<ConversationReadingChoices
                references={message.citations.filter(reference=>reference.kind==='top_of_mind_entry')} locale={locale} disabled={suggestionBlocked} hasDraft={Boolean(draft?.content.trim())}
                opening={readingChoice?.messageId===message.id?readingChoice.index:null} failed={readingChoiceFailed===message.id}
                onChoose={reference=>void chooseSource(message.id,message.replyRequestId!,reference)}/>:null}
              {message.citations?.some(reference=>!(message.id===latestMessage?.id&&generationEnabled&&reference.kind==='top_of_mind_entry'))&&message.replyRequestId?<div className="chat-citations jar-conversation-citations" aria-label={say('worldConversationReferences')}>{message.citations.filter(reference=>!(message.id===latestMessage?.id&&generationEnabled&&reference.kind==='top_of_mind_entry')).map(reference=><button key={reference.index} type="button" disabled={!reference.available} aria-expanded={citation?.requestId===message.replyRequestId&&citation?.index===reference.index} onClick={()=>void openCitation(message.replyRequestId!,reference.index)}><span>{sourceName(reference.kind)} {reference.index+1}</span><ConversationSourceDate locale={locale} historical={reference.historical} recordedAt={reference.recordedAt}/>{reference.preview?<span className="jar-citation-preview">{reference.preview}{reference.preview.length===96?'…':''}</span>:null}{!reference.available?` · ${say('worldConversationReferenceChanged')}`:''}</button>)}</div>:null}
              {citation&&citation.requestId===message.replyRequestId?<section className="jar-conversation-reference" aria-label={say('worldConversationReferences')}>
                <button type="button" onClick={()=>{citationSerial.current++;setCitation(null);}}>{say('worldClose')}</button>
                {citation.failed?<p role="alert">{say('worldConversationReferenceFailed')}</p>:citation.value?<><p>{sourceName(citation.value.source.kind)}</p><ConversationSourceDate locale={locale} historical={citation.value.source.historical} recordedAt={citation.value.source.recordedAt}/><blockquote>{citation.value.source.quote}</blockquote>
                  {generationEnabled&&message.citations?.find(reference=>reference.index===citation.index&&reference.available)?<button type="button" disabled={suggestionBlocked} onClick={()=>{const reference=message.citations!.find(row=>row.index===citation.index)!;void chooseSource(message.id,message.replyRequestId!,reference);}}>{say('worldChatDiscussSource')}</button>:null}
                  {draft?.content.trim()&&generationEnabled?<p className="chat-muted">{say('worldChatReadingDraft')}</p>:null}
                  {readingChoiceFailed===message.id?<p role="alert">{say('worldChatSourceSelectionFailed')}</p>:null}
                  {citation.value.source.state==='contested'?<p>{say('worldConversationContested')}</p>:null}{citation.value.source.supportCurrent===false?<p>{say('worldConversationUnconfirmed')}</p>:null}
                  {onOpenSource&&citation.value.source.kind!=='top_of_mind_entry'?<button type="button" onClick={()=>onOpenSource(citation.value!.source.kind,citation.value!.source.id)}>{say('worldConversationOpenSource')}</button>:null}
                </>:<p role="status">{say('worldChatMemoryLoading')}</p>}
              </section>:null}
              </details>:null}
            </li>)}
            {draft?.pending&&!conversation?.messages.some(message=>message.id===draft.id)?<li className="chat-sending" data-role="user"><span>{say('worldConversationYou')}</span><ConversationText text={draft.content}/><small role="status">{say(busy?'worldChatSending':'worldReviewPending')}</small></li>:null}
          </ol>
          {awaitingReply&&!reply.error?<div className="chat-thinking" role="status"><span className="chat-thinking-dots" aria-hidden="true"><i/><i/><i/></span> {say(reply.waiting?'worldConversationReplyWaiting':reply.state?.phase==='running'?'worldConversationThinking':'worldConversationQueued')}</div>:null}
        </div>
      </div>
      {canCompose?<footer className="chat-composer">
        {draft?.correctsMessageId?<div className="chat-correction"><span>{say('worldChatCorrectionNote')}</span><button type="button" disabled={busy||draft.pending} onClick={()=>keep({...draft,correctsMessageId:undefined})}>{say('worldChatCancelCorrection')}</button></div>:null}
        {newMessages?<button type="button" onClick={()=>{if(body.current)body.current.scrollTop=body.current.scrollHeight;nearBottom.current=true;setNewMessages(false);}}>{say('worldConversationLatest')}</button>:null}
        {generationEnabled?<div className="chat-reply-status" aria-live="polite">
          {reply.error?<p>{say('worldConversationReplyCheckFailed')}</p>:reply.state?.retryAfter&&reply.state.phase!=='ready'?<p>{say('worldConversationReplyLimit')} {new Date(reply.state.retryAfter).toLocaleTimeString(locale,{hour:'numeric',minute:'2-digit'})}</p>:
            reply.state?.phase==='failed'?<p>{say('worldConversationReplyFailed')}</p>:reply.state?.phase==='stopped'?<p>{say('worldConversationReplyStopped')}</p>:reply.state?.phase==='stale'?<p>{say('worldConversationReplyStale')}</p>:null}
          {replyPending?<button type="button" disabled={reply.busy} onClick={()=>void reply.stop()}>{say('worldConversationStop')}</button>:null}
          {reply.state?.canRetry&&!reply.error?<button type="button" disabled={reply.busy||reply.checking} onClick={()=>void reply.request()}>{say(reply.state.phase==='idle'?'worldConversationAsk':'worldConversationRetryReply')}</button>:null}
          {reply.error||reply.waiting||reply.state?.retryAfter&&reply.state.phase!=='ready'?<button type="button" disabled={reply.busy||reply.checking} onClick={reply.check}>{say('worldConversationCheckReply')}</button>:null}
        </div>:null}
        <div className="chat-input-row"><label className="chat-input-label"><span>{say(draft?.correctsMessageId?'worldChatCorrectionPrompt':'worldConversationMessage')}</span><textarea ref={editor} autoFocus={!mobile} maxLength={4000} rows={1} aria-label={say(draft?.correctsMessageId?'worldChatCorrectionPrompt':'worldConversationMessage')} placeholder={say('worldConversationFirst')} value={draft?.content??''} disabled={busy||draft?.pending} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.altKey&&(!mobile||event.metaKey||event.ctrlKey)&&!event.nativeEvent.isComposing&&event.nativeEvent.keyCode!==229&&!event.repeat){event.preventDefault();void save();}}} onChange={event=>edit(event.target.value)}/></label>
          <button className="chat-send" type="button" disabled={busy||loading||generationEnabled===null||awaitingReply||storageFailed||focusFailed||!draft?.content.trim()||(conversation?.revision??0)>=(generationEnabled?199:200)} onClick={()=>void save()}>{say(busy&&draft?.pending?'worldChatSending':draft?.pending?'worldConversationRetry':draft?.correctsMessageId?'worldChatSendCorrection':generationEnabled?'worldConversationSend':'worldConversationSave')}</button>
        </div>
        {draft?.content&&!draft.pending?<small className="chat-muted" role="status">{say('worldReviewDraftOnDevice')}</small>:null}
        {storageFailed?<p role="alert">{say('worldConversationDraftFailed')}</p>:null}
        {draft?.pending?<button type="button" disabled={busy||loading} onClick={()=>void refresh()}>{say('worldConversationCheck')}</button>:null}
        {(conversation?.revision??0)>=(generationEnabled?199:200)?<p>{say('worldConversationFull')}</p>:null}
      </footer>:null}
    </section>
    {memoryOpen?<ConversationMemory context={context} startingPrinciple={first} locale={locale} busy={memoryBusy} error={memoryFailed} canRead={Boolean(id&&conversation)} onRead={()=>void memory()} onClose={closeMemory}/>:null}
  </main>;
}
