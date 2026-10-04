import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {deleteConversation,fetchConversation,fetchConversationCitation,fetchConversationContext,listConversations,saveConversationMessage,type ApiConversation,type ConversationCitation,type ConversationContext,type ConversationSummary,type ConversationSourceKind} from '../lib/api/conversations';
import type {ProfileStorageScope} from '../lib/profile-storage';
import {startConversation} from '../lib/conversation-start';
import {useConversationReply} from '../lib/use-conversation-reply';
import {DialogSurface} from './DialogSurface';
import {t,type SupportedLocale} from '../lib/locales';
import {readConversationDrafts,storeConversationDraft,clearConversationDraft,clearConversationDrafts,type ConversationDraft as Draft,type StoredConversationDraft} from '../lib/conversation-drafts';

export function ConversationPanel({scope,id,locale,onChoose,onClose,onOpenSource}:{scope:ProfileStorageScope;id:string|null;locale:SupportedLocale;onChoose:(id:string|null)=>void;onClose:()=>void;onOpenSource?:(kind:ConversationSourceKind,id:string)=>void}){
  const [rows,setRows]=useState<ConversationSummary[]>([]),[conversation,setConversation]=useState<ApiConversation|null>(null),[draft,setDraft]=useState<Draft|null>(null);
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null),[storageFailed,setStorageFailed]=useState(false),[context,setContext]=useState<ConversationContext|null>(null);
  const lifecycle=useRef(new AbortController()),draftRef=useRef<Draft|null>(null);
  const conversationRef=useRef<ApiConversation|null>(null);
  const writer=useRef(crypto.randomUUID()),receipt=useRef<StoredConversationDraft|undefined>(undefined);
  const [drafts,setDrafts]=useState<StoredConversationDraft[]>([]);
  const [generationEnabled,setGenerationEnabled]=useState<boolean|null>(null);
  const [citation,setCitation]=useState<{requestId:string;index:number;value:ConversationCitation|null;failed:boolean}|null>(null),citationSerial=useRef(0);
  const body=useRef<HTMLDivElement>(null),nearBottom=useRef(true),[newMessages,setNewMessages]=useState(false);
  const say=(key:Parameters<typeof t>[1])=>t(locale,key);
  const sourceName=(kind:ConversationSourceKind)=>say(kind==='principle'?'worldConversationPrincipleRef':kind==='inspiration'?'worldConversationInspirationRef':'worldConversationReadingRef');
  const run=async<T,>(work:(signal:AbortSignal)=>Promise<T>)=>{
    const request=new AbortController(),abort=()=>request.abort();lifecycle.current.signal.addEventListener('abort',abort,{once:true});
    const timer=window.setTimeout(abort,15000);
    try{return await work(request.signal);}finally{window.clearTimeout(timer);lifecycle.current.signal.removeEventListener('abort',abort);}
  };
  const keep=(next:Draft)=>{draftRef.current=next;setDraft(next);try{if(!id)throw new Error('Missing conversation');receipt.current=storeConversationDraft(scope,id,next,receipt.current);setDrafts(readConversationDrafts(scope,id));setStorageFailed(false);return true;}catch{setStorageFailed(true);return false;}};
  const observe=(next:ApiConversation)=>{
    if(conversationRef.current&&conversationRef.current.id===next.id&&conversationRef.current.profileId===next.profileId&&conversationRef.current.revision>next.revision)next=conversationRef.current;
    conversationRef.current=next;
    setConversation(next);setGenerationEnabled(next.generationEnabled??false);setContext(null);setCitation(null);citationSerial.current++;
    const pending=draftRef.current;
    if(pending?.pending&&next.messages.some(message=>message.id===pending.id&&message.content===pending.content)){
      try{if(receipt.current)clearConversationDraft(receipt.current);}catch{setStorageFailed(true);}
      receipt.current=undefined;
      draftRef.current=null;setDraft(null);setError(null);
    }
    if(id)try{setDrafts(readConversationDrafts(scope,id));}catch{setStorageFailed(true);}
  };
  const reply=useConversationReply(scope.profileId,id,Boolean(conversation?.generationEnabled),conversation?.revision??0,observe);
  const replyPending=reply.state?.phase==='pending'||reply.state?.phase==='running';
  useLayoutEffect(()=>{const node=body.current;if(!node)return;if(nearBottom.current){node.scrollTop=node.scrollHeight;setNewMessages(false);}else setNewMessages(true);},[conversation?.messages.length]);
  const refresh=async()=>{
    setLoading(true);setError(null);
    try{if(id){const next=await run(signal=>fetchConversation(scope.profileId,id,signal));if(!lifecycle.current.signal.aborted)observe(next);}
      else{const next=await run(signal=>listConversations(scope.profileId,signal));if(!lifecycle.current.signal.aborted){setRows(next.conversations);setGenerationEnabled(next.generationEnabled);}}}
    catch{if(!lifecycle.current.signal.aborted)setError(say('worldConversationReadFailed'));}
    finally{if(!lifecycle.current.signal.aborted)setLoading(false);}
  };
  useEffect(()=>{
    lifecycle.current=new AbortController();
    if(id)try{const saved=readConversationDrafts(scope,id);setDrafts(saved);if(saved[0]){receipt.current=saved[0];draftRef.current=saved[0].value;setDraft(saved[0].value);}}catch{setStorageFailed(true);}
    void refresh();return()=>lifecycle.current.abort();
  },[scope.accountId,scope.profileId,id]);
  const start=async()=>{
    if(busy)return;setBusy(true);setError(null);
    try{const next=await run(signal=>startConversation(scope,signal));if(lifecycle.current.signal.aborted)return;
      onChoose(next.id);
    }catch{if(!lifecycle.current.signal.aborted)setError(say('worldConversationStartFailed'));}finally{if(!lifecycle.current.signal.aborted)setBusy(false);}
  };
  const save=async()=>{
    if(!id||!conversation||busy||replyPending||!draft?.content.trim()||storageFailed)return;
    const intent={...draft,revision:conversation.revision,pending:true,updatedAt:Date.now()};if(!keep(intent))return;
    setBusy(true);setError(null);
    nearBottom.current=true;
    try{const next=await run(signal=>saveConversationMessage(scope.profileId,id,{id:intent.id,content:intent.content,revision:intent.revision,...(generationEnabled?{requestReply:true}:{})},signal));if(!lifecycle.current.signal.aborted){observe(next);reply.check();}}
    catch{if(!lifecycle.current.signal.aborted)setError(say('worldConversationSaveFailed'));}finally{if(!lifecycle.current.signal.aborted)setBusy(false);}
  };
  const remove=async()=>{
    if(!id||busy||!window.confirm(say('worldConversationDeleteConfirm')))return;setBusy(true);setError(null);
    try{await run(signal=>deleteConversation(scope.profileId,id,signal));if(lifecycle.current.signal.aborted)return;clearConversationDrafts(scope,id);onChoose(null);}
    catch{if(!lifecycle.current.signal.aborted)setError(say('worldConversationDeleteFailed'));}finally{if(!lifecycle.current.signal.aborted)setBusy(false);}
  };
  const memory=async()=>{if(!id||busy)return;setBusy(true);setError(null);setContext(null);try{const next=await run(signal=>fetchConversationContext(scope.profileId,id,signal));if(!lifecycle.current.signal.aborted)setContext(next);}catch{if(!lifecycle.current.signal.aborted)setError(say('worldConversationMemoryFailed'));}finally{if(!lifecycle.current.signal.aborted)setBusy(false);}};
  const openCitation=async(requestId:string,index:number)=>{
    if(!id)return;const serial=++citationSerial.current;setCitation({requestId,index,value:null,failed:false});
    try{const value=await run(signal=>fetchConversationCitation(scope.profileId,id,requestId,index,signal));if(!lifecycle.current.signal.aborted&&serial===citationSerial.current)setCitation({requestId,index,value,failed:false});}
    catch{if(!lifecycle.current.signal.aborted&&serial===citationSerial.current)setCitation({requestId,index,value:null,failed:true});}
  };
  const fillStarter=(text:string)=>{if(!conversation||draft?.content)return;keep({id:crypto.randomUUID(),writer:writer.current,updatedAt:Date.now(),revision:conversation.revision,content:text,pending:false});};
  return <><button className="jar-review-backdrop" type="button" tabIndex={-1} aria-hidden="true" onClick={onClose}/>
    <DialogSurface className="jar-seek jar-conversation" aria-label={say('worldConversationTitle')} onClose={onClose} data-jar-chrome="1">
      <header><h2>{say('worldConversationTitle')}</h2><button type="button" onClick={onClose}>{say('worldClose')}</button></header>
      {generationEnabled===false?<p className="jar-review-context">{say('worldConversationFoundation')}</p>:null}
      {error?<p role="alert">{error} <button type="button" disabled={busy||loading} onClick={()=>void refresh()}>{say('worldConversationCheck')}</button></p>:null}
      {loading?<p role="status">{say('worldReviewChecking')}</p>:null}
      {id&&!conversation&&!loading?<button type="button" onClick={()=>onChoose(null)}>{say('worldConversationHistory')}</button>:null}
      <div className="jar-conversation-body" ref={body} onScroll={()=>{const node=body.current;if(node){nearBottom.current=node.scrollHeight-node.scrollTop-node.clientHeight<80;if(nearBottom.current)setNewMessages(false);}}}>
      {!id?<><button type="button" disabled={busy} onClick={()=>void start()}>{say('worldConversationNew')}</button>
        {!loading&&!rows.length?<p>{say('worldConversationEmpty')}</p>:null}
        <ul>{rows.map(row=><li key={row.id}><button type="button" onClick={()=>onChoose(row.id)}>{row.preview||say('worldConversationNew')}<time>{new Date(row.updatedAt).toLocaleDateString(locale)}</time></button></li>)}</ul></>:conversation?<>
        <button type="button" onClick={()=>onChoose(null)}>{say('worldConversationHistory')}</button>
        <details className="jar-conversation-options"><summary>{say('worldConversationOptions')}</summary>
          <details><summary>{say('worldConversationMemory')}</summary><button type="button" disabled={busy} onClick={()=>void memory()}>{say('worldConversationMemoryCheck')}</button>
            {context?<><p>{say('worldConversationMemoryNote')}</p><ul>{[...context.principles,...context.reading,...context.inspirations].map(row=><li key={row.id}><p>{row.text}{row.truncated?'…':''}</p>{'state' in row&&row.state==='contested'?<span>{say('worldConversationContested')}</span>:null}{'supportCurrent' in row&&!row.supportCurrent?<span>{say('worldConversationUnconfirmed')}</span>:null}</li>)}</ul></>:null}</details>
          <button type="button" disabled={busy} onClick={()=>void remove()}>{say('worldConversationDelete')}</button>
        </details>
        {conversation.initialPrinciple?<div className="jar-conversation-topic"><span className="jar-review-context">{say('worldConversationStartingFrom')}</span><blockquote>{conversation.initialPrinciple.statement}</blockquote>{conversation.initialPrinciple.state==='contested'?<p>{say('worldConversationContested')}</p>:null}</div>:null}
        <ol aria-label={say('worldConversationMessages')}>{conversation.messages.map(message=><li key={message.id} data-role={message.role}><span className="jar-review-context">{say(message.role==='user'?'worldConversationYou':'worldConversationWaka')}</span>
          {message.memoryChanged?<p className="jar-review-context">{say('worldConversationMemoryChanged')}</p>:null}<p>{message.content}</p>
          {message.followUpQuestion?<p className="jar-conversation-question">{message.followUpQuestion}</p>:null}
          {message.citations?.length&&message.replyRequestId?<div className="jar-conversation-citations" aria-label={say('worldConversationReferences')}>{message.citations.map(reference=><button key={reference.index} type="button" disabled={!reference.available} onClick={()=>void openCitation(message.replyRequestId!,reference.index)}>{sourceName(reference.kind)} {reference.index+1}{!reference.available?` · ${say('worldConversationReferenceChanged')}`:''}</button>)}</div>:null}
        </li>)}</ol>
        {citation?<section className="jar-conversation-reference" aria-label={say('worldConversationReferences')}>
          <button type="button" onClick={()=>{citationSerial.current++;setCitation(null);}}>{say('worldClose')}</button>
          {citation.failed?<p role="alert">{say('worldConversationReferenceFailed')}</p>:citation.value?<><p>{sourceName(citation.value.source.kind)}</p><blockquote>{citation.value.source.quote}</blockquote>
            {citation.value.source.state==='contested'?<p>{say('worldConversationContested')}</p>:null}{citation.value.source.supportCurrent===false?<p>{say('worldConversationUnconfirmed')}</p>:null}
            {onOpenSource&&citation.value.source.kind!=='top_of_mind_entry'?<button type="button" onClick={()=>onOpenSource(citation.value!.source.kind,citation.value!.source.id)}>{say('worldConversationOpenSource')}</button>:null}
          </>:<p role="status">{say('worldReviewChecking')}</p>}
        </section>:null}
        {conversation.messages.length===0?<><p>{say('worldConversationFirst')}</p>{generationEnabled?<div className="jar-conversation-starters">{(['worldConversationStarterChoice','worldConversationStarterMeaning','worldConversationStarterChange'] as const).map(key=><button key={key} type="button" disabled={Boolean(draft?.content)} onClick={()=>fillStarter(say(key))}>{say(key)}</button>)}</div>:null}</>:null}
      </>:null}
      </div>
      {id&&conversation?<footer>
        {newMessages?<button type="button" onClick={()=>{if(body.current)body.current.scrollTop=body.current.scrollHeight;nearBottom.current=true;setNewMessages(false);}}>{say('worldConversationLatest')}</button>:null}
        {generationEnabled?<div className="jar-conversation-reply" aria-live="polite">
          {reply.error?<p>{say('worldConversationReplyCheckFailed')}</p>:reply.state?.retryAfter&&reply.state.phase!=='ready'?<p>{say('worldConversationReplyLimit')} {new Date(reply.state.retryAfter).toLocaleTimeString(locale,{hour:'numeric',minute:'2-digit'})}</p>:
            replyPending?<p>{say(reply.waiting?'worldConversationReplyWaiting':reply.state?.phase==='running'?'worldConversationThinking':'worldConversationQueued')}{reply.state?.runAfter?` · ${new Date(reply.state.runAfter).toLocaleTimeString(locale,{hour:'numeric',minute:'2-digit'})}`:''}</p>:
            reply.state?.phase==='failed'?<p>{say('worldConversationReplyFailed')}</p>:reply.state?.phase==='stopped'?<p>{say('worldConversationReplyStopped')}</p>:reply.state?.phase==='stale'?<p>{say('worldConversationReplyStale')}</p>:null}
          {replyPending?<button type="button" disabled={reply.busy} onClick={()=>void reply.stop()}>{say('worldConversationStop')}</button>:null}
          {reply.state?.canRetry&&!reply.error?<button type="button" disabled={reply.busy||reply.checking} onClick={()=>void reply.request()}>{say(reply.state.phase==='idle'?'worldConversationAsk':'worldConversationRetryReply')}</button>:null}
          {reply.error||reply.waiting||reply.state?.retryAfter&&reply.state.phase!=='ready'?<button type="button" disabled={reply.busy||reply.checking} onClick={reply.check}>{say('worldConversationCheckReply')}</button>:null}
        </div>:null}
        {drafts.length>1?<label>{say('worldShareDrafts')}<select value={draft?.id??''} disabled={busy||storageFailed} onChange={event=>{const selected=drafts.find(row=>row.value.id===event.target.value);if(selected){receipt.current=selected;draftRef.current=selected.value;setDraft(selected.value);}}}><option value="" disabled/>{drafts.map(row=><option key={row.key} value={row.value.id}>{row.value.content.slice(0,50)}</option>)}</select></label>:null}
        <label>{say('worldConversationMessage')}<textarea maxLength={4000} rows={3} value={draft?.content??''} disabled={busy||draft?.pending} onKeyDown={event=>{if((event.metaKey||event.ctrlKey)&&event.key==='Enter'&&!event.nativeEvent.isComposing&&!event.repeat){event.preventDefault();void save();}}} onChange={event=>{const own=draft?.writer===writer.current;keep({id:own?draft.id:crypto.randomUUID(),writer:writer.current,updatedAt:Date.now(),content:event.target.value,revision:conversation.revision,pending:false});}}/></label>
        {draft?.content?<p className="jar-review-context" role="status">{say(draft.pending?(busy?'worldSaving':'worldReviewPending'):'worldReviewDraftOnDevice')}</p>:null}
        {storageFailed?<p role="alert">{say('worldConversationDraftFailed')}</p>:null}
        {draft?.pending?<button type="button" disabled={busy||loading} onClick={()=>void refresh()}>{say('worldConversationCheck')}</button>:null}
        <button type="button" disabled={busy||loading||replyPending||storageFailed||!draft?.content.trim()||conversation.revision>=(generationEnabled?199:200)} onClick={()=>void save()}>{say(draft?.pending?'worldConversationRetry':generationEnabled?'worldConversationSend':'worldConversationSave')}</button>
        {conversation.revision>=(generationEnabled?199:200)?<p>{say('worldConversationFull')}</p>:null}
      </footer>:null}
    </DialogSurface></>;
}
